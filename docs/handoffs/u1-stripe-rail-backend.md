# U1 — Stripe rail u ticketing backendu

> Handoff prompt za praznu Claude Code sesiju. **Ova faza se izvršava u DRUGOM repou:**
> `/Users/ms/git/domovinatv/domovina-api` (self-hosted Supabase). Repo
> `domovina-ulaznice` se u ovoj fazi NE dira osim Zapisnika na kraju.
>
> _EN abstract: add a Stripe payment rail to the existing `pinka_finance` ticketing
> core — a `payment_rail` + `external_payment_ref` column pair with a unique index
> for idempotency, an `organizer_payment_rails` table for Connect account state, an
> `confirm_ticket_order_offchain()` RPC mirroring the onchain one, and two edge
> functions (`events-stripe-intent`, `events-stripe-confirm`) where the latter is
> HMAC-gated because, unlike the onchain path, there is no self-authorizing proof._

## Cilj

Narudžba ulaznica se može naplatiti **Stripeom** i izdati ulaznice istim putem kao
kod onchain uplate — bez ijedne promjene postojećeg onchain toka, i bez mogućnosti
da itko izvana "potvrdi" plaćanje koje se nije dogodilo.

## Kontekst i izvori (pročitaj prije koda)

U `domovina-ulaznice`:

- `docs/02-arhitektura.md` (§3.1, §4), `docs/05-podatkovni-model.md` (**cijeli**,
  posebno §2.3 i §2.4), `docs/03-stripe-connect-0-posto.md` (§4).

U `domovina-api`:

- `supabase/migrations/20260716120000_events_ticketing_schema.sql` — shema
  (`events`, `tickets`, dodaci na `contributions` i `campaign_tiers`).
- `supabase/migrations/20260716120200_events_ticketing_rpcs.sql` — **`confirm_ticket_order`
  na liniji 457 je predložak koji zrcališ**; pročitaj i `create_ticket_order` (295)
  i `tg_contribution_state` (197) da razumiješ rezervaciju inventoryja.
- `supabase/migrations/20260716120100_events_ticketing_rls.sql` — RLS konvencije.
- `supabase/functions/events-confirm/index.ts` — obrazac edge funkcije, CORS,
  service klijent, format odgovora.
- `supabase/functions/events-order/index.ts` — validacija ulaza (UUID regex itd.).
- `docs/events-ticketing-curl-scenario.md` — format smoke testa; svoj scenarij
  dopisuješ u isti dokument (nova sekcija).
- `docs/backend-architecture.md`, `scripts/db-migrate.sh`, `scripts/deploy-functions.sh`.

U `safe-wallet-monorepo`:

- `docs/whitelabel-wallet/13-lekcije-sesije-dogadjaji.md` §3 — zašto poslovni
  ishodi idu kao status jsonb, a ne kao exception.

## Preduvjeti

**Ručni (vlasnik):**

| Preduvjet                                         | Zašto                              | Status |
| -------------------------------------------------- | ---------------------------------- | ------ |
| SSH pristup produkciji (Coolify)                   | migracije + deploy funkcija        | ⬜     |
| Tajna `EVENTS_STRIPE_CONFIRM_SECRET` (32+ bajta)   | HMAC između Workera i funkcije     | ⬜     |

**Tehnički:** lokalni `supabase start` stack za verifikaciju (`psql` na `:55322`,
funkcije na `:55321`).

## Opseg

**IN:**

1. **Migracija** `supabase/migrations/<YYYYMMDDHHMMSS>_events_stripe_rail.sql`:
   - `pinka_finance.organizer_payment_rails` (definicija u doc 05 §2.1) + RLS:
     select za org admina i service_role, **insert/update samo service_role**.
   - `contributions`: `payment_rail text not null default 'onchain'`,
     `external_payment_ref text`, `buyer_email text` + unique index
     `(payment_rail, external_payment_ref) where external_payment_ref is not null`.
   - `pinka_finance.confirm_ticket_order_offchain(...)` — zrcalo
     `confirm_ticket_order` sa svih šest obrazaca iz doc 05 §2.3.
   - Idempotentno (`if not exists`, `create or replace`, `do $$ … exception when duplicate_object`).
2. **Edge funkcija `events-stripe-intent`** (`verify_jwt=false`): ulaz `{order_id}`,
   izlaz `{amount_cents, currency, quantity, tier:{id,title}, event:{title,slug,starts_at},
   stripe_account_id, charges_enabled}`. Odbija ako narudžba nije `pending`, ako je
   rezervacija istekla, ili ako organizator nema `charges_enabled`.
3. **Edge funkcija `events-stripe-confirm`** (`verify_jwt=false` + **HMAC gate**):
   ulaz `{order_id, external_ref, amount_cents, payer_email?}`, header
   `x-ulaznice-signature: sha256=<hmac hex>` nad sirovim tijelom; konstantno-vremenska
   usporedba. Zove `confirm_ticket_order_offchain`, vraća `{status, serials, tickets:[{serial,
   holder_name, qr_token}]}` — QR tokeni **jednokratno**, isti obrazac kao `events-tickets`.
4. `config.toml` unosi za obje funkcije.
5. Dopuna `docs/events-ticketing-curl-scenario.md`: sekcija "10. Stripe rail".

**OUT:**

- Bilo kakav Stripe SDK poziv u backendu — Stripe zove **isključivo Worker**;
  backend nikad ne razgovara sa Stripeom i ne zna njegov ključ.
- Promjene `events-confirm`, `events-order`, `events-tickets`, `events-checkin`.
- Web/UI.

## Sigurnost (invarijanti)

1. **`events-stripe-confirm` bez ispravnog HMAC-a vraća 401 i ne dira bazu.** Bez
   postavljene tajne funkcija vraća 503 — nikad "prolazi jer tajne nema".
   Ovo je jedina razlika prema onchain putu, gdje je dokaz sam blockchain.
2. `stripe_account_id` se **nikad** ne vraća u javnim odgovorima osim
   `events-stripe-intent` (koji zove samo Worker) — feed dobiva izvedeni boolean.
3. QR tokeni u plaintextu postoje samo u odgovoru prve dostave; u bazi ostaje hash.
4. Poslovni ne-uspjeh = status jsonb (`amount_insufficient`, `expired_sold_out`,
   `tx_already_credited`, `already_paid`), NIKAD exception — inače se rollbacka
   audit zapis u `contribution_events`.
5. Migracija ne smije promijeniti ponašanje postojećih `onchain` redova.

## Kriteriji prihvaćanja

Na lokalnom stacku, dopisano u curl scenarij:

```
1. order (qty 2, imenska s imenima)                → pending, inventory_claimed +2
2. events-stripe-intent                            → amount_cents, acct_…, charges_enabled
3. events-stripe-confirm (valjan HMAC)             → status paid, 2 seriala, 2 qr_tokena
4. isti confirm ponovno                            → already_paid, BEZ novih ulaznica
5. confirm s krivim HMAC-om                        → 401, baza netaknuta
6. confirm s amount_cents manjim od narudžbe       → amount_insufficient + audit event
7. isti external_ref na drugoj narudžbi            → tx_already_credited + audit event
8. istekla rezervacija + rasprodan tier            → expired_sold_out
9. postojeći onchain scenarij (§3–§7 dokumenta)    → i dalje prolazi nepromijenjen
```

Uz to: `db-migrate.sh --dry-run` čist, drugi run migracije = no-op.

## Zapisnik izvršenja

> ★ Popuni na kraju faze: točna imena RPC-ova i funkcija, odstupanja od plana,
> gotchai, commit hashevi, što iduća faza (U2) mora znati (URL-ovi funkcija, format
> odgovora, ime headera i način izračuna HMAC-a).

- Status: ⬜
- Commitovi:
- Odluke:
- Gotchai:
