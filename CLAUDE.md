# CLAUDE.md — domovina-ulaznice

Orijentacija za agente koji rade u ovom repou. Držati aktualnim.

## Što je ovo

SaaS za prodaju ulaznica za događaje **bez posrednika i bez booking feeja**.
Organizator prodaje s vlastite stranice, novac ide izravno na njegov Stripe račun
(Connect **direct charge**, `application_fee_amount` se ne šalje), ulaznica je QR
koji se skenira na ulazu.

Status: **U1 ✅ živ na `api.domovina.ai` · U2 ✅ deployan na staging · U3/U4/U5 🟡
djelomično** (pregled prodaje, skener ulaza i FIRA račun rade; Connect onboarding i
`domovina_fiskal` ne). **Editor događaja je tek začet** (Ivan, 2026-11-20):
`/organizator/novi` sprema novu *privatnu skicu* s ulaznicama kroz `events-organizer`
(treba admin računa + provjeren identitet). Objava, uređivanje, galerija i
koordinate još idu kao dosad: organizator događaj priprema na svoj način (Google
Forms, FIRA `Config.gs`…), a agent ga u chatu formalizira u seed — pravila
mapiranja: `docs/2026-09-28-unos-dogadjaja-kroz-chat.md`. Prodaja **još ne radi ni na
stagingu** — nedostaju Stripe/Resend tajne i objavljen događaj u jezgri.

- `ulaznice-staging.domovina.ai` — puna aplikacija, Stripe **sandbox**
- `ulaznice.domovina.ai` — **samo najava** (`NAJAVA=1`, bez D1/KV/ASSETS/crona)

Mobilne aplikacije za **kupce** (iOS SwiftUI + Android Compose) su u `mobile/`
— pričaju samo s Workerom, QR dolazi kroz `POST /api/ulaznice/:id/preuzmi`
(rotacija tokena, isti mehanizam kao ponovna dostava). Kako se grade, mock API i
što fali: `mobile/README.md`, `docs/2026-09-11-mobilne-aplikacije.md`.

Deploy ide s `npm run deploy` (= staging); produkcija je `npm run deploy:prod`.
Tajne su po okruženju: `wrangler secret put … --env staging`.
Stanje, zamke i otvorena pitanja: `docs/2026-08-08-deploy-okruzenja-i-stripe.md`.
Što je u gitu a nije deployano (i kako/kamo): **`docs/deploy-dug.md`** — svaka
promjena koja traži deploy upisuje se tamo u istom commitu.
Što još treba do produkcije: `docs/2026-09-03-plan-do-produkcije.md`
(+ `docs/2026-09-03-implementacija-p0-p1.md` za popis `REVIEW(fable)` mjesta).

## Lanac `web/` — Astro frontend za kupce (Ivan, fork `IStep95`)

Zaseban Astro na Cloudflare Workersima za stranice kupaca (popis, događaj, kupnja,
narudžba, pravno), bez vlastite baze i tajni, podaci samo iz `/api/*` ovog Workera.
Radi ga Ivan Stepanić u forku `IStep95/domovina-ulaznice` kroz lanac sesija:
`web/TODO.md`, `web/docs/plan.md`, `web/docs/decisions.md`, `web/docs/handoffs/`.
„Nastavi web” = prvi otvoreni red u „Stanje lanca” u `web/docs/handoffs/README.md`.
Matija prati fork kroz remote `ivan` (`git fetch ivan && git log origin/main..ivan/main`).

## Prvo pročitaj

1. `docs/02-arhitektura.md` — granice odgovornosti (najvažnije)
2. `docs/05-podatkovni-model.md` — što postoji, što je novo
3. `docs/07-prior-art-reuse-mapa.md` — odakle se što kopira
4. `docs/handoffs/README.md` — kako izgleda faza
5. `docs/08-konkurencija-i-trziste.md` — tko su konkurenti (Ticket Tailor,
   Entrio, Upad, pretix…) i za što se **ne** natječemo; `docs/09` je usporedba
   s Ticket Tailorom funkcija po funkciju + rangirani popis onoga što fali

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
  - `npm test` (97 testova, node:test, **nikad na mrežu**), `npm run build`, `npm run api`
  - `scripts/lokalno/pokreni.sh` — cijela kupnja lokalno (jezgra + lažni Stripe + inbox),
    app na `:8788`, inbox na `:8901/inbox`; v. `docs/2026-08-04-…` §9
- Mobilno: `mobile/ios` (XcodeGen, `xcodegen generate`), `mobile/android`
  (`./gradlew :app:assembleDebug`, JDK 17), `node mobile/mock-api.mjs` (port 8797)
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
