\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'prijave@prilikazasusret.hr', crypt('demo1234', gen_salt('bf')),
        now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

insert into public.accounts (id, primary_owner_user_id, is_personal_account, slug, name)
values ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d1',
        false, 'prilika-za-susret', 'Udruga Prilika za Susret')
on conflict (id) do nothing;

insert into public.accounts_memberships (account_id, user_id, account_role)
values ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d1', 'admin')
on conflict do nothing;

select pinka_finance.create_event(
  p_id                  => '00000000-0000-4000-8000-000000000d01',
  p_account_id          => '00000000-0000-4000-8000-0000000000d2',
  p_title               => 'Prilika za Susret 2027',
  p_destination_address => '0x1111111111111111111111111111111111111111',
  p_venue_name          => 'Dom sportova',
  p_venue_address       => 'Trg Krešimira Ćosića 11',
  p_venue_city          => 'Zagreb',
  p_event_type          => 'konferencija',
  p_starts_at           => '2027-04-16T09:00:00+02',
  p_ends_at             => '2027-04-18T18:00:00+02',
  p_description_hr      => E'Tri dana susreta, predavanja i radionica.\n\nUlaznica vrijedi za sva tri dana i uključuje ručak. Ulaznice glase na ime — na ulazu se provjerava QR kod.',
  p_organizer_name      => 'Udruga Prilika za Susret',
  p_organizer_email     => 'prijave@prilikazasusret.hr',
  p_visibility          => 'public',
  p_tiers               => '[
    {"title":"Redovna ulaznica","description":"Sva tri dana, uključen ručak","price_cents":6000,"inventory_total":120,"imenska":true},
    {"title":"Studentska","description":"Uz predočenje indeksa na ulazu","price_cents":3500,"inventory_total":40,"imenska":true},
    {"title":"Rani upis","description":"Prodaja završila 1. veljače","price_cents":5000,"inventory_total":50,"imenska":true,
     "sale_end":"2027-02-01T00:00:00Z"}
  ]'::jsonb
);

update pinka_finance.campaigns set state = 'active'
 where id = '00000000-0000-4000-8000-000000000d01';

-- rani upis je "rasprodan" da se vidi i to stanje na stranici
update pinka_finance.campaign_tiers
   set inventory_claimed = inventory_total
 where campaign_id = '00000000-0000-4000-8000-000000000d01' and title = 'Rani upis';

-- studentska pri kraju (prikaz "još N")
update pinka_finance.campaign_tiers
   set inventory_claimed = 36
 where campaign_id = '00000000-0000-4000-8000-000000000d01' and title = 'Studentska';

insert into pinka_finance.organizer_payment_rails
  (account_id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, invoice_provider)
values ('00000000-0000-4000-8000-0000000000d2', 'acct_1PrilikaZaSusret', true, true, 'fira')
on conflict (account_id) do update
  set stripe_account_id = excluded.stripe_account_id,
      stripe_charges_enabled = true;

commit;

select t.id, t.title, t.price_cents, t.inventory_total, t.inventory_claimed, t.imenska
  from pinka_finance.campaign_tiers t
 where t.campaign_id = '00000000-0000-4000-8000-000000000d01' order by t.sort;
