-- Katolička udruga „Prilika za Susret" — nadolazeći događaji koje ONA organizira.
--
-- Izvori (dohvaćeno 2026-08-08):
--   A) javne stranice organizatora — https://www.prilikazasusret.hr/dogadjaji/
--      → naziv, datum, satnica, mjesto, kontakt, prijavni link
--   B) organizatorove VLASTITE konfiguracije za izdavanje računa
--      ../../stepanic/fira-forms-connector/google-apps-script/events/*/Config.gs
--      → kotizacije, rokovi prijave i uplate, satnica gdje je web nema
--
-- Zašto dva izvora: web organizatora sustavno NE objavljuje cjenik — cijena
-- postoji tek u prijavnoj formi i na računu. Od sedam nadolazećih događaja
-- cijena je javno objavljena samo za jedan (Visoko, a njega PzS ne organizira).
-- Iznosi ovdje nisu izvedeni ni preneseni s drugog događaja: svaki je iz
-- konfiguracije TOG događaja. Gdje cjenika nema ni u jednom izvoru, događaj
-- namjerno ide BEZ tierova → SPA prikazuje „Organizator još nije objavio cjenik."
--
-- NIJE ovdje, namjerno:
--   * Ljetni kamp Krk (2.–8. 8. 2026.) — završava na dan dohvata, nije za prodaju
--   * Ljetni kamp Papuk, Susret Visoko BiH — na obje stranice doslovno piše
--     „PzS nije organizator" (kontakti kr.u.papuk@gmail.com, samostan.visoko@gmail.com).
--     Tuđi događaj se ne stavlja u organizatorov katalog.
--   * Osijek 23.5.2026., Šibenik 6.–7.6.2026., Ćunski I i II — prošli
--   * Zagreb 12.–14. 2. 2027. — već u seeds/susret-zagreb-2027.sql
--
-- Akontacije (Badija 110 €, Ćunski/Krk 100 €) NISU tierovi — to je djelomično
-- plaćanje kroz FIRA split payment, a platforma prodaje cijelu ulaznicu.
-- Gotovinska uplata na dan susreta (Sinj 60 €) također nije online tier.
--
-- Kapacitet nigdje nije objavljen → inventory_total ostaje NULL (bez limita).
-- Izmišljen kapacitet bi lažno prikazao „još N komada" / „rasprodano".
--
-- ⚠️ LOKALNI demo seed. Ne pušta se na javni URL dok organizator ne potvrdi.
--
-- Pokretanje (idempotentno — drugi run je no-op):
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" \
--        -f seeds/prilika-za-susret-2026.sql
\set ON_ERROR_STOP on
begin;

-- ── Organizator ────────────────────────────────────────────────────────────
-- Isti UUID-evi kao u seeds/susret-zagreb-2027.sql, pa se dva seeda mogu
-- pustiti u bilo kojem redoslijedu i dijele jedan račun organizatora.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'catholicsinglesummit@gmail.com',
        crypt('demo1234', gen_salt('bf')),
        now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

insert into public.accounts (id, primary_owner_user_id, is_personal_account, slug, name)
values ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e1',
        false, 'prilika-za-susret-osijek', 'Katolička udruga Prilika za Susret')
on conflict (id) do nothing;

insert into public.accounts_memberships (account_id, user_id, account_role)
values ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e1', 'admin')
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Međunarodni Ljetni kamp Badija 2026 — 12.–17. 8. 2026.
--
-- Satnica: stranica kaže početak 18:00, a komentar u badija-2026/Config.gs
-- kaže 19:00. Uzet je podatak sa STRANICE (ono što je organizator objavio
-- kupcu); neslaganje je zabilježeno, ne razriješeno nagađanjem.
--
-- Prodajni prozori su stvarni rokovi organizatora, pa su na dan pisanja seeda
-- (8.8.2026.) SVI zatvoreni — rok prijave bio je 1.8.2026. Događaj je zato
-- vidljiv, ali nije kupiv. To je točno stanje, ne greška seeda.
-- ═══════════════════════════════════════════════════════════════════════════
select pinka_finance.create_event(
  p_id                  => '00000000-0000-4000-8000-000000000f02',
  p_account_id          => '00000000-0000-4000-8000-0000000000e2',
  p_title               => 'Međunarodni Ljetni kamp Badija 2026',
  p_destination_address => '0x1111111111111111111111111111111111111111',
  p_venue_name          => 'Samostan Badija',
  p_venue_address       => null,          -- ulica nije objavljena ni na jednom izvoru
  p_venue_city          => 'Korčula',
  p_event_type          => 'kamp',
  p_starts_at           => '2026-08-12T18:00:00+02',
  p_ends_at             => '2026-08-17T15:00:00+02',
  p_description_hr      => E'„Summer That Changes Everything" — međunarodni ljetni kamp na Badiji.\n\n'
                           'Početak u srijedu 12. 8. u 18:00, završetak u ponedjeljak 17. 8. u 15:00.\n'
                           'Službeni jezici: hrvatski i engleski.\n\n'
                           'Rok prijave bio je 1. 8. 2026.\n\n'
                           '— — —\n'
                           'Napomena za ovaj prikaz: iznosi kotizacije su cjenik organizatora za '
                           'ovaj kamp. Akontacija od 110 € za rezervaciju smještaja plaća se '
                           'odvojeno i nije dio online kupnje.',
  p_organizer_name      => 'Katolička udruga Prilika za Susret',
  p_organizer_email     => 'prilikazasusret@gmail.com',
  p_organizer_web       => 'https://www.prilikazasusret.hr',
  p_visibility          => 'public',
  -- Cjenik: badija-2026/Config.gs — 5 dana × 110/120/130 €
  p_tiers               => '[
    {"title":"Super Early Bird",
     "description":"Prijava do 31. 5. 2026. — 5 dana × 110 €",
     "price_cents":55000,"imenska":true,
     "sale_end":"2026-05-31T23:59:59+02"},
    {"title":"Redovna kotizacija",
     "description":"Prijava do 25. 7. 2026. — 5 dana × 120 €",
     "price_cents":60000,"imenska":true,
     "sale_start":"2026-06-01T00:00:00+02","sale_end":"2026-07-25T23:59:59+02"},
    {"title":"Last Minute",
     "description":"Prijava nakon 25. 7. 2026., do roka 1. 8. 2026. — 5 dana × 130 €",
     "price_cents":65000,"imenska":true,
     "sale_start":"2026-07-26T00:00:00+02","sale_end":"2026-08-01T23:59:59+02"}
  ]'::jsonb
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Regionalni susret SINJ — 19. 9. 2026.
--
-- Jedini nadolazeći događaj koji je danas STVARNO kupiv: rana kotizacija
-- traje do 1. 9. 2026. Satnica 9:30–19:00 dolazi iz sinj-2026/Config.gs
-- (stranica ima samo datum).
--
-- Gotovinska uplata na dan susreta (60 €) nije online tier — naplaćuje je
-- organizator na ulazu.
-- ═══════════════════════════════════════════════════════════════════════════
select pinka_finance.create_event(
  p_id                  => '00000000-0000-4000-8000-000000000f03',
  p_account_id          => '00000000-0000-4000-8000-0000000000e2',
  p_title               => 'Regionalni susret Sinj 19. 9. 2026.',
  p_destination_address => '0x1111111111111111111111111111111111111111',
  p_venue_name          => 'Svetište Gospe Sinjske',
  p_venue_address       => 'Fratarski prolaz 4',
  p_venue_city          => 'Sinj',
  p_event_type          => 'susret',
  p_starts_at           => '2026-09-19T09:30:00+02',
  p_ends_at             => '2026-09-19T19:00:00+02',
  p_description_hr      => E'Jednodnevni regionalni susret u Bazilici i svetištu Čudotvorne '
                           'Gospe Sinjske, u subotu 19. 9. 2026. od 9:30 do 19:00.\n\n'
                           'Duhovni pratitelj: fra Antonio Mravak. Glavna gošća: Maja Jakšić.\n\n'
                           'Broj mjesta je ograničen. Prijave i uplata do 15. 9. 2026.\n\n'
                           '— — —\n'
                           'Napomena za ovaj prikaz: uz online kotizaciju organizator prima i '
                           'gotovinsku uplatu na dan susreta (60 €), koja se ne kupuje ovdje.',
  p_organizer_name      => 'Katolička udruga Prilika za Susret',
  p_organizer_email     => 'prilikazasusret@gmail.com',
  p_organizer_web       => 'https://www.prilikazasusret.hr',
  p_visibility          => 'public',
  -- Cjenik: sinj-2026/Config.gs
  p_tiers               => '[
    {"title":"Rana kotizacija",
     "description":"Uplata do 1. 9. 2026. Povrat moguć do 1. 9. i uz zamjensku prijavu.",
     "price_cents":5000,"imenska":true,
     "sale_end":"2026-09-01T23:59:59+02"},
    {"title":"Redovna kotizacija",
     "description":"Uplata nakon 1. 9. 2026., do roka 15. 9. 2026.",
     "price_cents":5500,"imenska":true,
     "sale_start":"2026-09-02T00:00:00+02","sale_end":"2026-09-15T23:59:59+02"}
  ]'::jsonb
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Susret osoba otvorenih za katolički brak Varaždin — 14. 11. 2026.
--
-- Stranica objavljuje SAMO datum i satnicu. Nema mjesta, nema cjenika, nema
-- roka, nema prijavnog linka — i nema fira konfiguracije. Zato:
--   * BEZ tierova → SPA prikazuje „Organizator još nije objavio cjenik."
--   * venue_name je obavezan u create_event, a mjesto nije objavljeno, pa
--     stoji doslovna praznina umjesto izmišljene dvorane. Grad je poznat
--     jer je u samom nazivu događaja.
-- ═══════════════════════════════════════════════════════════════════════════
select pinka_finance.create_event(
  p_id                  => '00000000-0000-4000-8000-000000000f04',
  p_account_id          => '00000000-0000-4000-8000-0000000000e2',
  p_title               => 'Susret osoba otvorenih za katolički brak, Varaždin 14. 11. 2026.',
  p_destination_address => '0x1111111111111111111111111111111111111111',
  p_venue_name          => 'Mjesto održavanja još nije objavljeno',
  p_venue_address       => null,
  p_venue_city          => 'Varaždin',
  p_event_type          => 'susret',
  p_starts_at           => '2026-11-14T09:00:00+01',   -- studeni → CET (+01)
  p_ends_at             => '2026-11-14T19:00:00+01',
  p_description_hr      => E'Jednodnevni susret u subotu 14. 11. 2026. od 9:00 do 19:00.\n\n'
                           'Organizator još nije objavio mjesto održavanja, cjenik ni rok prijave. '
                           'Za upite: prilikazasusret@gmail.com',
  p_organizer_name      => 'Katolička udruga Prilika za Susret',
  p_organizer_email     => 'prilikazasusret@gmail.com',
  p_organizer_web       => 'https://www.prilikazasusret.hr',
  p_visibility          => 'public',
  p_tiers               => '[]'::jsonb    -- cjenik nije objavljen — praznina ostaje vidljiva
);

-- ── Objava ─────────────────────────────────────────────────────────────────
update pinka_finance.campaigns set state = 'active'
 where id in ('00000000-0000-4000-8000-000000000f02',
              '00000000-0000-4000-8000-000000000f03',
              '00000000-0000-4000-8000-000000000f04');

-- ── Stripe rail organizatora (izmišljen acct_ — vozi samo protiv mock Stripea) ──
insert into pinka_finance.organizer_payment_rails
  (account_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, invoice_provider)
values ('00000000-0000-4000-8000-0000000000e2', 'acct_1PrilikaZaSusretOS', true, true, 'fira')
on conflict (account_id) do update
  set stripe_account_id = excluded.stripe_account_id,
      stripe_charges_enabled = true;

commit;

-- ── Provjera ───────────────────────────────────────────────────────────────
select c.slug, c.title, c.state,
       to_char(e.starts_at at time zone 'Europe/Zagreb', 'DD.MM.YYYY. HH24:MI') as pocetak,
       to_char(e.ends_at   at time zone 'Europe/Zagreb', 'DD.MM.YYYY. HH24:MI') as kraj,
       e.venue_name, e.venue_city
  from pinka_finance.campaigns c join pinka_finance.events e on e.campaign_id = c.id
 where c.id in ('00000000-0000-4000-8000-000000000f02',
                '00000000-0000-4000-8000-000000000f03',
                '00000000-0000-4000-8000-000000000f04')
 order by e.starts_at;

-- Očekivano na dan 8.8.2026.: Badija svi tierovi zatvoreni (rok bio 1.8.),
-- Sinj "Rana kotizacija" otvorena, Varaždin bez ijednog reda.
select c.title,
       t.title as tier,
       t.price_cents,
       t.inventory_total,
       case
         when t.sale_start is not null and now() < t.sale_start then 'još nije počela'
         when t.sale_end   is not null and now() > t.sale_end   then 'zatvorena'
         else 'OTVORENA'
       end as prodaja
  from pinka_finance.campaign_tiers t
  join pinka_finance.campaigns c on c.id = t.campaign_id
 where t.campaign_id in ('00000000-0000-4000-8000-000000000f02',
                         '00000000-0000-4000-8000-000000000f03',
                         '00000000-0000-4000-8000-000000000f04')
 order by c.title, t.sort;
