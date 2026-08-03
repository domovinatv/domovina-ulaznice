import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { datumHr, dohvatiDogadjaje, eur, poruka, type EventView } from "../lib/api";

export default function Popis() {
  const [events, setEvents] = useState<EventView[] | null>(null);
  const [greska, setGreska] = useState<string | null>(null);

  useEffect(() => {
    dohvatiDogadjaje()
      .then((r) => setEvents(r.events))
      .catch((e) => setGreska(poruka(e.code)));
  }, []);

  return (
    <main className="omot">
      <h1>Događaji</h1>
      <p className="meta">Ulaznice kupujete izravno od organizatora. Bez naknade posrednika.</p>

      {greska && <div className="greska">{greska}</div>}
      {!events && !greska && <p className="mutno">Učitavanje…</p>}
      {events?.length === 0 && <p className="mutno">Trenutačno nema objavljenih događaja.</p>}

      {events?.map((ev) => {
        const najniza = ev.tiers.length ? Math.min(...ev.tiers.map((t) => t.price_cents)) : null;
        return (
          <article key={ev.campaign_id} className="kartica">
            <h2 style={{ margin: "0 0 6px" }}>
              <Link to={`/dogadjaj/${ev.slug}`}>{ev.title}</Link>
            </h2>
            <p className="meta">{datumHr(ev.event?.starts_at ?? null, ev.event?.timezone)}</p>
            <p className="meta">
              {[ev.event?.venue_name, ev.event?.venue_city].filter(Boolean).join(", ")}
            </p>
            <p style={{ margin: "10px 0 0" }}>
              {najniza !== null && <span className="tier__cijena">od {eur(najniza)}</span>}
              {!ev.kupovno && <span className="oznaka">prodaja nije otvorena</span>}
            </p>
          </article>
        );
      })}

      <p className="podnozje">Domovina — prodaja ulaznica bez posrednika</p>
    </main>
  );
}
