import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { dohvatiDogadjaj, eur, poruka, terminHr, type EventView, type TierView } from "../lib/api";

/** Zašto je tier vidljiv ali ne kupiv — kupac mora znati razlog. */
function oznakaTiera(t: TierView) {
  if (t.sold_out) return <span className="oznaka oznaka--lose">rasprodano</span>;
  if (t.not_started) return <span className="oznaka">prodaja još nije počela</span>;
  if (t.ended) return <span className="oznaka">prodaja zatvorena</span>;
  if (t.available !== null && t.available <= 10) {
    return <span className="oznaka oznaka--ok">još {t.available}</span>;
  }
  return null;
}

export default function Dogadjaj() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const [ev, setEv] = useState<EventView | null>(null);
  const [greska, setGreska] = useState<string | null>(null);

  useEffect(() => {
    dohvatiDogadjaj(slug)
      .then(setEv)
      .catch((e) => setGreska(poruka(e.code)));
  }, [slug]);

  if (greska) {
    return (
      <main className="omot">
        <div className="greska">{greska}</div>
        <Link to="/">Natrag na popis</Link>
      </main>
    );
  }
  if (!ev) return <main className="omot"><p className="mutno">Učitavanje…</p></main>;

  const d = ev.event;
  return (
    <main className="omot">
      {params.get("otkazano") === "1" && (
        <div className="obavijest">Plaćanje je prekinuto. Ulaznice nisu naplaćene — možete pokušati ponovno.</div>
      )}

      {d?.cover_image_url && <img className="hero" src={d.cover_image_url} alt="" width={720} height={405} />}

      <h1>{ev.title}</h1>
      <p className="meta">{terminHr(d?.starts_at ?? null, d?.ends_at ?? null, d?.timezone)}</p>
      <p className="meta">{[d?.venue_name, d?.venue_address, d?.venue_city].filter(Boolean).join(", ")}</p>
      {d?.organizer_name && <p className="meta">Organizator: {d.organizer_name}</p>}

      {d?.description_hr && (
        <div className="kartica" style={{ whiteSpace: "pre-wrap" }}>{d.description_hr}</div>
      )}

      <h2>Ulaznice</h2>
      {ev.tiers.length === 0 && <p className="mutno">Organizator još nije objavio cjenik.</p>}
      {ev.tiers.map((t) => (
        <div key={t.id} className={`tier${t.buyable ? "" : " tier--nedostupan"}`}>
          <div>
            <div style={{ fontWeight: 600 }}>
              {t.title}
              {oznakaTiera(t)}
            </div>
            {t.description && <div className="mutno">{t.description}</div>}
            {t.imenska && <div className="mutno">ulaznica glasi na ime</div>}
          </div>
          <div className="tier__cijena">{eur(t.price_cents)}</div>
        </div>
      ))}

      {/* "Vidljiv, ali ne kupiv" je legitimno stanje — stranica postoji i bez naplate. */}
      {ev.kupovno ? (
        <p style={{ marginTop: 20 }}>
          <Link className="gumb" to={`/dogadjaj/${ev.slug}/kupnja`}>Kupi ulaznice</Link>
        </p>
      ) : (
        <div className="obavijest" style={{ marginTop: 20 }}>
          {ev.stripe_connected
            ? "Online prodaja za ovaj događaj trenutačno nije aktivna."
            : "Organizator još nije aktivirao online prodaju za ovaj događaj."}
        </div>
      )}

      <p className="podnozje">
        Kupujete izravno od organizatora — platforma ne naplaćuje naknadu na prodaju.
      </p>
    </main>
  );
}
