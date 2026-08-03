// Tanki klijent za domovina-api (ticketing jezgra, shema pinka_finance).
//
// Ovaj repo NEMA vlastitu kopiju ulaznica, narudžbi ni inventoryja — svaki
// takav podatak dolazi odavde (docs/02-arhitektura.md §1). Dvije vrste poziva:
//
//   1. edge funkcije `events-*` — poslovne operacije (narudžba, intent, confirm,
//      dostava). Stripe rail funkcije su HMAC-zaštićene (v. Zapisnik U1).
//   2. PostgREST čitanja sa service ključem — samo za prikaz stanja
//      (stranica narudžbe, kupovnost eventa). Nikad za kreditiranje.
//
// Zašto PostgREST za stranicu narudžbe, a ne `events-tickets`: taj RPC
// isporučuje QR tokene JEDNOKRATNO i briše plaintext. Kad bi ga stranica zvala
// pri svakom osvježenju, prvi refresh bi potrošio tokene i e-mail bi ostao bez
// QR-a. `events-tickets` se zato zove ISKLJUČIVO iz dostave (mail.ts).
import type { Env } from "./env";
import { HttpError } from "./env";

export const SIGNATURE_HEADER = "x-ulaznice-signature";

// ---------------------------------------------------------------- HMAC potpis

/** sha256=<hex(hmac_sha256(secret, raw))> — shema iz Zapisnika U1. */
export async function signBody(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

// ------------------------------------------------------------- edge funkcije

async function callFunction<T>(
  env: Env,
  name: string,
  body: unknown,
  opts: { signed?: boolean } = {},
): Promise<T> {
  // Isti string se potpisuje i šalje — potpis ide nad SIROVIM tijelom.
  const raw = JSON.stringify(body ?? {});
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (opts.signed) {
    if (!env.EVENTS_STRIPE_CONFIRM_SECRET) {
      throw new HttpError(503, "hmac_secret_missing", "EVENTS_STRIPE_CONFIRM_SECRET nije postavljen");
    }
    headers[SIGNATURE_HEADER] = await signBody(env.EVENTS_STRIPE_CONFIRM_SECRET, raw);
  }
  if (env.DOMOVINA_API_SERVICE_KEY) {
    headers.apikey = env.DOMOVINA_API_SERVICE_KEY;
    headers.Authorization = `Bearer ${env.DOMOVINA_API_SERVICE_KEY}`;
  }

  const res = await fetch(`${env.DOMOVINA_API_URL}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: raw,
  });
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(502, "api_bad_json", `${name}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const code = (parsed as { error?: string }).error ?? `http_${res.status}`;
    throw new HttpError(res.status === 404 ? 404 : 502, code, `${name}: ${code}`);
  }
  return parsed as T;
}

// ------------------------------------------------------------------ PostgREST

async function rest<T>(env: Env, path: string): Promise<T> {
  if (!env.DOMOVINA_API_SERVICE_KEY) {
    throw new HttpError(503, "service_key_missing", "DOMOVINA_API_SERVICE_KEY nije postavljen");
  }
  const res = await fetch(`${env.DOMOVINA_API_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.DOMOVINA_API_SERVICE_KEY,
      Authorization: `Bearer ${env.DOMOVINA_API_SERVICE_KEY}`,
      "Accept-Profile": "pinka_finance",
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new HttpError(502, "api_rest_error", `rest ${path}: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function restRpc<T>(env: Env, fn: string, args: Record<string, unknown>): Promise<T> {
  if (!env.DOMOVINA_API_SERVICE_KEY) {
    throw new HttpError(503, "service_key_missing", "DOMOVINA_API_SERVICE_KEY nije postavljen");
  }
  const res = await fetch(`${env.DOMOVINA_API_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.DOMOVINA_API_SERVICE_KEY,
      Authorization: `Bearer ${env.DOMOVINA_API_SERVICE_KEY}`,
      "Content-Profile": "pinka_finance",
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(502, "api_rpc_error", `rpc ${fn}: ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// ------------------------------------------------------------------- tipovi

export interface FeedTier {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  inventory_total: number | null;
  inventory_claimed: number;
  imenska: boolean;
  sale_start: string | null;
  sale_end: string | null;
}

export interface FeedEvent {
  campaign_id: string;
  slug: string;
  title: string;
  state: string;
  event: {
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
  } | null;
  tiers: FeedTier[];
}

export interface OrderResponse {
  order_id: string;
  state: string;
  amount_cents: number;
  currency: string;
  expires_at: string | null;
  existing: boolean;
}

export interface StripeIntent {
  order_id: string;
  amount_cents: number;
  currency: string;
  quantity: number;
  expires_at: string | null;
  buyer_email: string | null;
  tier: { id: string; title: string; price_cents: number; imenska: boolean };
  event: {
    campaign_id: string;
    title: string;
    slug: string;
    starts_at: string | null;
    ends_at: string | null;
    timezone: string | null;
    venue_name: string | null;
    venue_city: string | null;
  };
  stripe_account_id: string;
  charges_enabled: boolean;
  invoice_provider: string;
}

export interface ConfirmTicket {
  serial: string;
  holder_name: string | null;
  holder_email: string | null;
  state: string;
  qr_token: string | null;
}

export interface ConfirmResponse {
  ok: boolean;
  status:
    | "paid"
    | "already_paid"
    | "amount_insufficient"
    | "expired_sold_out"
    | "tx_already_credited"
    | "duplicate_payment";
  order_id: string;
  serials?: string[];
  tickets?: ConfirmTicket[];
  expected_cents?: number;
  received_cents?: number;
  credited_ref?: string;
}

export interface OrderRow {
  id: string;
  campaign_id: string;
  tier_id: string | null;
  state: string;
  quantity: number;
  amount_cents: number;
  currency: string;
  reserve_expires_at: string | null;
  payment_rail: string;
  external_payment_ref: string | null;
  buyer_email: string | null;
  paid_at: string | null;
  holders: Array<{ full_name?: string; email?: string }> | null;
}

export interface TicketRow {
  serial: string;
  holder_name: string | null;
  state: string;
  checked_in_at: string | null;
}

// ------------------------------------------------------------------ operacije

export const feed = (env: Env, params = ""): Promise<{ events: FeedEvent[] }> =>
  fetch(`${env.DOMOVINA_API_URL}/functions/v1/events-feed${params}`, {
    headers: env.DOMOVINA_API_SERVICE_KEY
      ? { apikey: env.DOMOVINA_API_SERVICE_KEY, Authorization: `Bearer ${env.DOMOVINA_API_SERVICE_KEY}` }
      : {},
  }).then(async (r) => {
    if (!r.ok) throw new HttpError(502, "api_feed_error", `events-feed: ${r.status}`);
    return (await r.json()) as { events: FeedEvent[] };
  });

export const createOrder = (
  env: Env,
  p: {
    order_id: string;
    campaign_id: string;
    tier_id: string;
    quantity: number;
    holders: Array<{ full_name: string; email?: string }>;
  },
): Promise<OrderResponse> => callFunction<OrderResponse>(env, "events-order", p);

export const stripeIntent = (env: Env, orderId: string): Promise<StripeIntent> =>
  callFunction<StripeIntent>(env, "events-stripe-intent", { order_id: orderId }, { signed: true });

export const stripeConfirm = (
  env: Env,
  p: { order_id: string; external_ref: string; amount_cents: number; payer_email?: string },
): Promise<ConfirmResponse> => callFunction<ConfirmResponse>(env, "events-stripe-confirm", p, { signed: true });

/** ⚠️ Troši jednokratne QR tokene — zvati SAMO iz dostave ulaznica. */
export const deliverTickets = (
  env: Env,
  orderIds: string[],
): Promise<{ orders: Array<{ order_id: string; state: string; tickets: ConfirmTicket[] }> }> =>
  callFunction(env, "events-tickets", { order_ids: orderIds });

/** Kupovnost eventa: organizator mora imati acct_… i charges_enabled. */
export async function organizerRail(
  env: Env,
  campaignId: string,
): Promise<{ connected: boolean; charges_enabled: boolean; account_id: string | null }> {
  const camps = await rest<Array<{ id: string; account_id: string }>>(
    env,
    `campaigns?select=id,account_id&id=eq.${encodeURIComponent(campaignId)}`,
  );
  const accountId = camps[0]?.account_id ?? null;
  if (!accountId) return { connected: false, charges_enabled: false, account_id: null };
  const rails = await rest<Array<{ stripe_account_id: string | null; stripe_charges_enabled: boolean }>>(
    env,
    `organizer_payment_rails?select=stripe_account_id,stripe_charges_enabled&account_id=eq.${encodeURIComponent(accountId)}`,
  );
  const rail = rails[0];
  return {
    // ⚠️ vraća se SAMO boolean — acct_… nikad ne izlazi prema browseru
    connected: !!rail?.stripe_account_id,
    charges_enabled: !!rail?.stripe_charges_enabled,
    account_id: accountId,
  };
}

/** Stanje narudžbe za javnu stranicu (order_id = bearer capability). */
export async function orderStatus(
  env: Env,
  orderId: string,
): Promise<{ order: OrderRow; tickets: TicketRow[] } | null> {
  const orders = await rest<OrderRow[]>(
    env,
    "contributions?select=id,campaign_id,tier_id,state,quantity,amount_cents,currency," +
      `reserve_expires_at,payment_rail,external_payment_ref,buyer_email,paid_at,holders&id=eq.${encodeURIComponent(orderId)}`,
  );
  const order = orders[0];
  if (!order || !order.tier_id) return null;
  const tickets = await rest<TicketRow[]>(
    env,
    "tickets?select=serial,holder_name,state,checked_in_at&order=serial.asc" +
      `&contribution_id=eq.${encodeURIComponent(orderId)}`,
  );
  return { order, tickets };
}

/**
 * Zabilježi povrat u jezgri: narudžba → `refunded`, izdane ulaznice → `void`,
 * inventory se vraća u prodaju, audit zapis ostaje.
 *
 * Novac vraća Stripe (worker/stripe.ts `refundPaymentIntent`) — ovo je samo
 * evidencija. `void_ticket` se NE koristi: traži `auth.uid()` koji service
 * ključ nema (v. migraciju 20260803130000).
 */
export const refundOrder = (
  env: Env,
  p: { order_id: string; amount_cents?: number | null; reason: string; external_ref?: string | null },
): Promise<{ status: string; order_id: string; voided?: number; kept_checked_in?: number }> =>
  restRpc(env, "refund_ticket_order", {
    p_order_id: p.order_id,
    p_amount_cents: p.amount_cents ?? null,
    p_reason: p.reason,
    p_external_ref: p.external_ref ?? null,
  });

/** Osvježi Stripe stanje organizatora iz `account.updated` webhooka. */
export async function upsertOrganizerRail(
  env: Env,
  p: { stripe_account_id: string; charges_enabled: boolean; payouts_enabled: boolean },
): Promise<boolean> {
  if (!env.DOMOVINA_API_SERVICE_KEY) return false;
  const res = await fetch(
    `${env.DOMOVINA_API_URL}/rest/v1/organizer_payment_rails?stripe_account_id=eq.${encodeURIComponent(p.stripe_account_id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: env.DOMOVINA_API_SERVICE_KEY,
        Authorization: `Bearer ${env.DOMOVINA_API_SERVICE_KEY}`,
        "Content-Profile": "pinka_finance",
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        stripe_charges_enabled: p.charges_enabled,
        stripe_payouts_enabled: p.payouts_enabled,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!res.ok) throw new HttpError(502, "api_rail_update_failed", `organizer_payment_rails: ${res.status}`);
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}
