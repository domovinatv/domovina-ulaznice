// Testni Env + pozivanje PRAVOG Workera (worker/index.ts) kroz HTTP sučelje.
//
// Ništa ne izlazi na mrežu: globalThis.fetch je zamijenjen stubom koji zna
// odgovoriti Stripeu, domovina-api edge funkcijama, PostgREST-u i Resendu.
// Svaki poziv koji stub ne prepozna RUŠI test — nijedan test ne smije tiho
// otići van (obrazac: rodjendaonice/worker-tests/harness/env.ts).
import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import worker from "../../worker/index.ts";
import type { Env } from "../../worker/env.ts";
import { D1Shim, freshDb } from "./d1.ts";

export const HMAC_SECRET = "test-hmac-secret";
export const WEBHOOK_SECRET = "whsec_test";
export const SERVICE_KEY = "test-service-key";
export const API_URL = "https://api.test";
export const BASE_URL = "https://ulaznice.test";

export const CAMPAIGN = "11111111-1111-4111-8111-111111111111";
export const TIER = "22222222-2222-4222-8222-222222222222";
export const TIER_IMENSKA = "33333333-3333-4333-8333-333333333333";
export const ACCT = "acct_1TestOrganizator";

export interface TestCtx {
  env: Env;
  db: DatabaseSync;
  ctx: ExecutionContext;
  calls: FetchCall[];
  api: ApiState;
  restore(): void;
}

export interface FetchCall {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

/** Stanje koje stub glumi umjesto domovina-api baze. */
export interface ApiState {
  chargesEnabled: boolean;
  connected: boolean;
  inventoryTotal: number | null;
  inventoryClaimed: number;
  saleEnd: string | null;
  /** Odgovor koji `events-stripe-confirm` vraća (mijenja se po testu). */
  confirm: Record<string, unknown>;
  orderState: string;
  orderPaidAt: string | null;
  buyerEmail: string | null;
  tickets: Array<Record<string, unknown>>;
  deliverTokens: boolean;
  refundStatus: string;
  emailFails: boolean;
  stripeFails: boolean;
  createdSessions: Array<{ body: string; account: string | null }>;
  refunds: Array<{ body: string; account: string | null }>;
  emails: Array<Record<string, unknown>>;
}

export function testEnv(overrides: Partial<Record<string, unknown>> = {}): TestCtx {
  const db = freshDb();
  const state: ApiState = {
    chargesEnabled: true,
    connected: true,
    inventoryTotal: 10,
    inventoryClaimed: 0,
    saleEnd: null,
    confirm: {},
    orderState: "pending",
    orderPaidAt: null,
    buyerEmail: "kupac@example.com",
    tickets: [],
    deliverTokens: true,
    refundStatus: "refunded",
    emailFails: false,
    stripeFails: false,
    createdSessions: [],
    refunds: [],
    emails: [],
  };

  const env = {
    DB: new D1Shim(db),
    RL: undefined,
    ASSETS: { async fetch() { return new Response("<html><title>SPA</title></html>"); } },
    PUBLIC_BASE_URL: BASE_URL,
    DOMOVINA_API_URL: API_URL,
    EMAIL_FROM: "Ulaznice <ulaznice@test>",
    EMAIL_REPLY_TO: "podrska@test",
    STRIPE_SECRET_KEY: "sk_test_lazni",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    EVENTS_STRIPE_CONFIRM_SECRET: HMAC_SECRET,
    DOMOVINA_API_SERVICE_KEY: SERVICE_KEY,
    RESEND_API_KEY: "re_test",
    ...overrides,
  } as unknown as Env;

  const ctx = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;

  const { calls, restore } = installFetchStub(state);
  return { env, db, ctx, calls, api: state, restore };
}

// ------------------------------------------------------------------- pozivi

export interface CallOpts {
  method?: string;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  ip?: string;
}

export async function call(t: TestCtx, path: string, o: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { "CF-Connecting-IP": o.ip ?? "203.0.113.1", ...(o.headers ?? {}) };
  const hasBody = o.raw !== undefined || o.body !== undefined;
  if (hasBody && !headers["content-type"]) headers["content-type"] = "application/json";
  const req = new Request(`${BASE_URL}${path}`, {
    method: o.method ?? (hasBody ? "POST" : "GET"),
    headers,
    body: o.raw !== undefined ? o.raw : o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  return worker.fetch(req, t.env, t.ctx);
}

export async function callJson<T = Record<string, unknown>>(
  t: TestCtx,
  path: string,
  o: CallOpts = {},
): Promise<{ status: number; body: T; text: string }> {
  const res = await call(t, path, o);
  const text = await res.text();
  let body: unknown = {};
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body: body as T, text };
}

// ------------------------------------------------------- Stripe webhook potpis

/** `t=<ts>,v1=<hmac>` nad `<ts>.<payload>` — ista shema koju Stripe šalje. */
export function stripeSignature(payload: string, secret = WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}

export function checkoutCompleted(o: {
  id?: string;
  orderId: string;
  paymentIntent?: string;
  amount?: number;
  account?: string | null;
  email?: string | null;
  paymentStatus?: string;
}): string {
  return JSON.stringify({
    id: o.id ?? "evt_test_1",
    object: "event",
    type: "checkout.session.completed",
    account: o.account === undefined ? ACCT : o.account,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        payment_intent: o.paymentIntent ?? "pi_test_1",
        payment_status: o.paymentStatus ?? "paid",
        amount_total: o.amount ?? 29800,
        customer_email: o.email === undefined ? "kupac@example.com" : o.email,
        customer_details: { email: o.email === undefined ? "kupac@example.com" : o.email },
        metadata: { order_id: o.orderId, campaign_id: CAMPAIGN },
      },
    },
  });
}

// -------------------------------------------------------------- fetch stub

function installFetchStub(state: ApiState) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(typeof input === "object" && "url" in input ? input.url : input);
    const method = (init?.method || "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : "";
    const headers = normHeaders(init?.headers);
    calls.push({ url, method, body, headers });

    // ---- domovina-api: edge funkcije
    if (url.includes("/functions/v1/events-feed")) return json(feedPayload(state));

    if (url.includes("/functions/v1/events-order")) {
      const p = JSON.parse(body || "{}");
      state.inventoryClaimed += Number(p.quantity ?? 0);
      return json({
        order_id: p.order_id,
        state: "pending",
        amount_cents: 14900 * Number(p.quantity ?? 1),
        currency: "eur",
        expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
        existing: false,
      });
    }

    if (url.includes("/functions/v1/events-stripe-intent")) {
      requireHmac(headers, body);
      if (!state.connected) return json({ error: "organizer_not_connected" }, 400);
      if (!state.chargesEnabled) return json({ error: "organizer_charges_disabled" }, 400);
      const p = JSON.parse(body || "{}");
      return json({
        order_id: p.order_id,
        amount_cents: 29800,
        currency: "eur",
        quantity: 2,
        expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
        buyer_email: null,
        tier: { id: TIER, title: "Redovna", price_cents: 14900, imenska: false },
        event: {
          campaign_id: CAMPAIGN,
          title: "Susret 2027",
          slug: "susret-2027",
          starts_at: "2027-03-10T07:00:00+00:00",
          ends_at: null,
          timezone: "Europe/Zagreb",
          venue_name: "Dvorana",
          venue_city: "Zagreb",
        },
        stripe_account_id: ACCT,
        charges_enabled: true,
        invoice_provider: "organizator",
      });
    }

    if (url.includes("/functions/v1/events-stripe-confirm")) {
      requireHmac(headers, body);
      return json({ ok: true, ...state.confirm });
    }

    if (url.includes("/functions/v1/events-tickets")) {
      const p = JSON.parse(body || "{}");
      return json({
        orders: [
          {
            order_id: p.order_ids?.[0],
            state: state.orderState,
            tickets: state.tickets.map((t) => ({ ...t, qr_token: state.deliverTokens ? t.qr_token : null })),
          },
        ],
      });
    }

    // ---- domovina-api: PostgREST
    if (url.includes("/rest/v1/rpc/refund_ticket_order")) {
      return json({ status: state.refundStatus, order_id: JSON.parse(body || "{}").p_order_id, voided: 2 });
    }
    if (url.includes("/rest/v1/campaigns")) {
      return json([{ id: CAMPAIGN, account_id: "acc-1" }]);
    }
    if (url.includes("/rest/v1/organizer_payment_rails")) {
      if (method === "PATCH") return json([{ account_id: "acc-1" }]);
      return json([{
        stripe_account_id: state.connected ? ACCT : null,
        stripe_charges_enabled: state.chargesEnabled,
      }]);
    }
    if (url.includes("/rest/v1/contributions")) {
      return json([{
        id: idFromEq(url),
        campaign_id: CAMPAIGN,
        tier_id: TIER,
        state: state.orderState,
        quantity: 2,
        amount_cents: 29800,
        currency: "eur",
        reserve_expires_at: null,
        payment_rail: "stripe",
        external_payment_ref: "pi_test_1",
        buyer_email: state.buyerEmail,
        paid_at: state.orderPaidAt,
        holders: null,
      }]);
    }
    if (url.includes("/rest/v1/tickets")) {
      return json(state.tickets.map((t) => ({
        serial: t.serial,
        holder_name: t.holder_name ?? null,
        state: t.state ?? "issued",
        checked_in_at: null,
      })));
    }

    // ---- Stripe REST
    if (url.startsWith("https://api.stripe.com/")) {
      if (state.stripeFails) return json({ error: { message: "stripe pao", type: "api_error" } }, 500);
      const account = headers["stripe-account"] ?? null;
      if (url.includes("/v1/checkout/sessions")) {
        state.createdSessions.push({ body, account });
        return json({
          id: "cs_test_1",
          object: "checkout.session",
          url: "https://checkout.stripe.com/c/pay/cs_test_1",
          payment_intent: "pi_test_1",
        });
      }
      if (url.includes("/v1/refunds")) {
        state.refunds.push({ body, account });
        return json({ id: "re_test_1", object: "refund", status: "succeeded" });
      }
      if (url.includes("/v1/payment_intents/")) {
        return json({ id: "pi_test_1", object: "payment_intent", status: "succeeded", amount_received: 29800 });
      }
    }

    // ---- Resend
    if (url.startsWith("https://api.resend.com/")) {
      if (state.emailFails) return json({ message: "domena nije verificirana" }, 403);
      state.emails.push(JSON.parse(body || "{}"));
      return json({ id: "email_test_1" });
    }

    throw new Error(`neočekivan mrežni poziv u testu: ${method} ${url}`);
  }) as typeof fetch;

  return { calls, restore: () => { globalThis.fetch = original; } };
}

function requireHmac(headers: Record<string, string>, body: string): void {
  const sig = headers["x-ulaznice-signature"];
  if (!sig) throw new Error("events-stripe-* pozvan BEZ HMAC potpisa");
  const expected = "sha256=" + createHmac("sha256", HMAC_SECRET).update(body).digest("hex");
  if (sig !== expected) throw new Error(`neispravan HMAC potpis: ${sig}`);
}

function feedPayload(state: ApiState) {
  return {
    events: [
      {
        campaign_id: CAMPAIGN,
        slug: "susret-2027",
        title: "Susret 2027",
        state: "active",
        event: {
          event_type: "konferencija",
          venue_name: "Dvorana",
          venue_address: null,
          venue_city: "Zagreb",
          starts_at: "2027-03-10T07:00:00+00:00",
          ends_at: null,
          timezone: "Europe/Zagreb",
          description_hr: "Testni event",
          cover_image_url: null,
          organizer_name: "Test organizator",
          organizer_email: null,
          organizer_web: null,
        },
        tiers: [
          {
            id: TIER,
            title: "Redovna",
            description: null,
            price_cents: 14900,
            inventory_total: state.inventoryTotal,
            inventory_claimed: state.inventoryClaimed,
            imenska: false,
            sale_start: null,
            sale_end: state.saleEnd,
          },
          {
            id: TIER_IMENSKA,
            title: "Imenska",
            description: null,
            price_cents: 9900,
            inventory_total: 50,
            inventory_claimed: 0,
            imenska: true,
            sale_start: null,
            sale_end: null,
          },
        ],
      },
    ],
  };
}

const idFromEq = (url: string): string => decodeURIComponent(url.split("id=eq.")[1]?.split("&")[0] ?? "");

function normHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) h.forEach((v, k) => { out[k.toLowerCase()] = v; });
  else if (Array.isArray(h)) for (const [k, v] of h) out[k.toLowerCase()] = v;
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
