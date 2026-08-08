# CLAUDE.md — domovina-ulaznice

Orijentacija za agente koji rade u ovom repou. Držati aktualnim.

## Što je ovo

SaaS za prodaju ulaznica za događaje **bez posrednika i bez booking feeja**.
Organizator prodaje s vlastite stranice, novac ide izravno na njegov Stripe račun
(Connect **direct charge**, `application_fee_amount` se ne šalje), ulaznica je QR
koji se skenira na ulazu.

Status: **U1 ✅ živ na `api.domovina.ai` · U2 ✅ deployan na staging**.

- `ulaznice-staging.domovina.ai` — puna aplikacija, Stripe **sandbox**
- `ulaznice.domovina.ai` — **samo najava** (`NAJAVA=1`, bez D1/KV/ASSETS/crona)

Deploy ide s `npm run deploy` (= staging); produkcija je `npm run deploy:prod`.
Tajne su po okruženju: `wrangler secret put … --env staging`.
Stanje, zamke i otvorena pitanja: `docs/2026-08-08-deploy-okruzenja-i-stripe.md`.

## Prvo pročitaj

1. `docs/02-arhitektura.md` — granice odgovornosti (najvažnije)
2. `docs/05-podatkovni-model.md` — što postoji, što je novo
3. `docs/07-prior-art-reuse-mapa.md` — odakle se što kopira
4. `docs/handoffs/README.md` — kako izgleda faza

## Četiri pravila koja se ne krše

1. **Ticketing jezgra je u `domovina-api` (shema `pinka_finance`), ne ovdje.**
   Ulaznice, narudžbe i inventory nikad ne idu u lokalni D1/KV. Ako ti treba
   lokalna tablica ulaznica — pogrešno si postavio problem.
2. **Novac ne prolazi kroz platformu.** Direct charge na račun organizatora, 0 %
   provizije. Svaka promjena toga traži poreznu provjeru (`docs/04` §6).
3. **Webhook je jedini izvor istine o plaćanju**; idempotencija ide na unique index
   u bazi, ne u aplikacijski kod.
4. **`events-stripe-confirm` mora biti HMAC-zaštićena.** Za razliku od onchain puta
   (gdje je dokaz sam blockchain), ovdje je jedini dokaz uplate Stripe potpis koji
   verificira Worker. Otvorena funkcija = besplatne ulaznice.

## Stack

- Worker + Hono + D1 (operativni podaci) + KV (rate limit) + React SPA → Cloudflare
  - `npm test` (50 testova, node:test, **nikad na mrežu**), `npm run build`, `npm run api`
- Ticketing: `domovina-api` edge funkcije `events-*`
- Računi: `InvoiceProvider` (organizator | fira | domovina_fiskal)

## Susjedni repoi

```
../domovina-api                    ticketing jezgra (Postgres + edge funkcije)
../domovina-fiskal (+ -app)        fiskalizacija ZKI/JIR + dashboard obrazac
../rodjendaonice.domovina.ai       Stripe Connect presedan (apps/marketplace/worker/*)
../../safe-global/safe-wallet-monorepo  docs/whitelabel-wallet/11,12,13 — izvorni plan
../../stepanic/fira-forms-connector     današnji ručni tok (Forms → FIRA), prvi tenant
```

## Konvencije

- **Jezik: hrvatski** u dokumentaciji, UI-ju i commit porukama; kod i identifikatori
  engleski osim domenskih pojmova koji su već hrvatski u shemi (`imenska`, `holders`).
- Commit: `feat(u2): …`, `fix(u1): …`, `docs: …`.
- Novac: **cijeli centi (integer), nikad float.** Obrazac:
  `safe-wallet-monorepo/apps/mobile/src/custom/marketplace/logic/order.ts`.
- Tajne nikad u repo; `wrangler secret put`.
- Migracije u `domovina-api` su **idempotentne** (drugi run = no-op).
- Svaka faza na kraju popuni **Zapisnik izvršenja** u svom handoffu.
