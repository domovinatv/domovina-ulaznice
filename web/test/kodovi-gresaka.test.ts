// Sinkronizacija poruka kupnje s Workerom (S4): svaki kod greške koji
// `POST /api/narudzba` može vratiti mora imati rečenicu u PORUKE_NARUDZBE
// (web/src/lib/poruke.ts), inače kupac vidi generičku poruku za grešku koju
// bismo mogli objasniti.
//
// Test ČITA izvor Workera (worker/index.ts, api.ts, stripe.ts) i iz njega vadi
// kodove: string literale u prvom argumentu `fail(…)` (i u ternarnim izrazima
// unutar njega) te u drugom argumentu `new HttpError(…)`. Novi `fail("novi_kod")`
// bez poruke u poruke.ts ruši ovaj test. Bez mreže, samo fs.
//
// S5: isto za `/api/ulaznice/*` (stanje narudžbe, ponovna dostava, preuzimanje)
// i PORUKE_ULAZNICA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { GENERICKA_PORUKA, KOD_MREZA, PORUKE_NARUDZBE, PORUKE_ULAZNICA, porukaGreske, porukaUlaznica } from "../src/lib/poruke.ts";

const izvor = (ime: string) => readFileSync(new URL(`../../worker/${ime}`, import.meta.url), "utf8");

// ── mali leksički pomoćnici (bez parsera: worker/ je običan TS) ─────────────

/** Duljina string/template literala koji počinje na `i` (uključivo navodnike). */
function krajStringa(src: string, i: number): number {
  const navodnik = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== navodnik) j += src[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** Je li `/` na poziciji `i` početak regex literala (heuristika po prethodnom znaku). */
function pocinjeRegex(src: string, i: number): boolean {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k]!)) k--;
  return k < 0 || "(,=:[!&|?{};+-*%<>~^".includes(src[k]!);
}

function krajRegexa(src: string, i: number): number {
  let j = i + 1;
  let razred = false;
  while (j < src.length) {
    const z = src[j]!;
    if (z === "\\") j += 2;
    else {
      if (z === "[") razred = true;
      else if (z === "]") razred = false;
      else if (z === "/" && !razred) break;
      j++;
    }
  }
  return j + 1;
}

/** Izvor s komentarima zamijenjenim razmacima (iste pozicije); stringovi i regexi ostaju. */
function bezKomentara(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const z = src[i]!;
    const sljedeci = src[i + 1];
    if (z === '"' || z === "'" || z === "`") {
      const j = krajStringa(src, i);
      out += src.slice(i, j);
      i = j;
    } else if (z === "/" && sljedeci === "/") {
      const j = src.indexOf("\n", i);
      const kraj = j < 0 ? src.length : j;
      out += " ".repeat(kraj - i);
      i = kraj;
    } else if (z === "/" && sljedeci === "*") {
      const j = src.indexOf("*/", i + 2);
      const kraj = j < 0 ? src.length : j + 2;
      out += src.slice(i, kraj).replace(/[^\n]/g, " ");
      i = kraj;
    } else if (z === "/" && pocinjeRegex(src, i)) {
      const j = krajRegexa(src, i);
      out += src.slice(i, j);
      i = j;
    } else {
      out += z;
      i++;
    }
  }
  return out;
}

/** Argumenti svakog poziva `ime(…)` u `src` (bez komentara), razdvojeni zarezima najviše razine. */
function argumentiPoziva(src: string, ime: string): string[][] {
  const kod = bezKomentara(src);
  const re = new RegExp(`(?<![\\w.$])${ime.replace(/\s+/g, "\\s+")}\\s*\\(`, "g");
  const pozivi: string[][] = [];
  for (const m of kod.matchAll(re)) {
    const args: string[] = [];
    let dubina = 1;
    let i = m.index! + m[0].length;
    let pocetak = i;
    while (i < kod.length && dubina > 0) {
      const z = kod[i]!;
      if (z === '"' || z === "'" || z === "`") {
        i = krajStringa(kod, i);
        continue;
      }
      if ("([{".includes(z)) dubina++;
      else if (")]}".includes(z)) dubina--;
      if ((z === "," && dubina === 1) || dubina === 0) {
        args.push(kod.slice(pocetak, i).trim());
        pocetak = i + 1;
      }
      i++;
    }
    pozivi.push(args.filter(Boolean));
  }
  return pozivi;
}

