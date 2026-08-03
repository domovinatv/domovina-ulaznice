# U4 — Check-in PWA (skener ulaza)

> Handoff prompt za praznu Claude Code sesiju. Repo: `domovina-ulaznice`.
> Ovisi o [U2](u2-javna-prodaja-web.md); može se raditi **paralelno s U3** (ne dijele
> datoteke).
>
> _EN abstract: a browser-based QR scanner for venue staff that calls the existing
> `events-checkin` edge function; first scan shows the holder name, any repeat scan
> is loudly rejected with the first entry time. Server authorizes every scan._

## Cilj

Osoblje na ulazu otvori stranicu na mobitelu, skenira QR s ulaznice i u pola
sekunde vidi ✅ s imenom holdera i tierom, ili ⛔ s vremenom prvog ulaska.

## Kontekst i izvori

- `domovina-api/supabase/migrations/20260717120000_events_checkin.sql` —
  `redeem_ticket` (29) i `void_ticket` (144): **server provjerava rolu pri SVAKOM
  skenu**; anti-double-entry je u RPC-u, ne u klijentu.
- `domovina-api/supabase/functions/events-checkin/index.ts` — ugovor funkcije.
- `domovina-api/docs/events-ticketing-curl-scenario.md` §7 — očekivani ishodi.
- `safe-wallet-monorepo/docs/whitelabel-wallet/11-dogadjaji-p2p-ticketing.md` §3.4 —
  dijagram i odluka o offline fallbacku;
  `handoffs/dogadjaji-3-qr-checkin.md` — kako je to riješeno u walletu.
- Pravilo iz walleta koje vrijedi i ovdje: **skener ulaza nije skener plaćanja** —
  to su odvojeni tokovi i ne smiju dijeliti kod za razrješavanje skeniranog sadržaja.

## Preduvjeti

| Preduvjet                                                     | Status |
| -------------------------------------------------------------- | ------ |
| Prodane ulaznice s QR-om (U2)                                  | ⬜     |
| Barem jedan org admin korisnik za osoblje                      | ⬜     |
| HTTPS domena (kamera u browseru radi samo na secure originu)   | ⬜     |

## Opseg

**IN:**

1. `/skener` — PWA ruta: prijava (GoTrue, isti identitet kao U3), odabir događaja,
   pa puni-ekran skener (`BarcodeDetector` uz `zxing-wasm` fallback za Safari).
2. Rezultat skena: veliki ✅/⛔, ime holdera, tier, serial. Zvučni i haptički signal.
   Odbijanje mora biti **glasno i nedvosmisleno** — buka na ulazu je stvarna.
3. Brojač: skenirano / ukupno izdano za taj događaj (iz `organizer_overview`).
4. Ručni unos seriala kad se QR ne da skenirati (npr. slomljen ekran).
5. Offline tolerancija — **odluka se donosi u ovoj fazi i zapisuje u Zapisnik**:
   - opcija A (MVP): online-only + jasna poruka "nema mreže, pričekaj",
   - opcija B: predučitani potpisani vaučeri + odgođeni redeem (rizik: dupli ulaz
     ako dva uređaja skeniraju istu ulaznicu offline).
   Preporuka: **A za prvi event**, B tek ako se na terenu dokaže potreba.
6. Način rada "više uređaja" — svaki uređaj svoja sesija; sudar dvaju skena iste
   ulaznice rješava baza (prvi pobjeđuje).

**OUT:** self-service upravljanje osobljem (dodavanje skener-korisnika radi
organizator u U3 ili operater), statistike ulaza, akreditacijski ispis.

## Sigurnost

1. **Autorizacija je server-side pri svakom skenu** — ukraden mobitel s otvorenom
   aplikacijom bez valjanog tokena ne može ništa.
2. QR sadrži **opaque token**, ne podatke o holderu; u bazi je samo hash.
3. Skener nikad ne prikazuje e-mail holdera — samo ime i tier (minimizacija).
4. Token uređaja ima rok; istek → jasna poruka i ponovna prijava.

## Kriteriji prihvaćanja

```
1. Prvi sken ulaznice  → ✅ ime holdera + tier, checked_in_at zapisan
2. Drugi sken iste     → ⛔ + vrijeme prvog ulaska + tko je skenirao
3. Poništena ulaznica  → ⛔ "poništena"
4. Ulaznica drugog događaja → ⛔ "ne pripada ovom događaju"
5. Korisnik bez admin role → odbijen server-side (ne samo sakriven UI)
6. 100 uzastopnih skenova bez zamrzavanja kamere na prosječnom Androidu
```

## Zapisnik izvršenja

- Status: ⬜
- Odluka o offline načinu (A ili B) i zašto:
- Commitovi:
- Gotchai:
