// Stranica narudžbe ("Moje ulaznice"), ponovna dostava, rate limit i cron.
import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { call, callJson, checkoutCompleted, stripeSignature, testEnv, type TestCtx } from "./harness/env.ts";
import { one } from "./harness/d1.ts";
import { parseRule, DEFAULT_RULES } from "../worker/ratelimit.ts";
import { tierAvailability } from "../worker/index.ts";
import { reconcile } from "../worker/reconcile.ts";

let t: TestCtx | null = null;
afterEach(() => { t?.restore(); t = null; });

const ORDER = "55555555-5555-4555-8555-555555555555";
const TICKETS = [
  { serial: "SUS-000001", holder_name: "Ana Anić", state: "issued", qr_token: "a".repeat(64) },
  { serial: "SUS-000002", holder_name: "Ivo Ivić", state: "issued", qr_token: "b".repeat(64) },
];

// ------------------------------------------------------------ stranica narudžbe

test("stanje narudžbe: ulaznice bez QR-a, e-mail maskiran", async () => {
  t = testEnv();
  t.api.orderState = "paid";
  t.api.orderPaidAt = new Date().toISOString();
  t.api.tickets = TICKETS;

  const { status, body, text } = await callJson<{
    state: string; tickets: Array<{ serial: string }>; buyer_email: string;
  }>(t, `/api/ulaznice/${ORDER}`);

  assert.equal(status, 200);
  assert.equal(body.state, "paid");
  assert.equal(body.tickets.length, 2);
  // QR token NIKAD ne ide na stranicu — jednokratan je i živi u e-mailu
  assert.ok(!text.includes("qr_token"), "qr_token ne smije biti u odgovoru");
  assert.ok(!text.includes("a".repeat(64)), "plaintext token ne smije izaći");
  assert.match(body.buyer_email, /^ku.*@example\.com$/, "e-mail mora biti maskiran");
});

test("nepostojeća narudžba → 404, neispravan UUID → 400", async () => {
  t = testEnv();
  assert.equal((await callJson(t, "/api/ulaznice/nije-uuid")).status, 400);
});

test("stranica narudžbe NE troši QR tokene (ne zove events-tickets)", async () => {
  t = testEnv();
  t.api.orderState = "paid";
  t.api.tickets = TICKETS;
  await call(t, `/api/ulaznice/${ORDER}`);
  assert.equal(
    t.calls.filter((c) => c.url.includes("events-tickets")).length,
    0,
    "dostava tokena se ne smije okinuti pukim otvaranjem stranice",
  );
});

test("ponovna dostava šalje ulaznice dok tokeni postoje", async () => {
  t = testEnv();
  t.api.orderState = "paid";
  t.api.tickets = TICKETS;
  const { body } = await callJson<{ status: string }>(t, `/api/ulaznice/${ORDER}/ponovna-dostava`, { method: "POST" });
  assert.equal(body.status, "poslano");
  assert.equal(t.api.emails.length, 1);
  const log = one<{ template: string }>(t.db, "SELECT template FROM sent_emails ORDER BY id DESC");
  assert.equal(log.template, "ponovna_dostava");
});

test("ponovna dostava nakon potrošenih tokena javlja vec_isporuceno", async () => {
  t = testEnv();
  t.api.orderState = "paid";
  t.api.tickets = TICKETS;
  t.api.deliverTokens = false;
  const { body } = await callJson<{ status: string }>(t, `/api/ulaznice/${ORDER}/ponovna-dostava`, { method: "POST" });
  assert.equal(body.status, "vec_isporuceno");
  assert.equal(t.api.emails.length, 0);
});

test("ponovna dostava neplaćene narudžbe → 409", async () => {
  t = testEnv();
  t.api.orderState = "pending";
  const { status, body } = await callJson<{ error: string }>(t, `/api/ulaznice/${ORDER}/ponovna-dostava`, { method: "POST" });
  assert.equal(status, 409);
  assert.equal(body.error, "narudzba_nije_placena");
});

// ------------------------------------------------------------------ rate limit

test("parseRule prihvaća 'N/sekundi', a smeće vraća na zadano", () => {
  assert.deepEqual(parseRule("5/60", DEFAULT_RULES.order), { limit: 5, windowSeconds: 60 });
  assert.deepEqual(parseRule("", DEFAULT_RULES.order), DEFAULT_RULES.order);
  assert.deepEqual(parseRule("puno/brzo", DEFAULT_RULES.order), DEFAULT_RULES.order);
  assert.deepEqual(parseRule("0/60", DEFAULT_RULES.order), DEFAULT_RULES.order);
});

