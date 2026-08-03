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

> ★ Popuni na kraju: rute, imena env varijabli, format e-maila, odluke o QR
> renderiranju, što U3/U4 moraju znati.

- Status: ⬜
- Commitovi:
- Odluke:
- Gotchai:
