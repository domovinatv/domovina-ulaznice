// Račun kupcu i alarmi.
//
// Tri stvari koje ovi testovi brane, sve tri skuplje od pada builda:
//   1. **dupli račun** — u fiskalizaciji je broj u nizu potrošen zauvijek,
//   2. **račun prije ulaznice** — račun za promet koji se nije dogodio,
//   3. **pad FIRA-e koji ruši ulaznicu** — kupac je platio i ulaznica vrijedi.
import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { call, checkoutCompleted, stripeSignature, testEnv, type TestCtx } from "./harness/env.ts";
import { one, rows } from "./harness/d1.ts";
import { firaVrijeme, webshopOrderId } from "../worker/racun-fira.ts";
import { prigusiMinuta } from "../worker/alarm.ts";
import { reconcile } from "../worker/reconcile.ts";

let t: TestCtx;
afterEach(() => t?.restore());
after(() => t?.restore());

const ORDER = "44444444-4444-4444-8444-444444444444";
const TICKETS = [
  { serial: "SUS-000004", holder_name: "Ana Anić", state: "issued", qr_token: "a".repeat(64) },
  { serial: "SUS-000005", holder_name: "Ivo Ivić", state: "issued", qr_token: "b".repeat(64) },
];

async function platiWebhookom(ctx: TestCtx, evtId = "evt_racun_1"): Promise<Response> {
  const payload = checkoutCompleted({ id: evtId, orderId: ORDER });
  return call(ctx, "/webhook/stripe", {
    raw: payload,
    headers: { "stripe-signature": stripeSignature(payload) },
  });
}

function pripremiPlacenu(ctx: TestCtx): void {
  ctx.api.confirm = { status: "paid", order_id: ORDER, tickets: TICKETS };
  ctx.api.orderState = "paid";
  ctx.api.tickets = TICKETS;
}

// -------------------------------------------------------------- provider organizator

test("zadani provider ne zove nikoga, ali bilježi da obveza postoji", async () => {
  t = testEnv();
  pripremiPlacenu(t);
  await platiWebhookom(t);

  assert.equal(t.api.firaPozivi.length, 0);
  const red = one<{ provider: string; status: string }>(t.db, "SELECT provider, status FROM invoices");
  assert.equal(red.provider, "organizator");
  assert.equal(red.status, "preskocen");
});

// --------------------------------------------------------------------- FIRA

test("provider 'fira' izdaje račun tek NAKON izdanih ulaznica", async () => {
  t = testEnv({ FIRA_API_KEY: "fira_test" });
  t.api.invoiceProvider = "fira";
  pripremiPlacenu(t);
  await platiWebhookom(t);

  assert.equal(t.api.firaPozivi.length, 1);
  // e-mail s ulaznicama mora biti poslan prije nego se račun uopće zatražio
  const redoslijed = t.calls.map((c) => c.url);
  const iMail = redoslijed.findIndex((u) => u.includes("api.resend.com"));
  const iFira = redoslijed.findIndex((u) => u.includes("fira.finance"));
  assert.ok(iMail >= 0 && iFira > iMail, "račun se izdaje nakon dostave ulaznica");

  const red = one<{ status: string; provider_ref: string }>(t.db, "SELECT status, provider_ref FROM invoices");
  assert.equal(red.status, "izdan");
  assert.equal(red.provider_ref, "123456");
});

test("FIRA payload nosi ključ u headeru, iznos u eurima i klauzulu čl. 90", async () => {
  t = testEnv({ FIRA_API_KEY: "fira_test" });
  t.api.invoiceProvider = "fira";
  pripremiPlacenu(t);
  await platiWebhookom(t);

  const poziv = t.api.firaPozivi[0];
  assert.equal(poziv.headers["fira-api-key"], "fira_test");
  const p = JSON.parse(poziv.body) as {
    brutto: number;
    lineItems: Array<{ price: number; quantity: number }>;
    paymentType: string;
    invoiceType: string;
    termsHR: string;
  };
  // 29800 centi = 298,00 € — cijeli centi u bazi, euri prema FIRA-i
  assert.equal(p.brutto, 298);
  assert.equal(p.lineItems[0].quantity, 2);
  assert.equal(p.lineItems[0].price, 149);
  assert.equal(p.paymentType, "KARTICA");
  assert.equal(p.invoiceType, "FISKALNI_RAČUN");
  assert.match(p.termsHR, /čl\. 90/);
});

test("ponovljeni webhook ne izdaje DRUGI račun", async () => {
  t = testEnv({ FIRA_API_KEY: "fira_test" });
  t.api.invoiceProvider = "fira";
  pripremiPlacenu(t);
  await platiWebhookom(t, "evt_racun_1");

  // drugi event, ista narudžba (Stripe retry s novim evt id-em)
  t.api.confirm = { status: "already_paid", order_id: ORDER, tickets: TICKETS.map((x) => ({ ...x, qr_token: null })) };
  await platiWebhookom(t, "evt_racun_2");

  assert.equal(t.api.firaPozivi.length, 1, "drugi webhook ne smije izdati novi račun");
  assert.equal(rows(t.db, "SELECT id FROM invoices").length, 1);
});

