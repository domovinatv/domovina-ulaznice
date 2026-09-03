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
import { QR_PREFIX } from "./qr";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_QTY = 10;

const app = new Hono<{ Bindings: Env }>();

// ------------------------------------------------------------------ najava

/**
 * Stranica najave za okruženje koje još ne prodaje (NAJAVA="1").
 *
 * Namjerno je bez ijedne tvrdnje o datumu, cijeni ili organizatoru — nema ih
 * tko potvrditi. Bez ovoga bi javna domena servirala SPA koja izgleda kao
 * radna trgovina, a iza nje nema ni baze ni Stripe ključeva.
 */
const NAJAVA_HTML = `<!doctype html>
<html lang="hr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ulaznice — Domovina</title>
<meta name="robots" content="noindex">
<meta name="description" content="Prodaja ulaznica bez posrednika — uskoro.">
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
         background:#fbfbfa; color:#1a1a19; padding:24px; }
  @media (prefers-color-scheme: dark) { body { background:#141413; color:#f0f0ef; } }
  main { max-width:34rem; text-align:center; }
  h1 { font-size:1.6rem; margin:0 0 .6rem; letter-spacing:-.01em; }
  p { margin:.6rem 0; }
  .mutno { opacity:.65; font-size:.92rem; }
</style></head>
<body><main>
  <h1>Ulaznice bez posrednika</h1>
  <p>Organizator prodaje sa svoje stranice, novac ide izravno njemu.
     Bez naknade posrednika na ulaznicu.</p>
  <p class="mutno">Prodaja još nije otvorena. Ova stranica je najava.</p>
</main></body></html>`;

/**
 * U okruženju najave ništa osim najave ne postoji — API i webhook vraćaju 404,
 * ne 503. Razlog: 503 poziva na ponovni pokušaj i daje do znanja da ruta
 * postoji; ovdje je istina da u ovom okruženju te rute nema.
 */
app.use("*", async (c, next) => {
  if (c.env.NAJAVA !== "1") return next();
  const p = new URL(c.req.url).pathname;
  if (p.startsWith("/api/") || p.startsWith("/webhook/")) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.html(NAJAVA_HTML, 200, { "cache-control": "public, max-age=300" });
});

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
    // prijava organizatora i skener ulaza rade samo uz anon ključ
    prijava: !!c.env.DOMOVINA_API_ANON_KEY,
    // alarmi bez adrese završe u logu koji nitko ne gleda
    alarm: !!c.env.ALARM_EMAIL,
    // račun kupcu: 'fira' tek uz ključ, inače obveza ostaje na organizatoru
    racun: c.env.FIRA_API_KEY ? "fira" : "organizator",
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
 * Dva koraka, tim redoslijedom:
 *
 *   1. `events-tickets` — ako prva dostava nikad nije prošla, tokeni još
 *      postoje i dovoljno ih je poslati. Ništa se ne poništava.
 *   2. rotacija (`rotate_ticket_tokens`) — ako su tokeni potrošeni, izdaju se
 *      NOVI, a stari prestaju vrijediti.
 *
 * Zašto rotacija, a ne „žao nam je": prije nje je svaki „izgubio sam mail" bio
 * ručna intervencija podrške, a na događaju s nekoliko stotina ljudi to nije
 * rub nego svakodnevica (U1 §Gotcha 3 je ostavio odluku otvorenom; ovo je
 * opcija b).
 *
 * Cijena koju kupac mora razumjeti: **stari QR nakon ovoga ne radi.** Bez toga
 * bi ponovna dostava bila tvornica duplikata iste ulaznice — dva QR-a za isto
 * mjesto, oba važeća do prvog skena.
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
  let tickets = orders[0]?.tickets ?? [];
  let rotirano = false;

  if (!tickets.some((t) => t.qr_token)) {
    // Tokeni su potrošeni na prvoj dostavi → izdaj nove, stari prestaju vrijediti.
    const rot = await api.rotateTicketTokens(c.env, orderId);
    if (rot.status === "rate_limited") {
      return fail("previse_pokusaja", 429, { retry_after: 3600 });
    }
    if (rot.status === "nothing_to_rotate") {
      // sve ulaznice su iskorištene ili poništene — nema što isporučiti
      return c.json({ status: "nema_vazecih_ulaznica", recipient: maskEmail(recipient) });
    }
    if (rot.status !== "rotated" || !rot.tickets?.length) {
      return fail("rotacija_nije_uspjela", 502, { status: rot.status });
    }
    tickets = rot.tickets;
    rotirano = true;
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
  return c.json({
    status: res.ok ? "poslano" : "neuspjelo",
    recipient: maskEmail(recipient),
    // kupcu se MORA reći da stari QR više ne vrijedi
    stari_qr_ponisten: rotirano,
    error: res.error,
  });
});

// ------------------------------------------------- organizator i skener ulaza
//
// Sve ispod ide U IME PRIJAVLJENOG KORISNIKA (GoTrue JWT), nikad service
// ključem: autorizaciju drži baza (`has_role_on_account`, RLS), jer je jedina
// koja preživi grešku u ovom fajlu. Worker je proxy koji browseru štedi anon
// ključ i adresu jezgre.