/** String literali ("…" ili '…') u izrazu, npr. grane ternarnog izraza. */
function literali(izraz: string): string[] {
  return [...izraz.matchAll(/"([^"\\]*)"|'([^'\\]*)'/g)].map((m) => m[1] ?? m[2]!);
}

/** Isječak od `pocetak` do sljedeće naredbe `app.` na početku retka. */
function blok(src: string, pocetak: string): string {
  const i = src.indexOf(pocetak);
  assert.ok(i >= 0, `nema „${pocetak}” u worker/index.ts`);
  const kraj = src.indexOf("\napp.", i + pocetak.length);
  return src.slice(i, kraj < 0 ? undefined : kraj);
}

interface Izvuceno {
  kodovi: Set<string>;
  /** Argumenti bez ijednog literala (kod se ne može provjeriti statički). */
  dinamicni: string[];
}

function kodoviPoziva(src: string, ime: string, indeksKoda: number): Izvuceno {
  const kodovi = new Set<string>();
  const dinamicni: string[] = [];
  for (const args of argumentiPoziva(src, ime)) {
    const arg = args[indeksKoda] ?? "";
    const l = literali(arg);
    if (l.length === 0) dinamicni.push(arg);
    for (const k of l) kodovi.add(k);
  }
  return { kodovi, dinamicni };
}

// ── što Worker vraća ────────────────────────────────────────────────────────

const index = izvor("index.ts");
const narudzba = kodoviPoziva(blok(index, 'app.post("/api/narudzba"'), "fail", 0);
const onError = kodoviPoziva(blok(index, "app.onError("), "fail", 0);
const fallback = kodoviPoziva(blok(index, 'app.all("*"'), "fail", 0);
const httpApi = kodoviPoziva(izvor("api.ts"), "new HttpError", 1);
const httpStripe = kodoviPoziva(izvor("stripe.ts"), "new HttpError", 1);

/**
 * HttpError kodovi koji NISU na putu `POST /api/narudzba` (feed, organizerRail,
 * createOrder, stripeIntent, createCheckoutSession), pa im ne treba poruka kupnje.
 * Novi HttpError u api.ts/stripe.ts mora ili dobiti poruku ili ući ovdje s razlogom.
 */
const IZVAN_KUPNJE: Readonly<Record<string, string>> = {
  webhook_secret_missing: "stripe.ts verifyWebhook — /webhook/stripe",
  anon_key_missing: "api.ts anonKey — prijava organizatora i skener",
  prijava_neuspjela: "api.ts prijava — /api/organizator/prijava",
  auth_greska: "api.ts prijava — /api/organizator/prijava",
  kod_neispravan: "api.ts potvrdiKod — /api/organizator/potvrdi (SPA, ne Astro)",
  nema_prava_kreiranja: "api.ts kreirajDogadjaj — /api/organizator/dogadjaj (SPA editor)",
  api_error: "api.ts kreirajDogadjaj — /api/organizator/dogadjaj (SPA editor)",
  nije_prijavljen: "api.ts korisnickiRpc/korisnickiRest — organizator i skener",
  api_rail_update_failed: "api.ts upsertOrganizerRail — webhooks.ts (account.updated)",
};

const sviKodovi = new Set([
  ...narudzba.kodovi,
  ...onError.kodovi,
  ...fallback.kodovi,
  ...[...httpApi.kodovi, ...httpStripe.kodovi].filter((k) => !Object.hasOwn(IZVAN_KUPNJE, k)),
]);

// ── ekstrakcija ─────────────────────────────────────────────────────────────

test("ekstrakcija: pomoćnici razumiju ternarni izraz, komentare i stringove sa zagradama", () => {
  const src = [
    'if (x) return fail(a ? "prvi" : b ? "drugi" : "treci", 409);',
    '// return fail("zakomentirano");',
    '/* fail("u_bloku") */ fail("stvarni", 400, { poruka: "(zagrada, zarez)" });',
    'const re = /["(]/; x.fail("metoda"); prefail("ne");',
  ].join("\n");
  const r = kodoviPoziva(src, "fail", 0);
  assert.deepEqual([...r.kodovi], ["prvi", "drugi", "treci", "stvarni"]);
  assert.deepEqual(r.dinamicni, []);
  assert.deepEqual(argumentiPoziva('new HttpError(503, "k", `poruka ${x}`)', "new HttpError"), [
    ["503", '"k"', "`poruka ${x}`"],
  ]);
});

