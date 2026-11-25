# Deploy dug — što je u gitu, a nije na serveru

> Živi dokument, ne dnevnik. Zasad se radi **lokalno**. Svaka promjena koja
> traži deploy upisuje se ovdje **u istom commitu** u kojem nastaje. Kad se
> deploya i provjeri, redak se briše; povijest ostaje u gitu.
>
> Okruženja i zamke: [2026-08-08](2026-08-08-deploy-okruzenja-i-stripe.md).
> Što još treba do prve prave ulaznice: [plan do produkcije](2026-09-03-plan-do-produkcije.md).

Produkcija 23. 11. (Ivan): `NAJAVA` maknut, `ulaznice.domovina.ai` je puna aplikacija (Worker `ca26f532`, web `6b996d75`, D1 `0002` puštena). `/`, `/organizator`, `/skener`, `/api/dogadjaji` → 200; `/api/zdravlje`: `stripe`, `webhook`, `hmac`, `mail` = false — **#10**.

Jezgra 23. 11. (Matija): migracija `20261120120000_events_venue_geo` i `events-feed` s `venue_lat`/`venue_lon`/`cover_image_alt` na `api.domovina.ai` (bivši #5, `domovina-api` journal `20261123T140548Z-b1272d4`). U GoTrue `ADDITIONAL_REDIRECT_URLS` dodani `https://ulaznice.domovina.ai/**` i `https://ulaznice-staging.domovina.ai/**` — preduvjet za #11.

Staging Stripe 23. 11. (Matija): novi sandbox restricted key i Connect webhook (API `2025-02-24.acacia`) postavljeni, `/api/zdravlje` → `stripe`, `webhook` = true; stari endpoint `we_1U2CSIQoZhPywPyhprOeashs` (`2020-08-27`) **disabled** (bivši #12).

Produkcija 23. 11. (Matija): `SKRIVENI_ORGANIZATORI` = test organizator `…0000000000f2` — jezgra je zajednička, pa produkcija ne prikazuje ni ne prodaje `[TEST]` događaje sa sandbox railom (`worker/api.ts` `feed()`). Svaki novi test organizator ide u tu varijablu **prije** seeda.

Jezgra 23. 11. (Matija): pušten `seeds/staging-web-pregled.sql` sa sandbox railom (`acct_1U2CRfByTQ1uTmhK`). Produkcija: `[]` i 404 na događaju. Staging: sandbox onboarding dovršen, `account.updated` webhook sam postavio rail → `kupovno: true`; **prva testna kupnja prošla** (narudžba `ab2e7543`, ulaznica `TES-000001`). Mail ne ide dok nema `RESEND_API_KEY` (#10). Detalji: [2026-11-23 §4](2026-11-23-stripe-kljucevi-i-connect-platforma.md).

Staging 23. 11.: D1 `0002` puštena (`invoices`, `alarms` postoje); Worker na `main` — `/api/zdravlje` ima `prijava`, `alarm`, `racun`, `/preuzmi` s `{}` → 400 (bivši #2 i #3).

Jezgra i Worker 25. 11. (Matija, S6 lanca `domovina-api/docs/ulaznice-shema/`): jezgra na shemi `ulaznice` (migracije `20261125150000`–`170000`, `PGRST_DB_SCHEMAS`, `events-*` funkcije; journal `deploys/20261125T163756Z-1d7a89b.md`), Worker s grane `feat/ulaznice-shema` deployan na staging `70b6e87c` i produkciju `ced9eb6f` (bivši #21). Rujanske migracije `event_rail_ready` i `rotate_ticket_tokens` nisu puštene u `pinka_finance`, nego su ugrađene u `ulaznice` (odluka 111): `ulaznice.event_rail_ready` i `ulaznice.rotate_ticket_tokens` postoje na produkciji (bivši #4). Stari ticketing u `pinka_finance` zamrznut je do brisanja (S7, ne prije 9. 12.).

Stanje u tablici je **provjereno na živim sustavima** na navedeni datum, ne
pretpostavljeno iz gita. „Nepotvrđeno“ znači da nitko nije pogledao.

## Čeka deploy

| # | Promjena | Commit | Kamo | Kako | Provjera nakon deploya | Stanje |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `events-feed` bez `?limit` vraća 1 događaj umjesto 50 | `domovina-api@ca375ab` | `api.domovina.ai` (edge runtime) | u `domovina-api`: `./scripts/deploy-functions.sh --only=events-feed --restart` | `curl https://api.domovina.ai/functions/v1/events-feed` → `"limit":50` | ❌ 26. 9. vraća `"limit":1` |
| 6 | Stranice kupaca na stagingu kroz Astro: binding `WEB` (+ `assets.run_worker_first`) u `env.staging` glavnog Workera, podjela putanja u `worker/index.ts` (S6 lanca `web/`) | S6 lanca `web/` (PR iz `IStep95/domovina-ulaznice`) | prvo `domovina-ulaznice-web-staging` (`ulaznice-web-staging.domovina.ai`), pa `ulaznice-staging.domovina.ai` | v. „Binding `WEB` (S6)” niže | v. „Binding `WEB` (S6)” niže | ⚠️ deployano 23. 11. (web `0833e5c0`, Worker `c794c86a`): `/uvjeti`, `/organizator`, `/skener` 200, ali **`/` → 503 „Pokušaj ponovno”**: SSR pozvan kroz binding dobiva `ApiError: neispravan_odgovor` na `API_BASE_URL` (javni URL istog Workera); izravno na `ulaznice-web-staging` radi. Popravak: v. `web/docs/ui-feedback.md` stavka 6 |
| 7 | Prijava organizatora i skenera kodom na e-mail: `POST /api/organizator/kod` i `/potvrdi` (GoTrue `/otp` + `/verify`), novi izgled `/organizator` i `/skener`; lozinka ostaje sporedni put | ovaj commit | `ulaznice-staging.domovina.ai` | isti `npm run deploy` kao #3/#6. **Prije toga** u GoTrueu (`api.domovina.ai`, Auth → Email Templates → Magic Link) predložak mora imati `{{ .Token }}`, inače mail nosi samo link i kod se ne može upisati. „Nastavi s Googleom” v. #11 | `POST /api/organizator/kod` → `{"ok":true}`, mail za postojeći račun sadrži 6-znamenkasti kod, upis koda na `/organizator` otvara pregled | ⚠️ Worker deployan 23. 11.; `POST /api/organizator/kod` → `{"ok":true}`; predložak s `{{ .Token }}` u GoTrueu nepotvrđen |
| 8 | Galerija događaja: migracija `20261120170000_events_gallery` (`events.gallery` jsonb `[{url, alt}]`, ≤ 20) i `events-feed` koji je vraća; Astro je prikazuje ispod „Dodaj u kalendar” kad je slika više od jedne | `domovina-api@d5cdae3` (grana `events-gallery`) + ovaj commit | produkcijska baza, pa `api.domovina.ai` (edge runtime), pa `web` | kao #5: **migracija strogo prije `events-feed`** (feed nad starom shemom vraća 500 na `column events.gallery does not exist`); Worker ne treba ništa osim tipa | `curl …/events-feed` → svaki `event` ima `"gallery":[]`; `/dogadjaj/<slug>` s ≥ 2 slike ima odjeljak „Galerija” | ⏳ lokalno provjereno 20. 11.; ide zajedno s #15 (grana `events-media`) |
| 9 | Editor događaja, prva verzija: `POST /api/organizator/dogadjaj` → `events-organizer` (`action: create`, korisnikov JWT) i SPA `/organizator/novi`; sprema privatnu skicu s ulaznicama | ovaj commit | `ulaznice-staging.domovina.ai` | isti `npm run deploy` kao #3/#6/#7. Preduvjet: `events-organizer` deployan na `api.domovina.ai` (nepotvrđeno). Organizator mora biti admin računa **i** imati redak u `identity_verifications` (eOsobna na domovina.ai), inače `403 nema_prava_kreiranja` | prijava → „+ Novi događaj” → „Spremi kao skicu” → skica se vidi na pregledu kao „skica” | ⚠️ Worker deployan 23. 11.; `/organizator/novi` 200; `events-organizer` na `api.domovina.ai` nepotvrđen |

| 10 | Produkcijske tajne glavnog Workera | — | `ulaznice.domovina.ai` | `wrangler secret put <IME>` (bez `--env`): `DOMOVINA_API_SERVICE_KEY`, `EVENTS_STRIPE_CONFIRM_SECRET` (iste vrijednosti kao staging, ista jezgra), `STRIPE_SECRET_KEY` (`sk_live_…`), `STRIPE_WEBHOOK_SECRET` (Connect endpoint `https://ulaznice.domovina.ai/webhook/stripe`), `RESEND_API_KEY`; po potrebi `FIRA_API_KEY` | `/api/zdravlje` → `stripe`, `webhook`, `hmac`, `mail` = true | ⚠️ 23. 11.: `EVENTS_STRIPE_CONFIRM_SECRET`, `DOMOVINA_API_SERVICE_KEY`, `STRIPE_SECRET_KEY` (restricted) i `STRIPE_WEBHOOK_SECRET` postavljeni; `/api/zdravlje` → `stripe`, `webhook`, `hmac` = true. Fali `RESEND_API_KEY` (`mail:false`). Live račun još nije Connect platforma — [2026-11-23](2026-11-23-stripe-kljucevi-i-connect-platforma.md) |
| 11 | Prijava Googleom: `GET /api/organizator/google` → GoTrue `/authorize?provider=google` (implicit flow), SPA preuzme token iz fragmenta (`src/lib/auth.ts`), refresh token se ne sprema | ovaj commit | `ulaznice-staging.domovina.ai`, pa `ulaznice.domovina.ai` | `npm run deploy`, pa `npm run deploy:prod`. Preduvjet (✅ 23. 11.): origin u GoTrue `ADDITIONAL_REDIRECT_URLS` | `GET /api/organizator/google` → 302 na `api.domovina.ai/auth/v1/authorize`; „Nastavi s Googleom” na `/organizator` vraća prijavljenog korisnika | ⚠️ staging `1b61e0ae` (prava prijava provjerena, Ivan); produkcija `25e0df1b` 23. 11.: `GET /api/organizator/google` → 302 na `api.domovina.ai/auth/v1/authorize?provider=google&redirect_to=https://ulaznice.domovina.ai/organizator`; prava prijava na produkciji nepotvrđena |
| 13 | S8 lanca `web/`: `/organizator`, `/organizator/novi` i `/skener` iz Astra (otoci `client:only`, prijava kodom/Googleom/lozinkom u `web/src/lib/auth.ts`, `noindex`, `no-store`); glavni Worker ih više ne daje SPA-i (`SPA_STRANICE` maknut, `/assets/*` i `ASSETS` ostaju rezerva do S9). Uz to Lighthouse sitnice (odluka 705): inline CSS, preload Figtreeja, `og:image:width/height/type`, `image` u JSON-LD-u. `/organizator/novi` je **wizard** u 5 koraka (ui-feedback stavka 4: nacrt u `localStorage`, `?korak=N`, živi pregled kartice; payload prema `events-organizer` isti kao u SPA-i) | S8 lanca `web/` (PR iz `IStep95/domovina-ulaznice`) | prvo `web` (staging), pa `ulaznice-staging.domovina.ai`; isto za produkciju | **Prvo** `npm --prefix web run deploy:staging`, **tek onda** `npm run deploy` (glavni Worker bez Astrovih stranica organizatora vratio bi 404). Wizard je u istom PR-u (bez zasebnog deploya). Produkcija istim redom (`deploy:prod`) | `/organizator`, `/organizator/novi`, `/skener` → 200, `cache-control: no-store`, `<meta name="robots" content="noindex…">`, u HTML-u `astro-island`; prijava kodom otvara pregled; „Nastavi s Googleom” vraća na istu stranicu prijavljenog; `/assets/index-*.js` i dalje iz SPA-e; wizard: skica se sprema (pregled prodaje je pokazuje kao privatnu), refresh na `?korak=3` ostaje na koraku 3 s upisanim podacima, „natrag” u pregledniku vraća korak | staging ✅ 24. 11. (web `10d40e70`, glavni `3e32a2f3`; rute 200 + `no-store` + `noindex` + `astro-island`, `/organizator/nesto` 404, Google redirect_to `/organizator/novi`); ručno još: prijava kodom, skica, Google · produkcija ⏳ |
| 14 | Podnožje „prodaja bez provizije” i blok na početnoj „Bez provizije” (bez rečenice o Stripeu) umjesto „bez posrednika” (Ivan). Wizard, korak 4: tablica vrsta ulaznica ovisi o širini stupca (`@container` ≥ 520 px), ne prozora; između 1024 i ~1250 px „Naziv” se stiskao na nulu i tablica je scrollala vodoravno (Ivan, staging) | ovaj commit | web staging, pa produkcija | `npm --prefix web run deploy:staging` (glavni Worker ne treba) | `/organizator/novi?korak=4` na ~1100 px: vrste kao kartice s punim „Naziv”; na 1440 tablica; bez vodoravnog scrolla | staging ✅ 24. 11. (web `607fd744`; početna „Bez provizije”, `container-type` u CSS-u wizarda) · produkcija ⏳ |
| 15 | Upload slike i galerija u wizardu (`/organizator/novi`, korak 3): `POST /api/organizator/slika` (korisnikov JWT → Storage `pinka-covers/{uid}/…`, preglednik smanji na 1600 px WebP), `gallery` u `POST /api/organizator/dogadjaj`; jezgra: `events-organizer` je upiše nakon `create_event`/`update_event` | grana `events-media` u `IStep95/domovina-api` (, uključuje galeriju iz #8 kao `c1e3997`) + ovaj commit | produkcijska baza, pa `api.domovina.ai` (edge runtime), pa `ulaznice-staging.domovina.ai` i web | **Matija:** merge PR-a `events-media`, migracija `20261120170000_events_gallery` **prije** `events-feed` i `events-organizer` (`./scripts/deploy-functions.sh --only=events-feed,events-organizer --restart`). Provjeri da bucket `pinka-covers` postoji na produkciji (migracija `20260611120000`). Tek onda `npm --prefix web run deploy:staging` i `npm run deploy` | upload na stagingu vraća `https://api.domovina.ai/storage/v1/object/public/pinka-covers/…` i slika se otvara; skica s galerijom: `select gallery from pinka_finance.events` popunjeno; korisnik bez provjerenog identiteta dobiva poruku „Sliku može učitati samo…”. **Bez jezgre** upload radi, ali spremanje skice s galerijom tiho izgubi galeriju (stari `events-organizer` ih ignorira) | ⚠️ staging 24. 11. (web + glavni `3d0fb3de`): `/organizator/novi` 200, korak 3 s „Učitaj slike”, `POST /api/organizator/slika` bez prijave → 401, SVG → 415; `pinka-covers` postoji na `api.domovina.ai`. Pravi upload prijavljenog nije isproban. **Jezgra (`events-media`) još nije deployana** → skica se sprema bez galerije · produkcija ⏳ |
| 16 | Uredi i obriši skicu: `GET`/`PUT`/`DELETE /api/organizator/dogadjaj/:id`, wizard `?uredi=<id>`, gumbi u pregledu prodaje; jezgra: migracija `20261124170000_events_delete_draft` (`delete_event_draft`) i `events-organizer` (`delete`, `remove_tier_ids`) | grana `events-media` u `IStep95/domovina-api` + ovaj commit | produkcijska baza, pa `api.domovina.ai`, pa web i glavni Worker (staging) | **Matija:** uz #15, migracija `20261124170000` prije `events-organizer`. Zatim `npm --prefix web run deploy:staging`, pa `CLOUDFLARE_ACCOUNT_ID=… npm run deploy` | na stagingu skica → „Uredi skicu” učita podatke, „Spremi izmjene” ih zapiše, maknuta vrsta nestane; „Obriši skicu” je makne iz pregleda; objavljeni događaj → `event_not_draft`. **Bez jezgre:** uređivanje polja radi (stari `update`), ali maknute vrste ostaju, a brisanje vraća grešku | ⚠️ staging 24. 11. (glavni `e055b591`): `/organizator` s „Obriši skicu”, `?uredi=` 200, `GET`/`PUT`/`DELETE` bez prijave → 401, loš id → 400. **Jezgra još nije deployana** → brisanje skice i uklanjanje vrsta na stagingu ne rade · lokalno cijeli tok ✅ · produkcija ⏳ |
| 17 | Jedan gumb „Dodaj u kalendar” na `/dogadjaj/[slug]` (Google Kalendar, pa `.ics` kad se prozor ne otvori; odluka 825) | `e7937a1` | web staging, pa produkcija | `npm --prefix web run deploy:staging` (glavni Worker ne treba) | stranica događaja ima jedan gumb s `data-kalendar-ics`, `.ics` 200 `text/calendar` | staging ✅ 24. 11. (web `ed461ade`, provjereno na `test-pregled-web-sucelja`) · produkcija ⏳ |
| 18 | Fizički/online i komercijalni/besplatan događaj (odluke 826–827): wizard koraci 2 i 4, `/api/narudzba` za 0 € bez Stripea, link online događaja u mailu i na `/ulaznice/:id`; jezgra: migracija `20261125120000_events_free_online` (`attendance_mode`, `event_access`, rail `free`) i `events-order`, `events-organizer`, `events-feed` | grana `events-format` (`2395f88`), mergeana u `domovinatv/domovina-api` 25. 11. (PR #7, `1564aab`) + ovaj commit | produkcijska baza, pa `api.domovina.ai`, pa web i glavni Worker (staging) | **Matija:** migracija `20261125120000` **prije** `events-order`, `events-organizer` i `events-feed` (`./scripts/deploy-functions.sh --only=events-order,events-organizer,events-feed --restart`); `events-order` je javna, a sama potvrđuje samo narudžbe od 0 € (RPC `order_not_free`). Zatim `npm --prefix web run deploy:staging`, pa `CLOUDFLARE_ACCOUNT_ID=… npm run deploy` | skica „Online” + „Besplatan” se spremi (`select attendance_mode from pinka_finance.events`, red u `event_access`); objavljen besplatan događaj: „Uzmi ulaznice” → `/ulaznice/<id>?besplatno=1`, mail s QR-om i linkom; anon `GET /rest/v1/event_access` → 401/permission denied. **Bez jezgre:** wizard šalje nova polja, stari `events-organizer` ih ignorira; besplatna narudžba pada na `tier_price_missing` | lokalno ✅ 25. 11. (cijeli tok: wizard, kupnja, mail, narudžba) · ⚠️ staging 25. 11. (web `79a4f41b`, glavni `a14323cf`): stranice 200, wizard ima „Gdje se održava” i „Komercijalni”, `/api/dogadjaj/…` vraća `besplatno`; skica se čita i bez migracije (`546cba8`). **Jezgra (`events-format`) nije deployana** → online i besplatno se na stagingu ne spremaju, besplatna narudžba ne prolazi · produkcija ⏳ |
| 19 | Vrsta događaja „Seminar” (`seminar`) u wizardu (`web/src/lib/editor.ts`) i staroj SPA-i (`src/lib/editor.ts`); jezgra prima bilo koji `^[a-z0-9_]{1,40}$`, ne treba je dirati | ovaj commit | web staging (i glavni Worker zbog SPA rezerve), pa produkcija | `npm --prefix web run deploy:staging`, pa `CLOUDFLARE_ACCOUNT_ID=… npm run deploy` | `/organizator/novi`, korak 1: „Seminar” u izborniku vrste; skica spremljena kao seminar → stranica događaja ispisuje „Seminar” | lokalno ✅ 25. 11. (build na :8792) · staging ✅ 25. 11. (web `db327909`, glavni `a234e0ab`): `/organizator/novi` 200, bundle wizarda sadrži `seminar` · produkcija ⏳ |
| 20 | Gumb „Prijavi se” u mailu s kodom vodio je na `domovina.ai` (SITE_URL jezgre): `POST /api/organizator/kod` sad šalje GoTrueu `redirect_to` (query) = stranica s koje je kod tražen (`povratak`: `/organizator`, `/organizator/novi`, `/skener`), token stiže u fragmentu kao kod Googlea | ovaj commit | glavni Worker i web (staging), pa produkcija | `npm --prefix web run deploy:staging`, pa `CLOUDFLARE_ACCOUNT_ID=… npm run deploy`. Preduvjet: `https://ulaznice(-staging).domovina.ai/**` u `ADDITIONAL_REDIRECT_URLS` jezgre (postoji od 23. 11.) | zatraži kod na `/organizator/novi` na stagingu → u mailu link `…/auth/v1/verify?…&redirect_to=https://ulaznice-staging.domovina.ai/organizator/novi`, klik prijavi i vrati na wizard | lokalno: GoTrue čita `redirect_to` iz query stringa ✅ (lokalna allow lista nema `127.0.0.1:8788`, pa lokalni mail i dalje vodi na SITE_URL) · ⚠️ staging 25. 11. (web `2b05df2f`, glavni `d5f9335f`): `/api/organizator/kod` 200, `/organizator/novi` 200; klik na link u pravom mailu još nije isproban · produkcija ⏳ |

Redoslijed: **4 → 1 → 2 → 3**, #6 nakon #3 (isti Worker, isti `npm run deploy`); #5 je neovisan, ali unutar njega **migracija strogo prije `events-feed`**: novi feed nad starom shemom vraća 500 (`column events.venue_lat does not exist`) i ruši popis događaja. Backend ide prije Workera, a D1 shema prije
koda koji je čita (isto pravilo kao u [2026-08-04 §8](2026-08-04-lokalna-verifikacija-i-nalazi.md#8-redoslijed-puštanja-u-pogon-ne-mijenjati)).

Zamka uz #2: `npm run db:staging` i `npm run db:remote` primjenjuju **samo
`0001_init.sql`**. Svaka nova D1 migracija mora se pustiti ručno, kao gore.

## `web/` (korak 0, 2026-11-19)

`domovina-ulaznice-web` (`ulaznice-web.domovina.ai`) i `domovina-ulaznice-web-staging`
(`ulaznice-web-staging.domovina.ai`) su deployani sa stranicom „u izradi” iz
`web/privremeno/`. Auto-deploya nema: nakon svakog mergea Ivanovog PR-a koji dira
`web/` pokreni `npm --prefix web ci && npm --prefix web run deploy:staging`
([web odluka 22](../web/docs/decisions.md)). Produkciju `web/` ne deployaj prije S6
osim kao „u izradi” (odluka 24).

S1 (2026-11-19): `web/` je sad Astro build (`dist/`), `privremeno/` je obrisan. Okruženje
se bira **pri buildu** (`CLOUDFLARE_ENV`), ne s `--env` pri deployu, pa uvijek preko
skripti: `npm --prefix web run deploy:staging`, odnosno `deploy:prod`. Goli
`wrangler deploy --env staging` nad produkcijskim buildom deploya produkcijsku
konfiguraciju. Provjera nakon deploya: `/` vraća „u izradi” (`noindex`), a
`/dogadjaj/<slug>` naslov događaja (na stagingu tek kad je pušten test događaj, odluka 23).

### Binding `WEB` (S6)

Glavni staging Worker stranice kupaca (`/`, `/dogadjaj/*`, `/ulaznice/*`, `/uvjeti`,
`/privatnost`, nepoznate putanje, Astrova statika) prosljeđuje Astro Workeru kroz service
binding; `/api/*`, `/webhook/*`, `/.well-known/*`, `/organizator`, `/skener` i `/assets/*`
(SPA) ostaju njegovi. Povratak sa Stripea (`success_url`) i link u mailu (`PUBLIC_BASE_URL`)
time vode na Astro. Produkcija od 23. 11. ima isti binding (`WEB` → `domovina-ulaznice-web`).

1. **Prvo `web`**, s istog commita: `npm --prefix web ci && npm --prefix web run deploy:staging`.
   Binding na servis koji ne postoji ruši deploy glavnog Workera, a stari `web` bi kupcima
   servirao stare stranice. Provjera: `curl -s -o /dev/null -w '%{http_code}'
   https://ulaznice-web-staging.domovina.ai/uvjeti` → 200.
2. **Pa glavni Worker**: `npm run deploy` (= `--env staging`).

Varijable: ništa novo za postaviti, sve je u configu. `web` staging ima `API_BASE_URL` =
`https://ulaznice-staging.domovina.ai` (`web/wrangler.jsonc`, `env.staging.vars`): SSR zove
`/api` glavnog Workera javnim URL-om. Glavni Worker: `services: [{ binding: "WEB", service:
"domovina-ulaznice-web-staging" }]` i `assets.run_worker_first: true` u `env.staging`
korijenskog `wrangler.jsonc`; `PUBLIC_BASE_URL` ostaje `https://ulaznice-staging.domovina.ai`.
Bez novih tajni.

Provjere nakon deploya (dodaj `?cb=$RANDOM` ako sumnjaš na cache, [2026-08-08 §4.4](2026-08-08-deploy-okruzenja-i-stripe.md)):

| Zahtjev na `https://ulaznice-staging.domovina.ai` | Očekivano |
| --- | --- |
| `/` | 200, `<title>Događaji · Ulaznice` (Astro), ne SPA; nema stranice „Pokušaj ponovno” (to znači da SSR ne dohvaća `/api` javnim URL-om, web S6 točka 3) |
| `/uvjeti`, `/privatnost` | 200; `/uvjeti/` → 307 na `/uvjeti` (lokalno pod wranglerom 3 binding daje 200, [research](../web/docs/research/2026-11-20-lokalna-e2e-kroz-astro.md) zamka 7) |
| `/nepostoji-$RANDOM`, `/ulaznice/00000000-0000-4000-8000-000000000000` | 404 iz Astra („Stranica nije pronađena”), ne SPA 200 |
| `/organizator`, `/skener` | 200, SPA |
| `/api/zdravlje`, `/.well-known/apple-app-site-association` | 200 JSON |
| `/dogadjaj/<slug>` | 200 tek kad je u jezgri objavljen događaj ([web odluka 23](../web/docs/decisions.md)) |

Uz to `npx wrangler tail --env staging` dok se otvaraju stranice: bez `[worker] neuhvaćena
greška` i bez 5xx s `WEB`. Kupnja od kraja do kraja na stagingu čeka Stripe/Resend tajne
(„Namjerno se ne deploya”); lokalno je prošla kroz `scripts/lokalno/pokreni.sh` +
`npm --prefix web run e2e:stack`.

Povratak: ukloniti `services` iz `env.staging` i `npm run deploy` — bez `env.WEB` Worker sve
što nije `/api` ili `/webhook` servira iz `ASSETS` kao prije S6 (`run_worker_first` tada samo
znači da Worker vidi i statiku SPA-e, ponašanje je isto). Brže, bez commita: prethodna verzija
Workera u Cloudflare dashboardu (Workers → `domovina-ulaznice-staging` → Deployments →
Rollback). `domovina-ulaznice-web-staging` može ostati deployan, na svojoj domeni ne smeta.

## Namjerno se ne deploya

| Što | Zašto | Kada |
| --- | --- | --- |
| `seeds/*.sql` na produkcijsku jezgru | Stripe rail u seedovima ima izmišljen `acct_…`, a Safe je `0x1111…`. Na živom sustavu događaj bi izgledao kupovno, a naplata ne bi radila. | Kad Prilika za Susret završi pravi Stripe onboarding i potvrdi cjenik (TODO poslan Tomislavu Belaviću 26. 9. 2026.) |
| Resend tajna na staging (Stripe je postavljen 23. 11.) | Odluka vlasnika, v. [implementacija P0/P1](2026-09-03-implementacija-p0-p1.md) | Nakon odluke Standard vs Express ([plan §3.1](2026-09-03-plan-do-produkcije.md)) |
