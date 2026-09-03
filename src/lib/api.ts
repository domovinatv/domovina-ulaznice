// Klijent prema vlastitom Workeru. SPA nikad ne razgovara s domovina-api
// izravno — sve ide kroz /api/*, jer samo Worker smije držati service ključ,
// HMAC tajnu i Stripe ključeve (docs/handoffs/u2 §Sigurnost 3).

export interface TierView {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  imenska: boolean;
  sale_start: string | null;
  sale_end: string | null;
  sold_out: boolean;
  not_started: boolean;
  ended: boolean;
  available: number | null;
  buyable: boolean;
}

export interface EventDetails {
  event_type: string;
  venue_name: string;
  venue_address: string | null;
  venue_city: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  description_hr: string | null;
  cover_image_url: string | null;
  organizer_name: string;
  organizer_email: string | null;
  organizer_web: string | null;
}

export interface EventView {
  campaign_id: string;
  slug: string;
  title: string;
  event: EventDetails | null;
  tiers: TierView[];
  stripe_connected: boolean;
  kupovno: boolean;
  brand?: { accent_color?: string; hero_url?: string; intro_html?: string; terms_url?: string } | null;
}

export interface TicketView {
  serial: string;
  holder_name: string | null;
  state: string;
  checked_in_at: string | null;
}

export interface OrderView {
  order_id: string;
  state: "pending" | "paid" | "expired" | "refunded" | "failed";
  quantity: number;
  amount_cents: number;
  currency: string;
  expires_at: string | null;
  paid_at: string | null;
  buyer_email: string | null;
  event: ({ title: string; slug: string } & Partial<EventDetails>) | null;
  tickets: TicketView[];
  dostava: { status: string; at: string } | null;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError("neispravan_odgovor", res.status);
  }
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `http_${res.status}`, res.status);
  return body as T;
}

export const dohvatiDogadjaj = (slug: string) => req<EventView>(`/api/dogadjaj/${encodeURIComponent(slug)}`);

export const dohvatiDogadjaje = () => req<{ events: EventView[] }>("/api/dogadjaji");

export const dohvatiNarudzbu = (orderId: string) => req<OrderView>(`/api/ulaznice/${encodeURIComponent(orderId)}`);

export const posaljiPonovno = (orderId: string) =>
  req<{
    status: "poslano" | "neuspjelo" | "nema_vazecih_ulaznica";
    recipient: string | null;
    /** true = izdani su NOVI QR kodovi, stari više ne vrijede */
    stari_qr_ponisten?: boolean;
    error?: string;
  }>(`/api/ulaznice/${encodeURIComponent(orderId)}/ponovna-dostava`, { method: "POST" });

export const kreirajNarudzbu = (p: {
  campaign_id: string;
  tier_id: string;
  quantity: number;
  buyer_email: string;
  holders: Array<{ full_name: string; email?: string }>;
}) => req<{ order_id: string; checkout_url: string; amount_cents: number }>("/api/narudzba", {
  method: "POST",
  body: JSON.stringify(p),
});

// ------------------------------------------------------------------ formati

export const eur = (cents: number): string =>
  new Intl.NumberFormat("hr-HR", { style: "currency", currency: "EUR" }).format(cents / 100);

export function datumHr(iso: string | null, timeZone = "Europe/Zagreb"): string {
  if (!iso) return "termin još nije objavljen";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "termin još nije objavljen";
  return new Intl.DateTimeFormat("hr-HR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(d);
}

/**
 * Termin događaja za prikaz.
 *
 * Konvencija: organizatori objave datum puno prije satnice. Ako je vrijeme
 * početka točno 00:00 u vremenskoj zoni događaja, tretiramo to kao "satnica
 * još nije objavljena" i prikazujemo samo datum — umjesto da izmišljamo
 * "u 00:00". Višednevni događaj se prikazuje kao raspon.
 */
export function terminHr(
  startsAt: string | null,
  endsAt: string | null,
  timeZone = "Europe/Zagreb",
): string {
  if (!startsAt) return "termin još nije objavljen";
  const s = new Date(startsAt);
  if (Number.isNaN(s.getTime())) return "termin još nije objavljen";
  const e = endsAt ? new Date(endsAt) : null;

  const dio = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("hr-HR", { ...opts, timeZone }).format(d);

  const bezSatnice = dio(s, { hour: "2-digit", minute: "2-digit", hour12: false }) === "00:00";
  const istiDan = e ? dio(s, { dateStyle: "short" }) === dio(e, { dateStyle: "short" }) : true;

  if (bezSatnice) {
    const datum = dio(s, { day: "numeric", month: "long", year: "numeric" });
    if (e && !istiDan) {
      const doDatum = dio(e, { day: "numeric", month: "long", year: "numeric" });
      // isti mjesec → "12. – 14. veljače 2027."; različit → pun oba datuma
      const istiMjesec = dio(s, { month: "long", year: "numeric" }) === dio(e, { month: "long", year: "numeric" });
      return istiMjesec
        ? `${dio(s, { day: "numeric" })} – ${doDatum}`
        : `${dio(s, { day: "numeric", month: "long" })} – ${doDatum}`;
    }
    return datum;
  }

  const pocetak = dio(s, {
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  if (e && istiDan) return `${pocetak} – ${dio(e, { hour: "2-digit", minute: "2-digit" })}`;
  if (e) return `${pocetak} – ${dio(e, { day: "2-digit", month: "2-digit", year: "numeric" })}`;
  return pocetak;
}

/** Poruke grešaka na hrvatskom — kod s backenda je strojni. */
export const PORUKE: Record<string, string> = {
  event_not_found: "Događaj nije pronađen.",
  tier_not_found: "Odabrana vrsta ulaznice više ne postoji.",
  tier_sold_out: "Ulaznice te vrste su rasprodane.",
  sale_not_started: "Prodaja za tu vrstu ulaznice još nije počela.",
  sale_ended: "Prodaja za tu vrstu ulaznice je zatvorena.",
  holders_incomplete: "Za imenske ulaznice upišite ime i prezime za svaku ulaznicu.",
  organizer_not_connected: "Organizator još nije povezao račun za naplatu.",
  organizer_charges_disabled: "Organizatorov račun za naplatu još nije aktivan.",
  invalid_buyer_email: "Upišite ispravnu e-mail adresu.",
  invalid_quantity: "Odaberite između 1 i 10 ulaznica.",
  order_not_found: "Narudžba nije pronađena.",
  narudzba_nije_placena: "Narudžba još nije plaćena.",
  nema_email_adrese: "Za ovu narudžbu nemamo e-mail adresu.",
  previse_pokusaja: "Previše pokušaja — pokušajte za koju minutu.",
  nije_prijavljen: "Prijava je istekla. Prijavite se ponovno.",
  prijava_neuspjela: "Neispravna e-mail adresa ili lozinka.",
  neispravan_qr: "To nije ulaznica ovog sustava.",
  not_authorized: "Nemate ovlasti za ovaj događaj.",
  not_authenticated: "Prijava je istekla. Prijavite se ponovno.",
  anon_key_missing: "Prijava trenutačno nije dostupna (nedostaje konfiguracija).",
  rotacija_nije_uspjela: "Nismo uspjeli izdati nove QR kodove. Javite se podršci.",
  stripe_not_configured: "Naplata trenutačno nije dostupna.",
  greska_servera: "Nešto je pošlo po zlu. Pokušajte ponovno.",
};

export const poruka = (code: string): string => PORUKE[code] ?? "Nešto je pošlo po zlu. Pokušajte ponovno.";
