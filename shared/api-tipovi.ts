// Ugovor javnog /api/* Workera (worker/api.ts) — samo tipovi, bez runtime koda.
// Uvoze ga SPA (src/lib/api.ts) i Astro frontend (web/src/lib/api.ts);
// web/docs/decisions.md, odluka 10. Mobilne aplikacije imaju svoje modele
// (mobile/), pa promjena ovdje = promjena ugovora (odluka 6).

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
  description_en: string | null;
  cover_image_url: string | null;
  /** Alt tekst naslovne slike, ≤ 300 znakova (S2b, odluka 15). */
  cover_image_alt?: string | null;
  /** Dodatne slike redom prikaza, ≤ 20 (migracija `events_gallery`). Opcionalno dok je jezgra nema. */
  gallery?: GallerySlika[];
  /** WGS84; oba ili nijedno (S2b, odluka 14). Opcionalno dok jezgra nema migraciju. */
  venue_lat?: number | null;
  venue_lon?: number | null;
  organizer_name: string;
  organizer_email: string | null;
  organizer_web: string | null;
}

export interface GallerySlika {
  url: string;
  alt?: string | null;
}

export interface EventView {
  campaign_id: string;
  slug: string;
  title: string;
  event: EventDetails | null;
  tiers: TierView[];
  stripe_connected: boolean;
  kupovno: boolean;
  brand?: { accent_color?: string; logo_url?: string; hero_url?: string; intro_html?: string; terms_url?: string } | null;
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

/** GET /api/dogadjaji */
export interface EventListResponse {
  events: EventView[];
}

/** POST /api/narudzba — tijelo zahtjeva. */
export interface CreateOrderRequest {
  campaign_id: string;
  tier_id: string;
  quantity: number;
  buyer_email: string;
  holders: Array<{ full_name: string; email?: string }>;
}

/** POST /api/narudzba — odgovor; kupca se šalje na `checkout_url`. */
export interface CreateOrderResponse {
  order_id: string;
  checkout_url: string;
  amount_cents: number;
}

/** POST /api/ulaznice/:id/ponovna-dostava */
export interface ResendResponse {
  status: "poslano" | "neuspjelo" | "nema_vazecih_ulaznica";
  recipient: string | null;
  /** true = izdani su NOVI QR kodovi, stari više ne vrijede */
  stari_qr_ponisten?: boolean;
  error?: string;
}
