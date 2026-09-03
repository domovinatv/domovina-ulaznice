import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { datumHr, dohvatiNarudzbu, eur, poruka, posaljiPonovno, terminHr, type OrderView } from "../lib/api";

/**
 * "Moje ulaznice" — order_id iz e-maila je bearer capability (128-bit random).
 *
 * QR kodovi se OVDJE ne prikazuju: tokeni su jednokratni i žive samo u
 * poslanoj poruci (Zapisnik U1 §Gotcha 3). Stranica pokazuje stanje narudžbe i
 * popis ulaznica, a nudi ponovnu dostavu ako prva nije uspjela.
 */
const STANJA: Record<OrderView["state"], { naslov: string; tekst: string; ton: "ok" | "cekanje" | "lose" }> = {
  pending: {
    naslov: "Čeka plaćanje",
    tekst: "Mjesta su rezervirana dok rezervacija ne istekne. Ulaznice izdajemo čim plaćanje bude potvrđeno.",
    ton: "cekanje",
  },
  paid: {
    naslov: "Plaćeno",
    tekst: "Ulaznice su izdane i poslane e-mailom. Na ulazu pokažite QR kod iz poruke.",
    ton: "ok",
  },
  expired: {
    naslov: "Rezervacija je istekla",
    tekst: "Plaćanje nije stiglo na vrijeme pa su mjesta vraćena u prodaju. Ništa nije naplaćeno.",
    ton: "lose",
  },
  refunded: {
    naslov: "Vraćeno",
    tekst: "Uplata je vraćena na karticu, a ulaznice su poništene.",
    ton: "lose",
  },
  failed: {
    naslov: "Plaćanje nije uspjelo",
    tekst: "Ništa nije naplaćeno. Možete pokušati ponovno sa stranice događaja.",
    ton: "lose",
  },
};

export default function Narudzba() {
  const { orderId = "" } = useParams();
  const [params] = useSearchParams();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [greska, setGreska] = useState<string | null>(null);
  const [poruke, setPoruke] = useState<string | null>(null);
  const [salje, setSalje] = useState(false);
  const pokusaji = useRef(0);

  const ucitaj = useCallback(
    () => dohvatiNarudzbu(orderId).then(setOrder).catch((e) => setGreska(poruka(e.code))),
    [orderId],
  );

  useEffect(() => {
    void ucitaj();
  }, [ucitaj]);

  // Nakon povratka sa Stripea narudžba je često još `pending` — webhook je
  // izvor istine i stiže u sekundi-dvije. Kratko poll-amo umjesto da lažemo
  // kupcu da je plaćeno (redirect NIJE dokaz uplate — docs/03 §4 pravilo 2).
  useEffect(() => {
    if (params.get("placeno") !== "1") return;
    if (!order || order.state !== "pending") return;
    if (pokusaji.current >= 10) return;
    const t = setTimeout(() => {
      pokusaji.current += 1;
      void ucitaj();
    }, 2000);
    return () => clearTimeout(t);
  }, [order, params, ucitaj]);

  if (greska) {
    return (
      <main className="omot">
        <div className="greska">{greska}</div>
        <Link to="/">Natrag na popis</Link>
      </main>
    );
  }
  if (!order) return <main className="omot"><p className="mutno">Učitavanje…</p></main>;

  const s = STANJA[order.state] ?? STANJA.pending;
  const cekaWebhook = params.get("placeno") === "1" && order.state === "pending";

  return (
    <main className="omot">
      <h1>{order.event?.title ?? "Narudžba"}</h1>
      {order.event?.starts_at && (
        <p className="meta">{terminHr(order.event.starts_at, order.event.ends_at ?? null, order.event.timezone)}</p>
      )}
      <p className="meta">
        {[order.event?.venue_name, order.event?.venue_city].filter(Boolean).join(", ")}
      </p>

      <div className={s.ton === "ok" ? "obavijest" : s.ton === "lose" ? "greska" : "kartica"}>
        <strong>{cekaWebhook ? "Potvrđujemo plaćanje…" : s.naslov}</strong>
        <div style={{ marginTop: 4 }}>
          {cekaWebhook
            ? "Plaćanje je zaprimljeno kod Stripea. Ulaznice izdajemo čim potvrda stigne — ova stranica se osvježava sama."
            : s.tekst}
        </div>
      </div>

      <div className="kartica">
        <div className="sazetak"><span>Broj ulaznica</span><span>{order.quantity}</span></div>
        <div className="sazetak"><span>Iznos</span><span>{eur(order.amount_cents)}</span></div>
        {order.buyer_email && (
          <div className="sazetak"><span>E-mail</span><span>{order.buyer_email}</span></div>
        )}
        {order.state === "pending" && order.expires_at && (
          <div className="sazetak"><span>Rezervacija vrijedi do</span><span>{datumHr(order.expires_at)}</span></div>
        )}
      </div>

      {order.tickets.length > 0 && (
        <>
          <h2>Ulaznice</h2>
          {order.tickets.map((t) => (
            <div key={t.serial} className="ulaznica">
              <div>
                <div style={{ fontWeight: 600 }}>{t.holder_name ?? "Ulaznica"}</div>
                <div className="mutno">{t.serial}</div>
              </div>
              <div>
                {t.state === "checked_in" && <span className="oznaka oznaka--ok">ušlo</span>}
                {t.state === "void" && <span className="oznaka oznaka--lose">poništena</span>}
                {t.state === "issued" && <span className="oznaka">vrijedi</span>}
              </div>
            </div>
          ))}
          <p className="mutno">
            QR kodovi su u e-mailu koji smo poslali i ovdje se namjerno ne prikazuju.
          </p>
        </>
      )}

      {order.state === "paid" && (
        <div className="kartica">
          <strong>Niste dobili e-mail?</strong>
          <p className="mutno" style={{ marginTop: 4 }}>
            Provjerite i mapu neželjene pošte. Ako poruke nema, poslat ćemo ulaznice ponovno.
          </p>
          {/* Posljedica se kaže PRIJE klika, ne poslije: rotacija poništava
              stari QR, a netko je taj QR možda već proslijedio prijatelju. */}
          <p className="mutno">
            Ako je prva poruka stigla, novi QR kodovi poništavaju stare —
            proslijeđene ulaznice iz stare poruke prestaju vrijediti.
          </p>
          {poruke && <div className="obavijest">{poruke}</div>}
          <button
            className="gumb gumb--tanki"
            disabled={salje}
            onClick={async () => {
              setPoruke(null);
              setSalje(true);
              try {
                const r = await posaljiPonovno(orderId);
                setPoruke(
                  r.status === "poslano"
                    ? r.stari_qr_ponisten
                      ? `Poslano na ${r.recipient}. Vrijede QR kodovi iz NOVE poruke — stari više ne rade.`
                      : `Poslano na ${r.recipient}.`
                    : r.status === "nema_vazecih_ulaznica"
                      ? "Sve ulaznice iz ove narudžbe su već iskorištene ili poništene."
                      : "Slanje nije uspjelo. Pokušajte kasnije ili se javite podršci.",
                );
                void ucitaj();
              } catch (e) {
                setPoruke(poruka((e as { code: string }).code));
              } finally {
                setSalje(false);
              }
            }}
          >
            {salje ? "Šaljem…" : "Pošalji ponovno"}
          </button>
        </div>
      )}

      <p className="podnozje">Sačuvajte ovaj link — njime pristupate narudžbi bez prijave.</p>
    </main>
  );
}
