# domovina-ulaznice

**SaaS za prodaju ulaznica za događaje — bez posrednika i bez booking feeja.**

Organizator prodaje ulaznice s vlastite stranice, novac ide **izravno na njegov
Stripe račun** (Connect, `application_fee_amount = 0`), ulaznica je QR koji se
skenira na ulazu. Platforma nikad ne drži novac i ne uzima proviziju s ulaznice.

> Status: **PLANIRANJE** — u repou su za sada samo plan dokumenti (`docs/`).
> Prvi kod kreće po handoffu [U1](docs/handoffs/u1-stripe-rail-backend.md).
> Datum plana: 2026-08-03.

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
