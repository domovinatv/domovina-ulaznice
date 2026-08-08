# seeds/ — demo podaci za lokalni rad

Ovi SQL-ovi se primjenjuju na **`domovina-api` lokalni stack** (shema
`pinka_finance`), ne na D1 ovog repoa — ulaznice, narudžbe i eventi žive tamo
(v. [`docs/02-arhitektura.md`](../docs/02-arhitektura.md) §1).

```bash
# u domovina-api: supabase start -x edge-runtime,imgproxy  (ili pun start)
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -f seeds/prilika-za-susret-2026.sql
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -f seeds/susret-zagreb-2027.sql
```

| Datoteka | Što je |
| --- | --- |
| `prilika-za-susret-2026.sql` | **stvarni** nadolazeći događaji koje organizira Prilika za Susret: Badija (12.–17. 8. 2026.), Sinj (19. 9. 2026.) i Varaždin (14. 11. 2026.). Datum, satnica i mjesto sa stranica organizatora; kotizacije iz njegovih vlastitih FIRA konfiguracija (`fira-forms-connector/google-apps-script/events/*/Config.gs`). Varaždin nema objavljen cjenik pa **namjerno nema tierova**. |
| `susret-zagreb-2027.sql` | **stvarni** događaj — Međunarodni susret osoba otvorenih za katolički brak, Zagreb, 12.–14. 2. 2027. Podaci sa stranice organizatora; cjenik i satnica nisu objavljeni pa su iznosi preuzeti s vikend susreta Šibenik 2026. istog organizatora i to piše u opisu događaja. |
| `demo-dom-sportova.sql` | izmišljeni događaj za demonstraciju rubnih stanja (rasprodan tier, "još N komada", zatvoren prodajni prozor) |

Sva tri „stvarna" seeda dijele isti račun organizatora (`…0000e2`), pa se mogu
pustiti u bilo kojem redoslijedu. Svaki je idempotentan — drugi run vraća
`existing: true` i ništa ne mijenja.

**Što u seedovima namjerno NIJE popunjeno**, jer organizator to nije objavio:
kapacitet (`inventory_total` je `NULL` → bez limita, umjesto lažnog „još N
komada"), mjesto održavanja u Varaždinu, te cjenik za Varaždin. Ljetni kamp
Papuk i Susret Visoko BiH nisu u katalogu — na njihovim stranicama doslovno
piše da PzS nije organizator.

⚠️ Oba seeda pale Stripe rail (`organizer_payment_rails` s izmišljenim `acct_…`),
pa su događaji "kupivi" samo lokalno, protiv mock Stripea. Ništa od ovoga ne ide
na javni URL dok organizator ne potvrdi cjenik.