test("ekstrakcija: POST /api/narudzba daje barem poznati minimum kodova", () => {
  assert.ok(narudzba.kodovi.size >= 15, `samo ${narudzba.kodovi.size}: ${[...narudzba.kodovi].join(", ")}`);
  for (const k of [
    "previse_pokusaja",
    "bad_json",
    "invalid_quantity",
    "invalid_buyer_email",
    "tier_sold_out",
    "sale_not_started",
    "sale_ended",
    "holders_incomplete",
    "organizer_not_connected",
    "organizer_charges_disabled",
    "checkout_bez_url",
  ]) {
    assert.ok(narudzba.kodovi.has(k), `ekstrakcija nije našla ${k}`);
  }
  // Svaki fail() u handleru ima kod kao literal; dinamičan kod ovaj test ne bi vidio.
  assert.deepEqual(narudzba.dinamicni, []);
});

test("ekstrakcija: onError (greska_servera), 404 fallback i HttpError iz api.ts/stripe.ts", () => {
  assert.ok(onError.kodovi.has("greska_servera"));
  // onError prosljeđuje err.code HttpErrora — ti kodovi se provjeravaju niže.
  assert.deepEqual(onError.dinamicni, ["err.code"]);
  assert.ok(fallback.kodovi.has("not_found"));
  for (const k of ["api_feed_error", "api_rest_error", "api_rpc_error", "api_bad_json", "service_key_missing", "hmac_secret_missing"]) {
    assert.ok(httpApi.kodovi.has(k), `api.ts: nema ${k}`);
  }
  for (const k of ["stripe_not_configured", "stripe_api_base_invalid", "stripe_api_base_forbidden", "organizer_not_connected"]) {
    assert.ok(httpStripe.kodovi.has(k), `stripe.ts: nema ${k}`);
  }
  // Ternarni kod u HttpError (prijava) se također vidi.
  assert.ok(httpApi.kodovi.has("prijava_neuspjela") && httpApi.kodovi.has("auth_greska"));
  // Jedini dinamični kod u api.ts je `code` iz odgovora jezgre (callFunction, checkin);
  // kodovi jezgre su ručno popisani u poruke.ts (domovina-api nije u ovom repou).
  assert.deepEqual(new Set(httpApi.dinamicni), new Set(["code"]));
  assert.deepEqual(httpStripe.dinamicni, []);
  assert.ok(sviKodovi.size >= 25, `samo ${sviKodovi.size} kodova`);
});

test("IZVAN_KUPNJE: svaki izuzeti kod stvarno postoji u Workeru (nema zastarjelih izuzetaka)", () => {
  const http = new Set([...httpApi.kodovi, ...httpStripe.kodovi]);
  for (const k of Object.keys(IZVAN_KUPNJE)) assert.ok(http.has(k), `${k} više nije u worker/api.ts ni stripe.ts`);
});

// ── poruke ──────────────────────────────────────────────────────────────────

test("svaki kod iz Workera ima poruku u PORUKE_NARUDZBE", () => {
  const bez = [...sviKodovi].filter((k) => !Object.hasOwn(PORUKE_NARUDZBE, k));
  assert.deepEqual(bez, [], `kodovi bez poruke u web/src/lib/poruke.ts: ${bez.join(", ")}`);
});

test("svaki kod iz Workera ima vlastitu poruku, ne generičku (osim greska_servera)", () => {
  const genericki = [...sviKodovi].filter((k) => k !== "greska_servera" && porukaGreske(k) === GENERICKA_PORUKA);
  assert.deepEqual(genericki, [], `kodovi s generičkom porukom: ${genericki.join(", ")}`);
});

test("greska_servera namjerno nosi generičku poruku (neuhvaćena greška u Workeru, uzrok nepoznat)", () => {
  assert.ok(Object.hasOwn(PORUKE_NARUDZBE, "greska_servera"));
  assert.equal(PORUKE_NARUDZBE.greska_servera, GENERICKA_PORUKA);
  assert.equal(porukaGreske("greska_servera"), GENERICKA_PORUKA);
});

