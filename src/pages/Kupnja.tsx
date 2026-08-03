import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { dohvatiDogadjaj, eur, kreirajNarudzbu, poruka, type EventView } from "../lib/api";

const MAX = 10;

export default function Kupnja() {
  const { slug = "" } = useParams();
  const [ev, setEv] = useState<EventView | null>(null);
  const [tierId, setTierId] = useState<string>("");
  const [kolicina, setKolicina] = useState(1);
  const [email, setEmail] = useState("");
  const [imena, setImena] = useState<string[]>([""]);
  const [greska, setGreska] = useState<string | null>(null);
  const [salje, setSalje] = useState(false);

  useEffect(() => {
    dohvatiDogadjaj(slug)
      .then((e) => {
        setEv(e);
        setTierId(e.tiers.find((t) => t.buyable)?.id ?? "");
      })
      .catch((e) => setGreska(poruka(e.code)));
  }, [slug]);

  const tier = useMemo(() => ev?.tiers.find((t) => t.id === tierId) ?? null, [ev, tierId]);
  const maxKolicina = Math.min(MAX, tier?.available ?? MAX);

  useEffect(() => {
    setKolicina((k) => Math.min(Math.max(1, k), Math.max(1, maxKolicina)));
  }, [maxKolicina]);

  useEffect(() => {
    setImena((prev) => Array.from({ length: kolicina }, (_, i) => prev[i] ?? ""));
  }, [kolicina]);

  const ukupno = tier ? tier.price_cents * kolicina : 0;
  // Imenski tier traži potpuno ime za SVAKU ulaznicu — isto pravilo vrijedi i
  // server-side (create_ticket_order → holders_incomplete); ovo je samo ranije.
  const imenaOk = !tier?.imenska || imena.every((n) => n.trim().length >= 2);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const moze = !!tier?.buyable && imenaOk && emailOk && kolicina >= 1 && !salje;

  async function posalji(e: React.FormEvent) {
    e.preventDefault();
    if (!ev || !tier || !moze) return;
    setGreska(null);
    setSalje(true);
    try {
      const r = await kreirajNarudzbu({
        campaign_id: ev.campaign_id,
        tier_id: tier.id,
        quantity: kolicina,
        buyer_email: email.trim(),
        holders: tier.imenska ? imena.map((n) => ({ full_name: n.trim() })) : [],
      });
      // Stripe Checkout je na Stripeovoj domeni (račun organizatora).
      window.location.href = r.checkout_url;
    } catch (err) {
      setGreska(poruka((err as { code: string }).code));
      setSalje(false);
    }
  }

  if (greska && !ev) {
    return (
      <main className="omot">
        <div className="greska">{greska}</div>
        <Link to="/">Natrag na popis</Link>
      </main>
    );
  }
  if (!ev) return <main className="omot"><p className="mutno">Učitavanje…</p></main>;

  if (!ev.kupovno) {
    return (
      <main className="omot">
        <h1>{ev.title}</h1>
        <div className="obavijest">Online prodaja za ovaj događaj trenutačno nije aktivna.</div>
        <Link to={`/dogadjaj/${ev.slug}`}>Natrag na događaj</Link>
      </main>
    );
  }

  return (
    <main className="omot">
      <h1>Kupnja ulaznica</h1>
      <p className="meta">{ev.title}</p>

      {greska && <div className="greska">{greska}</div>}

      <form className="kartica" onSubmit={posalji}>
        <label htmlFor="tier">Vrsta ulaznice</label>
        <select id="tier" value={tierId} onChange={(e) => setTierId(e.target.value)}>
          {ev.tiers.map((t) => (
            <option key={t.id} value={t.id} disabled={!t.buyable}>
              {t.title} — {eur(t.price_cents)}
              {t.buyable ? "" : t.sold_out ? " (rasprodano)" : " (nije u prodaji)"}
            </option>
          ))}
        </select>

        <label htmlFor="kolicina">Broj ulaznica</label>
        <select id="kolicina" value={kolicina} onChange={(e) => setKolicina(Number(e.target.value))}>
          {Array.from({ length: Math.max(1, maxKolicina) }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        <label htmlFor="email">Vaša e-mail adresa</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ime@primjer.hr"
          required
        />
        <p className="mutno" style={{ marginTop: 6 }}>Ulaznice s QR kodom šaljemo na ovu adresu.</p>

        {tier?.imenska && (
          <>
            <h2 style={{ marginBottom: 4 }}>Imena posjetitelja</h2>
            <p className="mutno">Ulaznica glasi na ime i na ulazu se provjerava.</p>
            {imena.map((n, i) => (
              <div key={i}>
                <label htmlFor={`holder-${i}`}>{i + 1}. ulaznica — ime i prezime</label>
                <input
                  id={`holder-${i}`}
                  value={n}
                  onChange={(e) => setImena((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                  autoComplete="off"
                  required
                />
              </div>
            ))}
          </>
        )}

        <div style={{ marginTop: 20 }}>
          <div className="sazetak">
            <span>{tier?.title} × {kolicina}</span>
            <span>{eur(ukupno)}</span>
          </div>
          <div className="sazetak">
            <span>Naknada platforme</span>
            <span>0,00 €</span>
          </div>
          <div className="sazetak sazetak--ukupno">
            <span>Ukupno</span>
            <span>{eur(ukupno)}</span>
          </div>
        </div>

        <p style={{ marginTop: 18 }}>
          <button type="submit" disabled={!moze}>
            {salje ? "Otvaram plaćanje…" : "Nastavi na plaćanje"}
          </button>
        </p>
        <p className="mutno">
          Plaćanje karticom obrađuje Stripe za organizatora. Mjesta su rezervirana 20 minuta.
        </p>
      </form>

      <p><Link to={`/dogadjaj/${ev.slug}`}>Natrag na događaj</Link></p>
    </main>
  );
}
