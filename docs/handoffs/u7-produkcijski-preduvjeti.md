# U7 — Produkcijski preduvjeti (od staginga do prve naplaćene ulaznice)

> Handoff prompt za praznu Claude Code sesiju. Repo: `domovina-ulaznice`
> (+ `domovina-api`). Ovisi o [U2](u2-javna-prodaja-web.md).
>
> _EN abstract: everything between a working staging deployment and one real
> paid ticket — secrets per environment, the core migration that lets a
> Stripe-only organizer publish an event, e-mail domain verification, and
> flipping production out of announcement mode._

## Cilj

Kupac s pravom karticom kupi ulaznicu za stvarni događaj i dobije QR e-mailom —
na produkcijskoj domeni, s novcem na računu organizatora.

## Kontekst i izvori

- `docs/2026-09-03-plan-do-produkcije.md` — **pročitaj cijeli prije bilo čega**;
  §3 je popis blokera, §7 su pitanja na koja odgovor daje organizator.
- `docs/2026-08-08-deploy-okruzenja-i-stripe.md` §4 — zamke koje su već jednom
  pojele vrijeme (edge cache, `routes` gasi workers.dev, prolazni 1042).
- `docs/2026-09-03-implementacija-p0-p1.md` — što je u ovom prolazu napravljeno
  i što je namjerno ostavljeno.
- `worker/env.ts` — potpun popis varijabli i tajni s objašnjenjem svake.

## Preduvjeti (vlasnik, ne agent)

| Preduvjet | Blokira | Status |
| --- | --- | --- |
| Odluka **Standard vs Express** Connect | live onboarding | ⬜ |
| Odluka **pravni subjekt platforme** (ITalk ili Domovina) | live onboarding | ⬜ |
| Stripe **live** onboarding organizatora | pravi novac | ⬜ |
| Resend: **verificirana domena** pošiljatelja (SPF/DKIM/DMARC) | dostava ulaznica | ⬜ |
| Odgovori na ⚠️ ODLUKE 1–2 iz `docs/04` §6 | fiskalizacija | ⬜ |
| Potvrda pilot događaja, cijena i kapaciteta s organizatorom | objava | ⬜ |

## Opseg

**IN:**

1. **Migracija u jezgri je već napisana** (`20260903120000_events_publish_rail_gate.sql`)
   — treba je pustiti na produkciju: `./scripts/db-migrate.sh` u `domovina-api`.
   Smoke: organizator sa `stripe_charges_enabled=true` i `destination_address`
   `0x0…0` mora moći `publish_event`; onaj bez ijednog raila mora dobiti
   `event_no_working_rail`.
2. **Tajne po okruženju.** Na stagingu nedostaju tri; provjera je uvijek
   `GET /api/zdravlje` (mora dati `stripe:true, webhook:true, mail:true`).
   ⚠️ Bez `--env staging` tajna tiho ode u produkcijski Worker koji ne prodaje.
3. **Stripe Connect webhook endpoint** → `/webhook/stripe`. Mora biti **Connect**
   endpoint (event nosi `account`), inače povrati na tuđem računu ne rade.
4. **Unos organizatora u jezgru**: org account, `organizer_allowlist`,
   `upsert_organizer_record` (DAC7), `organizer_payment_rails` s
   `invoice_provider`. Događaj i tieri s **potvrđenim** cijenama.
5. **Produkcija u prodajni način** — u `wrangler.jsonc` maknuti `NAJAVA`, vratiti
   `assets`/`d1_databases`/`kv_namespaces`/`triggers` na vrh (vrijednosti su u
   `env.staging`; produkcijski D1 je `2c01251e-133a-42db-9d1e-70cfe47db223`),
   pa `npm run db:remote` i sve tajne bez `--env`.
6. **Purge cachea po hostu** nakon deploya — edge zna servirati staru verziju
   iako je deploy ispravan.

**OUT:** dashboard za uređivanje događaja (U3), fiskalizacija kroz
`domovina-fiskal` (U5), airKUNA (U6).

## Sigurnost

1. `NAJAVA` se miče **tek kad `/api/zdravlje` na produkciji vrati sve `true`** —
   javna domena ne smije izgledati kao trgovina prije nego to postane.
2. Stari CLI profil `domovina-ulaznice` drži **live ključ od italk.hr** — obrisati
   prije prvog live rada, inače jedna kriva zastavica gađa tuđu produkciju.
3. Live ključ i sandbox ključ nikad u istom okruženju.

## Kriteriji prihvaćanja

```
1. Kartica 4242… na stagingu → e-mail s 2 QR privitka, D1 bez ijedne ulaznice
2. Isti webhook dvaput → i dalje 2 ulaznice, jedan e-mail, jedan račun
3. publish_event za Stripe-only organizatora prolazi (nakon migracije)
4. /api/dogadjaji na stagingu vraća pilot događaj s ispravnim cijenama
5. /api/zdravlje: stripe, webhook, mail, prijava, alarm — svi true
6. Produkcija nakon prebacivanja servira SPA, ne najavu, i webhook prima evente
```

## Zapisnik izvršenja

- Status: ⬜
- Commitovi:
- Odluke:
- Gotchai:
