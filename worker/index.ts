// domovina-ulaznice — Worker: javna prodaja ulaznica bez posrednika.
//
// Granica (docs/02-arhitektura.md §1): ovaj Worker je prodajni kanal i Stripe
// rail. Ulaznice, narudžbe i inventory NISU ovdje — svaki takav podatak dolazi
// iz domovina-api (shema pinka_finance) i tamo se i mijenja.
//
// Što browser NIKAD ne vidi: `acct_…` organizatora, service ključ, HMAC tajnu,
// Stripe ključeve, QR tokene tuđih narudžbi.
import { Hono } from "hono";
import type { Env } from "./env";
import { HttpError } from "./env";
import * as api from "./api";
import { createCheckoutSession, formatWhen } from "./stripe";
import { handleStripeWebhook, logMoney } from "./webhooks";
import { reconcile } from "./reconcile";
import { clientIp, consume } from "./ratelimit";
import { sendEmail, ticketAttachments, ticketMail } from "./mail";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_QTY = 10;

const app = new Hono<{ Bindings: Env }>();

// ------------------------------------------------------------------ pomoćnici

const fail = (code: string, status = 400, extra: Record<string, unknown> = {}) =>
  Response.json({ error: code, ...extra }, { status });

/** Je li tier trenutno kupiv (prodajni prozor + zalihe). */
export function tierAvailability(t: api.FeedTier, now = Date.now()): {
  sold_out: boolean;
  not_started: boolean;
  ended: boolean;
  available: number | null;
  buyable: boolean;
} {
  const start = t.sale_start ? Date.parse(t.sale_start) : null;
  const end = t.sale_end ? Date.parse(t.sale_end) : null;
  const not_started = start !== null && !Number.isNaN(start) && now < start;
  const ended = end !== null && !Number.isNaN(end) && now > end;
  const available = t.inventory_total === null ? null : Math.max(t.inventory_total - t.inventory_claimed, 0);
  const sold_out = available !== null && available <= 0;
  return { sold_out, not_started, ended, available, buyable: !sold_out && !not_started && !ended };
}

/** Javni oblik eventa — bez `acct_…`, bez PII-ja, bez Safe adrese. */
function publicEvent(ev: api.FeedEvent, rail: { connected: boolean; charges_enabled: boolean }) {
  const tiers = ev.tiers.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    price_cents: t.price_cents,
    imenska: t.imenska,
    sale_start: t.sale_start,
    sale_end: t.sale_end,
    ...tierAvailability(t),
  }));
  return {
    campaign_id: ev.campaign_id,
    slug: ev.slug,
    title: ev.title,
    event: ev.event,
    tiers,
    // izvedeni boolean umjesto acct_… (docs/03 §2, presedan bookable.ts)
    stripe_connected: rail.connected,
    // "vidljiv, ali ne kupiv" je legitimno stanje — stranica se prikazuje
    kupovno: rail.connected && rail.charges_enabled && tiers.some((t) => t.buyable),
  };
}

// ------------------------------------------------------------------- rute

app.get("/api/zdravlje", (c) => {
  // dev override (STRIPE_API_BASE / RESEND_API_BASE) smije postojati samo
  // lokalno. Ako se provuče u produkciju, pozivi prema Stripeu i Resendu
  // pucaju (guard prihvaća samo localhost) — a to se mora VIDJETI odmah,
  // ne tek kad prva narudžba padne.
  const devOverride = !!(c.env.STRIPE_API_BASE || c.env.RESEND_API_BASE);
  const prod = /^https:\/\//.test(c.env.PUBLIC_BASE_URL ?? "") &&
    !/localhost|127\.0\.0\.1|\.workers\.dev/.test(c.env.PUBLIC_BASE_URL ?? "");
  if (devOverride && prod) {
    console.error("[zdravlje] ⚠️ STRIPE_API_BASE/RESEND_API_BASE postavljeni na produkcijskoj domeni");
  }
  return c.json({
    ok: !(devOverride && prod),
    api: !!c.env.DOMOVINA_API_URL,
    stripe: !!c.env.STRIPE_SECRET_KEY,
    webhook: !!c.env.STRIPE_WEBHOOK_SECRET,
    hmac: !!c.env.EVENTS_STRIPE_CONFIRM_SECRET,
    mail: !!c.env.RESEND_API_KEY,
    dev_override: devOverride,
    ...(devOverride && prod ? { upozorenje: "dev_override_na_produkciji" } : {}),
  });
});

app.get("/api/dogadjaji", async (c) => {
  const { events } = await api.feed(c.env, c.req.query("grad") ? `?grad=${encodeURIComponent(c.req.query("grad")!)}` : "");
  const out = await Promise.all(
    events.map(async (ev) => {
      const rail = await api.organizerRail(c.env, ev.campaign_id).catch(() => ({
        connected: false,
        charges_enabled: false,
        account_id: null,
      }));
      return publicEvent(ev, rail);
    }),
  );
  return c.json({ events: out });
});

