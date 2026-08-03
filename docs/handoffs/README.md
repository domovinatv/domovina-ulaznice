# Handoff promptovi — domovina-ulaznice

> Datum: 2026-08-03 · Jezik: HR
> Svaki dokument u ovom folderu je **samodostatan handoff prompt**: referenciraš ga
> u praznoj Claude Code sesiji i agent može izvršiti fazu bez dodatnog konteksta.
> Format je preuzet iz `safe-wallet-monorepo/docs/whitelabel-wallet/handoffs/`, gdje
> je dokazano da agenti njime izvršavaju faze **bez ijednog dodatnog pitanja**
> (doc 13 §2).

## Struktura svakog handoffa

```
Cilj                    jedna rečenica, mjerljiva
Kontekst i izvori       TOČNE datoteke koje treba pročitati prije koda
Preduvjeti              ručni (vlasnik) i tehnički
Opseg IN / OUT          što se smije dirati, što ne
Sigurnost               invarijanti koje se ne smiju prekršiti
Kriteriji prihvaćanja   provjerljivo, po mogućnosti curl/test
Zapisnik izvršenja      ★ agent ga popunjava na kraju — ugovor prema idućoj fazi
```

## Faze

| #   | Handoff                                                     | Repo                              | Ovisi o | Status |
| --- | ------------------------------------------------------------ | --------------------------------- | ------- | ------ |
| U1  | [Stripe rail u backendu](u1-stripe-rail-backend.md)         | `domovina-api`                    | —       | ⬜     |
| U2  | [Javna prodaja end-to-end](u2-javna-prodaja-web.md)         | ovaj repo                         | U1      | ⬜     |
| U3  | [Organizator self-service](u3-organizator-dashboard.md)     | ovaj repo (+ `domovina-api`)      | U2      | ⬜     |
| U4  | [Check-in PWA](u4-checkin-pwa.md)                           | ovaj repo                         | U2      | ⬜     |
| U5  | [Računi / fiskalizacija](u5-racuni-fiskalizacija.md)        | ovaj repo (+ `domovina-fiskal`)   | U3, U4  | ⬜     |
| U6  | [airKUNA rail](u6-airkuna-rail.md)                          | ovaj repo + `safe-wallet-monorepo`| U2      | ⬜     |

## Pravila za svakog agenta

1. **Pročitaj prije koda:** `docs/02-arhitektura.md`, `docs/05-podatkovni-model.md`,
   `docs/07-prior-art-reuse-mapa.md`, i lekcije u
   `safe-wallet-monorepo/docs/whitelabel-wallet/13-lekcije-sesije-dogadjaji.md`.
2. **Ne izmišljaj ono što postoji** — mapa preuzimanja je u doc 07 §2.
3. **Ulaznice, narudžbe i inventory žive isključivo u `pinka_finance`.** Lokalna
   kopija u D1/KV = prekršena granica.
4. **Novac nikad ne prolazi kroz platformu** (direct charge, 0 % fee). Svaka ideja
   koja to mijenja ide prvo na poreznu provjeru (doc 04 §6).
5. **Poslovni ishodi u SQL RPC-ovima su status jsonb, ne exceptioni.**
6. **Idempotencija ide na unique index u bazi.**
7. Commit konvencija ovog repoa: `feat(u2): …`, `fix(u1): …`, hrvatski opisi.
   Konvencija `domovina-api`: vidi `git log` tog repoa prije prvog commita.
8. Na kraju faze **popuni Zapisnik izvršenja** u svom handoffu i označi status.
