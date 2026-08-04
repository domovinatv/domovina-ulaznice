# seeds/ — demo podaci za lokalni rad

Ovi SQL-ovi se primjenjuju na **`domovina-api` lokalni stack** (shema
`pinka_finance`), ne na D1 ovog repoa — ulaznice, narudžbe i eventi žive tamo
(v. [`docs/02-arhitektura.md`](../docs/02-arhitektura.md) §1).

```bash
# u domovina-api: supabase start -x edge-runtime,imgproxy  (ili pun start)
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -f seeds/susret-zagreb-2027.sql
```

| Datoteka | Što je |
| --- | --- |
| `susret-zagreb-2027.sql` | **stvarni** događaj — Međunarodni susret osoba otvorenih za katolički brak, Zagreb, 12.–14. 2. 2027. Podaci sa stranice organizatora; cjenik i satnica nisu objavljeni pa su iznosi preuzeti s vikend susreta Šibenik 2026. istog organizatora i to piše u opisu događaja. |
| `demo-dom-sportova.sql` | izmišljeni događaj za demonstraciju rubnih stanja (rasprodan tier, "još N komada", zatvoren prodajni prozor) |

⚠️ Oba seeda pale Stripe rail (`organizer_payment_rails` s izmišljenim `acct_…`),
pa su događaji "kupivi" samo lokalno, protiv mock Stripea. Ništa od ovoga ne ide
na javni URL dok organizator ne potvrdi cjenik.
