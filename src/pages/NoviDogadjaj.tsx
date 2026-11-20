import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { poruka } from "../lib/api";
import { AuthError, dohvatiPregled, kreirajDogadjaj, procitajSesiju, type OrgPregled, type Sesija } from "../lib/auth";
import { VRSTE, prazanTier, provjeri, zahtjev, type Greske, type UnosDogadjaja, type UnosTiera } from "../lib/editor";
import KalendarPolje from "../components/KalendarPolje";
import { predlozeniKraj } from "../lib/kalendar";
import Prijava from "./Prijava";

/**
 * Editor događaja, prva verzija: nova PRIVATNA skica s vrstama ulaznica.
 *
 * Objava (`publish_event`: allowlist + Safe adresa), uređivanje postojećeg,
 * galerija i koordinate još nisu ovdje; do tada ih radi agent kroz seed
 * (docs/2026-09-28-unos-dogadjaja-kroz-chat.md).
 *
 * `event_id` nastaje jednom po otvaranju forme, pa ponovno slanje nakon
 * greške mreže ne pravi duplikat (`create_event` je idempotentan po id-u).
 * Tko smije kreirati odlučuje baza (admin računa + provjeren identitet).
 */
export default function NoviDogadjaj() {
  const [sesija, setSesija] = useState<Sesija | null>(procitajSesiju);
  const [pregled, setPregled] = useState<OrgPregled | null>(null);
  const [unos, setUnos] = useState<UnosDogadjaja>({
    accountId: "",
    naslov: "",
    vrsta: "koncert",
    pocetak: "",
    kraj: "",
    mjesto: "",
    adresa: "",
    grad: "",
    opis: "",
    slika: "",
    organizator: "",
    email: "",
    web: "",
    tieri: [prazanTier()],
  });
  const [greske, setGreske] = useState<Greske>({});
  const [pokusano, setPokusano] = useState(false);
  const [greska, setGreska] = useState<string | null>(null);
  const [salje, setSalje] = useState(false);
  const [gotovo, setGotovo] = useState<{ slug: string } | null>(null);
  const eventId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    if (!sesija) return;
    dohvatiPregled(sesija.access_token)
      .then((p) => {
        setPregled(p);
        if (p.accounts.length === 1) setUnos((u) => ({ ...u, accountId: p.accounts[0].id }));
      })
      .catch((e) => {
        if ((e as AuthError).code === "nije_prijavljen") setSesija(null);
        else setGreska(poruka((e as AuthError).code));
      });
  }, [sesija]);

  if (!sesija) return <Prijava naslov="Novi događaj" onPrijava={setSesija} />;

  const postavi = <K extends keyof UnosDogadjaja>(k: K, v: UnosDogadjaja[K]) => {
    const novo = { ...unos, [k]: v };
    setUnos(novo);
    if (pokusano) setGreske(provjeri(novo));
  };
  const postaviTier = (i: number, izmjena: Partial<UnosTiera>) =>
    postavi(
      "tieri",
      unos.tieri.map((t, j) => (j === i ? { ...t, ...izmjena } : t)),
    );

  if (gotovo) {
    return (
      <main className="omot editor">
        <h1>Skica je spremljena</h1>
        <div className="obavijest">
          „{unos.naslov.trim()}” je spremljen kao <b>privatna skica</b>. Kupci ga još ne vide; objava dolazi u
          sljedećem koraku.
        </div>
        <p className="mutno">Adresa nakon objave: /dogadjaj/{gotovo.slug}</p>
        <div className="editor__dno">
          <Link className="gumb" to="/organizator">
            Na pregled događaja
          </Link>
        </div>
      </main>
    );
  }

  const posalji = async () => {
    setPokusano(true);
    const g = provjeri(unos);
    setGreske(g);
    setGreska(null);
    if (Object.keys(g).length > 0) return;
    setSalje(true);
    try {
      const r = await kreirajDogadjaj(sesija.access_token, zahtjev(unos, eventId));
      setGotovo({ slug: r.slug });
      window.scrollTo(0, 0);
    } catch (e) {
      const kod = (e as AuthError).code;
      if (kod === "nije_prijavljen") setSesija(null);
      setGreska(poruka(kod));
    } finally {
      setSalje(false);
    }
  };

  const polje = (
    k: keyof UnosDogadjaja,
    oznaka: string,
    props: Record<string, unknown> = {},
    pomoc?: string,
  ): ReactNode => (
    <>
      <label htmlFor={k}>{oznaka}</label>
      <input
        id={k}
        value={unos[k] as string}
        onChange={(e) => postavi(k, e.target.value as never)}
        aria-invalid={greske[k] ? true : undefined}
        {...props}
      />
      {greske[k] ? <p className="editor__greska">{greske[k]}</p> : pomoc && <p className="editor__pomoc">{pomoc}</p>}
    </>
  );

  return (
    <main className="omot editor">
      <p className="meta">
        <Link to="/organizator">← Pregled prodaje</Link>
      </p>
      <h1>Novi događaj</h1>
      <p className="meta">Spremamo ga kao privatnu skicu. Kupci ga vide tek nakon objave.</p>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void posalji();
        }}
      >
        <section className="kartica">
          <h2>Osnovno</h2>
          {pregled && pregled.accounts.length > 1 && (
            <>
              <label htmlFor="accountId">Organizator</label>
              <select
                id="accountId"
                value={unos.accountId}
                onChange={(e) => postavi("accountId", e.target.value)}
                aria-invalid={greske.accountId ? true : undefined}
              >
                <option value="">Odaberi…</option>
                {pregled.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {greske.accountId && <p className="editor__greska">{greske.accountId}</p>}
            </>
          )}
          {polje("naslov", "Naziv događaja", { placeholder: "npr. Koncert u parku", maxLength: 160 })}
          <label htmlFor="vrsta">Vrsta</label>
          <select id="vrsta" value={unos.vrsta} onChange={(e) => postavi("vrsta", e.target.value)}>
            {VRSTE.map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </section>

        <section className="kartica">
          <h2>Termin</h2>
          <div className="editor__termin">
            <KalendarPolje
              id="pocetak"
              oznaka="Početak"
              vrijednost={unos.pocetak}
              onChange={(v) => postavi("pocetak", v)}
              greska={greske.pocetak}
            />
            <KalendarPolje
              id="kraj"
              oznaka="Kraj (neobavezno)"
              vrijednost={unos.kraj}
              onChange={(v) => postavi("kraj", v)}
              od={unos.pocetak.slice(0, 10) || undefined}
              oznaceno={unos.pocetak.slice(0, 10) || undefined}
              otvoriNa={unos.pocetak.slice(0, 10) || undefined}
              zadaniSat={predlozeniKraj(unos.pocetak)}
              greska={greske.kraj}
              neobavezno
            />
          </div>
          <p className="editor__pomoc">Vrijeme je po Zagrebu.</p>
        </section>

        <section className="kartica">
          <h2>Mjesto</h2>
          {polje("mjesto", "Naziv mjesta", { placeholder: "npr. Dom sportova", maxLength: 160 })}
          <div className="editor__red">
            <div>{polje("adresa", "Adresa (neobavezno)", { placeholder: "Trg Krešimira Ćosića 11" })}</div>
            <div>{polje("grad", "Grad", { placeholder: "Zagreb", maxLength: 80 })}</div>
          </div>
        </section>

        <section className="kartica">
          <h2>Opis i slika</h2>
          <label htmlFor="opis">Opis (neobavezno)</label>
          <textarea
            id="opis"
            value={unos.opis}
            onChange={(e) => postavi("opis", e.target.value)}
            placeholder="Što, za koga, program…"
          />
          <p className="editor__pomoc">Prazan red odvaja odlomke; „- ” na početku retka je stavka popisa.</p>
          {polje(
            "slika",
            "Naslovna slika: link (neobavezno)",
            { type: "url", placeholder: "https://…" },
            "Kvadratna ili vodoravna slika, barem 1200 px.",
          )}
          {unos.slika.trim().startsWith("https://") && !greske.slika && (
            <img className="editor__slika" src={unos.slika.trim()} alt="" />
          )}
        </section>

        <section className="kartica">
          <h2>Kontakt organizatora</h2>
          {polje(
            "organizator",
            "Ime koje kupci vide (neobavezno)",
            { placeholder: "npr. Udruga Prilika za Susret" },
            "Prazno = naziv događaja.",
          )}
          <div className="editor__red">
            <div>{polje("email", "E-mail za kupce (neobavezno)", { type: "email" })}</div>
            <div>{polje("web", "Web (neobavezno)", { placeholder: "primjer.hr" })}</div>
          </div>
        </section>

        <section className="kartica">
          <h2>Ulaznice</h2>
          {greske.tieri && <p className="editor__greska">{greske.tieri}</p>}
          {unos.tieri.map((t, i) => (
            <div key={i} className="editor__tier">
              <div className="editor__tier-vrh">
                <strong>Vrsta {i + 1}</strong>
                {unos.tieri.length > 1 && (
                  <button
                    type="button"
                    className="editor__ukloni"
                    onClick={() => postavi("tieri", unos.tieri.filter((_, j) => j !== i))}
                  >
                    Ukloni
                  </button>
                )}
              </div>
              <label htmlFor={`tier-${i}-naziv`}>Naziv</label>
              <input
                id={`tier-${i}-naziv`}
                value={t.naziv}
                placeholder="npr. Parter"
                maxLength={160}
                onChange={(e) => postaviTier(i, { naziv: e.target.value })}
                aria-invalid={greske[`tier.${i}.naziv`] ? true : undefined}
              />
              {greske[`tier.${i}.naziv`] && <p className="editor__greska">{greske[`tier.${i}.naziv`]}</p>}
              <div className="editor__red">
                <div>
                  <label htmlFor={`tier-${i}-cijena`}>Cijena (€)</label>
                  <input
                    id={`tier-${i}-cijena`}
                    inputMode="decimal"
                    value={t.cijena}
                    placeholder="25,00"
                    onChange={(e) => postaviTier(i, { cijena: e.target.value })}
                    aria-invalid={greske[`tier.${i}.cijena`] ? true : undefined}
                  />
                  {greske[`tier.${i}.cijena`] && <p className="editor__greska">{greske[`tier.${i}.cijena`]}</p>}
                </div>
                <div>
                  <label htmlFor={`tier-${i}-kolicina`}>Količina</label>
                  <input
                    id={`tier-${i}-kolicina`}
                    inputMode="numeric"
                    value={t.kolicina}
                    placeholder="bez ograničenja"
                    onChange={(e) => postaviTier(i, { kolicina: e.target.value })}
                    aria-invalid={greske[`tier.${i}.kolicina`] ? true : undefined}
                  />
                  {greske[`tier.${i}.kolicina`] && <p className="editor__greska">{greske[`tier.${i}.kolicina`]}</p>}
                </div>
              </div>
              <label className="editor__kvacica">
                <input
                  type="checkbox"
                  checked={t.imenska}
                  onChange={(e) => postaviTier(i, { imenska: e.target.checked })}
                />
                Imenska (kupac upisuje ime za svaku ulaznicu)
              </label>
            </div>
          ))}
          <button
            type="button"
            className="gumb gumb--tanki"
            style={{ marginTop: 14 }}
            disabled={unos.tieri.length >= 50}
            onClick={() => postavi("tieri", [...unos.tieri, prazanTier()])}
          >
            + Dodaj vrstu ulaznice
          </button>
        </section>

        {pokusano && Object.keys(greske).length > 0 && <div className="greska">Provjeri označena polja.</div>}
        {greska && <div className="greska">{greska}</div>}
        <div className="editor__dno">
          <button className="gumb" type="submit" disabled={salje}>
            {salje ? "Spremam…" : "Spremi kao skicu"}
          </button>
          <Link to="/organizator">Odustani</Link>
        </div>
      </form>
    </main>
  );
}