test("pad FIRA-e NE ruši webhook i ne poništava ulaznicu", async () => {
  t = testEnv({ FIRA_API_KEY: "fira_test" });
  t.api.invoiceProvider = "fira";
  t.api.firaOk = false;
  pripremiPlacenu(t);
  const res = await platiWebhookom(t);

  // 200: Stripe ne smije ponavljati zbog računa — ulaznica je izdana i poslana
  assert.equal(res.status, 200);
  assert.equal(t.api.emails.length, 1);
  const red = one<{ status: string; error: string }>(t.db, "SELECT status, error FROM invoices");
  assert.equal(red.status, "neuspjeh");
  assert.match(red.error, /401/);
});

test("bez FIRA ključa provider ne šalje ništa prema van", async () => {
  t = testEnv(); // nema FIRA_API_KEY
  t.api.invoiceProvider = "fira";
  pripremiPlacenu(t);
  await platiWebhookom(t);

  assert.equal(t.api.firaPozivi.length, 0);
  const red = one<{ status: string; error: string }>(t.db, "SELECT status, error FROM invoices");
  assert.equal(red.status, "neuspjeh");
  assert.match(red.error, /FIRA_API_KEY/);
});

test("povrat označi račun za storno (FIRA storno je ručni korak)", async () => {
  t = testEnv({ FIRA_API_KEY: "fira_test" });
  t.api.invoiceProvider = "fira";
  pripremiPlacenu(t);
  await platiWebhookom(t);

  const payload = JSON.stringify({
    id: "evt_refund_1",
    object: "event",
    type: "charge.refunded",
    account: "acct_1TestOrganizator",
    data: { object: { id: "ch_1", payment_intent: "pi_test_1", amount_refunded: 29800 } },
  });
  await call(t, "/webhook/stripe", { raw: payload, headers: { "stripe-signature": stripeSignature(payload) } });

  const red = one<{ status: string }>(t.db, "SELECT status FROM invoices WHERE provider = 'fira'");
  assert.equal(red.status, "storniran");
});

test("webshopOrderId je determinističan — retry ne stvara drugu narudžbu", () => {
  assert.equal(webshopOrderId(ORDER), webshopOrderId(ORDER));
  assert.notEqual(webshopOrderId(ORDER), webshopOrderId("55555555-4444-4444-8444-444444444444"));
  assert.ok(Number.isSafeInteger(webshopOrderId(ORDER)));
});

test("firaVrijeme daje 'YYYY-MM-DD HH:mm:ss'", () => {
  assert.equal(firaVrijeme(new Date("2026-09-03T08:05:09Z")), "2026-09-03 08:05:09");
});

// -------------------------------------------------------------------- alarmi

test("rekoncilijacija s problemom šalje alarm", async () => {
  t = testEnv({ ALARM_EMAIL: "ops@test.hr" });
  t.db.prepare(
    "INSERT INTO pending_deliveries (order_id, recipient, attempts) VALUES (?,?,1)",
  ).run(ORDER, "kupac@example.com");

  const izvjestaj = await reconcile(t.env);
  assert.equal(izvjestaj.pendingDeliveries, 1);
  const mail = t.api.emails.at(-1) as { subject: string; to: string[] };
  assert.match(mail.subject, /\[ulaznice\]/);
  assert.deepEqual(mail.to, ["ops@test.hr"]);
});

test("isti problem u prozoru prigušivanja ne šalje drugi e-mail", async () => {
  t = testEnv({ ALARM_EMAIL: "ops@test.hr" });
  t.db.prepare("INSERT INTO pending_deliveries (order_id, recipient, attempts) VALUES (?,?,1)")
    .run(ORDER, "kupac@example.com");

  await reconcile(t.env);
  await reconcile(t.env);

  assert.equal(t.api.emails.length, 1, "cron svakih 15 min ne smije slati 96 poruka dnevno");
  const red = one<{ broj_potisnutih: number }>(t.db, "SELECT broj_potisnutih FROM alarms");
  assert.equal(red.broj_potisnutih, 1);
});

test("bez ALARM_EMAIL rekoncilijacija radi, alarm samo ne odlazi", async () => {
  t = testEnv();
  t.db.prepare("INSERT INTO pending_deliveries (order_id, recipient, attempts) VALUES (?,?,1)")
    .run(ORDER, "kupac@example.com");

  const izvjestaj = await reconcile(t.env);
  assert.equal(izvjestaj.problems.length, 1);
  assert.equal(t.api.emails.length, 0);
});

test("neizdan račun je problem koji rekoncilijacija prijavi", async () => {
  t = testEnv({ ALARM_EMAIL: "ops@test.hr" });
  t.db.prepare(
    "INSERT INTO invoices (order_id, provider, status, amount_cents, error) VALUES (?,?,?,?,?)",
  ).run(ORDER, "fira", "neuspjeh", 29800, "401");

  const izvjestaj = await reconcile(t.env);
  assert.equal(izvjestaj.failedInvoices, 1);
  assert.ok(izvjestaj.problems.some((p) => p.includes("bez izdanog računa")));
});

test("prigušivanje se čita iz okoline, a smeće pada na zadanih 180 min", () => {
  assert.equal(prigusiMinuta({ ALARM_PRIGUSI_MIN: "30" } as never), 30);
  assert.equal(prigusiMinuta({ ALARM_PRIGUSI_MIN: "pola sata" } as never), 180);
  assert.equal(prigusiMinuta({} as never), 180);
});
