import { useEffect, useState } from "react";
import { eur, poruka } from "../lib/api";
import {
  AuthError,
  dohvatiPregled,
  odjavi,
  preuzmiHoldere,
  procitajSesiju,
  type OrgEvent,
  type OrgPregled,
  type Sesija,
} from "../lib/auth";
import Prijava from "./Prijava";

/**
 * Pregled prodaje za organizatora — čitanje, ne uređivanje.
 *
 * Namjerno uzak opseg: organizator mora moći vidjeti koliko je prodano i
 * izvesti popis sudionika bez da nas zove. Uređivanje događaja, Stripe
 * onboarding i DAC7 obrazac su U3 i traže puno više (v. handoff).
 *
 * Brojevi dolaze iz `organizer_overview` RPC-a, pozvanog S KORISNIKOVIM JWT-om
 * — RLS odlučuje što ovaj korisnik smije vidjeti. Ovdje nema filtriranja po
 * accountu u kodu, i to je namjerno: filter u klijentu je ukras, ne zaštita.
 *
 * ⚠️ REVIEW(fable): „prodano" je `inventory_claimed`, što uključuje i
 * REZERVIRANE (pending) narudžbe, ne samo plaćene. Za organizatora je to
 * optimistična brojka — 20 min nakon isteka rezervacije padne. Točan broj
 * plaćenih traži ili dodatni upit nad `contributions` ili novo polje u
 * `organizer_overview`; nisam htio mijenjati RPC bez potrebe, ali stupac je
 * zato izrijekom nazvan „zauzeto", ne „prodano".
 */
export default function Organizator() {
  const [sesija, setSesija] = useState<Sesija | null>(procitajSesiju);
  const [pregled, setPregled] = useState<OrgPregled | null>(null);
  const [greska, setGreska] = useState<string | null>(null);

  useEffect(() => {
    if (!sesija) return;
    dohvatiPregled(sesija.access_token)
      .then(setPregled)
      .catch((e) => {
        if ((e as AuthError).code === "nije_prijavljen") setSesija(null);
        else setGreska(poruka((e as AuthError).code));
      });
  }, [sesija]);

  if (!sesija) return <Prijava naslov="Pregled prodaje" onPrijava={setSesija} />;

  return (
    <main className="omot">
      <div className="skener__vrh">
        <h1 style={{ margin: 0 }}>Pregled prodaje</h1>
        <button
          className="gumb gumb--tanki"
          onClick={() => {
            odjavi();
            setSesija(null);
          }}
        >
          Odjava
        </button>
      </div>
      <p className="meta">{sesija.email}</p>

      {greska && <div className="greska">{greska}</div>}
      {!pregled && !greska && <p className="mutno">Učitavanje…</p>}

      {pregled?.accounts.map((a) => (
        <div key={a.id} className="kartica">
          <strong>{a.name}</strong>
          <div className="mutno" style={{ marginTop: 4 }}>
            {a.allowlisted ? "objava dopuštena" : "objava još nije odobrena"} ·{" "}
            {a.has_record ? "podaci izdavatelja upisani" : "nedostaju podaci izdavatelja (DAC7)"}
          </div>
        </div>
      ))}

      {pregled?.events.length === 0 && <p className="mutno">Nemate nijedan događaj.</p>}
      {pregled?.events.map((d) => (
        <Dogadjaj key={d.campaign_id} d={d} token={sesija.access_token} />
      ))}

      <p className="podnozje">
        Isplate i računi kartičnih uplata su na vašem Stripe računu — platforma ne
        drži vaš novac i ne naplaćuje naknadu na prodaju.
      </p>
    </main>
  );
}

function Dogadjaj({ d, token }: { d: OrgEvent; token: string }) {
  const [radi, setRadi] = useState(false);
  const [greska, setGreska] = useState<string | null>(null);

  const zauzeto = d.tiers.reduce((n, t) => n + t.inventory_claimed, 0);
  const prihod = d.tiers.reduce((n, t) => n + t.inventory_claimed * t.price_cents, 0);
  const imenskih = d.tiers.some((t) => t.imenska);

  return (
    <div className="kartica">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <strong>{d.title}</strong>
          <div className="mutno">
            {d.event?.venue_city ?? ""} ·{" "}
            {d.state === "active" ? <span className="oznaka oznaka--ok">objavljen</span> : <span className="oznaka">{d.state}</span>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 600 }}>{eur(prihod)}</div>
          <div className="mutno">{zauzeto} ulaznica</div>
        </div>
      </div>

      {d.tiers.length === 0 && <p className="mutno" style={{ marginTop: 12 }}>Cjenik još nije objavljen.</p>}
      {d.tiers.map((t) => (
        <div key={t.id} className="sazetak">
          <span>{t.title}</span>
          <span>
            {t.inventory_claimed}
            {t.inventory_total !== null ? ` / ${t.inventory_total}` : ""} · {eur(t.price_cents)}
          </span>
        </div>
      ))}

      {greska && <div className="greska" style={{ marginTop: 12 }}>{greska}</div>}

      {imenskih && (
        <button
          className="gumb gumb--tanki"
          style={{ marginTop: 12 }}
          disabled={radi}
          onClick={async () => {
            setGreska(null);
            setRadi(true);
            try {
              const blob = await preuzmiHoldere(token, d.campaign_id);
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `sudionici-${d.slug || d.campaign_id.slice(0, 8)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            } catch (e) {
              setGreska(poruka((e as AuthError).code));
            } finally {
              setRadi(false);
            }
          }}
        >
          {radi ? "Pripremam…" : "Preuzmi popis sudionika (CSV)"}
        </button>
      )}
    </div>
  );
}
