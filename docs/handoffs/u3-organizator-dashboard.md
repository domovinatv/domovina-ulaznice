# U3 — Organizator self-service (dashboard)

> Handoff prompt za praznu Claude Code sesiju. Repo: `domovina-ulaznice`
> (+ manja dopuna u `domovina-api`). Ovisi o [U2](u2-javna-prodaja-web.md).
>
> _EN abstract: organizer dashboard — GoTrue login (same Domovina identity as
> `domovina-fiskal-app`), Stripe Connect Express onboarding, event and tier editor
> on top of the existing `update_event` / `publish_event` RPCs, sales overview via
> `organizer_overview`, holder export, and CSV import of pre-existing registrations._

## Cilj

Organizator bez ijednog SQL upita i bez našeg sudjelovanja: prijavi se, spoji
Stripe, kreira događaj s tierima, objavi ga, prati prodaju i izveze popis
sudionika.

## Kontekst i izvori

- `docs/02-arhitektura.md` §5 (auth), `docs/03-stripe-connect-0-posto.md` §2
  (onboarding), `docs/04-porezni-i-pravni-okvir.md` §5 (DAC7 = obavezan dio
  onboardinga), `docs/05-podatkovni-model.md` §2.1.
- `safe-wallet-monorepo/docs/whitelabel-wallet/12-onboarding-organizatora.md` —
  **runbook i tekst uputa organizatoru; §3 je gotov copy koji treba samo prilagoditi
  s "EURe/Safe" na "Stripe/kartica"**. §8 je popis poznatih ograničenja pilota.
- `domovina-api/supabase/migrations/20260717130000_events_organizer.sql` —
  `update_event` (131), `publish_event` (380), `organizer_overview` (455),
  `upsert_organizer_record` (542), `sanitize_ugc` (111).
- `domovina-fiskal-app/` — obrazac SPA + GoTrue login + `lib/fiskal.ts` (kako se
  JWT nosi prema backendu i kako se bira tenant iz dropdowna).

## Preduvjeti

| Preduvjet                                                            | Status |
| --------------------------------------------------------------------- | ------ |
| Potvrda da Stripe Express onboarding prolazi za hrvatske **udruge**   | ⬜     |
| GoTrue klijent config za `api.domovina.ai`                            | ⬜     |
| Odluka: tko odobrava objavu (allowlist ostaje ručni ili admin UI)     | ⬜     |

## Opseg

**IN:**

1. **Prijava** — GoTrue (e-mail + lozinka / magic link), dropdown org accounta ako
   korisnik ima više. **Ovim se zatvara dug iz E4** ("zalijepljeni JWT", doc 13 §6.2).
2. **Stripe Connect** — "Spoji Stripe" → `accountLinks` → povratak → status
   (`charges_enabled`, `payouts_enabled`) iz `organizer_payment_rails`.
   Jasna poruka dok račun nije spreman: događaj je vidljiv, ali se ne može kupiti.
3. **Editor događaja** — naziv, tip, venue, termin, opis HR/EN, cover; tieri
   (naziv, cijena, količina, `imenska`, `sale_start`/`sale_end`). Zaključavanje:
   objavljenom tieru se ne mijenja cijena (server to odbija) → UI nudi "dodaj novi
   tier" kao u `12-onboarding-organizatora.md` §7.
4. **Objava** — `publish_event` s postojećim gatingom (allowlist + spojen Stripe).
5. **Pregled prodaje** — `organizer_overview`: prodano/rezervirano/preostalo po
   tieru, prihod, zadnje narudžbe. Isplate: link na Stripe Express dashboard
   (`stripe.accounts.createLoginLink`), ne kopiramo Stripeov UI.
6. **Izvoz holdera** (CSV) — samo org admin; zapis u audit.
7. **DAC7 zapis** — obrazac u onboardingu (pravni subjekt, OIB, adresa, financijski
   identifikator) → `upsert_organizer_record`. **Bez toga nema objave.**
8. **Uvoz postojećih prijava (CSV)** — za organizatore koji prelaze usred sezone s
   Google Forms/FIRA toka: mapiranje stupaca → `contributions` (`state='paid'`,
   `payment_rail='manual'`) + izdavanje ulaznica. Presedan izvora podataka:
   `fira-forms-connector/google-apps-script/events/*/Config.gs` (`COLUMNS` mapa).
9. **Retencija** — cron koji anonimizira `holder_name`/`holder_email` nakon
   `events.ends_at + 90 dana` (obveza iz komentara sheme; danas nije automatizirana).

**OUT:** upravljanje skener-osobljem (U4 zapisnik odlučuje), refund UI (post-MVP),
admin UI za allowlist moderaciju (post-MVP), višejezičnost.

## Sigurnost

1. Svaka organizator-akcija ide kroz **RLS s `has_role_on_account(account,'admin')`** —
   nikad service-role iz browsera.
2. `stripe_account_id` se ne prikazuje; samo status i "Otvori Stripe".
3. UGC (naziv, opis) prolazi `sanitize_ugc` na backendu — ne oslanjaj se na frontend.
4. Izvoz holdera i DAC7 podaci nikad ne završe u javnom feedu.

## Kriteriji prihvaćanja

```
1. Novi organizator: prijava → Stripe onboarding → event + 2 tiera → objava,
   bez ijednog SQL-a i bez izmjene koda
2. Objava odbijena dok Stripe nije spojen ILI dok DAC7 zapis ne postoji
3. Promjena cijene objavljenog tiera odbijena server-side
4. organizator_overview brojevi se poklapaju s brojem izdanih ulaznica
5. CSV uvoz 20 postojećih prijava → 20 ulaznica, idempotentno na ponovni uvoz
6. Drugi organizator NE vidi tuđe događaje ni holdere (RLS test)
```

## Zapisnik izvršenja

- Status: ⬜
- Commitovi:
- Odluke:
- Gotchai:
