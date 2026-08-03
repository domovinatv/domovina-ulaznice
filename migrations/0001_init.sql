-- domovina-ulaznice — D1 (operativni podaci Workera)
--
-- ⚠️ GRANICA (docs/02-arhitektura.md §1, docs/05-podatkovni-model.md §3):
-- ulaznice, narudžbe i inventory žive ISKLJUČIVO u pinka_finance (domovina-api).
-- Ovdje je samo ono što je operativni trag Workera i nema smisla u ticketing
-- jezgri. Ako se ikad pojavi tablica `tickets` ili `orders` u ovoj datoteci,
-- granica je prekršena i imamo dva izvora istine o istoj ulaznici.

-- ----- webhook_events: idempotencija + trag svakog Stripe eventa --------------
-- PK insert zaključava event (duplikat → 200 bez obrade). Ako obrada padne,
-- zaključavanje se BRIŠE i vraćamo 500 da Stripe ponovi — obrazac iz
-- rodjendaonice/worker/webhooks.ts (tamo je to bio stvarni bug).
create table if not exists webhook_events (
  id text primary key,                  -- evt_…
  type text not null,
  stripe_account text,                  -- acct_… (Connect endpoint šalje event.account)
  order_id text,                        -- UUID narudžbe iz metadata (kad ga ima)
  payment_intent text,
  outcome text,                         -- status iz events-stripe-confirm ili naša oznaka
  raw text,                             -- sirovi payload (skraćen) za forenziku
  created_at text not null default (datetime('now'))
);
create index if not exists ix_webhook_events_order on webhook_events(order_id);
create index if not exists ix_webhook_events_pi on webhook_events(payment_intent);
create index if not exists ix_webhook_events_created on webhook_events(created_at desc);

-- ----- sent_emails: je li kupac stvarno dobio ulaznice ------------------------
-- "Nisam dobio mail" mora biti istraživo: svaki pokušaj ima vidljiv ishod
-- (obrazac rodjendaonice/worker/email.ts pravilo 1).
create table if not exists sent_emails (
  id integer primary key autoincrement,
  order_id text,
  recipient text not null,
  template text not null,               -- ulaznice | isprika_refund | ponovna_dostava
  subject text not null,
  status text not null,                 -- sent | failed | skipped
  provider_id text,
  error text,
  created_at text not null default (datetime('now'))
);
create index if not exists ix_sent_emails_order on sent_emails(order_id, created_at desc);

-- ----- payment_log: novac koji je Worker dirnuo ------------------------------
-- Refundi (expired_sold_out, duplicate_payment) i njihov ishod. Ovo je jedini
-- zapis o tome da je platforma inicirala povrat na tuđem Stripe računu.
create table if not exists payment_log (
  id integer primary key autoincrement,
  order_id text,
  stripe_account text,
  payment_intent text,
  op text not null,                     -- refund.expired_sold_out | refund.duplicate | checkout.created
  amount_cents integer,
  result text not null,                 -- ok | error
  detail text,
  created_at text not null default (datetime('now'))
);
create index if not exists ix_payment_log_order on payment_log(order_id, created_at desc);

-- ----- event_pages: brand prodajne stranice ----------------------------------
-- Prezentacija, ne ticketing. Ključ je campaign_id iz pinka_finance, ali ovdje
-- se NE drži nijedan podatak o prodaji.
create table if not exists event_pages (
  campaign_id text primary key,         -- = pinka_finance.campaigns.id
  slug text unique,
  accent_color text,
  logo_url text,
  hero_url text,
  intro_html text,
  terms_url text,
  support_email text,
  updated_at text not null default (datetime('now'))
);

-- ----- pending_deliveries: narudžbe kojima e-mail nije uspio -----------------
-- Cron ih pokušava ponovno; QR tokeni su jednokratni pa se OVDJE NE spremaju —
-- sprema se samo činjenica da dostava duguje (docs/handoffs/u1 §Gotcha 3).
create table if not exists pending_deliveries (
  order_id text primary key,
  recipient text,
  attempts integer not null default 0,
  last_error text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);
