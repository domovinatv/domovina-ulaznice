// Prijava organizatora, pregled prodaje, izvoz sudionika i skener ulaza.
//
// Jedan invariant vrijedi za sve u ovoj datoteci i vrijedi ga braniti testom:
// **service ključ ne smije dodirnuti nijedan od ovih puteva.** Autorizacija je
// u bazi (RLS, `has_role_on_account`), a Worker samo nosi korisnikov JWT. Stub
// u harnessu ruši test ako `organizer_overview` stigne bez JWT-a ili ako
// `events-checkin` dobije service ključ.
import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { ANON_KEY, call, callJson, CAMPAIGN, SERVICE_KEY, testEnv, type TestCtx } from "./harness/env.ts";

let t: TestCtx;
afterEach(() => t?.restore());
after(() => t?.restore());

const auth = (jwt = "jwt-organizatora") => ({ authorization: `Bearer ${jwt}` });

// ------------------------------------------------------------------- prijava

test("prijava vraća token, a refresh token NE izlazi prema browseru", async () => {
  t = testEnv();
  const { status, body, text } = await callJson<{ access_token: string; email: string }>(
    t,
    "/api/organizator/prijava",
    { body: { email: "org@test.hr", lozinka: "lozinka123" } },
  );
  assert.equal(status, 200);
  assert.equal(body.access_token, "jwt-organizatora");
  assert.ok(!text.includes("refresh_token"), "refresh token ne smije izaći iz Workera");
});

test("kriva lozinka → 401 i nijedan token", async () => {
  t = testEnv();
  t.api.prijavaOk = false;
  const { status, body } = await callJson<{ error: string }>(t, "/api/organizator/prijava", {
    body: { email: "org@test.hr", lozinka: "lozinka123" },
  });
  assert.equal(status, 401);
  assert.equal(body.error, "prijava_neuspjela");
});

test("prijava prema GoTrueu ide s ANON ključem, nikad sa service ključem", async () => {
  t = testEnv();
  await call(t, "/api/organizator/prijava", { body: { email: "org@test.hr", lozinka: "lozinka123" } });
  const poziv = t.calls.find((c) => c.url.includes("/auth/v1/token"));
  assert.ok(poziv, "prijava mora zvati GoTrue");
  assert.equal(poziv!.headers.apikey, ANON_KEY);
  assert.notEqual(poziv!.headers.apikey, SERVICE_KEY);
});

test("prekratka lozinka se odbija prije mreže", async () => {
  t = testEnv();
  const { status } = await callJson(t, "/api/organizator/prijava", { body: { email: "org@test.hr", lozinka: "kratk" } });
  assert.equal(status, 401);
  assert.equal(t.calls.filter((c) => c.url.includes("/auth/v1/token")).length, 0);
});

// -------------------------------------------------------------------- pregled

test("pregled bez tokena → 401", async () => {
  t = testEnv();
  const { status, body } = await callJson<{ error: string }>(t, "/api/organizator/pregled");
  assert.equal(status, 401);
  assert.equal(body.error, "nije_prijavljen");
});

test("pregled ide U IME korisnika (JWT), ne service ključem", async () => {
  t = testEnv();
  const { status } = await callJson(t, "/api/organizator/pregled", { headers: auth() });
  assert.equal(status, 200);
  const poziv = t.calls.find((c) => c.url.includes("rpc/organizer_overview"));
  assert.equal(poziv!.headers.authorization, "Bearer jwt-organizatora");
  assert.equal(poziv!.headers.apikey, ANON_KEY);
});

// --------------------------------------------------------------------- izvoz

test("izvoz sudionika je CSV s BOM-om i ; razdjelnikom", async () => {
  t = testEnv();
  t.api.tickets = [
    { serial: "SUS-000004", holder_name: "Ana Anić", holder_email: "ana@example.com", state: "issued" },
  ];
  const res = await call(t, `/api/organizator/holderi.csv?campaign_id=${CAMPAIGN}`, { headers: auth() });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
  // BOM se provjerava nad BAJTOVIMA: TextDecoder ga pri .text() tiho pojede,
  // pa bi test nad stringom prošao i da ga u odgovoru nema.
  const bajtovi = new Uint8Array(await res.clone().arrayBuffer());
  assert.deepEqual([...bajtovi.slice(0, 3)], [0xef, 0xbb, 0xbf], "bez BOM-a Excel razbije dijakritiku");
  const text = await res.text();
  assert.match(text, /serial;ime;email;stanje;ulazak/);
  assert.match(text, /Ana Anić/);
});

