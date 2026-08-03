# U5 — Računi i fiskalizacija (pluggable provider)

> Handoff prompt za praznu Claude Code sesiju. Repo: `domovina-ulaznice`
> (+ eventualne dopune u `domovina-fiskal`). Ovisi o [U3](u3-organizator-dashboard.md)
> i [U4](u4-checkin-pwa.md).
>
> _EN abstract: an `InvoiceProvider` interface with three implementations —
> `organizator` (no-op, we only hand over the data), `fira` (existing FIRA Custom
> Webshop API, already used by our first customers), and `domovina_fiskal`
> (ZKI/JIR, **TEST environment only**, locked in code). Which one runs is per-organizer
> configuration._

## Cilj

Naplaćena narudžba proizvede račun kupcu kroz provider koji je organizator odabrao
— ili ne proizvede ništa, ako organizator izdaje račune sam.

## Kontekst i izvori

- `docs/04-porezni-i-pravni-okvir.md` — **pročitaj cijeli prije koda**; §6 su
  otvorena pitanja koja drže produkciju zaključanom.
- `rodjendaonice.domovina.ai/apps/marketplace/worker/fiskal.ts` — gotov klijent za
  `domovina-fiskal`, uključujući:
  - `provjeriOkolinu()` — **brava koja odbija svaki ne-test host**; prenesi ju
    doslovno, to nije konfiguracija nego sigurnosni mehanizam,
  - izračun PDV-a, KPD, `DEFAULT_PP='ONLINE1'`, idempotencija.
- `domovina-fiskal/backend/src/validacija.ts` (`racunModelShema`, `KLAUZULA_CL90`),
  `src/api/racuni.ts` (`POST /racun`, `/racun/:id/pdf`), `migrations/0002_dokumenti.sql`
  (tablica `sekvenca` → pravilo o slijednosti brojeva).
- `fira-forms-connector/google-apps-script/modules/Mapping.gs` (`buildPayload`) i
  `examples/fira-custom-api-openapi-spec.txt` — FIRA payload, mapiranje kupca,
  stavki, `termsHR/EN/DE`, `paymentGatewayCode/Name`.
- `fira-forms-connector/google-apps-script/events/sinj-2026/Config.gs` — realan
  primjer konfiguracije jednog događaja (usluga, mjesto, datum, klauzula čl. 90).

## Preduvjeti

| Preduvjet                                                                        | Status |
| --------------------------------------------------------------------------------- | ------ |
| Odgovori na ⚠️ ODLUKE 1–2 iz `docs/04` §6 (prodavatelj; punomoć)                  | ⬜     |
| Za `domovina_fiskal`: tenant + certifikat + **zaseban PP/NU** po organizatoru      | ⬜     |
| Za `fira`: API ključ organizatora (imaju ga postojeći korisnici)                   | ⬜     |
| Tekst u uvjetima korištenja o izdavanju računa u ime organizatora                  | ⬜     |

## Opseg

**IN:**

1. **Sučelje** `InvoiceProvider` u `worker/invoice/`:
   ```ts
   interface InvoiceProvider {
     readonly id: 'organizator' | 'fira' | 'domovina_fiskal';
     izdaj(order: NaplacenaNarudzba, cfg: OrganizerInvoiceConfig): Promise<IzdaniRacun | null>;
     storniraj(racunId: string, razlog: string): Promise<void>;
   }
   ```
2. **`organizator`** (zadano) — ne izdaje ništa; bilježi da je obveza na organizatoru
   i izlaže mu podatke (iznos, vrijeme naplate, kupac, način plaćanja) u dashboardu
   i izvozu. Ovo je jedini provider koji smije raditi u produkciji do odgovora na §6.
3. **`fira`** — POST na FIRA Custom Webshop API; mapiranje polja preslikano iz
   `Mapping.gs::buildPayload` (kupac, stavka = tier, `termsHR/EN/DE`, klauzula
   čl. 90 za neobveznike PDV-a). Tip dokumenta: `FISKALNI_RAČUN`, `KARTICA`.
4. **`domovina_fiskal`** — POST `/api/v1/racun` s `nacinPlacanja: 'KARTICA'`,
   `FISKALNI_B2C`, `poslovniProstor: 'ONLINE1'`. **Samo TEST host.**
5. **Okidači:**
   - izdavanje: na `checkout.session.completed` **nakon** uspješnog izdavanja
     ulaznica (ne prije — račun za promet koji se nije dogodio je greška),
   - storno: na `charge.refunded` (`stornoZaId` / FIRA ekvivalent).
6. **Idempotencija**: jedan račun po narudžbi; ključ `(order_id, provider)` u D1.
   Ponovljeni webhook ne smije izdati drugi račun — u fiskalizaciji je to skuplja
   greška nego dupla ulaznica.
7. **Dostava**: PDF računa u istom e-mailu kao ulaznice (ili zasebno, ako provider
   šalje sam).
8. **Postavke u dashboardu** (U3): odabir providera, podaci izdavatelja, test/live
   prekidač koji **ne otključava produkciju** dok kod to ne dopusti.

**OUT:** eRačun B2B za pretplatu (nema pretplate), naplata fiskalizacije kao usluge,
knjigovodstveni izvještaji.

## Sigurnost i pravila

1. **Nikakav živi fiskalni promet dok §6.1 i §6.2 nisu odgovoreni.** Brava je u
   kodu (`provjeriOkolinu()`), ne u env varijabli.
2. **Slijednost brojeva:** organizator koji već fiskalizira na svojoj blagajni MORA
   dobiti zaseban PP ili NU za online prodaju. Ako toga nema — provider se ne smije
   aktivirati (tvrda provjera pri spremanju postavki).
3. Certifikati i API ključevi organizatora nikad u plaintextu u našoj bazi —
   `domovina-fiskal` ih drži enkriptirane (envelope, `ENC_MASTER_KEY`); mi držimo
   samo referencu.
4. Neuspjeh izdavanja računa **ne smije** poništiti ulaznicu — kupac je platio i
   ulaznica vrijedi; račun ide u red za ponovni pokušaj i alarm.

## Kriteriji prihvaćanja

```
1. Provider 'organizator': naplata → 0 poziva prema van, podaci vidljivi u dashboardu
2. Provider 'fira' (test ključ): naplata → račun s ispravnim iznosom, klauzulom
   čl. 90 za neobveznika i stavkom koja odgovara tieru
3. Provider 'domovina_fiskal' prema fiskal-test: račun s JIR + ZKI + PDF
4. Pokušaj postavljanja ne-test hosta → odbijeno u kodu
5. Ponovljeni webhook → i dalje JEDAN račun
6. Refund → storno račun, ulaznice poništene
7. Pad providera → ulaznica ostaje valjana, račun u redu za retry, alarm
```

## Zapisnik izvršenja

- Status: ⬜
- Commitovi:
- Odluke (koji provideri su pušteni i u kojoj okolini):
- Gotchai:
