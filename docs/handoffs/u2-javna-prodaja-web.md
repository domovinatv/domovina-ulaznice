# U2 — Javna prodaja ulaznica end-to-end

> Handoff prompt za praznu Claude Code sesiju. Repo: **`/Users/ms/git/domovinatv/domovina-ulaznice`**.
> Ovisi o [U1](u1-stripe-rail-backend.md) — pročitaj njegov **Zapisnik izvršenja** prije koda.
>
> _EN abstract: build the public sales channel — a Cloudflare Worker (Hono) that
> creates orders against `domovina-api`, opens a Stripe Connect **direct charge**
> Checkout session on the organizer's account with **no application fee**, confirms
> the order from the verified webhook, and e-mails QR tickets; plus a React SPA with
> the event page, checkout and "my tickets" view._

## Cilj

Posjetitelj otvori javni link događaja, odabere tier i količinu, upiše imena
holdera za imenski tier, plati karticom i u roku od nekoliko sekundi dobije e-mail
s QR ulaznicama. Naplata sjeda **na Stripe račun organizatora**, platforma ne uzima
ni cent.

## Kontekst i izvori (pročitaj prije koda)

U ovom repou: `docs/02-arhitektura.md` (§3.2, §4, §5),
`docs/03-stripe-connect-0-posto.md` (**cijeli**), `docs/05-podatkovni-model.md` (§3),
`docs/07-prior-art-reuse-mapa.md` (§2 — odakle se što kopira).

Presedani u kodu (čitaj izvor, ne pretpostavljaj):

- `rodjendaonice.domovina.ai/apps/marketplace/worker/stripe.ts` — Stripe klijent,
  onboarding, checkout, refund. **Naša inačica mijenja model: direct charge
  (`{ stripeAccount }` kao drugi argument), bez `application_fee_amount`, bez
  `transfer_data`, bez `reverse_transfer` na refundu.**
- `.../worker/webhooks.ts` — verifikacija potpisa i rukovanje eventima.
- `.../worker/reconcile.ts` + `worker-tests/reconcile.test.ts` — cron provjere i
  kako se to testira bez mreže.
- `.../worker/bookable.ts` — invariant "bez spojenog računa se ne može kupiti" i
  pravilo da `acct_…` nikad ne ide klijentu.
- `.../worker/index.ts`, `wrangler.jsonc`, `package.json` — struktura Worker projekta.
- `domovina-api/supabase/functions/events-feed/index.ts` i `events-order/index.ts` —
  ugovori koje zoveš.

## Preduvjeti

| Preduvjet                                                    | Status |
| ------------------------------------------------------------- | ------ |
| U1 deployan (funkcije žive na `api.domovina.ai/functions/v1`) | ⬜     |
| Stripe **test** ključevi + Connect uključen                    | ⬜     |
| Test connected account (Express, test mode)                    | ⬜     |
| Pilot event u bazi (`create_event` + `state='active'`)         | ⬜     |
| Cloudflare projekt (Worker + Pages), domena                    | ⬜     |
| E-mail provider (Resend ili MailChannels) + verificirana domena| ⬜     |

## Opseg

**IN — Worker (`worker/`):**

1. `index.ts` — Hono router, CORS, rate limit (KV), health.
2. `api.ts` — tanki klijent za `domovina-api` (`events-feed`, `events-order`,
   `events-stripe-intent`, `events-stripe-confirm` s HMAC potpisom, `events-tickets`).
3. `stripe.ts` — `createCheckoutSession()` (direct charge, 0 fee, `expires_at` +30 min),
   `refund()`, `constructEvent()`.
4. `webhooks.ts` — `POST /webhook/stripe`:
   - verificiraj potpis **prije** parsiranja tijela; bez tajne → 503,
   - `checkout.session.completed` → `events-stripe-confirm` → e-mail,
   - `expired_sold_out` iz odgovora → **automatski pun refund** + e-mail isprike,
   - `charge.refunded` → poništi ulaznice (`void_ticket` kroz backend),
   - `account.updated` → osvježi `organizer_payment_rails`,
   - svaki event zapiši u D1 log (raw + ishod).
5. `mail.ts` — e-mail s ulaznicama: QR po komadu (inline PNG ili PDF privitak),
   naziv događaja, termin, mjesto, ime holdera, link "Moje ulaznice".
6. `reconcile.ts` — cron (svakih 15 min) po tablici iz doc 03 §6.
7. D1 shema (`migrations/0001_init.sql`): `webhook_events`, `sent_emails`,
   `event_pages` (brand postavke). **Nikakvih ulaznica ni narudžbi.**

**IN — SPA (`src/`):**

8. `/dogadjaj/:slug` — javna stranica: opis, termin, mjesto, tieri s cijenama i
   dostupnošću, CTA. Tier izvan prodajnog prozora ili rasprodan → vidljiv, ne kupiv.
9. `/dogadjaj/:slug/kupnja` — količina, imena holdera (samo za `imenska`), e-mail
   kupca, sažetak, → redirect na Stripe Checkout.
10. `/ulaznice/:order_id` — stanje narudžbe i ulaznice s QR-om (order_id je bearer
    capability; ista stranica služi kao "Moje ulaznice" iz e-maila).
11. Stanja: čeka plaćanje · plaćeno · isteklo · vraćeno — svako s jasnim tekstom
    na hrvatskom.

**OUT:** organizator dashboard (U3), skener (U4), računi (U5), wallet (U6),
promo kodovi, seating, višejezičnost (samo HR u U2).

## Sigurnost (invarijanti)

1. **Webhook je jedini izvor istine o plaćanju.** `success_url` samo prikazuje stanje.
2. **Idempotencija je u bazi** (`(payment_rail, external_ref)` iz U1) — Worker se ne
   oslanja na to da webhook stiže jednom.
3. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `EVENTS_STRIPE_CONFIRM_SECRET`,
   service-role ključ — **samo u Workeru**, nikad u SPA bundleu.
4. `acct_…` se ne šalje klijentu; javno ide samo `stripe_connected: boolean`.
5. Bez `charges_enabled` organizatora **ne kreiraj session** — vrati 409.
6. Holder podaci (ime, e-mail) ne idu u nikakav javni odgovor osim vlasniku narudžbe.
7. Rate limit na `POST /narudzba` i `/webhook/stripe` (obrazac: `worker/ratelimit.ts`).

## Kriteriji prihvaćanja

```
1. Test kartica 4242…            → e-mail s 2 QR ulaznice u < 30 s
2. Isti webhook dostavljen 2×    → i dalje 2 ulaznice (already_paid)
3. Rasprodan tier nakon isteka   → automatski refund + e-mail isprike, 0 ulaznica
4. Kartica 4000…9995 (odbijena)  → narudžba ostaje pending, rezervacija istekne
5. Organizator bez charges_enabled → kupnja onemogućena (409), stranica vidljiva
6. Imenski tier bez svih imena   → blokirano u UI i odbijeno na backendu
7. Webhook s krivim potpisom     → 400, ništa se ne dogodi
8. `acct_` se ne pojavljuje ni u jednom mrežnom odgovoru prema browseru
9. Lighthouse: javna stranica događaja radi na mobitelu, LCP < 2,5 s
```

Testovi: `node:test` za `stripe.ts` (izračuni, parametri sessiona) i `reconcile.ts`
bez mreže — obrazac `rodjendaonice/apps/marketplace/worker-tests/`.

## Zapisnik izvršenja

- **Status: ✅ kod gotov i testiran bez mreže; ⬜ nije deployan i nije vožen
  protiv pravog Stripea** (nedostaju TEST ključevi i Cloudflare projekt —
  §5 Preostalo ručno).
- **Commitovi:**
  - `domovina-ulaznice` — Worker + SPA + D1 + 48 testova (ovaj commit).
  - `domovina-api@2ddac86` — `refund_ticket_order` RPC (v. §2 odluka 4).

### 1. Rute i ugovor prema U3/U4

**Javni API (SPA ↔ Worker).** Sve je HR, svi kodovi grešaka su strojni:

| Ruta                                          | Što radi                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `GET  /api/zdravlje`                          | koje su tajne postavljene (booleani, nikad vrijednosti)                |
| `GET  /api/dogadjaji`                         | popis; svaki event ima `stripe_connected` i `kupovno`                 |
| `GET  /api/dogadjaj/:slug`                    | detalji + tieri s dostupnošću + `brand` iz D1                         |
| `POST /api/narudzba`                          | `{campaign_id,tier_id,quantity,buyer_email,holders[]}` → `{order_id, checkout_url, amount_cents}` |
| `GET  /api/ulaznice/:order_id`                | stanje narudžbe + popis ulaznica (**bez QR-a**)                       |
| `POST /api/ulaznice/:order_id/ponovna-dostava`| ponovno slanje e-maila dok tokeni postoje                             |
| `POST /webhook/stripe`                        | Stripe Connect webhook (potpis prije svega)                           |
| `*`                                           | SPA (ASSETS binding)                                                  |

**SPA rute:** `/` (popis), `/dogadjaj/:slug`, `/dogadjaj/:slug/kupnja`,
`/ulaznice/:orderId`. `order_id` u URL-u je bearer capability — tko ima link,
vidi narudžbu; prijave nema.

**Env (`wrangler.jsonc` vars):** `PUBLIC_BASE_URL`, `DOMOVINA_API_URL`,
`EMAIL_FROM`, `EMAIL_REPLY_TO`, `RL_ORDER_IP`, `RL_WEBHOOK_IP`.
**Tajne (`wrangler secret put`):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`EVENTS_STRIPE_CONFIRM_SECRET`, `DOMOVINA_API_SERVICE_KEY`, `RESEND_API_KEY`.
**Bindingi:** `DB` (D1), `RL` (KV), `ASSETS`.

**D1 (`migrations/0001_init.sql`)** — nijedna tablica ulaznica ni narudžbi:
`webhook_events` (idempotencija + trag), `sent_emails` (je li kupac dobio),
`payment_log` (svaki refund koji smo inicirali), `event_pages` (brand),
`pending_deliveries` (dostave koje dugujemo).

**Statusi narudžbe za UI (U3/U4 koriste iste):** `pending` (čeka plaćanje) ·
`paid` · `expired` (rezervacija istekla, ništa naplaćeno) · `refunded` ·
`failed`. Tekstovi su u `src/pages/Narudzba.tsx` (`STANJA`).

### 2. Odluke

1. **QR ide kao PNG privitak s `cid:` referencom, ne `data:` URI.** Gmail i
   Outlook blokiraju `data:` u `<img>`. PNG se generira u Workeru
   (`worker/qr.ts`): QR matrica iz `qrcode-generator` (čisti JS), a PNG pišemo
   sami — 1-bitni grayscale s "stored" deflate blokovima. Razlog: `pngjs`/
   `canvas` vuku native/stream API koji Worker runtime nema. Rezultat je
   validan PNG (test dekomprimira IDAT s `node:zlib` i provjerava piksele),
   ~3 kB po ulaznici. QR payload nosi prefiks `dgdj1:` koji skener iz E3 već
   tolerira.
2. **Stranica narudžbe NE prikazuje QR i NE zove `events-tickets`.** Tokeni su
   jednokratni (Zapisnik U1 §Gotcha 3) — kad bi ih stranica povukla, prvi
   refresh bi ih potrošio i e-mail bi ostao bez QR-a. Stanje narudžbe se čita
   PostgREST-om (service ključ) koji ne dira `qr_token_once`. Test to čuva.
3. **Ponovna dostava umjesto ponovnog prikaza.** `/ponovna-dostava` zove
   `events-tickets`; ako tokena više nema, vraća `vec_isporuceno` i upućuje na
   izvornu poruku. To je iskrena posljedica Tier-0 modela (u bazi samo hash), a
   ne zaobilaženje.
4. **Novi RPC `refund_ticket_order` u jezgri** (`domovina-api@2ddac86`) —
   **odstupanje od plana**, koji je pisao "`void_ticket` kroz backend".
   `void_ticket` traži `auth.uid()` + org admin rolu; Worker se autentificira
   service ključem i `auth.uid()` nema, pa bi uvijek dobio `not_authenticated`.
   Povrat je uz to operacija nad cijelom narudžbom (ulaznice + inventory +
   stanje + audit) i mora biti jedna transakcija. Iskorištene (`checked_in`)
   ulaznice ostaju i njihovo mjesto se **ne** vraća u prodaju.
5. **`amount_insufficient` vodi na automatski povrat.** Kod Checkouta se ne bi
   smjelo dogoditi (iznos je naš), ali ako se dogodi, narudžba NIJE kreditirana
   pa je novac nezasluženo primljen.
6. **Spor (`charge.dispute.created`) se samo bilježi.** Ulaznica se ne poništava
   automatski: spor može završiti u korist organizatora, a poništena ulaznica na
   ulazu je nepopravljiva šteta.
7. **Rate limit je u Workeru (KV), fail-open.** Limit u jezgri (10/h) veže se na
   account ili payer adresu, a web gost nema ni jedno (Zapisnik U1 §Gotcha 5).
   KV ispad ne smije oboriti prodaju.
8. **SPA je bez UI biblioteke** (~58 kB gzip ukupno) — javna stranica mora biti
   brza na mobitelu.

### 3. Gotchai (pročitati prije U3/U4)

