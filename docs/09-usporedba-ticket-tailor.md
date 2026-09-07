# 09 — Usporedba s Ticket Tailorom

> Datum snimke: **2026-09-06**. Izvor za TT: [tickettailor.com/features](https://www.tickettailor.com/features)
> i [/pricing](https://www.tickettailor.com/pricing), dohvaćeno tog dana.
> Izvor za nas: **kod u ovom repou na commitu `7fc1850`**, ne planovi iz dokumenata.
> Kontekst tržišta: [08 Konkurencija](08-konkurencija-i-trziste.md).

---

## 1. Zašto baš Ticket Tailor

Od svih igrača na tržištu, TT je jedini koji ima **isti temeljni model**:

| Odluka | Ticket Tailor | mi |
| --- | --- | --- |
| Tko je merchant of record | organizator | organizator |
| Gdje sjeda novac | izravno na organizatorov Stripe/PayPal/Square | izravno na organizatorov Stripe |
| Dira li platforma sredstva | ne („We never handle your funds") | ne (direct charge, `application_fee_amount` se ne šalje) |
| Booking fee kupcu | ne (osim ako ga organizator sam doda) | ne |
| Marketplace / vlastiti promet | ne (ima `discover`, ali nije poanta) | ne |
| Naplata | **0,22–0,60 £ po prodanoj ulaznici** | **0** |

To ga čini najboljim mjerilom: sve razlike su funkcionalne, ne strukturne. Ono što
TT ima a mi nemamo, mogli bismo imati — nije blokirano modelom.

**Zaključak usporedbe u jednoj rečenici:** TT je zreo proizvod sa ~90 funkcija i
73.000 organizatora; mi imamo ~15 funkcija, jedan neisporučen pilot i dvije stvari
koje TT strukturno nema (0 € po ulaznici i hrvatski fiskalni račun).

---

## 2. Što imamo zajedničko

Provjereno u kodu — ovo su funkcije koje stvarno rade, ne planovi.

| Funkcija | Kod | Bilješka |
| --- | --- | --- |
| Javna stranica događaja sa slugom | `src/pages/Dogadjaj.tsx`, `GET /api/dogadjaj/:slug` | TT to zove „box office" |
| Više tipova ulaznica s kapacitetom | jezgra: `campaign_tiers` (`price_cents`, `inventory_total/claimed`) | |
| Prodajni prozor po tieru | jezgra: `sale_start` / `sale_end` | mi nemamo UI za to, TT ima |
| Checkout karticom | `worker/stripe.ts` → Stripe Checkout, direct charge | Apple/Google Pay dolaze besplatno uz Stripe Checkout |
| E-ulaznica s QR kodom mailom | `worker/mail.ts` + `worker/qr.ts` (vlastiti PNG enkoder) | TT isto: QR + free check-in app |
| Skener na ulazu | `src/pages/Skener.tsx` (`BarcodeDetector`), jezgra `events-checkin` | TT ima nativnu aplikaciju, offline rad, vanjske skenere |
| Dvostruki sken se odbija s vremenom prvog ulaza | jezgra `redeem_ticket` | |
| Imenske ulaznice (podaci po posjetitelju) | `holders`, `campaign_tiers.imenska` | TT: prilagodljiva checkout forma |
| Pregled prodaje organizatoru | `src/pages/Organizator.tsx`, `organizer_overview` | TT ima puni analitički dashboard |
| Izvoz popisa posjetitelja (CSV) | `GET /api/organizator/holderi.csv` | |
| Ponovna dostava ulaznica kupcu | `POST /api/ulaznice/:order_id/ponovna-dostava` + rotacija tokena | TT: samouslužno za kupca |
| Stranica „moje ulaznice" | `src/pages/Narudzba.tsx` | |
| Automatski povrat kad tier padne | `worker/webhooks.ts` (`expired_sold_out`, `duplicate_payment`, `amount_insufficient`) | **TT ovo javno ne oglašava** |
| Sinkronizacija povrata iz Stripe dashboarda | `charge.refunded` u `webhooks.ts` | |
| Rekoncilijacija propuštenih webhookova | `worker/reconcile.ts`, cron 15 min | |
| Pravni tekstovi | `src/pages/Pravno.tsx` (`/uvjeti`, `/privatnost`) | |
| Otvoreni kod | MIT, `domovinatv/domovina-ulaznice` | TT je zatvoren |

Naša financijska čvrstoća (dvoslojna idempotencija: PK insert u `webhook_events` +
unique index u jezgri; `payment_log` kao trag svakog dodira novca; rate limit na
KV-u) vjerojatno postoji i kod TT-a — samo je nevidljiva izvana. Ne računam to
kao prednost, nego kao **paritet koji smo morali platiti da uopće budemo u igri**.

---

## 3. Gdje smo bolji

Kratak popis, i to je poštena duljina.

### 3.1 Trošak po ulaznici je stvarno 0

| Scenarij | Ticket Tailor | Entrio (kupcu) | mi |
| --- | --- | --- | --- |
| 100 ulaznica × 50 € | ~60 £ (~70 €) organizatoru | ~275 € kupcima | **0 €** |
| 500 ulaznica × 20 € | ~205 £ (~240 €) uz kredite unaprijed | ~850 € kupcima | **0 €** |
| 1.000 besplatnih ulaznica | 0 (do 5.000/god.) | — | **0 €** |
| + Stripe obrada | ~1,5 % + 0,25 € | u naknadi | ~1,5 % + 0,25 € |

Uz ovo: TT za **rezervirano sjedalo naplaćuje dodatni kredit**, a za uklanjanje
svog brandinga („white label") naplaćuje posebno. Kod nas nema TT brandinga jer
nema TT-a.

**Iskrena mjera:** naspram Ticket Tailora ~70 € na događaj nije razlog za selidbu.
Naspram Entrija, gdje 275 € plaća kupac i vidi ih u košarici, jest.

### 3.2 Hrvatski fiskalni račun

Ovo je jedina prednost koju TT ne može replicirati bez ulaska na hrvatsko tržište:

- `InvoiceProvider` sučelje (`worker/racun.ts`) s tri providera:
  `organizator` (zadano, ništa ne izdaje — namjerno), `fira`, `domovina_fiskal`.
- FIRA most (`worker/racun-fira.ts`) izdaje račun kad uplata sjedne, na presedanu
  iz `fira-forms-connector`.
- Jedan račun po narudžbi i provideru, i to na **unique indexu u D1**, ne u
  aplikacijskom kodu. Pad providera ne poništava ulaznicu.

Za obveznika fiskalizacije od 1. 1. 2026. ovo nije dodatak nego preduvjet: PzS
danas izdaje FIRA račune iz Google Sheet retka, a **ako prodaja ode na platformu
bez ovog mosta, nema retka → nema računa → prekršaj**
([plan do produkcije](2026-09-03-plan-do-produkcije.md) §3.8).

TT nudi „set custom taxes" — to je porezna stopa na cijenu, ne fiskalizirani račun.

### 3.3 Hrvatski kao prvi jezik

TT navodi 19 jezika checkouta, ali ne i koji su — a i da je hrvatski među njima,
uvjeti, podrška i računi ostaju strani. Naša SPA, mailovi, pravni tekstovi
i dokumentacija su HR (konvencija iz `CLAUDE.md`).

### 3.4 Otvoreni kod pod MIT-om

pretix i Hi.Events su AGPL. Mi smo MIT — organizator ili partner smije forkati i
komercijalizirati bez copyleft obveze. TT je zatvoren.

### 3.5 Drugi rail nad istim ulaznicama

U6 (airKUNA / EURe na Gnosisu) je isti događaj, isti tier, ista ulaznica, isti
check-in — samo drugi način plaćanja ([01](01-vizija-i-model.md) §6). Nijedan
konkurent iz [08](08-konkurencija-i-trziste.md) to nema. Realno je za 2027. i ne
utječe na pilot, ali je stvarna razlika.

---

## 4. Što nam nedostaje

TT ima ~90 funkcija. Ovo je popis onoga što nemamo, **rangiran po tome koliko
blokira stvarnu prodaju**, ne po tome koliko je zvučno.

### Razred A — bez ovoga organizator ne može sam prodavati

| # | Funkcija (TT naziv) | Zašto blokira | Napor |
| --- | --- | --- | --- |
| A1 | **Editor događaja** (Box office: kreiraj/uredi/objavi događaj i tierove) | danas događaje unosimo mi kroz SQL; ovo je razlika između SaaS-a i usluge | 1–2 tj. |
| A2 | **Samouslužni Connect onboarding** | organizator ne može spojiti svoj Stripe bez nas | 3–5 dana |
| A3 | **Ručni unos narudžbe** (add an order manually) | komplimentarne ulaznice, prodaja na licu mjesta, telefonom — udruge to rade stalno | 2–3 dana |
| A4 | **Offline plaćanja** (uplata na IBAN, na vratima, po predračunu) | **ovo je današnji tok PzS-a.** Bez toga ih tjeramo da ukinu kanal koji im radi | 3–5 dana |
| A5 | **Upravljanje narudžbama** (traži, otkaži, refundiraj, ponovno pošalji iz UI-a) | danas refund ide kroz Stripe dashboard, otkazivanje nikako | 3–5 dana |
| A6 | **Uvoz posjetitelja (CSV)** | migracija s Google Formsa; bez toga prvi događaj kreće s praznom listom | 2 dana |
| A7 | **Embed checkouta na organizatorovu stranicu** (widget) | naša teza je „prodaj sa svoje stranice"; danas šaljemo kupca na `ulaznice.domovina.ai` | 3–5 dana |

> A4 i A7 su neugodni jer **oboje potkopavaju vlastito pozicioniranje**: A7 je
> doslovno naše obećanje iz [01](01-vizija-i-model.md) §1 koje kod ne ispunjava, a
> A4 znači da bi PzS prelaskom na nas **izgubio** kanal koji danas ima.

### Razred B — događaj prođe bez toga, ali s trenjem

| # | Funkcija | Bilješka |
| --- | --- | --- |
| B1 | **Promo / popust kodovi** | nema ih nigdje u kodu (`grep` potvrđuje); rana ptica, partnerski kodovi |
| B2 | **Brand prodajne stranice** | tablica `event_pages` postoji, **ništa u nju ne piše** |
| B3 | **Vlastita domena organizatora** | TT to ima; mi imamo jednu domenu za sve |
| B4 | **Slanje mailova posjetiteljima** (broadcast, podsjetnik prije događaja) | imamo samo transakcijski mail s ulaznicom |
| B5 | **Prilagodljiva checkout forma + potvrda uvjeta + marketing opt-in** | GDPR privola za marketing danas ne postoji |
| B6 | **Timski pristup i uloge** (Admin / Event manager / Order manager) | danas: prijava po organizatoru, bez razina |
| B7 | **PDF doorlist** | imamo CSV; papir na ulazu je stvarna potreba kad kamera zakaže |
| B8 | **„Dodaj u kalendar"** u mailu potvrde | jeftino, mjerljivo podiže dolaznost |
| B9 | **Skener bez interneta** | `BarcodeDetector` + mreža; TT radi offline. Dvorana bez signala je realan scenarij |
| B10 | **Skener na iPhoneu** | `BarcodeDetector` **ne postoji u Safariju** — `REVIEW(fable)` u `src/pages/Skener.tsx:32`. Danas fallback = ručni unos. Ovo je za pilot ozbiljnije nego što izgleda |
| B11 | **Analitika i izvještaji o prihodu** | imamo pregled prodaje, nemamo izvještaje |
| B12 | **Duplikat događaja** | PzS ima 5 istih događaja godišnje — ovo im vrijedi više nego prosjeku |

### Razred C — kasnije ili nikad

Sjedala · vremenski termini i ponavljajući događaji · lista čekanja · Apple Wallet
· grupne ulaznice i paketi · članarine i sezonske ulaznice · dodatna prodaja
(merch, add-oni) · darovni bonovi · donacije na checkoutu · SMS/WhatsApp podsjetnici
· više valuta (mi smo EUR-only) · više jezika checkouta · PayPal/Square/Klarna ·
Tap to Pay i POS · Stripe Terminal · osiguranje povrata · multi-checkout ·
Zapier/Mailchimp/HubSpot · javni API s webhookovima za organizatora · **MCP
konektor za AI** · ispis akreditacija · preprodaja · Meta/TikTok/GA4 piksel ·
referral i affiliate oznake · SEO schema.org na stranici događaja · 24/7 podrška ·
PCI DSS SAQ-A Level 1 · statusna stranica.

Dvije stavke iz razreda C zaslužuju posebnu bilješku:

- **SEO schema.org** je jeftin (jedan `<script type="application/ld+json">`) i
  jedini organski dovod prometa koji alat bez marketplacea uopće ima.
- **MCP konektor** — TT ga je pustio kao istaknutu funkciju („create events, update
  tickets, share sales insights"). Za repo koji se razvija s agentima to je
  prirodno i vjerojatno je najjeftiniji način da dobijemo A1 (editor događaja) prije
  nego napišemo ijedan ekran.

---

## 5. Što bih napravio s ovim nalazom

Ne „sustići TT". Redoslijed koji slijedi iz gornjeg rangiranja i iz
[plana do produkcije](2026-09-03-plan-do-produkcije.md):

1. **B10 (skener na iPhoneu)** prije pilota. Ovo je jedina stavka koja može srušiti
   događaj na dan događaja, a nije u planu do produkcije. Rješenje je jedan QR
   dekoder u WASM-u ili `jsQR`, bez ovisnosti o `BarcodeDetector`u.
2. **A4 (offline plaćanja)** prije nego se PzS-u išta obeća. Inače prelaskom gube
   funkcionalnost.
3. **A3 + A5** (ručna narudžba, upravljanje narudžbama) — to je 80 % onoga što
   organizator zapravo radi nakon što prodaja krene.
4. **A1 kroz MCP prije nego kroz UI.** Editor događaja kao skup alata koje zovemo
   iz agenta je dani posla umjesto tjedana, a pokriva slučaj „ubaci mi Varaždin
   14. 11. s dva tiera".
5. **A7 (embed widget)** kad postoji drugi organizator. Za PzS je naša stranica
   dovoljna; za pozicioniranje nije.
6. **B8, B12, SEO schema** — sitno, jeftino, vidljivo.

Ono što **ne** treba raditi: sjedala, više valuta, marketplace promet, virtualne
pozornice. Argumentacija je u [08](08-konkurencija-i-trziste.md) §7.
