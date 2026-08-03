// Webhook je JEDINI izvor istine o plaćanju — ovdje se testira upravo to:
// potpis prije svega, idempotencija, dostava ulaznica, automatski povrat.
import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import {
  ACCT,
  call,
  callJson,
  checkoutCompleted,
  stripeSignature,
  testEnv,
  type TestCtx,
} from "./harness/env.ts";
import { one, rows } from "./harness/d1.ts";

let t: TestCtx | null = null;
afterEach(() => { t?.restore(); t = null; });

const ORDER = "44444444-4444-4444-8444-444444444444";

const TICKETS = [
  { serial: "SUS-000001", holder_name: "Ana Anić", holder_email: "ana@example.com", state: "issued", qr_token: "a".repeat(64) },
  { serial: "SUS-000002", holder_name: "Ivo Ivić", holder_email: null, state: "issued", qr_token: "b".repeat(64) },
];

const posalji = (t: TestCtx, payload: string, sig?: string) =>
  callJson<{ received?: boolean; outcome?: string; duplicate?: boolean; error?: string }>(t, "/webhook/stripe", {
    raw: payload,
    headers: { "stripe-signature": sig ?? stripeSignature(payload) },
  });

// ------------------------------------------------------------------- potpis

test("krivi potpis → 400 i NIŠTA se ne dogodi", async () => {
  t = testEnv();
  const payload = checkoutCompleted({ orderId: ORDER });
  const res = await posalji(t, payload, "t=1,v1=" + "0".repeat(64));
  assert.equal(res.status, 400);
  assert.equal(rows(t.db, "SELECT * FROM webhook_events").length, 0, "baza mora ostati netaknuta");
  assert.equal(t.api.emails.length, 0);
});

test("bez potpisa → 400", async () => {
  t = testEnv();
  const res = await callJson(t, "/webhook/stripe", { raw: checkoutCompleted({ orderId: ORDER }) });
  assert.equal(res.status, 400);
});

test("bez STRIPE_WEBHOOK_SECRET → 503, nikad tiho propuštanje", async () => {
  t = testEnv({ STRIPE_WEBHOOK_SECRET: undefined });
  const payload = checkoutCompleted({ orderId: ORDER });
  const res = await posalji(t, payload);
  assert.equal(res.status, 503);
});

// ------------------------------------------------------------------- dostava

test("plaćena sesija → ulaznice e-mailom s QR privitkom", async () => {
  t = testEnv();
  t.api.confirm = { status: "paid", order_id: ORDER, serials: ["SUS-000001", "SUS-000002"], tickets: TICKETS };

  const res = await posalji(t, checkoutCompleted({ orderId: ORDER }));
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, "paid");

  assert.equal(t.api.emails.length, 1, "točno jedan e-mail");
  const mail = t.api.emails[0] as { to: string[]; subject: string; html: string; attachments: Array<{ filename: string; content: string; content_id: string }> };
  assert.deepEqual(mail.to, ["kupac@example.com"]);
  assert.match(mail.subject, /Ulaznice/);
  assert.equal(mail.attachments.length, 2, "QR privitak po ulaznici");
  assert.equal(mail.attachments[0].filename, "SUS-000001.png");
  assert.ok(mail.html.includes("cid:qr0"), "QR mora biti ugrađen preko cid:");
  assert.ok(mail.html.includes("Ana Anić"));
  // QR token NIKAD ne smije završiti u tijelu poruke kao tekst
  assert.ok(!mail.html.includes("a".repeat(64)), "plaintext token ne ide u HTML");

  const log = one<{ status: string; template: string }>(t.db, "SELECT status, template FROM sent_emails");
  assert.equal(log.status, "sent");
  assert.equal(log.template, "ulaznice");
});

test("isti webhook dvaput → i dalje jedan e-mail (D1 lock)", async () => {
  t = testEnv();
  t.api.confirm = { status: "paid", order_id: ORDER, serials: [], tickets: TICKETS };
  const payload = checkoutCompleted({ orderId: ORDER });

  const prvi = await posalji(t, payload);
  const drugi = await posalji(t, payload);

  assert.equal(prvi.body.outcome, "paid");
  assert.equal(drugi.body.duplicate, true, "drugi put je duplikat");
  assert.equal(t.api.emails.length, 1, "ulaznice se ne šalju dvaput");
  assert.equal(rows(t.db, "SELECT * FROM webhook_events").length, 1);
});

test("retry s drugim evt_ id-em → already_paid, bez novih tokena i bez maila", async () => {
  t = testEnv();
  // jezgra je već kreditirala narudžbu; tokeni su potrošeni pa ih nema u odgovoru
  t.api.confirm = {
    status: "already_paid",
    order_id: ORDER,
    serials: ["SUS-000001"],
    tickets: TICKETS.map((x) => ({ ...x, qr_token: null })),
  };
  const res = await posalji(t, checkoutCompleted({ id: "evt_test_2", orderId: ORDER }));
  assert.equal(res.body.outcome, "already_paid");
  assert.equal(t.api.emails.length, 0, "bez tokena nema smisla slati poruku bez QR-a");
});

test("neuspjelo slanje ostavlja dug u pending_deliveries", async () => {
  t = testEnv();
  t.api.confirm = { status: "paid", order_id: ORDER, serials: [], tickets: TICKETS };
  t.api.emailFails = true;

  await posalji(t, checkoutCompleted({ orderId: ORDER }));

  const dug = one<{ order_id: string; attempts: number }>(t.db, "SELECT order_id, attempts FROM pending_deliveries");
  assert.equal(dug.order_id, ORDER);
  assert.equal(dug.attempts, 1);
  const log = one<{ status: string }>(t.db, "SELECT status FROM sent_emails ORDER BY id DESC");
  assert.equal(log.status, "failed");
});

// -------------------------------------------------------------------- povrat

test("expired_sold_out → automatski PUN povrat + e-mail isprike", async () => {
  t = testEnv();
  t.api.confirm = { status: "expired_sold_out", order_id: ORDER };

  const res = await posalji(t, checkoutCompleted({ orderId: ORDER }));
  assert.equal(res.body.outcome, "expired_sold_out_refunded");

  assert.equal(t.api.refunds.length, 1, "mora se izvesti povrat");
  const refund = t.api.refunds[0];
  assert.equal(refund.account, ACCT, "povrat ide na račun organizatora (direct charge)");
  const form = new URLSearchParams(refund.body);
  assert.equal(form.get("payment_intent"), "pi_test_1");
  assert.equal(form.get("amount"), null, "pun povrat: iznos se ne šalje");
  assert.equal(form.get("reverse_transfer"), null, "to je parametar destination modela");
  assert.equal(form.get("refund_application_fee"), null, "feeja nema pa se ni ne vraća");

  const mail = t.api.emails.at(-1) as { subject: string; to: string[] };
  assert.match(mail.subject, /Povrat/);
  assert.deepEqual(mail.to, ["kupac@example.com"]);

  const money = one<{ op: string; result: string }>(t.db, "SELECT op, result FROM payment_log ORDER BY id DESC");
  assert.equal(money.op, "refund.expired_sold_out");
  assert.equal(money.result, "ok");
});

test("duplicate_payment → povrat te uplate, bez isprike (ulaznice postoje)", async () => {
  t = testEnv();
  t.api.confirm = { status: "duplicate_payment", order_id: ORDER, credited_ref: "pi_prvi" };
  const res = await posalji(t, checkoutCompleted({ orderId: ORDER, paymentIntent: "pi_drugi" }));
  assert.equal(res.body.outcome, "duplicate_payment_refunded");
  assert.equal(t.api.refunds.length, 1);
  assert.equal(t.api.emails.length, 0, "kupac ima ulaznice — isprika bi zbunila");
});

test("tx_already_credited → NE dira novac, ide u red za ručno sparivanje", async () => {
  t = testEnv();
  t.api.confirm = { status: "tx_already_credited", order_id: ORDER };
  const res = await posalji(t, checkoutCompleted({ orderId: ORDER }));
  assert.equal(res.body.outcome, "tx_already_credited");
  assert.equal(t.api.refunds.length, 0, "tuđa uplata se ne vraća automatski");
  const money = one<{ op: string; result: string }>(t.db, "SELECT op, result FROM payment_log ORDER BY id DESC");
  assert.equal(money.result, "error");
});