1. **Webhook MORA biti Connect endpoint.** Samo tada event nosi
   `account: "acct_…"`, a bez toga se povrat ne može izvesti (refund ide s
   `{ stripeAccount }`). Worker to detektira i zapiše kao grešku, ali novac
   ostane kod organizatora — provjeriti pri postavljanju endpointa.
2. **Redoslijed pri kreiranju narudžbe je rezervacija → intent → Checkout.**
   Obrnuto bi značilo da kupac plaća mjesto koje ne postoji.
3. **Neuspio e-mail = izgubljen QR.** Tokeni su potrošeni čim ih confirm vrati.
   Zato `pending_deliveries` bilježi dug, a cron ga **prijavljuje** (ne može ga
   sam popraviti). Ako se to pokaže čestim, U3 neka uvede rotaciju tokena pri
   autoriziranoj re-dostavi.
4. **`success_url` nije dokaz plaćanja.** Stranica narudžbe nakon povratka sa
   Stripea kratko poll-a dok webhook ne stigne i eksplicitno piše
   "Potvrđujemo plaćanje…" umjesto "Plaćeno".
5. **Stripe-only organizator još ne može objaviti event** — `publish_event` i
   `campaigns_write_guard` traže pravi Safe (Zapisnik U1 §Gotcha 7). Za pilot se
   event aktivira kroz psql. **U3 mora riješiti**: gate na "barem jedan radni
   rail" (Safe **ili** `stripe_charges_enabled`).
6. **`events-feed` ne zna za Stripe.** Worker kupovnost računa sam
   (`organizerRail` → PostgREST). Zato `/api/dogadjaji` radi po jedan dodatan
   upit po eventu — kod većeg kataloga treba `stripe_connected` u feedu.
7. **`npm test` ne smije nikad na mrežu.** Harness (`worker-tests/harness/env.ts`)
   zamjenjuje `globalThis.fetch` i **ruši test** na svaki neprepoznat poziv; taj
   stub uz to **provjerava HMAC potpis** prema Stripe rail funkcijama, pa test
   pukne i ako Worker zaboravi potpisati.
8. **Node 24+** je uvjet za testove (`node:sqlite`, type stripping bez zastavice).

### 4. Verifikacija (što je stvarno prošlo)

`npm test` — **48/48**, `npm run test:types` i `npx tsc -b` čisti, `npm run build`
prolazi. Testovi voze **pravi** `worker/index.ts` kroz HTTP sučelje, nad D1
shimom koji koristi **pravu** `migrations/0001_init.sql`.

| Kriterij iz handoffa                        | Stanje | Kako je pokriveno                                              |
| -------------------------------------------- | ------ | --------------------------------------------------------------- |
| 1. kartica 4242 → e-mail s 2 QR ulaznice     | ⬜ / ✅ | tok je pokriven testom (webhook → 1 e-mail, 2 PNG privitka, `cid:`); **prava kartica čeka Stripe ključeve** |
| 2. isti webhook 2× → i dalje 2 ulaznice      | ✅     | `webhook.test.ts` — duplikat + `already_paid` bez novog maila   |
| 3. rasprodano nakon isteka → refund + isprika| ✅     | pun povrat na `acct_…`, bez `reverse_transfer`/`refund_application_fee` |
| 4. odbijena kartica → narudžba ostaje pending| ✅     | `payment_intent.payment_failed` samo bilježi; nenaplaćena sesija ne izdaje |
| 5. bez `charges_enabled` → kupnja onemogućena| ✅     | 409 i **nijedan** Checkout session; stranica ostaje vidljiva     |
| 6. imenski tier bez imena → blokirano        | ✅     | 422 na Workeru + isto pravilo u `create_ticket_order`            |
| 7. webhook s krivim potpisom → ništa         | ✅     | 400, `webhook_events` prazan, bez maila; bez tajne 503          |
| 8. `acct_` se ne pojavljuje prema browseru   | ✅     | asserti nad sirovim tijelom odgovora `/api/narudzba` i `/api/dogadjaj/:slug` |
| 9. Lighthouse LCP < 2,5 s                    | ⬜     | mjerenje traži deploy; bundle je 58 kB gzip, bez UI biblioteke  |

Dodatno provjereno izvan popisa: neuspjeh povrata → **500 i otključan event**
(inače bi Stripeov retry bio odbačen kao duplikat), `tx_already_credited` ne
dira novac, `charge.refunded` ide kroz `refund_ticket_order`, spor se ne
poništava automatski, rate limit reže na N-tom pokušaju, `/api/zdravlje` ne
otkriva vrijednosti tajni, QR PNG se stvarno dekomprimira u očekivane piksele.

**Šav U1↔U2 provjeren uživo:** potpis koji računa `worker/api.ts` (Web Crypto)
poslan je stvarnoj `events-stripe-confirm` funkciji na lokalnom stacku → **200
`paid` s izdanom ulaznicom i QR tokenom**; namjerno pokvaren potpis → **401
`bad_signature`**. Dvije neovisne implementacije HMAC-a (Deno `crypto.subtle` u
funkciji, Web Crypto u Workeru) slažu se bajt u bajt.

**Živi lokalni prolaz (2026-08-03, nakon prve verifikacije):** cijeli tok je
pokrenut i u browseru — `wrangler dev` (**pravi workerd**, pravi lokalni D1),
prave `events-*` funkcije nad pravim Postgresom, pravi Chrome. Stripe i Resend
su bili lokalni mockovi (nema ključeva), ali webhook potpis je **pravi HMAC**
koji verificira Stripe SDK. Izvještaj sa snimkama:
[`docs/izvjestaji/2026-08-03-lokalni-test-u1-u2.pdf`](../izvjestaji/2026-08-03-lokalni-test-u1-u2.pdf).

Dodatno dokazano tim prolazom:

- QR iz poslanog e-maila **dekodiran neovisnim čitačem** → nosi `dgdj1:` prefiks,
  a sha256 tokena odgovara `qr_token_hash` u bazi; plaintext u bazi više ne postoji.
- Taj isti token proslijeđen `redeem_ticket`-u: **prvi sken prolazi, drugi je
  odbijen** uz vrijeme prvog ulaska. Petlja kupnja → e-mail → QR → ulaz je zatvorena.
- `expired_sold_out` je stvarno okinuo povrat na `acct_…` bez `reverse_transfer`
  i `refund_application_fee`, uz e-mail isprike.
- D1 nakon svega sadrži samo `webhook_events`, `sent_emails`, `payment_log`,
  `event_pages`, `pending_deliveries` — nijednu ulaznicu ni narudžbu.

**Bug koji su testovi propustili, a pokretanje uhvatilo:** Worker je prema
`events-order` slao `Authorization` sa service ključem; ta funkcija na prisutan
Authorization prelazi na "user klijent" granu i zove `auth.getUser()` — za nas
pogrešan put (web kupac je gost) i 500 ako u okruženju funkcije nema
`SUPABASE_ANON_KEY`. Ispravak: prema `events-*` ide **samo `apikey`**. Dodan
regresijski test (ukupno 49).

**Dev-only seam:** `STRIPE_API_BASE` i `RESEND_API_BASE` preusmjeravaju te dva
API-ja na lokalni mock. Oba prihvaćaju **isključivo** `http://127.0.0.1:*` /
`http://localhost:*` — svaka druga vrijednost ruši poziv, da varijabla ne postane
način da se plaćanja ili ulaznice pošalju na tuđi host.

**Nije verificirano:** stvarni Stripe Checkout i webhook s pravim potpisom
(nema TEST ključeva), stvarna dostava Resendom (nema ključa ni verificirane
domene), ponašanje na Cloudflareu (nema projekta), Lighthouse.

### 5. Preostalo ručno (vlasnik) — bez ovoga U2 ne može u pogon

| Preduvjet                                                    | Za što                                        | Status |
| ------------------------------------------------------------- | --------------------------------------------- | ------ |
| U1 deployan na `api.domovina.ai` (SSH + `EVENTS_STRIPE_CONFIRM_SECRET`) | bez toga Worker nema s čim razgovarati | ⬜ |
| Stripe **TEST** ključevi + Connect uključen                   | `STRIPE_SECRET_KEY`                           | ⬜     |
| Stripe **Connect** webhook endpoint → `/webhook/stripe`       | `STRIPE_WEBHOOK_SECRET` (mora biti Connect!)  | ⬜     |
| Test connected account (Express, test mode) + `charges_enabled`| kriteriji 1–5                                | ⬜     |
| Cloudflare: `wrangler d1 create` + `kv namespace create` → id-evi u `wrangler.jsonc` | D1/KV bindingi         | ⬜     |
| Resend API ključ + verificirana domena pošiljatelja           | dostava ulaznica                              | ⬜     |
| Pilot event u bazi (`create_event` + `state='active'` + `organizer_payment_rails`) | kriteriji 1–5            | ⬜     |

Nakon toga se kriteriji 1, 3, 4 voze `stripe listen --forward-to
localhost:8787/webhook/stripe` s karticama `4242…` (uspjeh) i
`4000 0000 0000 9995` (odbijena), a kriterij 9 Lighthouseom nad deployanom
stranicom.
