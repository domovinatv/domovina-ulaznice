# domovina-ulaznice

**SaaS za prodaju ulaznica za događaje — bez posrednika i bez booking feeja.**

Organizator prodaje ulaznice s vlastite stranice, novac ide **izravno na njegov
Stripe račun** (Connect, `application_fee_amount = 0`), ulaznica je QR koji se
skenira na ulazu. Platforma nikad ne drži novac i ne uzima proviziju s ulaznice.

> Status: **U1 ✅ (živ u produkciji) · U2 ✅ (deployan na staging)**.
> U1 je u `domovina-api` (Stripe rail u ticketing jezgri), U2 je ovaj Worker + SPA.
>
> | Okruženje | URL | Stanje |
> | --- | --- | --- |
> | staging | `ulaznice-staging.domovina.ai` | puna aplikacija, Stripe sandbox |
> | produkcija | `ulaznice.domovina.ai` | **samo najava** — prodaja nije otvorena |
>
> Preostalo za prvu test kupnju: Express onboarding + `STRIPE_SECRET_KEY` i
> `STRIPE_WEBHOOK_SECRET` (`wrangler secret put … --env staging`).
> Stanje deploya, zamke i otvorena pitanja:
> [2026-08-08](docs/2026-08-08-deploy-okruzenja-i-stripe.md).
> Datum plana: 2026-08-03.

## Kako pokrenuti

```
worker/          Cloudflare Worker (Hono): Stripe rail, webhook, e-mail, cron
  api.ts         klijent prema domovina-api (HMAC potpis za Stripe rail funkcije)
  stripe.ts      direct charge checkout, refund, verifikacija webhook potpisa
  webhooks.ts    POST /webhook/stripe — jedini izvor istine o plaćanju
  mail.ts        dostava ulaznica (QR kao PNG privitak)
  qr.ts          QR → PNG bez native ovisnosti (radi i u Workeru i u testu)
  reconcile.ts   cron: propušteni webhookovi, neisporučene ulaznice, povrati
src/             React SPA: događaj → kupnja → "moje ulaznice"
migrations/      D1 — samo operativni trag (webhook log, mailovi, brand stranice)
worker-tests/    node:test nad PRAVIM Workerom; nijedan test ne ide na mrežu
```

```bash
npm install
npm run api          # wrangler dev (Worker) na :8787
npm run dev          # Vite (SPA) na :5174, /api proxy na Worker
npm test             # 50 testova, bez mreže
npm run build        # tsc + vite build → dist/ (Worker ga servira preko ASSETS)
```