app.get("/api/dogadjaj/:slug", async (c) => {
  const slug = c.req.param("slug");
  const { events } = await api.feed(c.env);
  const ev = events.find((e) => e.slug === slug);
  if (!ev) return fail("event_not_found", 404);
  const rail = await api.organizerRail(c.env, ev.campaign_id).catch(() => ({
    connected: false,
    charges_enabled: false,
    account_id: null,
  }));
  const page = await c.env.DB.prepare("SELECT accent_color, logo_url, hero_url, intro_html, terms_url FROM event_pages WHERE campaign_id = ?")
    .bind(ev.campaign_id)
    .first()
    .catch(() => null);
  return c.json({ ...publicEvent(ev, rail), brand: page ?? null });
});

/**
 * Narudžba → Stripe Checkout.
 *
 * Redoslijed je bitan: rezervacija u jezgri PRIJE Stripea. Ako bi session
 * nastao prvi, kupac bi mogao platiti mjesto koje ne postoji.
 */
app.post("/api/narudzba", async (c) => {
  const rl = await consume(c.env, "order", clientIp(c.req.raw));
  if (!rl.allowed) return fail("previse_pokusaja", 429, { retry_after: rl.retryAfter });

  let body: {
    campaign_id?: string;
    tier_id?: string;
    quantity?: number;
    holders?: Array<{ full_name?: string; email?: string }>;
    buyer_email?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return fail("bad_json");
  }

  if (!UUID_RE.test(body.campaign_id ?? "")) return fail("invalid_campaign_id");
  if (!UUID_RE.test(body.tier_id ?? "")) return fail("invalid_tier_id");
  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) return fail("invalid_quantity");
  const buyerEmail = (body.buyer_email ?? "").trim();
  if (!EMAIL_RE.test(buyerEmail) || buyerEmail.length > 200) return fail("invalid_buyer_email");

  const { events } = await api.feed(c.env);
  const ev = events.find((e) => e.campaign_id === body.campaign_id);
  if (!ev) return fail("event_not_found", 404);
  const tier = ev.tiers.find((t) => t.id === body.tier_id);
  if (!tier) return fail("tier_not_found", 404);

  const avail = tierAvailability(tier);
  if (!avail.buyable) {
    return fail(avail.sold_out ? "tier_sold_out" : avail.not_started ? "sale_not_started" : "sale_ended", 409);
  }
  if (avail.available !== null && quantity > avail.available) return fail("tier_sold_out", 409);

  // Imenski tier traži potpuno ime za svaki komad — isto pravilo vrijedi i u
  // create_ticket_order (holders_incomplete); ovdje samo ranije i s HR porukom.
  const holders = (body.holders ?? [])
    .slice(0, quantity)
    .map((h) => ({ full_name: (h.full_name ?? "").trim(), email: (h.email ?? "").trim() || undefined }));
  if (tier.imenska) {
    if (holders.length < quantity || holders.some((h) => h.full_name.length < 2 || h.full_name.length > 120)) {
      return fail("holders_incomplete", 422);
    }
  }

  // Bez radnog Stripe raila session se NIKAD ne kreira "u prazno" (bookable.ts).
  const rail = await api.organizerRail(c.env, ev.campaign_id);
  if (!rail.connected) return fail("organizer_not_connected", 409);
  if (!rail.charges_enabled) return fail("organizer_charges_disabled", 409);

  // order_id je bearer capability: 128-bit random, generira ga server.
  const orderId = crypto.randomUUID();
  await api.createOrder(c.env, {
    order_id: orderId,
    campaign_id: ev.campaign_id,
    tier_id: tier.id,
    quantity,
    holders: tier.imenska ? holders.map((h) => ({ full_name: h.full_name, email: h.email })) : [],
  });

  // Iznos i acct_… dolaze iz jezgre, ne iz klijenta — klijent ne određuje cijenu.
  const intent = await api.stripeIntent(c.env, orderId);
  const session = await createCheckoutSession(c.env, {
    orderId,
    campaignId: ev.campaign_id,
    eventTitle: intent.event.title,
    eventSlug: intent.event.slug,
    eventWhen: formatWhen(intent.event.starts_at, intent.event.venue_city, intent.event.timezone ?? "Europe/Zagreb"),
    tierTitle: intent.tier.title,
    quantity: intent.quantity,
    unitAmountCents: intent.tier.price_cents,
    buyerEmail,
    stripeAccountId: intent.stripe_account_id,
    chargesEnabled: intent.charges_enabled,
  });

  await logMoney(c.env, {
    orderId,
    account: null, // acct_… se ne zapisuje uz narudžbu prije naplate
    paymentIntent: null,
    op: "checkout.created",
    amount: intent.amount_cents,
    result: "ok",
    detail: session.id,
  });

  if (!session.url) return fail("checkout_bez_url", 502);
  // ⚠️ Odgovor NE sadrži acct_… ni session objekt — samo URL i naša narudžba.
  return c.json({ order_id: orderId, checkout_url: session.url, amount_cents: intent.amount_cents });
});

