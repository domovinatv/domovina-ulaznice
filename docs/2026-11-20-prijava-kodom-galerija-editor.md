# Prijava kodom, galerija i editor događaja (2026-11-20)

Ivanova sesija izvan lanca `web/` (S7 čeka staging deploy). Tri promjene, svaka
sa svojim commitom i redom u [`deploy-dug.md`](deploy-dug.md):

| # | Što | Commit |
| --- | --- | --- |
| 7 | Prijava organizatora i skenera kodom na e-mail (`/api/organizator/kod`, `/potvrdi`) | `0515e85` |
| 8 | Galerija slika događaja (`events.gallery`, Astro `Galerija.astro`) | `1c247fb` + `domovina-api@d5cdae3` |
| 9 | Editor događaja: nova privatna skica (`/organizator/novi`) | `a423316` |

Ovdje je samo ono što se iz koda ne vidi.

## Tko smije kreirati događaj

`create_event` je security invoker, a RLS na `campaigns` traži **dvoje**:

```
has_role_on_account(account_id, 'admin') AND is_identity_verified()
```

`is_identity_verified()` = korisnik ima redak u `public.identity_verifications`
(eOsobna/Certilia na domovina.ai, KYC). Biti admin računa organizatora **nije
dovoljno**. Seedani korisnici taj redak nemaju, pa lokalno nitko ne može kreirati
dok se redak ne upiše (v. „Lokalno” niže).

`events-organizer` grešku baze skrati na prvu riječ (`normalizeDbError`), pa RLS
odbijanje („new row violates row-level security policy”) stiže kao
`{"error":"new"}` sa statusom 400. Worker to prevodi u `403 nema_prava_kreiranja`;
svaku drugu poruku koja nije `snake_case` kod pretvara u 502, da sirova poruka
baze ne ode u browser.

Objava je zaseban korak (`publish_event`) i traži još: račun u
`organizer_allowlist` (ručno, Matija) i pravu Safe adresu u
`campaigns.destination_address` (skica iz editora dobije nultu). DAC7 zapis
(`organizer_records`) objavu danas ne blokira, ali je po `docs/04` §5 obavezan dio
onboardinga. Za njega još nema forme.

## Zamke koje su koštale vrijeme

- **GoTrue `/otp` vraća 500 „Database error finding user”** za korisnike koje je
  seed upisao SQL-om: stupci `confirmation_token`, `recovery_token`,
  `email_change*`, `phone_change*`, `reauthentication_token` su `NULL`, a GoTrue ih
  čita kao string. Lijek (lokalno): `update auth.users set <stupac> = coalesce(<stupac>, '')`.
  Isto vrijedi za produkciju ako je tamo itko upisan mimo GoTruea.
- **Zadani lokalni predložak maila ima samo link, bez koda.** Kod u mailu traži
  `{{ .Token }}` u predlošku. Lokalno je to riješeno u
  `domovina-api@728f50b` (`supabase/templates/magic_link.html`). **Na produkciji
  nije provjereno** kakav je predložak (Supabase dashboard → Auth → Email
  Templates → Magic Link). Bez `{{ .Token }}` prijava kodom na stagingu ne radi.
- **`fn-shim` (:55390) učita edge funkcije samo pri pokretanju.** Nakon izmjene
  `events-*` u `domovina-api` treba ga restartati, inače vraća staro (feed bez
  `gallery`).
- **:8788 ne vidi izmjene u `web/` dok se Astro na :8792 ne builda ponovno.**
  `pokreni-web.sh` vrti kopiju builda (`.wrangler/web-build`), ne `astro dev`.
  :4321 (Ivanov dev) ih vidi odmah.
- **`docker exec` bez `-i` tiho ignorira heredoc**: `psql` ne izvrši ništa i ne
  javi grešku.
- Nepoznat mail na `/otp` s `create_user: false` daje 422 „Signups not allowed
  for otp”. Worker namjerno svejedno vraća `{ok:true}` (bez otkrivanja računa), pa
  korisnik vidi „Poslali smo kod” iako kod ne stiže. Na to je naletio i Ivan.

## Odluke

- **Lozinka ostaje** kao sporedni put u istom obrascu: `REVIEW(fable)` u
  `worker/api.ts` kaže da osoblje na ulazu s tuđeg mobitela ne može čekati mail.
- **Google gumb je samo izgled.** Za stvarni tok treba `ulaznice(-staging).domovina.ai`
  u `additional_redirect_urls` GoTruea i OAuth povratak u Workeru.
- **Galerija je `jsonb` na `events`**, ne zasebna tablica: ≤ 20 stavki, redom
  prikaza, bez upita po slici. Naslovna ostaje `cover_image_url` i prva je u
  galeriji; odjeljak se prikazuje tek kad je slika više od jedne.
- **Editor je u SPA-u** (`/organizator/novi`), ne u Astru: iza prijave je, ne
  treba SEO, a sesija organizatora već živi u SPA-u.
- **Birač datuma je vlastiti** (`src/components/KalendarPolje.tsx`), bez
  biblioteke; vrijednost ostaje `YYYY-MM-DDTHH:MM` kao `datetime-local`, a UTC
  računa `zidnoVrijemeUUtc` po Zagrebu, neovisno o zoni preglednika.
- **`events-gallery` i predložak maila su složene grane** u `domovina-api` (na
  S2b PR #5), jer lokalni Supabase čita radnu kopiju: odvojene grane od `main`
  bi pri restartu izgubile ili migraciju ili predložak.

## Lokalno stanje (nije u gitu)

U lokalnom Supabaseu (`supabase_db_domovina-api`), samo za razvoj:

- `stepanic.ivan@gmail.com` postoji, admin je na računima `…d2` (Udruga Prilika
  za Susret) i `…e2` (Katolička udruga…), i ima **lažni** redak u
  `identity_verifications` (`provider = 'lokalni_test'`).
- `testni-dogadaj` ima naslovnu sliku i 5 slika u `gallery` (Unsplash).
- Skica „Ljetni koncert u Maksimiru” (privatna) iz probe editora.
- `auth.users` tokeni očišćeni od `NULL` (v. zamke).

`supabase db reset` sve to briše.

## Otvoreno

- Produkcijski predložak maila: ima li `{{ .Token }}` (#7).
- Je li `events-organizer` uopće deployan na `api.domovina.ai` (#9).
- Objava iz editora: allowlist, Safe adresa, DAC7 forma, gumb „Objavi”.
- Uređivanje postojećeg događaja; galerija, alt i koordinate u formi; upload slike.
- PR-ovi u `domovina-api`: `events-gallery` i `lokalni-predlozak-koda` čekaju
  merge S2b PR-a #5.

Povezano: [`deploy-dug.md`](deploy-dug.md), [`04-porezni-i-pravni-okvir.md`](04-porezni-i-pravni-okvir.md) §5,
[`2026-09-28-unos-dogadjaja-kroz-chat.md`](2026-09-28-unos-dogadjaja-kroz-chat.md).
