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

- **Status: ✅ implementirano i verificirano na lokalnom stacku** (2026-08-03).
  Prod deploy **čeka vlasnika** (SSH + tajna) — v. §"Preostalo ručno".
- **Commitovi:**
  - `domovina-api@4f7703f` — `feat(events): U1 Stripe rail — offchain naplata narudžbi ulaznica`
  - `domovina-api@2ddac86` — `feat(events): refund_ticket_order` (dodano tijekom U2:
    Worker mora moći poništiti ulaznice na povrat, a `void_ticket` traži
    `auth.uid()` koji service ključ nema; detalji u [U2 Zapisniku](u2-javna-prodaja-web.md) §2.4)
  - `domovina-ulaznice` — ovaj Zapisnik.

### 1. Ugovor prema U2 (ovo je sve što Worker treba)

**Migracija:** `supabase/migrations/20260803120000_events_stripe_rail.sql`

**Nove edge funkcije** (`$FN = https://api.domovina.ai/functions/v1`, lokalno
`http://127.0.0.1:55321/functions/v1`), obje `POST`, obje `verify_jwt=false`
**+ HMAC**:

| Funkcija                       | Ulaz                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| `$FN/events-stripe-intent`     | `{order_id}`                                                 |
| `$FN/events-stripe-confirm`    | `{order_id, external_ref, amount_cents, payer_email?}`       |

**HMAC (identičan za obje funkcije):**

```
header:  x-ulaznice-signature: sha256=<hex(hmac_sha256(EVENTS_STRIPE_CONFIRM_SECRET, RAW_BODY))>
```

- potpisuje se **sirovo tijelo zahtjeva**, byte-for-byte ono što se šalje
  (ne re-serijalizirani JSON — `JSON.stringify` jednom, pa isti string potpiši i pošalji),
- usporedba je konstantnog vremena; prefiks `sha256=` je **obavezan**,
- bez tajne na serveru → **503**; krivi/nedostajući potpis → **401 i baza se ne dira**,
- replay se namjerno ne brani timestampom — ponovljeni zahtjev je no-op jer je
  idempotencija u bazi.

Worker strana (Cloudflare, Web Crypto):

```ts
const raw = JSON.stringify(payload);
const key = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(env.EVENTS_STRIPE_CONFIRM_SECRET),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
);
const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-ulaznice-signature": `sha256=${hex}` },
  body: raw,   // ← isti string koji je potpisan
});
```

**`events-stripe-intent` → 200:**

```jsonc
{
  "order_id": "…", "amount_cents": 29800, "currency": "eur", "quantity": 2,
  "expires_at": "2026-08-03T08:19:55.983206+00:00", "buyer_email": null,
  "tier":  { "id": "…", "title": "Redovna", "price_cents": 14900, "imenska": true },
  "event": { "campaign_id": "…", "title": "…", "slug": "…", "starts_at": "…",
             "ends_at": "…", "timezone": "Europe/Zagreb",
             "venue_name": "…", "venue_city": "Zagreb" },
  "stripe_account_id": "acct_…",      // ← JEDINI odgovor u sustavu koji ga vraća
  "charges_enabled": true,
  "invoice_provider": "fira"          // organizator|fira|domovina_fiskal (za U5)
}
```

Greške (HTTP 400, `{error}`): `order_not_pending` (+`state`), `order_expired`,
`organizer_not_connected`, `organizer_charges_disabled`, `invalid_order_id`,
`bad_json`; 404 `order_not_found`; 401 `bad_signature`/`missing_signature`;
503 `secret_not_configured`.

**`events-stripe-confirm` → 200** (uvijek 200 kad je HMAC dobar i RPC prošao;
ishod je u `status`):

```jsonc
{
  "ok": true, "status": "paid", "order_id": "…",
  "serials": ["SUS-000004", "SUS-000005"],
  "tickets": [{ "serial": "SUS-000004", "holder_name": "Web Kupac",
                "holder_email": "web@example.com", "state": "issued",
                "qr_token": "<64-hex>" }]
}
```

| `status`              | Značenje                                             | Što Worker MORA napraviti                         |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| `paid`                | narudžba kreditirana, ulaznice izdane                | poslati e-mail s ulaznicama                        |
| `already_paid`        | ponovljeni webhook / retry                           | ništa (ali v. gotcha 3 o tokenima)                 |
| `amount_insufficient` | uplata < iznosa narudžbe (+`expected/received_cents`)| refund + alarm                                     |
| `expired_sold_out`    | rezervacija istekla, tier u međuvremenu pun          | **pun refund + e-mail isprike** (doc 03 §5)        |
| `tx_already_credited` | isti `external_ref` već kreditirao drugu narudžbu    | ne duplicirati; red za ručno sparivanje            |
| `duplicate_payment`   | druga uplata na već plaćenu narudžbu (+`credited_ref`)| refund **te** uplate                              |

HTTP 400 `{error}` = programska greška, ne poslovni ishod: `invalid_order_id`,
`invalid_external_ref`, `invalid_amount_cents`, `invalid_payer_email`,
`order_not_found`, `not_a_ticket_order`, `order_not_payable`, `invalid_rail`.

**RPC:** `pinka_finance.confirm_ticket_order_offchain(p_order_id uuid, p_rail text,
p_external_ref text, p_amount_cents bigint, p_payer_email text default null)` —
`security definer`, execute **samo `service_role`**. Worker ga ne zove izravno.

**Nova tablica:** `pinka_finance.organizer_payment_rails(account_id pk,
stripe_account_id unique, stripe_charges_enabled, stripe_payouts_enabled,
invoice_provider, invoice_config jsonb, created_at, updated_at)`.
Piše **samo service_role** — Worker je upisuje izravno kroz PostgREST
(`sb.schema("pinka_finance").from("organizer_payment_rails").upsert(...)`) iz
`account.updated` webhooka; **nema RPC-a za to i ne treba ga.** Org admin ju
smije čitati, ne i pisati; anon nema ni `select` grant.

**Nove kolone na `contributions`:** `payment_rail` (`'onchain'` default |
`'stripe'`), `external_payment_ref` (`pi_…`), `buyer_email`. Idempotencija:
`unique (payment_rail, external_payment_ref) where external_payment_ref is not null`.

### 2. Odluke i odstupanja od plana

1. **`events-stripe-intent` je TAKOĐER HMAC-zaštićena** (plan je tražio HMAC samo
   na `confirm`). Razlog: `order_id` je bearer capability koju ima svaki kupac —
   bez HMAC-a bi svatko tko je nešto naručio mogao izvući `acct_…` organizatora.
   Cijena za Workera je nula (isti potpis, ista tajna, isti header).
2. **`duplicate_payment` umjesto exceptiona.** Onchain blizanac na drugu uplatu
   već plaćene narudžbe radi `raise exception 'order_already_paid'`. Kod Stripea
   to znači stvarno dvaput naplaćenog kupca (dvije checkout sesije iste narudžbe),
   pa exception ne dolazi u obzir — rollbackao bi upravo onaj audit zapis na
   temelju kojeg Worker radi refund. Vraća se status + `ticket_order.duplicate_payment`.
   **Onchain funkcija nije dirana.**
3. **QR tokeni se povlače kroz postojeći `deliver_ticket_orders`**, ne kroz novi
   put u RPC-u. Time ostaje netaknut invariant "u bazi trajno samo sha256 hash".
   Poziva se i na `already_paid` — v. gotcha 3.
4. **Nova sekcija u curl scenariju je §11, ne §10** — §10 je već zauzet (feed
   filtriranje, E4).
5. **`holder_email` ostaje holderov.** Prva verzija je fallbackala na e-mail
   kupca; ispravljeno — e-mail kupca živi na `contributions.buyer_email` i ne
   upisuje se tuđoj ulaznici (GDPR higijena, holder polja su PII).