/** Stanje narudžbe. `order_id` (128-bit random) JE autorizacija — kao u jezgri. */
app.get("/api/ulaznice/:order_id", async (c) => {
  const orderId = c.req.param("order_id");
  if (!UUID_RE.test(orderId)) return fail("invalid_order_id");

  const status = await api.orderStatus(c.env, orderId);
  if (!status) return fail("order_not_found", 404);

  const { events } = await api.feed(c.env);
  const ev = events.find((e) => e.campaign_id === status.order.campaign_id);
  const delivered = await c.env.DB.prepare(
    "SELECT status, created_at FROM sent_emails WHERE order_id = ? AND template = 'ulaznice' ORDER BY id DESC LIMIT 1",
  )
    .bind(orderId)
    .first<{ status: string; created_at: string }>()
    .catch(() => null);

  return c.json({
    order_id: status.order.id,
    state: status.order.state,
    quantity: status.order.quantity,
    amount_cents: status.order.amount_cents,
    currency: status.order.currency,
    expires_at: status.order.reserve_expires_at,
    paid_at: status.order.paid_at,
    buyer_email: maskEmail(status.order.buyer_email),
    event: ev ? { title: ev.title, slug: ev.slug, ...(ev.event ?? {}) } : null,
    // QR se NE vraća: tokeni su jednokratni i žive u e-mailu (Zapisnik U1 §Gotcha 3)
    tickets: status.tickets,
    dostava: delivered ? { status: delivered.status, at: delivered.created_at } : null,
  });
});

/**
 * Ponovna dostava ulaznica na e-mail.
 *
 * Radi SAMO ako QR tokeni još nisu isporučeni (prvi pokušaj slanja je pao).
 * Nakon uspješne dostave plaintext u bazi više ne postoji — tada se javlja
 * `vec_isporuceno` i kupac mora potražiti izvornu poruku ili kontaktirati
 * podršku. To je cijena Tier-0 modela (u bazi samo hash) i svjesna odluka.
 */
app.post("/api/ulaznice/:order_id/ponovna-dostava", async (c) => {
  const orderId = c.req.param("order_id");
  if (!UUID_RE.test(orderId)) return fail("invalid_order_id");
  const rl = await consume(c.env, "resend", orderId);
  if (!rl.allowed) return fail("previse_pokusaja", 429, { retry_after: rl.retryAfter });

  const status = await api.orderStatus(c.env, orderId);
  if (!status) return fail("order_not_found", 404);
  if (status.order.state !== "paid") return fail("narudzba_nije_placena", 409, { state: status.order.state });

  const recipient = status.order.buyer_email;
  if (!recipient) return fail("nema_email_adrese", 409);

  const { orders } = await api.deliverTickets(c.env, [orderId]);
  const tickets = orders[0]?.tickets ?? [];
  if (!tickets.some((t) => t.qr_token)) {
    return c.json({ status: "vec_isporuceno", recipient: maskEmail(recipient) });
  }

  const { events } = await api.feed(c.env);
  const ev = events.find((e) => e.campaign_id === status.order.campaign_id);
  const mail = ticketMail({
    event: {
      title: ev?.title ?? "Događaj",
      slug: ev?.slug ?? "",
      starts_at: ev?.event?.starts_at ?? null,
      ends_at: ev?.event?.ends_at ?? null,
      timezone: ev?.event?.timezone ?? "Europe/Zagreb",
      venue_name: ev?.event?.venue_name ?? null,
      venue_city: ev?.event?.venue_city ?? null,
    },
    tickets,
    orderUrl: `${c.env.PUBLIC_BASE_URL}/ulaznice/${orderId}`,
    amountCents: status.order.amount_cents,
  });
  const res = await sendEmail(c.env, {
    to: recipient,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    template: "ponovna_dostava",
    orderId,
    attachments: ticketAttachments(tickets),
  });
  if (res.ok) {
    await c.env.DB.prepare("DELETE FROM pending_deliveries WHERE order_id = ?").bind(orderId).run().catch(() => undefined);
  }
  return c.json({ status: res.ok ? "poslano" : "neuspjelo", recipient: maskEmail(recipient), error: res.error });
});

app.post("/webhook/stripe", async (c) => {
  const rl = await consume(c.env, "webhook", clientIp(c.req.raw));
  if (!rl.allowed) return fail("previse_pokusaja", 429, { retry_after: rl.retryAfter });
  return handleStripeWebhook(c.req.raw, c.env);
});

// SPA fallback — sve što nije /api ili /webhook servira statika.
app.all("*", async (c) => {
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/webhook/")) return fail("not_found", 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    if (err.status >= 500) console.error(`[worker] ${err.code}: ${err.message}`);
    return fail(err.code, err.status);
  }
  console.error(`[worker] neuhvaćena greška: ${String(err?.message || err)}`);
  return fail("greska_servera", 500);
});

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  if (!domain) return "…";
  const head = user.slice(0, 2);
  return `${head}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      reconcile(env).catch((e) => {
        console.error(`[cron] rekoncilijacija: ${String(e)}`);
      }),
    );
  },
};

export type { Env };