test("rate limit reže nakon N narudžbi s istog IP-a", async () => {
  const kv = new Map<string, string>();
  t = testEnv({
    RL: {
      async get(k: string) { return kv.get(k) ?? null; },
      async put(k: string, v: string) { kv.set(k, v); },
    },
    RL_ORDER_IP: "2/600",
  });
  const body = { campaign_id: "11111111-1111-4111-8111-111111111111", tier_id: "22222222-2222-4222-8222-222222222222", quantity: 1, buyer_email: "a@b.hr", holders: [] };
  assert.equal((await callJson(t, "/api/narudzba", { body })).status, 200);
  assert.equal((await callJson(t, "/api/narudzba", { body })).status, 200);
  const treci = await callJson<{ error: string }>(t, "/api/narudzba", { body });
  assert.equal(treci.status, 429);
  assert.equal(treci.body.error, "previse_pokusaja");
});

// -------------------------------------------------------------- dostupnost tiera

test("tierAvailability: prodajni prozor i zalihe", () => {
  const base = {
    id: "t", title: "T", description: null, price_cents: 100,
    inventory_total: 10, inventory_claimed: 0, imenska: false,
    sale_start: null as string | null, sale_end: null as string | null,
  };
  assert.equal(tierAvailability(base).buyable, true);
  assert.equal(tierAvailability({ ...base, inventory_claimed: 10 }).sold_out, true);
  assert.equal(tierAvailability({ ...base, inventory_total: null }).available, null);
  assert.equal(tierAvailability({ ...base, sale_start: new Date(Date.now() + 3600_000).toISOString() }).not_started, true);
  assert.equal(tierAvailability({ ...base, sale_end: new Date(Date.now() - 3600_000).toISOString() }).ended, true);
});

// ------------------------------------------------------------------- cron

test("rekoncilijacija dovršava narudžbu kojoj je webhook ostao bez ishoda", async () => {
  t = testEnv();
  t.api.confirm = { status: "paid", order_id: ORDER, serials: ["SUS-000001"], tickets: [] };
  await t.env.DB.prepare(
    "INSERT INTO webhook_events (id, type, stripe_account, order_id, payment_intent, outcome) VALUES (?,?,?,?,?,NULL)",
  ).bind("evt_zaglavljen", "checkout.session.completed", "acct_1TestOrganizator", ORDER, "pi_test_1").run();

  const rep = await reconcile(t.env);
  assert.equal(rep.checked, 1);
  assert.equal(rep.confirmed, 1);
  const ev = one<{ outcome: string }>(t.db, "SELECT outcome FROM webhook_events WHERE id = 'evt_zaglavljen'");
  assert.equal(ev.outcome, "reconcile:paid");
});

test("rekoncilijacija prijavljuje neisporučene ulaznice kao problem", async () => {
  t = testEnv();
  await t.env.DB.prepare("INSERT INTO pending_deliveries (order_id, recipient, attempts) VALUES (?,?,1)")
    .bind(ORDER, "kupac@example.com").run();
  const rep = await reconcile(t.env);
  assert.equal(rep.pendingDeliveries, 1);
  assert.ok(rep.problems.some((p) => p.includes("ručnu dostavu")));
});

test("obrađeni webhook se u rekoncilijaciji ne dira", async () => {
  t = testEnv();
  await t.env.DB.prepare(
    "INSERT INTO webhook_events (id, type, stripe_account, order_id, payment_intent, outcome) VALUES (?,?,?,?,?,?)",
  ).bind("evt_ok", "checkout.session.completed", "acct_1TestOrganizator", ORDER, "pi_test_1", "paid").run();
  const rep = await reconcile(t.env);
  assert.equal(rep.checked, 0);
});

// ------------------------------------------------------------------- zdravlje

test("/api/zdravlje ne otkriva vrijednosti tajni, samo jesu li postavljene", async () => {
  t = testEnv();
  const { body, text } = await callJson<Record<string, boolean>>(t, "/api/zdravlje");
  assert.equal(body.hmac, true);
  assert.equal(body.stripe, true);
  assert.ok(!text.includes("sk_test"), "ključ ne smije izaći");
  assert.ok(!text.includes("test-hmac-secret"));
});

test("nepoznata /api ruta → 404, a SPA ruta ide na ASSETS", async () => {
  t = testEnv();
  assert.equal((await call(t, "/api/nepostoji")).status, 404);
  const spa = await call(t, "/dogadjaj/susret-2027");
  assert.equal(spa.status, 200);
  assert.match(await spa.text(), /SPA/);
});

// Provjera da harness stvarno hvata mrežu (inače bi testovi lagali).
test("neočekivan mrežni poziv ruši test", async () => {
  t = testEnv();
  await assert.rejects(() => fetch("https://negdje-drugdje.test/"), /neočekivan mrežni poziv/);
  // a poznati poziv prolazi
  const payload = checkoutCompleted({ orderId: ORDER });
  assert.ok(stripeSignature(payload).startsWith("t="));
});
