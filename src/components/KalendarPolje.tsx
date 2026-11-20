import { useEffect, useRef, useState } from "react";
import { DANI_KRATKO, danasUZagrebu, mrezaMjeseca, nazivMjeseca, opisVremena } from "../lib/kalendar";

/**
 * Polje datuma i vremena za editor događaja: gumb s datumom ispisanim po
 * hrvatski, a klik otvara kalendar (tjedan od ponedjeljka) i izbor sata.
 * Vrijednost je zidno vrijeme „YYYY-MM-DDTHH:MM” po Zagrebu, kao datetime-local.
 *
 * `od` onemogućuje ranije dane (kraj ne smije prije početka), `oznaceno` je
 * datum početka koji se u kalendaru kraja vidi kao raspon.
 */
interface Props {
  id: string;
  oznaka: string;
  vrijednost: string;
  onChange: (v: string) => void;
  /** „YYYY-MM-DD”: dani prije ovoga su onemogućeni. */
  od?: string;
  /** „YYYY-MM-DD”: početak raspona (za polje kraja). */
  oznaceno?: string;
  /** Sat koji se predloži kad se prvi put bira dan, „HH:MM”. */
  zadaniSat?: string;
  /** Mjesec koji se otvori kad je polje prazno, „YYYY-MM-DD”. */
  otvoriNa?: string;
  greska?: string;
  neobavezno?: boolean;
}

const SATI = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTE = ["00", "15", "30", "45"];

export default function KalendarPolje({
  id,
  oznaka,
  vrijednost,
  onChange,
  od,
  oznaceno,
  zadaniSat = "20:00",
  otvoriNa,
  greska,
  neobavezno,
}: Props) {
  const [otvoreno, setOtvoreno] = useState(false);
  const korijen = useRef<HTMLDivElement>(null);
  const danas = danasUZagrebu();
  const [datum, sat] = vrijednost ? vrijednost.split("T") : ["", ""];
  const polaziste = datum || otvoriNa || danas;
  const [prikaz, setPrikaz] = useState(() => ({ g: +polaziste.slice(0, 4), m: +polaziste.slice(5, 7) - 1 }));

  // pri otvaranju kalendar skoči na odabrani (ili predloženi) mjesec
  useEffect(() => {
    if (otvoreno) setPrikaz({ g: +polaziste.slice(0, 4), m: +polaziste.slice(5, 7) - 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otvoreno]);

  useEffect(() => {
    if (!otvoreno) return;
    const van = (e: MouseEvent) => {
      if (!korijen.current?.contains(e.target as Node)) setOtvoreno(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOtvoreno(false);
    document.addEventListener("mousedown", van);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", van);
      document.removeEventListener("keydown", esc);
    };
  }, [otvoreno]);

  const [hh, mm] = (sat || zadaniSat).split(":");
  const minute = MINUTE.includes(mm) ? MINUTE : [...MINUTE, mm].sort();
  const pomakni = (n: number) =>
    setPrikaz(({ g, m }) => ({ g: m + n < 0 ? g - 1 : m + n > 11 ? g + 1 : g, m: (m + n + 12) % 12 }));
  const opis = opisVremena(vrijednost);
  const najranije = od && od > danas ? od : danas;

  return (
    <div className="kal" ref={korijen}>
      <label htmlFor={id}>{oznaka}</label>
      <button
        id={id}
        type="button"
        className={`kal__polje${opis ? "" : " kal__polje--prazno"}`}
        aria-haspopup="dialog"
        aria-expanded={otvoreno}
        aria-invalid={greska ? true : undefined}
        onClick={() => setOtvoreno((o) => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <span>{opis ?? "Odaberi datum i sat"}</span>
      </button>
      {greska && <p className="editor__greska">{greska}</p>}

      {otvoreno && (
        <div className="kal__ploca" role="dialog" aria-label={oznaka}>
          <div className="kal__vrh">
            <button type="button" className="kal__strelica" onClick={() => pomakni(-1)} aria-label="Prethodni mjesec">
              ‹
            </button>
            <strong>{nazivMjeseca(prikaz.g, prikaz.m)}</strong>
            <button type="button" className="kal__strelica" onClick={() => pomakni(1)} aria-label="Sljedeći mjesec">
              ›
            </button>
          </div>
          <div className="kal__mreza" role="grid">
            {DANI_KRATKO.map((d) => (
              <span key={d} className="kal__dan-tjedna" role="columnheader">
                {d}
              </span>
            ))}
            {mrezaMjeseca(prikaz.g, prikaz.m).map((d) => {
              const onemogucen = d.iso < najranije;
              const odabran = d.iso === datum;
              const uRasponu = oznaceno && datum && d.iso >= oznaceno && d.iso <= datum;
              const klase = [
                "kal__dan",
                d.uMjesecu ? "" : "kal__dan--izvan",
                d.iso === danas ? "kal__dan--danas" : "",
                odabran ? "kal__dan--odabran" : "",
                d.iso === oznaceno ? "kal__dan--pocetak" : "",
                uRasponu && !odabran ? "kal__dan--raspon" : "",
              ].join(" ");
              return (
                <button
                  key={d.iso}
                  type="button"
                  className={klase}
                  disabled={onemogucen}
                  aria-pressed={odabran}
                  aria-label={d.iso}
                  onClick={() => onChange(`${d.iso}T${sat || zadaniSat}`)}
                >
                  {d.dan}
                </button>
              );
            })}
          </div>
          <div className="kal__sat">
            <span>Sat</span>
            <select
              aria-label="Sat"
              value={hh}
              disabled={!datum}
              onChange={(e) => onChange(`${datum}T${e.target.value}:${mm}`)}
            >
              {SATI.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
            <span>:</span>
            <select
              aria-label="Minute"
              value={mm}
              disabled={!datum}
              onChange={(e) => onChange(`${datum}T${hh}:${e.target.value}`)}
            >
              {minute.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <span className="kal__razmak" />
            {neobavezno && vrijednost && (
              <button
                type="button"
                className="editor__ukloni"
                onClick={() => {
                  onChange("");
                  setOtvoreno(false);
                }}
              >
                Ukloni
              </button>
            )}
            <button type="button" className="gumb kal__gotovo" onClick={() => setOtvoreno(false)}>
              Gotovo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