test("izvoz s neispravnim campaign_id ne ide na mrežu", async () => {
  t = testEnv();
  const { status, body } = await callJson<{ error: string }>(t, "/api/organizator/holderi.csv?campaign_id=nije-uuid", {
    headers: auth(),
  });
  assert.equal(status, 400);
  assert.equal(body.error, "invalid_campaign_id");
  assert.equal(t.calls.filter((c) => c.url.includes("/rest/v1/tickets")).length, 0);
});

test("izvoz bez tokena → 401 i nijedan PII ne izlazi", async () => {
  t = testEnv();
  const res = await call(t, `/api/organizator/holderi.csv?campaign_id=${CAMPAIGN}`);
  assert.equal(res.status, 401);
  assert.ok(!(await res.text()).includes("@"));
});

// --------------------------------------------------------------------- skener

test("prvi sken vraća ime holdera", async () => {
  t = testEnv();
  const { status, body } = await callJson<{ status: string; holder_name: string }>(t, "/api/skener/sken", {
    headers: auth(),
    body: { qr_token: "a".repeat(64) },
  });
  assert.equal(status, 200);
  assert.equal(body.status, "checked_in");
  assert.equal(body.holder_name, "Ana Anić");
});

test("skener prihvaća QR s prefiksom i velikim slovima", async () => {
  t = testEnv();
  const { status } = await callJson(t, "/api/skener/sken", {
    headers: auth(),
    body: { qr_token: `dgdj1:${"A".repeat(64)}` },
  });
  assert.equal(status, 200);
  const poslano = JSON.parse(t.calls.find((c) => c.url.includes("events-checkin"))!.body) as { qr_token: string };
  assert.equal(poslano.qr_token, "a".repeat(64));
});

test("drugi sken iste ulaznice je odbijen s vremenom prvog ulaska", async () => {
  t = testEnv();
  t.api.checkin = {
    status: "already_checked_in",
    serial: "SUS-000004",
    holder_name: "Ana Anić",
    checked_in_at: "2026-11-14T09:12:00Z",
    checked_in_by_email: "ulaz@test",
  };
  const { body } = await callJson<{ status: string; checked_in_at: string }>(t, "/api/skener/sken", {
    headers: auth(),
    body: { qr_token: "a".repeat(64) },
  });
  assert.equal(body.status, "already_checked_in");
  assert.equal(body.checked_in_at, "2026-11-14T09:12:00Z");
});

test("sken bez prijave → 401, jezgra se ne dira", async () => {
  t = testEnv();
  const { status } = await callJson(t, "/api/skener/sken", { body: { qr_token: "a".repeat(64) } });
  assert.equal(status, 401);
  assert.equal(t.calls.filter((c) => c.url.includes("events-checkin")).length, 0);
});

test("smeće umjesto QR-a se odbija prije mreže", async () => {
  t = testEnv();
  const { status, body } = await callJson<{ error: string }>(t, "/api/skener/sken", {
    headers: auth(),
    body: { qr_token: "https://example.com/neka-druga-aplikacija" },
  });
  assert.equal(status, 400);
  assert.equal(body.error, "neispravan_qr");
  assert.equal(t.calls.filter((c) => c.url.includes("events-checkin")).length, 0);
});

test("korisnik bez admin role je odbijen SERVER-SIDE, ne skrivanjem UI-ja", async () => {
  t = testEnv();
  t.api.checkin = { error: "not_authorized" };
  t.api.checkinStatus = 403;
  const { status, body } = await callJson<{ error: string }>(t, "/api/skener/sken", {
    headers: auth(),
    body: { qr_token: "a".repeat(64) },
  });
  assert.equal(status, 403);
  assert.equal(body.error, "not_authorized");
});

// ------------------------------------------------------- konfiguracija okoline

test("bez anon ključa prijava jasno pada, a zdravlje to pokazuje", async () => {
  t = testEnv({ DOMOVINA_API_ANON_KEY: undefined });
  const { body: zdravlje } = await callJson<{ prijava: boolean }>(t, "/api/zdravlje");
  assert.equal(zdravlje.prijava, false);
  const { status, body } = await callJson<{ error: string }>(t, "/api/organizator/prijava", {
    body: { email: "org@test.hr", lozinka: "lozinka123" },
  });
  assert.equal(status, 503);
  assert.equal(body.error, "anon_key_missing");
});