/** `Authorization: Bearer <jwt>` → JWT, ili null. */
function bearer(c: { req: { header(n: string): string | undefined } }): string | null {
  const h = c.req.header("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

app.post("/api/organizator/prijava", async (c) => {
  const rl = await consume(c.env, "prijava", clientIp(c.req.raw));
  if (!rl.allowed) return fail("previse_pokusaja", 429, { retry_after: rl.retryAfter });

  let body: { email?: string; lozinka?: string };
  try {
    body = await c.req.json();
  } catch {
    return fail("bad_json");
  }
  const email = (body.email ?? "").trim();
  const lozinka = body.lozinka ?? "";
  if (!EMAIL_RE.test(email) || lozinka.length < 6) return fail("prijava_neuspjela", 401);

  const p = await api.prijava(c.env, email, lozinka);
  // Refresh token se NE vraća browseru: sesija traje koliko i access token, a
  // produljivanje bi tražilo trajnu pohranu koju ovaj proizvod nema razloga imati.
  return c.json({ access_token: p.access_token, expires_in: p.expires_in, email: p.user?.email ?? email });
});

app.get("/api/organizator/pregled", async (c) => {
  const jwt = bearer(c);
  if (!jwt) return fail("nije_prijavljen", 401);
  const pregled = await api.korisnickiRpc<{ accounts: unknown[]; events: unknown[] }>(
    c.env,
    jwt,
    "organizer_overview",
  );
  return c.json(pregled);
});

/**
 * Izvoz popisa sudionika (CSV) — imenske ulaznice za jedan događaj.
 *
 * PII izlazi iz sustava, pa vrijede tri stvari: RLS odlučuje smije li ovaj
 * korisnik vidjeti retke (mi ne filtriramo po accountu u kodu), izvoz je uvijek
 * za JEDAN događaj, i datoteka se ne cachea.
 */
app.get("/api/organizator/holderi.csv", async (c) => {
  const jwt = bearer(c);
  if (!jwt) return fail("nije_prijavljen", 401);
  const campaignId = c.req.query("campaign_id") ?? "";
  if (!UUID_RE.test(campaignId)) return fail("invalid_campaign_id");

  const redci = await api.korisnickiRest<
    Array<{
      serial: string;
      holder_name: string | null;
      holder_email: string | null;
      state: string;
      checked_in_at: string | null;
    }>
  >(
    c.env,
    jwt,
    "tickets?select=serial,holder_name,holder_email,state,checked_in_at&order=serial.asc" +
      `&campaign_id=eq.${encodeURIComponent(campaignId)}`,
  );

  const csv = [
    "serial;ime;email;stanje;ulazak",
    ...redci.map((r) =>
      [r.serial, r.holder_name ?? "", r.holder_email ?? "", r.state, r.checked_in_at ?? ""]
        .map(csvPolje)
        .join(";"),
    ),
  ].join("\r\n");

  // \uFEFF (BOM) + ; razdjelnik: Excel na hrvatskim postavkama inače razbije
  // dijakritiku i strpa sve u jedan stupac.
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sudionici-${campaignId.slice(0, 8)}.csv"`,
      "cache-control": "no-store",
    },
  });
});

app.post("/api/skener/sken", async (c) => {
  const jwt = bearer(c);
  if (!jwt) return fail("nije_prijavljen", 401);
  const rl = await consume(c.env, "sken", clientIp(c.req.raw));
  if (!rl.allowed) return fail("previse_pokusaja", 429, { retry_after: rl.retryAfter });

  let body: { qr_token?: string };
  try {
    body = await c.req.json();
  } catch {
    return fail("bad_json");
  }
  // Skener šalje što je pročitao; normalizaciju prefiksa radi i jezgra, ali
  // ovdje odbijamo očito smeće prije nego ode na mrežu.
  const sirovo = (body.qr_token ?? "").trim();
  const token = (sirovo.startsWith(QR_PREFIX) ? sirovo.slice(QR_PREFIX.length) : sirovo).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(token)) return fail("neispravan_qr", 400);

  return c.json(await api.checkin(c.env, jwt, token));
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

/** CSV polje: navodnici oko svega što ima ; " ili prijelom retka. */
function csvPolje(v: string): string {
  const s = String(v ?? "");
  // Vodeći =, +, - ili @ Excel tumači kao formulu — prefiks apostrofom.
  const sigurno = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[;"\r\n]/.test(sigurno) ? `"${sigurno.replace(/"/g, '""')}"` : sigurno;
}

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
    // Okruženje najave nema ni D1 ni Stripe ključeve — rekoncilijacija bi samo
    // rušila cron. Produkcija danas i nema trigger, ali guard stoji da dodavanje
    // triggera ne postane tiha greška.
    if (env.NAJAVA === "1") return;
    ctx.waitUntil(
      reconcile(env).catch((e) => {
        console.error(`[cron] rekoncilijacija: ${String(e)}`);
      }),
    );
  },
};

export type { Env };