// ── narudžba: /api/ulaznice/* (S5) ──────────────────────────────────────────

const RUTE_ULAZNICA = [
  'app.get("/api/ulaznice/:order_id"',
  'app.post("/api/ulaznice/:order_id/ponovna-dostava"',
  'app.post("/api/ulaznice/:order_id/preuzmi"',
];
const ulaznice = RUTE_ULAZNICA.map((r) => kodoviPoziva(blok(index, r), "fail", 0));

/**
 * Kodovi jezgre (events-tickets kroz callFunction, kao 502) koje statički ne vidimo:
 * `code` u api.ts je dinamičan, a domovina-api nije u ovom repou. Ručno popisani.
 */
const JEZGRA_ULAZNICA = ["method_not_allowed", "too_many_orders"];
/** Kodovi koje proizvodi sam klijent (src/lib/api.ts, kodIzGreske). */
const KLIJENT = ["neispravan_odgovor", KOD_MREZA];

/** HttpError iz api.ts koji nisu na putu /api/ulaznice/* (isti izuzeci kao za kupnju). */
const httpUlaznica = [...httpApi.kodovi].filter((k) => !Object.hasOwn(IZVAN_KUPNJE, k));

const kodoviUlaznica = new Set([
  ...ulaznice.flatMap((u) => [...u.kodovi]),
  ...onError.kodovi,
  ...fallback.kodovi,
  ...httpUlaznica,
]);

test("ekstrakcija: /api/ulaznice/* daje poznate kodove, svi kao literali", () => {
  for (const k of [
    "invalid_order_id",
    "order_not_found",
    "previse_pokusaja",
    "narudzba_nije_placena",
    "nema_email_adrese",
    "rotacija_nije_uspjela",
    "bad_json",
    "invalid_buyer_email",
    "email_ne_odgovara",
  ]) {
    assert.ok(kodoviUlaznica.has(k), `ekstrakcija nije našla ${k}`);
  }
  // svaka ruta je nađena i ima barem invalid_order_id i order_not_found
  for (const [i, u] of ulaznice.entries()) {
    assert.ok(u.kodovi.has("invalid_order_id") && u.kodovi.has("order_not_found"), RUTE_ULAZNICA[i]);
    assert.deepEqual(u.dinamicni, [], RUTE_ULAZNICA[i]);
  }
  // blok() staje na sljedećem `app.`: kodovi organizatora ne smiju procuriti u ulaznice
  assert.ok(!kodoviUlaznica.has("prijava_neuspjela"));
  assert.ok(!kodoviUlaznica.has("nije_prijavljen"));
});

test("svaki kod iz /api/ulaznice/* (i HttpError na tom putu) ima poruku u PORUKE_ULAZNICA", () => {
  const bez = [...kodoviUlaznica, ...JEZGRA_ULAZNICA, ...KLIJENT].filter((k) => !Object.hasOwn(PORUKE_ULAZNICA, k));
  assert.deepEqual(bez, [], `kodovi bez poruke u PORUKE_ULAZNICA (web/src/lib/poruke.ts): ${bez.join(", ")}`);
});

test("kodovi /api/ulaznice/* imaju vlastitu poruku, ne generičku (osim greska_servera)", () => {
  const genericki = [...kodoviUlaznica].filter((k) => k !== "greska_servera" && porukaUlaznica(k) === GENERICKA_PORUKA);
  assert.deepEqual(genericki, [], `kodovi s generičkom porukom: ${genericki.join(", ")}`);
  assert.equal(porukaUlaznica("greska_servera"), GENERICKA_PORUKA);
});

test("PORUKE_ULAZNICA nema zastarjelih kodova (svaki ključ dolazi iz Workera, jezgre ili klijenta)", () => {
  const poznati = new Set([...kodoviUlaznica, ...JEZGRA_ULAZNICA, ...KLIJENT]);
  const visak = Object.keys(PORUKE_ULAZNICA).filter((k) => !poznati.has(k));
  assert.deepEqual(visak, [], `ključevi koje /api/ulaznice/* ne vraća: ${visak.join(", ")}`);
});
