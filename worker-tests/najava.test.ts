// Okruženje najave (NAJAVA="1") — produkcijska domena stoji javno prije nego
// prodaja postoji. Pravilo: ništa osim najave se ne poslužuje, i to se mora
// vidjeti u testu jer je posljedica krivog guarda javna trgovina bez baze.
import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { CAMPAIGN, TIER, call, testEnv, type TestCtx } from "./harness/env.ts";

let t: TestCtx | null = null;
afterEach(() => { t?.restore(); t = null; });

const najava = () => testEnv({ NAJAVA: "1" });

test("najava: root vraća statičnu stranicu, ne SPA", async () => {
  t = najava();
  const res = await call(t, "/", { method: "GET" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html, /Prodaja još nije otvorena/);
  // najava ne smije ništa tvrditi o konkretnom događaju ili cijeni
  assert.ok(!/€|EUR/.test(html), "najava ne smije sadržavati cijenu");
});

test("najava: /api/* vraća 404, ne 503 — u ovom okruženju te rute nema", async () => {
  t = najava();
  for (const p of ["/api/dogadjaji", `/api/dogadjaj/${CAMPAIGN}`, "/api/narudzba"]) {
    const res = await call(t, p, { method: "GET" });
    assert.equal(res.status, 404, `${p} mora biti 404`);
  }
});

test("najava: webhook je zatvoren — nijedna uplata se ne obrađuje", async () => {
  t = najava();
  const res = await call(t, "/webhook/stripe", { body: { type: "checkout.session.completed" } });
  assert.equal(res.status, 404);
});

test("najava: narudžba se NE kreira ni kad je tijelo ispravno", async () => {
  t = najava();
  const res = await call(t, "/api/narudzba", {
    body: { campaign_id: CAMPAIGN, tier_id: TIER, quantity: 1, buyer_email: "a@b.hr", holders: [] },
  });
  assert.equal(res.status, 404);
  assert.equal(t.api.createdSessions.length, 0, "Stripe session se ne smije stvoriti");
});

test("bez NAJAVA guard ne dira normalan rad", async () => {
  t = testEnv();
  const res = await call(t, "/api/dogadjaji", { method: "GET" });
  assert.equal(res.status, 200);
});

test("NAJAVA mora biti točno '1' — svaka druga vrijednost znači normalan rad", async () => {
  for (const v of ["0", "true", "", "da"]) {
    t = testEnv({ NAJAVA: v });
    const res = await call(t, "/api/dogadjaji", { method: "GET" });
    assert.equal(res.status, 200, `NAJAVA=${JSON.stringify(v)} ne smije gasiti API`);
    t.restore(); t = null;
  }
});
