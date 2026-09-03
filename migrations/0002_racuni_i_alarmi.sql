-- domovina-ulaznice — D1 migracija 2: računi i alarmi
--
-- ⚠️ ISTA GRANICA KAO 0001 (docs/02-arhitektura.md §1): ovdje NE ulaze ulaznice,
-- narudžbe ni inventory. Obje tablice su operativni trag Workera:
--   * `invoices` — je li za naplaćenu narudžbu izdan račun i kroz koji provider,
--   * `alarms`   — kad je koji alarm zadnji put poslan (da cron ne šalje isti
--                  problem svakih 15 minuta).
--
-- Idempotentno: `create table if not exists`, drugi run je no-op.

-- ----- invoices: jedan račun po narudžbi i provideru --------------------------
-- Idempotencija ide na UNIQUE INDEX, ne u aplikacijski kod (pravilo 3 iz
-- CLAUDE.md). U fiskalizaciji je dupli račun skuplja greška od duple ulaznice:
-- ulaznica se poništi, a broj računa u nizu ostaje potrošen zauvijek.
--
-- Redak nastaje PRIJE poziva prema provideru (status 'u_tijeku'), pa dva
-- istovremena webhooka ne mogu oba krenuti u izdavanje — drugi puca na unique
-- indexu i odustaje.
create table if not exists invoices (
  id integer primary key autoincrement,
  order_id text not null,
  provider text not null,               -- organizator | fira | domovina_fiskal
  status text not null,                 -- u_tijeku | izdan | preskocen | neuspjeh | storniran
  provider_ref text,                    -- broj/ID računa kod providera
  amount_cents integer,
  attempts integer not null default 1,
  error text,
  payload text,                         -- skraćeni odgovor providera, za forenziku
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now'))
);
create unique index if not exists ux_invoices_order_provider on invoices(order_id, provider);
create index if not exists ix_invoices_status on invoices(status, created_at desc);

-- ----- alarms: prigušivanje ponavljajućih alarma ------------------------------
-- Rekoncilijacija se vrti svakih 15 minuta. Bez prigušivanja bi jedan zaglavljen
-- problem poslao 96 identičnih e-mailova dnevno i alarmi bi prestali značiti
-- išta. Ključ je stabilan opis problema, ne trenutak.
create table if not exists alarms (
  kljuc text primary key,               -- npr. 'reconcile.problemi' | 'dostava.zaostatak'
  zadnji_put text not null,             -- ISO vrijeme zadnjeg POSLANOG alarma
  broj_potisnutih integer not null default 0,
  zadnji_sadrzaj text,
  created_at text not null default (datetime('now'))
);