6. **`payment_rail` check dopušta samo `('onchain','stripe')`.** U3 (CSV uvoz
   postojećih FIRA/IBAN prijava) i U6 (airKUNA) trebaju jednolinijsku
   idempotentnu dopunu constrainta + `p_rail` liste u RPC-u.
7. **Ništa Stripe-specifično nije ušlo u backend** — ni SDK, ni ključ, ni pojam
   "checkout". Backend zna samo `(rail, external_ref, amount)`.

### 3. Gotchai (pročitati prije U2)

1. **Potpisuje se sirovo tijelo.** Ako Worker `JSON.stringify`-a dvaput (jednom
   za potpis, jednom za `body`), redoslijed ključeva je isti pa će raditi — ali
   ne oslanjaj se na to: stringify jednom u varijablu i pošalji **tu** varijablu.
2. **`amount_cents` mora biti cijeli broj centa.** Stripe daje `amount_total` u
   najmanjoj jedinici — proslijedi ga takvog, bez dijeljenja s 100.
3. **QR tokeni su jednokratni i to je otvoreno pitanje za U2.** `paid` i
   `already_paid` odgovor nose `qr_token` samo dok plaintext postoji; poslije je
   `null` zauvijek. To pokriva crash-recovery (retry webhooka poslije uspješnog
   confirma ipak isporuči tokene), ali **ne pokriva "Moje ulaznice" na webu**:
   kupac koji drugi put otvori link iz e-maila više ne može dobiti QR.
   Wallet to rješava lokalnim MMKV zapisom; web nema ekvivalent. **U2 mora
   odlučiti** između: (a) Worker renderira QR u e-mail/PDF i to je jedina kopija,
   (b) rotacija tokena pri svakoj autoriziranoj re-dostavi (stari QR prestaje
   vrijediti), (c) novi `deliver_*` RPC koji za `stripe` narudžbe zadržava
   plaintext pod bearer capability. Preporuka: **(a) za MVP** (e-mail je dostava,
   kao kod avionske karte), (b) ako se pokaže da ljudi gube mail.
4. **Rezervacija 20 min vs Stripe checkout min. 30 min** je poznat prozor, ne bug.
   Između 20. i 30. minute uplata stiže na isteklu rezervaciju: RPC pokuša
   re-rezervirati, a ako ne stane → `expired_sold_out` → **Worker mora refundirati**.
   Bez tog refunda kupac ostaje bez ulaznice i bez novca.
5. **`create_ticket_order` nema rate limit za web kupca.** Postojeći limit
   (10/h) veže se na `contributor_account_id` ili `declared_payer_address`; web
   gost nema ni jedno pa je uvjet uvijek prazan. **Rate limiting narudžbi je
   obaveza Workera** (KV brojač po IP-u, obrazac `rodjendaonice`).
6. **`buyer_email` se puni tek na confirm** (`payer_email` iz Stripea).
   `events-order` ga ne prima — ako U2 treba e-mail prije plaćanja (npr. za
   "vrati mi narudžbu"), Worker ga drži kod sebe do confirma.
7. **Stripe-only organizator trenutačno NE MOŽE objaviti event.**
   `publish_event` i trigger `campaigns_write_guard` traže pravi Safe
   (`destination_address` ≠ null i ≠ `0x0…0`) za `state='active'` —
   nasljeđe onchain raila. Udruga bez walleta zapinje tu.
   U1 to **namjerno nije dirao** (izvan opsega, mijenja postojeće ponašanje).
   Za smoke/testove aktivacija ide kroz psql/service_role (trigger preskače
   ne-`authenticated` pozivatelje), a **U3 (organizator dashboard) mora donijeti
   odluku**: preporuka je otpustiti gate na "event mora imati **barem jedan
   radni rail**" — Safe **ili** `organizer_payment_rails.stripe_charges_enabled`.
