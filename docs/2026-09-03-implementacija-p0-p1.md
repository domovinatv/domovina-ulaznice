# Što je napravljeno 3. 9. 2026. — P0/P1 iz plana

> Datum: 2026-09-03 · Prethodi: [plan do produkcije](2026-09-03-plan-do-produkcije.md).
> Ovaj dokument je **ugovor prema sljedećoj sesiji**: što je gotovo, što je
> namjerno ostavljeno, i gdje su odluke koje se mogu opravdano donijeti drukčije.
>
> Svako mjesto u kodu koje traži neovisnu prosudbu nosi komentar `REVIEW(fable)`.
> Popis je na dnu ovog dokumenta.

## 1. Napravljeno

### 1.1 Jezgra (`domovina-api`) — dvije migracije

| Migracija | Što rješava |
| --- | --- |
| `20260903120000_events_publish_rail_gate.sql` | Objava događaja traži **barem jedan radni rail** (Safe ILI Stripe), ne više obavezno Safe. Ovo je razlog zašto je katalog bio prazan. |
| `20260903120100_events_rotate_ticket_tokens.sql` | `rotate_ticket_tokens` — novi QR za kupca koji je izgubio e-mail; stari prestaje vrijediti. |

Donacijske kampanje (`type <> 'tickets'`) i dalje traže pravi Safe — gate je
otpušten, ne ukinut. Nova funkcija `event_rail_ready` je jedini izvor istine i
zovu je i trigger i RPC.

### 1.2 Worker

| Datoteka | Što je novo |
| --- | --- |
| `worker/racun.ts`, `worker/racun-fira.ts` | Račun kupcu: `InvoiceProvider` s `organizator` (zadano, ne radi ništa) i `fira`. Idempotencija na unique indexu `(order_id, provider)`. |
| `worker/alarm.ts` | Alarmi s prigušivanjem — problem koji nitko ne gleda nije prijavljen. |
| `worker/index.ts` | `/api/organizator/prijava`, `/pregled`, `/holderi.csv`, `/api/skener/sken`; ponovna dostava sada rotira tokene. |
| `worker/api.ts` | Pozivi **u ime korisnika** (GoTrue JWT) — RLS ostaje autoritet. |
| `worker/reconcile.ts` | Četvrta provjera (neizdani računi) + alarm. |
| `migrations/0002_racuni_i_alarmi.sql` | Tablice `invoices` i `alarms`. |

### 1.3 SPA

`/skener` (check-in s kamerom), `/organizator` (pregled prodaje + CSV izvoz),
`/uvjeti` i `/privatnost` (**nacrti**, s vidljivim prazninama), prijava
zajednička za skener i pregled.

### 1.4 Ostalo

`LICENSE` (MIT) — repo je javan, a bez licence „public" nije open source.

**Testovi: 89/89** (bilo 56). Novi: `worker-tests/organizator.test.ts` (16),
`worker-tests/racun.test.ts` (14), rotacija tokena (4). `npm run test:types`,
`tsc -b` i `npm run build` čisti; bundle 63,6 kB gzip (bio 58).

---

## 2. Namjerno NIJE napravljeno

| Stavka | Zašto |
| --- | --- |
| Postavljanje tajni na staging (Stripe, webhook, Resend) | Vanjsko djelovanje na živu infrastrukturu. Sandbox ključ postoji lokalno u CLI profilu, ali odluka je vlasnikova. |
| Prebacivanje produkcije iz najave u prodaju | Isto — i preduvjet mu je da `/api/zdravlje` na produkciji bude sav `true`. |
| Puštanje migracija na produkcijsku jezgru | Coolify API je IP-restricted; migracija je napisana i lokalno provjerena. |
| `zxing-wasm` fallback za skener na iPhoneu | Jedina staza kojom se dokazuje je stvarni uređaj, ne test. Danas: Android/Chrome na ulazu. |
| FIRA storno na povrat | Storno endpoint nije u specifikaciji koju imamo. Povrat mijenja status računa u `storniran` i podiže alarm; storno se radi u FIRA sučelju. |
| Puni U3 dashboard (uređivanje događaja, Connect onboarding, DAC7 obrazac) | Zaseban posao; pregled prodaje je namjerno samo čitanje. |
| Anonimizacija holdera 90 dana nakon događaja | Cron postoji, pravilo nije implementirano — ostaje U3. |

---

## 3. Odluke koje su mogle biti drukčije (`REVIEW(fable)`)

Popis mjesta u kodu koja traže neovisnu prosudbu, s kratkim razlogom zašto je
odabrano baš tako:

| # | Gdje | Odluka | Alternativa koju vrijedi izvagati |
| --- | --- | --- | --- |
| 1 | `20260903120000` | „radni rail" se izvodi iz `organizer_payment_rails` pri svakoj aktivaciji | denormalizirani stupac na kampanji (brže, ali se razilazi kad Stripe javi `charges_enabled=false`) |
| 2 | `20260903120100` | limit 5 rotacija/24 h brojan iz `contribution_events` | zaseban brojač/stupac ako count postane spor |
| 3 | `20260903120100` | rotira se **cijela narudžba** | rotacija po serialu — traži da kupac zna koji je serial izgubio |
| 4 | `worker/racun-fira.ts` | `webshopOrderId` = prvih 48 bita UUID-a (determinističko) | slučajan broj + vlastita tablica mapiranja |
| 5 | `worker/racun-fira.ts` | PDV 0 % i klauzula čl. 90 iz koda | postavka po organizatoru (obvezno kad dođe organizator U sustavu PDV-a) |
| 6 | `worker/racun-fira.ts` | storno je ručni korak | FIRA storno endpoint kad se dobije specifikacija |
| 7 | `src/lib/auth.ts` | bez refresh tokena; sesija umire sa zatvaranjem taba | duža sesija = trajnija tajna na posuđenom mobitelu |
| 8 | `worker/api.ts::prijava` | samo lozinka, bez magic linka | zaseban skener-korisnik po događaju (U3) |
| 9 | `src/pages/Skener.tsx` | `BarcodeDetector`, bez fallbacka | `zxing-wasm` lazy import za Safari |
| 10 | `src/pages/Organizator.tsx` | „zauzeto" = `inventory_claimed` (uključuje rezervacije) | dodati broj **plaćenih** u `organizer_overview` |

---

## 4. Što još stoji između ovoga i prve naplaćene ulaznice

Nepromijenjeno u odnosu na plan §3 — sve su to odluke ili vanjski koraci, ne kod:

1. Standard vs Express Connect · 2. pravni subjekt platforme · 3. Stripe live
onboarding · 4. tri tajne na Workeru · 5. verificirana domena za e-mail ·
6. migracije na produkcijsku jezgru · 7. pravna provjera nacrta uvjeta ·
8. prebacivanje produkcije iz najave.

Redoslijed i podjela posla: [`handoffs/u7-produkcijski-preduvjeti.md`](handoffs/u7-produkcijski-preduvjeti.md).
