// Kupovni tok do Stripea: validacija, "ne kreiraj session u prazno", i
// najvažnije — `acct_…` ne smije izaći prema browseru.
import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { ACCT, CAMPAIGN, TIER, TIER_IMENSKA, call, callJson, testEnv, type TestCtx } from "./harness/env.ts";

let t: TestCtx | null = null;
afterEach(() => { t?.restore(); t = null; });

const narudzba = (over: Record<string, unknown> = {}) => ({
  campaign_id: CAMPAIGN,
  tier_id: TIER,
  quantity: 2,
  buyer_email: "kupac@example.com",
  holders: [],
  ...over,
});

test("uspješna narudžba vraća checkout URL i NE otkriva acct_", async () => {
  t = testEnv();
  const { status, body, text } = await callJson<{ order_id: string; checkout_url: string }>(
    t, "/api/narudzba", { body: narudzba() },
  );
  assert.equal(status, 200);
  assert.match(body.checkout_url, /^https:\/\/checkout\.stripe\.com\//);
  assert.match(body.order_id, /^[0-9a-f-]{36}$/);
  // kriterij prihvaćanja 8
  assert.ok(!text.includes("acct_"), `acct_ procurio u odgovor: ${text}`);
});

test("checkout je DIRECT CHARGE: Stripe-Account header, bez feeja i transfera", async () => {
  t = testEnv();
  await call(t, "/api/narudzba", { body: narudzba() });
  const session = t.api.createdSessions.at(-1)!;
  assert.equal(session.account, ACCT, "session mora ići na račun organizatora");
  assert.ok(!session.body.includes("application_fee_amount"), "0 % — feeja ne smije biti");
  assert.ok(!session.body.includes("transfer_data"), "direct charge nema transfer_data");
  const form = new URLSearchParams(session.body);
  assert.ok(form.get("metadata[order_id]"), "metadata mora nositi order_id");
  // iznos je iz jezgre (14900 × 2), ne iz klijenta
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "14900");
  assert.equal(form.get("line_items[0][quantity]"), "2");
  assert.equal(form.get("mode"), "payment");
});

test("expires_at je Stripeov minimum (+30 min), ne naših 20", async () => {
  t = testEnv();
  await call(t, "/api/narudzba", { body: narudzba() });
  const body = t.api.createdSessions.at(-1)!.body;
  const expires = Number(new URLSearchParams(body).get("expires_at"));
  const delta = expires - Math.floor(Date.now() / 1000);
  assert.ok(delta > 29 * 60 && delta <= 30 * 60 + 5, `expires_at ${delta}s od sada`);
});

test("organizator bez charges_enabled → 409 i NIJEDAN session", async () => {
  t = testEnv();
  t.api.chargesEnabled = false;
  const { status, body } = await callJson<{ error: string }>(t, "/api/narudzba", { body: narudzba() });
  assert.equal(status, 409);
  assert.equal(body.error, "organizer_charges_disabled");
  assert.equal(t.api.createdSessions.length, 0, "session se ne smije kreirati u prazno");
});

test("organizator bez spojenog računa → 409", async () => {
  t = testEnv();
  t.api.connected = false;
  const { status, body } = await callJson<{ error: string }>(t, "/api/narudzba", { body: narudzba() });
  assert.equal(status, 409);
  assert.equal(body.error, "organizer_not_connected");
});

test("imenski tier bez svih imena → 422 (odbijeno na backendu, ne samo u UI-ju)", async () => {
  t = testEnv();
  const { status, body } = await callJson<{ error: string }>(t, "/api/narudzba", {
    body: narudzba({ tier_id: TIER_IMENSKA, quantity: 2, holders: [{ full_name: "Ana Anić" }] }),
  });
  assert.equal(status, 422);
  assert.equal(body.error, "holders_incomplete");
  assert.equal(t!.api.createdSessions.length, 0);
});

test("rasprodan tier → 409, bez rezervacije", async () => {
  t = testEnv();
  t.api.inventoryTotal = 2;
  t.api.inventoryClaimed = 2;
  const { status, body } = await callJson<{ error: string }>(t, "/api/narudzba", { body: narudzba() });
  assert.equal(status, 409);
  assert.equal(body.error, "tier_sold_out");
});

test("količina veća od preostalih ulaznica → 409", async () => {
  t = testEnv();
  t.api.inventoryTotal = 3;
  t.api.inventoryClaimed = 2;
  const { status, body } = await callJson<{ error: string }>(t, "/api/narudzba", { body: narudzba({ quantity: 2 }) });
  assert.equal(status, 409);
  assert.equal(body.error, "tier_sold_out");
});

test("zatvoren prodajni prozor → 409 sale_ended", async () => {
  t = testEnv();
  t.api.saleEnd = new Date(Date.now() - 86_400_000).toISOString();
  const { status, body } = await callJson<{ error: string }>(t, "/api/narudzba", { body: narudzba() });
  assert.equal(status, 409);
  assert.equal(body.error, "sale_ended");
});

test("neispravan e-mail i količina se odbijaju prije ijednog poziva prema jezgri", async () => {
  t = testEnv();
  const bezMaila = await callJson<{ error: string }>(t, "/api/narudzba", { body: narudzba({ buyer_email: "nije-mail" }) });
  assert.equal(bezMaila.body.error, "invalid_buyer_email");
  const puno = await callJson<{ error: string }>(t, "/api/narudzba", { body: narudzba({ quantity: 99 }) });
  assert.equal(puno.body.error, "invalid_quantity");
  assert.equal(t.calls.length, 0, "nijedan mrežni poziv za očito neispravan unos");
});

test("javni prikaz događaja nosi izvedeni boolean, ne acct_", async () => {
  t = testEnv();
  const { body, text } = await callJson<{ stripe_connected: boolean; kupovno: boolean }>(t, "/api/dogadjaj/susret-2027");
  assert.equal(body.stripe_connected, true);
  assert.equal(body.kupovno, true);
  assert.ok(!text.includes("acct_"), "acct_ procurio u javni prikaz");
  assert.ok(!text.includes("destination_address"), "Safe adresa ne treba na prodajnoj stranici");
});

test("događaj bez aktivne naplate ostaje VIDLJIV, samo nije kupiv", async () => {
  t = testEnv();
  t.api.chargesEnabled = false;
  const { status, body } = await callJson<{ kupovno: boolean; title: string }>(t, "/api/dogadjaj/susret-2027");
  assert.equal(status, 200);
  assert.equal(body.title, "Susret 2027");
  assert.equal(body.kupovno, false);
});