8. **Javni feed još ne zna za Stripe.** `events-feed` nije diran, pa nema
   `stripe_connected` izvedenog booleana. U2 landing stranica dobiva kupovnost
   iz `events-stripe-intent` (Worker), ili U2/U3 dodaje boolean u feed.
   `acct_…` u feed **ne smije** nikad.

### 4. Verifikacija (što je stvarno prošlo)

Lokalni stack (`supabase db reset` → sve migracije od nule, uklj. novu).
Kriteriji iz ovog handoffa, svi ✅ — skripte i ispisi u §11 curl scenarija:

| # | Kriterij                                            | Rezultat                                                        |
| - | ---------------------------------------------------- | ---------------------------------------------------------------- |
| 1 | order qty 2 imenska                                  | `pending`, `inventory_claimed` 0→2                               |
| 2 | `events-stripe-intent`                               | `amount_cents 29800`, `acct_1TestOrganizator`, `charges_enabled` |
| 3 | `events-stripe-confirm` valjan HMAC                  | `paid`, 2 seriala (`SUS-000004/5`), 2 QR tokena                   |
| 4 | isti confirm ponovno                                 | `already_paid`, i dalje 2 ulaznice, `qr_token: null`              |
| 5 | krivi HMAC / bez headera                             | 401 `bad_signature` / `missing_signature`; narudžba i dalje `pending`, 0 ulaznica |
| 6 | premali iznos                                        | `amount_insufficient` + audit `ticket_order.underpaid`            |
| 7 | isti `external_ref` na drugoj narudžbi               | `tx_already_credited` + audit `ticket_order.match_conflict`       |
| 8 | istekla rezervacija + rasprodan tier                 | `expired_sold_out` + audit, 0 ulaznica                            |
| 8b| druga uplata na plaćenu narudžbu                     | `duplicate_payment` + audit, i dalje 2 ulaznice                   |
| 9 | onchain `confirm_ticket_order`                       | `paid` → `already_paid`, `payment_rail='onchain'`, `ref=null`     |

Dodatno provjereno: drugi run migracije = no-op (samo `NOTICE … skipping`);
unique index puca na direktan pokušaj dupliranja `(stripe, pi_…)`;
`invalid_rail`/`invalid_external_ref` validacija; RLS
(`anon` → permission denied, ne-član → 0 redaka, org admin čita ali ne piše);
`authenticated` ne smije izvršiti `confirm_ticket_order_offchain`;
`deno check` čist na obje funkcije.

**Okolinski gotcha:** docker registry je u ovoj sesiji bio nedostupan, pa slike
`edge-runtime` i `imgproxy` nisu bile dohvatljive. Stack je dignut s
`supabase start -x edge-runtime,imgproxy,…`, a obje funkcije su vožene direktno
Denom (`Deno.serve` wrapper na portovima 8801/8802) protiv istog Konga/DB-a —
isti kod, isti klijent, samo drugi runtime. Kad `edge-runtime` bude dostupan,
scenarij §11 se vrti nepromijenjen protiv `$FN/…`.

### 5. Preostalo ručno (vlasnik) — blokira prod, ne blokira U2

| Preduvjet                                              | Zašto                                    | Status |
| ------------------------------------------------------- | ---------------------------------------- | ------ |
| SSH pristup produkciji (Coolify)                        | `db-migrate.sh` + `deploy-functions.sh`  | ⬜     |
| `EVENTS_STRIPE_CONFIRM_SECRET` (`openssl rand -hex 32`) | **ista** vrijednost u Coolify env-u edge-runtimea i u `wrangler secret put` | ⬜ |
| Stripe TEST ključevi + Connect uključen                 | U2 Worker (backend ih ne treba)          | ⬜     |

Redoslijed deploya je bitan: **tajna prije funkcija** (bez nje su 503), pa
migracija, pa funkcije. Smoke nakon deploya: `POST .../events-stripe-confirm`
bez potpisa **mora** vratiti 401 — ako vrati 503, tajna nije stigla; ako vrati
200, nešto je katastrofalno krivo.