test("neuspjeh povrata → 500 i OTKLJUČAN event (Stripe mora ponoviti)", async () => {
  t = testEnv();
  t.api.confirm = { status: "expired_sold_out", order_id: ORDER };
  t.api.stripeFails = true;

  const res = await posalji(t, checkoutCompleted({ orderId: ORDER }));
  assert.equal(res.status, 500);
  assert.equal(
    rows(t.db, "SELECT * FROM webhook_events").length,
    0,
    "zaključavanje se mora obrisati, inače bi retry bio odbačen kao duplikat",
  );
});

// ------------------------------------------------------------------- ostalo

test("nenaplaćena sesija ne izdaje ulaznice", async () => {
  t = testEnv();
  const res = await posalji(t, checkoutCompleted({ orderId: ORDER, paymentStatus: "unpaid" }));
  assert.equal(res.body.outcome, "not_paid_unpaid");
  assert.equal(t.api.emails.length, 0);
});

test("sesija bez order_id metapodatka se preskače, ne ruši", async () => {
  t = testEnv();
  const payload = JSON.stringify({
    id: "evt_bez_meta",
    type: "checkout.session.completed",
    account: ACCT,
    data: { object: { id: "cs_x", payment_intent: "pi_x", payment_status: "paid", amount_total: 100, metadata: {} } },
  });
  const res = await posalji(t, payload);
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, "no_order_metadata");
});

test("account.updated osvježava rail organizatora", async () => {
  t = testEnv();
  const payload = JSON.stringify({
    id: "evt_acct_1",
    type: "account.updated",
    account: ACCT,
    data: { object: { id: ACCT, object: "account", charges_enabled: true, details_submitted: true, payouts_enabled: false } },
  });
  const res = await posalji(t, payload);
  assert.equal(res.body.outcome, "rail_updated");
  const patch = t.calls.find((c) => c.method === "PATCH" && c.url.includes("organizer_payment_rails"));
  assert.ok(patch, "mora otići PATCH na organizer_payment_rails");
  assert.ok(patch!.body.includes('"stripe_charges_enabled":true'));
});

test("charge.refunded poništava ulaznice kroz jezgru", async () => {
  t = testEnv();
  // najprije uspješna kupnja (da postoji veza pi → order)
  t.api.confirm = { status: "paid", order_id: ORDER, serials: [], tickets: TICKETS };
  await posalji(t, checkoutCompleted({ orderId: ORDER }));

  const payload = JSON.stringify({
    id: "evt_refund_1",
    type: "charge.refunded",
    account: ACCT,
    data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_test_1", amount_refunded: 29800 } },
  });
  const res = await posalji(t, payload);
  assert.equal(res.body.outcome, "refund_refunded");
  const rpc = t.calls.find((c) => c.url.includes("/rpc/refund_ticket_order"));
  assert.ok(rpc, "povrat se bilježi RPC-om u jezgri, ne lokalno");
  assert.ok(rpc!.body.includes(ORDER));
});

test("dispute se samo bilježi — ulaznica se NE poništava automatski", async () => {
  t = testEnv();
  const payload = JSON.stringify({
    id: "evt_disp_1",
    type: "charge.dispute.created",
    account: ACCT,
    data: { object: { id: "dp_1", object: "dispute", payment_intent: "pi_test_1", amount: 29800, reason: "fraudulent" } },
  });
  const res = await posalji(t, payload);
  assert.equal(res.body.outcome, "dispute_logged");
  assert.equal(t.api.refunds.length, 0);
  const money = one<{ op: string }>(t.db, "SELECT op FROM payment_log ORDER BY id DESC");
  assert.equal(money.op, "dispute.created");
});

test("HMAC prema events-stripe-confirm se stvarno šalje i točan je", async () => {
  t = testEnv();
  t.api.confirm = { status: "paid", order_id: ORDER, serials: [], tickets: [] };
  await posalji(t, checkoutCompleted({ orderId: ORDER }));
  // stub baca ako potpis nedostaje ili ne valja; ovdje samo potvrđujemo da je poziv bio
  const confirm = t.calls.find((c) => c.url.includes("events-stripe-confirm"));
  assert.ok(confirm, "confirm mora biti pozvan");
  assert.match(confirm!.headers["x-ulaznice-signature"] ?? "", /^sha256=[0-9a-f]{64}$/);
});