Deploy i tajne: v. [U2 Zapisnik](docs/handoffs/u2-javna-prodaja-web.md#zapisnik-izvršenja).
Webhook u Stripeu mora biti **Connect** endpoint — inače eventi ne nose
`account: acct_…` i povrati se ne mogu izvesti.

## Zašto

| Posrednik  | Naknada posjetitelju            | Izvor snimke                                       |
| ---------- | ------------------------------- | -------------------------------------------------- |
| Entrio     | 4,00 € na 149 € (~2,7 %)        | Money Motion 2027, snimka 2026-07-16 (doc 11 §1)   |
| Entrio     | 2,72 € na 49 € (~5,5 %)         | MoMo studentska ulaznica                            |
| TicketTailor / Stripe Payment Link | fiksno + % po transakciji | EHO konferencija (nalaz iz web analize 2026)   |

Booking fee je nepovratan i naplaćuje se po ulaznici, za svaki način plaćanja.
Ovdje je **0 %** — organizator plaća samo Stripeovu procesorsku naknadu, koju bi
platio i inače.

## Ključne odluke (donesene 2026-08-03)

1. **Ticketing jezgra se NE gradi ponovno.** Eventi, tieri, narudžbe s TTL
   rezervacijom, ulaznice, QR i check-in već postoje i deployani su u
   `domovina-api` (shema `pinka_finance`) — v. [05 — Podatkovni model](docs/05-podatkovni-model.md).
   Ovaj repo dodaje **Stripe rail + web prodajni kanal** nad time.
2. **Stripe Connect direct charges, 0 % application fee** — organizator je
   nedvojbeno prodavatelj (merchant of record), novac ne prolazi kroz platformu.
   Obrazloženje i posljedice: [03 — Stripe model](docs/03-stripe-connect-0-posto.md).
3. **Fiskalizacija je pluggable** (`domovina-fiskal` | FIRA | organizator sam);
   MVP pušta "organizator sam" + `domovina-fiskal` u TEST okolini —
   [04 — Porezni okvir](docs/04-porezni-i-pravni-okvir.md).
4. **airKUNA wallet je kasniji rail nad istim podacima**, ne drugi proizvod —
   [06 — Faze](docs/06-faze-roadmap.md) §U6.

## Dokumenti

| #   | Dokument                                                        | Sadržaj                                                     |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| 01  | [Vizija i model](docs/01-vizija-i-model.md)                     | teza, tržište, tko su prvi korisnici, monetizacija           |
| 02  | [Arhitektura](docs/02-arhitektura.md)                           | komponente, tok kupnje, deploy, granice odgovornosti         |
| 03  | [Stripe Connect 0 %](docs/03-stripe-connect-0-posto.md)         | direct charges, onboarding, webhook, refund, rekoncilijacija |
| 04  | [Porezni i pravni okvir](docs/04-porezni-i-pravni-okvir.md)     | fiskalizacija 2.0, PDV, DAC7, GDPR, otvorena pitanja         |
| 05  | [Podatkovni model](docs/05-podatkovni-model.md)                 | što postoji u `pinka_finance`, što je novo za Stripe rail    |
| 06  | [Faze i roadmap](docs/06-faze-roadmap.md)                       | U1–U6, ovisnosti, definicija MVP-a                           |
| 07  | [Prior art i reuse mapa](docs/07-prior-art-reuse-mapa.md)       | što se kopira iz kojeg repoa i zašto                         |
| 08  | [Konkurencija i tržište](docs/08-konkurencija-i-trziste.md)     | tko su konkurenti globalno i u HR, gdje je naš prostor       |
| 09  | [Usporedba s Ticket Tailorom](docs/09-usporedba-ticket-tailor.md) | funkcija po funkciju: zajedničko, bolje, što nedostaje      |
|     | [Nalazi lokalne verifikacije](docs/2026-08-04-lokalna-verifikacija-i-nalazi.md) | odbačene alternative, zamke, mjerenja, otvoreno |
|     | [Handoffi](docs/handoffs/README.md)                             | samodostatni promptovi po fazi                               |

## Stack (planiran)

- **Web** (ovaj repo): Cloudflare Worker + Hono (Stripe rail, webhook, e-mail) +
  React SPA (javna prodaja, organizator dashboard, check-in PWA).
- **Ticketing jezgra**: `domovina-api` (self-hosted Supabase, shema `pinka_finance`)
  — postojeće edge funkcije `events-*` + nove `events-stripe-*`.
- **Računi**: `domovina-fiskal` (ZKI/JIR) ili FIRA, iza `InvoiceProvider` sučelja.

## Susjedni repoi (izvori istine, ne kopirati naslijepo)

```
/Users/ms/git/domovinatv/domovina-api              ticketing jezgra + edge funkcije
/Users/ms/git/domovinatv/domovina-fiskal           fiskalizacija (Worker+Hono+D1)
/Users/ms/git/domovinatv/domovina-fiskal-app       dashboard obrazac (Next static export)
/Users/ms/git/domovinatv/rodjendaonice.domovina.ai Stripe Connect presedan (apps/marketplace)
/Users/ms/git/safe-global/safe-wallet-monorepo     doc 11/12/13 — izvorni plan + lekcije
/Users/ms/git/stepanic/fira-forms-connector        današnji ručni tok (Forms → FIRA)
```
