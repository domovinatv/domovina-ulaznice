-- Stvarni događaj: Međunarodni susret osoba otvorenih za katolički brak,
-- Zagreb, 12.–14. 2. 2027.
--
-- Izvor podataka (dohvaćeno 2026-08-04):
--   https://www.prilikazasusret.hr/dogadjaji/medunarodni-susret-osoba-otvorenih-za-katolicki-brak-zagreb/
--
-- Sa stranice je preuzeto DOSLOVNO: naziv, datum, mjesto (Aula Magna,
-- Hrvatsko katoličko sveučilište, Ilica 244, Zagreb), organizator, kontakt
-- e-mail i očekivani broj sudionika (>400).
--
-- Na stranici NEMA: satnice, cjenika, roka prijave. Zato:
--   * starts_at je 00:00 → UI to tumači kao "satnica nije objavljena" i
--     prikazuje samo raspon datuma (v. src/lib/api.ts::terminHr),
--   * iznosi kotizacija preuzeti su s vikend susreta Šibenik 2026. ISTOG
--     organizatora (fira-forms-connector/google-apps-script/events/sibenik-2026:
--     100 € s noćenjem / 70 € bez noćenja) i to je izrijekom napisano u opisu
--     koji se prikazuje na stranici. Ništa nije izmišljeno.
--
-- ⚠️ Ovo je LOKALNI demo seed. Ne pušta se na javni URL dok organizator ne
-- potvrdi cjenik i satnicu.
\set ON_ERROR_STOP on
begin;

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

select pinka_finance.create_event(
  p_id                  => '00000000-0000-4000-8000-000000000f01',
  p_account_id          => '00000000-0000-4000-8000-0000000000e2',
  p_title               => 'Međunarodni susret osoba otvorenih za katolički brak',
  p_destination_address => '0x1111111111111111111111111111111111111111',
  p_venue_name          => 'Aula Magna, Hrvatsko katoličko sveučilište',
  p_venue_address       => 'Ilica 244',
  p_venue_city          => 'Zagreb',
  p_event_type          => 'konferencija',
  -- datum je objavljen, satnica nije → 00:00 (v. konvenciju gore)
  p_starts_at           => '2027-02-12T00:00:00+01',
  p_ends_at             => '2027-02-14T23:59:00+01',
  p_description_hr      => E'Međunarodni susret katolika otvorenih za brak.\n\n'
                           'Očekuje se više od 400 sudionika iz Hrvatske, Bosne i Hercegovine, '
                           'Europske unije i drugih zemalja svijeta.\n\n'
                           'Organizira Katolička udruga „Prilika za Susret" iz Osijeka, u suradnji '
                           's platformama kathTreff.org i katSus.org.\n\n'
                           '— — —\n'
                           'Napomena za ovaj prikaz: organizator još nije objavio satnicu ni službeni '
                           'cjenik. Prikazani iznosi kotizacije preuzeti su s vikend susreta Šibenik 2026. '
                           'istog organizatora i služe isključivo za demonstraciju sustava prodaje.',
  p_organizer_name      => 'Katolička udruga Prilika za Susret',
  p_organizer_email     => 'catholicsinglesummit@gmail.com',
  p_organizer_web       => 'https://www.prilikazasusret.hr',
  p_visibility          => 'public',
  -- Iznosi: Šibenik 2026 (isti organizator) — Opcija 1: 100 € (program +
  -- noćenje + obroci), Opcija 2: 70 € (bez noćenja). Kapacitet 400 = objavljeni
  -- očekivani broj sudionika.
  p_tiers               => '[
    {"title":"Kotizacija — s noćenjem",
     "description":"Cjeloviti program (12.–14. 2.), noćenje i obroci",
     "price_cents":10000,"inventory_total":250,"imenska":true},
    {"title":"Kotizacija — bez noćenja",
     "description":"Cjeloviti program i obroci, bez smještaja",
     "price_cents":7000,"inventory_total":150,"imenska":true}
  ]'::jsonb
);

update pinka_finance.campaigns set state = 'active'
 where id = '00000000-0000-4000-8000-000000000f01';

insert into pinka_finance.organizer_payment_rails
  (account_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, invoice_provider)
values ('00000000-0000-4000-8000-0000000000e2', 'acct_1PrilikaZaSusretOS', true, true, 'fira')
on conflict (account_id) do update
  set stripe_account_id = excluded.stripe_account_id,
      stripe_charges_enabled = true;

commit;

select c.slug, c.title, c.state,
       to_char(e.starts_at at time zone 'Europe/Zagreb', 'DD.MM.YYYY. HH24:MI') as pocetak,
       to_char(e.ends_at   at time zone 'Europe/Zagreb', 'DD.MM.YYYY. HH24:MI') as kraj,
       e.venue_name, e.venue_address, e.venue_city
  from pinka_finance.campaigns c join pinka_finance.events e on e.campaign_id = c.id
 where c.id = '00000000-0000-4000-8000-000000000f01';

select title, price_cents, inventory_total, imenska
  from pinka_finance.campaign_tiers
 where campaign_id = '00000000-0000-4000-8000-000000000f01' order by sort;

select (date '2027-02-12' - current_date) as dana_do_dogadjaja;
