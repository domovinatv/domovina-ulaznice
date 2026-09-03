import { useCallback, useEffect, useRef, useState } from "react";
import { poruka } from "../lib/api";
import {
  AuthError,
  dohvatiPregled,
  odjavi,
  procitajSesiju,
  skenirajToken,
  type OrgEvent,
  type SkenRezultat,
  type Sesija,
} from "../lib/auth";
import Prijava from "./Prijava";

/**
 * Skener ulaza (U4).
 *
 * Tri stvari koje su na vratima važnije od svega ostalog:
 *   1. **Odbijanje mora biti glasno.** Buka na ulazu je stvarna; ⛔ je crven,
 *      preko cijele širine, uz zvuk i vibraciju. Tiho odbijanje = propušten ulaz.
 *   2. **Autorizacija je server-side pri SVAKOM skenu.** Ukraden mobitel s
 *      otvorenom aplikacijom bez valjanog tokena ne može ništa — `redeem_ticket`
 *      traži `auth.uid()` i admin rolu organizatora.
 *   3. **Anti-double-entry je u bazi.** Dva uređaja koja skeniraju istu ulaznicu
 *      rješava row lock u jezgri; prvi pobjeđuje, drugi dobije vrijeme prvog
 *      ulaska. Klijent ne pokušava biti pametan.
 *
 * Offline: opcija A iz handoffa U4 — online-only uz jasnu poruku. Predučitani
 * vaučeri (opcija B) donose rizik duplog ulaza kad dva uređaja rade bez mreže,
 * a to je na ulazu nepopravljiva šteta.
 *
 * ⚠️ REVIEW(fable): `BarcodeDetector` ne postoji u Safariju. Na iPhoneu skener
 * zato nudi samo ručni unos, što je za pravi ulaz nedovoljno. Ispravno rješenje
 * je bundlati `zxing-wasm` kao fallback (~250 kB, lazy import samo kad detektora
 * nema) — svjesno nije napravljeno u ovom prolazu jer je jedina staza kojom to
 * mogu dokazati stvarni uređaj, ne test. Do tada: Android/Chrome na ulazu.
 */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

const QR_PREFIX = "dgdj1:";
const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Zvuk bez datoteke: kratki ton iz WebAudija (uspjeh visok, odbijanje nisko). */
function zvuk(ok: boolean): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.4));
    osc.onended = () => void ctx.close();
  } catch {
    /* bez zvuka se i dalje vidi rezultat */
  }
}

const vibriraj = (ok: boolean): void => {
  try {
    navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
  } catch {
    /* nema haptike */
  }
};

function vrijemeHr(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("hr-HR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(d);
}

export default function Skener() {
  const [sesija, setSesija] = useState<Sesija | null>(procitajSesiju);
  const [dogadjaji, setDogadjaji] = useState<OrgEvent[] | null>(null);
  const [odabrani, setOdabrani] = useState<OrgEvent | null>(null);
  const [greska, setGreska] = useState<string | null>(null);

  useEffect(() => {
    if (!sesija) return;
    dohvatiPregled(sesija.access_token)
      .then((p) => setDogadjaji(p.events))
      .catch((e) => {
        if ((e as AuthError).code === "nije_prijavljen") setSesija(null);
        else setGreska(poruka((e as AuthError).code));
      });
  }, [sesija]);

  if (!sesija) return <Prijava naslov="Skener ulaza" onPrijava={setSesija} />;

  if (!odabrani) {
    return (
      <main className="omot">
        <h1>Skener ulaza</h1>
        <p className="meta">{sesija.email}</p>
        {greska && <div className="greska">{greska}</div>}
        {!dogadjaji && <p className="mutno">Učitavanje događaja…</p>}
        {dogadjaji?.length === 0 && <p className="mutno">Nemate nijedan događaj.</p>}
        {dogadjaji?.map((d) => (
          <button key={d.campaign_id} className="tier tier--gumb" onClick={() => setOdabrani(d)}>
            <div>
              <div style={{ fontWeight: 600 }}>{d.title}</div>
              <div className="mutno">
                {d.event?.venue_city ?? ""} · {d.state === "active" ? "objavljen" : d.state}
              </div>
            </div>
            <span aria-hidden="true">→</span>
          </button>
        ))}
        <p className="podnozje">
          <button
            className="gumb gumb--tanki"
            onClick={() => {
              odjavi();
              setSesija(null);
            }}
          >
            Odjava
          </button>
        </p>
      </main>
    );
  }

  return (
    <SkenerKamera
      sesija={sesija}
      dogadjaj={odabrani}
      natrag={() => setOdabrani(null)}
      istekla={() => setSesija(null)}
    />
  );
}

function SkenerKamera({
  sesija,
  dogadjaj,
  natrag,
  istekla,
}: {
  sesija: Sesija;
  dogadjaj: OrgEvent;
  natrag: () => void;
  istekla: () => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const platno = useRef<HTMLCanvasElement | null>(null);
  const zadnji = useRef<{ token: string; kad: number }>({ token: "", kad: 0 });
  const zauzet = useRef(false);
  const [rezultat, setRezultat] = useState<SkenRezultat | null>(null);
  const [poruke, setPoruke] = useState<string | null>(null);
  const [kameraRadi, setKameraRadi] = useState(false);
  const [rucni, setRucni] = useState("");

  const imaDetektor = typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector === "function";

  const posalji = useCallback(
    async (sirovo: string) => {
      const token = (sirovo.startsWith(QR_PREFIX) ? sirovo.slice(QR_PREFIX.length) : sirovo).trim().toLowerCase();
      if (!TOKEN_RE.test(token)) {
        setPoruke("Pročitani kod nije ulaznica ovog sustava.");
        zvuk(false);
        return;
      }
      // Isti kod pred kamerom ne šalje se svakih 100 ms.
      if (zadnji.current.token === token && Date.now() - zadnji.current.kad < 3000) return;
      zadnji.current = { token, kad: Date.now() };

      setPoruke(null);
      try {
        const r = await skenirajToken(sesija.access_token, token);
        setRezultat(r);
        const ok = r.status === "checked_in";
        zvuk(ok);
        vibriraj(ok);
      } catch (e) {
        const code = (e as AuthError).code;
        if (code === "nije_prijavljen" || code === "not_authenticated") {
          istekla();
          return;
        }
        setPoruke(poruka(code));
        zvuk(false);
      }
    },
    [sesija.access_token, istekla],
  );

  // Petlja skeniranja: jedan frame svakih 150 ms, bez paralelnih detekcija.
  useEffect(() => {
    if (!imaDetektor) return;
    let stani = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (stani) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
          setKameraRadi(true);
        }
        const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike })
          .BarcodeDetector;
        const detektor = new Detector({ formats: ["qr_code"] });

        const tik = async () => {
          if (stani || zauzet.current || !video.current || !platno.current) return;
          zauzet.current = true;
          try {
            const v = video.current;
            const c = platno.current;
            if (v.videoWidth > 0) {
              c.width = v.videoWidth;
              c.height = v.videoHeight;
              c.getContext("2d")?.drawImage(v, 0, 0);
              const nalazi = await detektor.detect(c);
              if (nalazi[0]?.rawValue) await posalji(nalazi[0].rawValue);
            }
          } catch {
            /* pojedinačni frame smije pasti */
          } finally {
            zauzet.current = false;
          }
        };
        timer = window.setInterval(() => void tik(), 150);
      } catch {
        setPoruke("Kamera nije dostupna. Provjerite dopuštenje u pregledniku.");
      }
    })();

    return () => {
      stani = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [imaDetektor, posalji]);

  const ton =
    rezultat?.status === "checked_in" ? "ok" : rezultat ? "lose" : null;

  return (
    <main className="omot">
      <div className="skener__vrh">
        <button className="gumb gumb--tanki" onClick={natrag}>← Događaji</button>
        <span className="mutno">{dogadjaj.title}</span>
      </div>

      {rezultat && (
        <div className={`sken sken--${ton}`} role="status" aria-live="assertive">
          <div className="sken__znak" aria-hidden="true">{rezultat.status === "checked_in" ? "✅" : "⛔"}</div>
          <div className="sken__tekst">
            {rezultat.status === "checked_in" && (
              <>
                <strong>{rezultat.holder_name ?? "Ulaznica vrijedi"}</strong>
                <div>{rezultat.tier_title ?? ""} · {rezultat.serial}</div>
                <div className="mutno">ušlo: {rezultat.checked_in_count ?? "?"}</div>
              </>
            )}
            {rezultat.status === "already_checked_in" && (
              <>
                <strong>VEĆ UŠAO</strong>
                <div>{rezultat.holder_name ?? ""} · {rezultat.serial}</div>
                <div>prvi ulazak: {vrijemeHr(rezultat.checked_in_at)}</div>
                {rezultat.checked_in_by_email && <div className="mutno">skenirao: {rezultat.checked_in_by_email}</div>}
              </>
            )}
            {rezultat.status === "void" && (
              <>
                <strong>PONIŠTENA</strong>
                <div>{rezultat.serial}</div>
              </>
            )}
            {rezultat.status === "not_found" && <strong>NEPOZNATA ULAZNICA</strong>}
          </div>
        </div>
      )}

      {poruke && <div className="greska">{poruke}</div>}

      {imaDetektor ? (
        <div className="kartica">
          <video ref={video} className="skener__video" playsInline muted />
          <canvas ref={platno} hidden />
          <p className="mutno">{kameraRadi ? "Usmjerite kameru na QR kod." : "Pokrećem kameru…"}</p>
        </div>
      ) : (
        <div className="obavijest">
          Ovaj preglednik ne može čitati QR kod (nema <code>BarcodeDetector</code> — tipično Safari na
          iPhoneu). Za ulaz koristite Chrome na Androidu ili upišite kod ručno.
        </div>
      )}

      <form
        className="kartica"
        onSubmit={(e) => {
          e.preventDefault();
          void posalji(rucni);
          setRucni("");
        }}
      >
        <label htmlFor="rucni">Ručni unos koda s ulaznice</label>
        <input
          id="rucni"
          value={rucni}
          onChange={(e) => setRucni(e.target.value)}
          placeholder="dgdj1:… ili 64 znaka"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="gumb gumb--tanki" type="submit" disabled={!rucni.trim()}>Provjeri</button>
        {/* Serial (npr. SUS-000004) ovdje NE radi: jezgra prima samo QR token.
            Ručni ulaz po serialu traži novi RPC — v. REVIEW na vrhu datoteke. */}
        <p className="mutno">Serial ulaznice nije dovoljan — potreban je kod iz QR-a.</p>
      </form>
    </main>
  );
}
