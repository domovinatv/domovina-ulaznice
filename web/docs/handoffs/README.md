# Handoffi za sesije S1–S7 i S2b (web/)

Plan je u [`../plan.md`](../plan.md), odluke u [`../decisions.md`](../decisions.md),
radna lista u [`../../TODO.md`](../../TODO.md). Svaka sesija ima svoj handoff `SN.md`.
Nakon `/clear` reci „nastavi web” (prvi otvoreni red u „Stanje lanca”) ili zalijepi
prompt iz clipboarda.

Ovaj lanac je odvojen od `docs/handoffs/` u korijenu (faze U1–U7).

## Lanac

1. Sesija N počinje iz `web/docs/handoffs/SN.md`.
2. Sesija N radi svoj paket po pravilima ispod.
3. Na kraju sesija N:
   - označi `SN` u tablici „Stanje lanca” (commit, testovi, napomena) i stavke u `TODO.md`;
   - **ako je naučila nešto što mijenja sljedeće pakete, uredi `S(N+1).md`**, a po potrebi
     i kasnije handoffe i plan. Nedovršeni dio paketa N ide na **vrh** `S(N+1).md`;
   - u `S(N+1).md` upiše polazni commit i brojke iz `check`a;
   - pusha fork i otvori PR (v. „Fork i PR”);
   - pozove `/wrap-up`. Handoff prompt je **sadržaj `S(N+1).md`**.
4. Ako sesija ostane bez konteksta usred paketa, nastavak je opet `SN` s popisom onoga što
   je ostalo na vrhu datoteke. Broj se ne povećava.
5. **Vrata.** Kad je sljedeći korak ljudski (dizajn, deploy), sesija upiše pitanje na vrh
   `S(N+1).md` i lanac staje dok korisnik ne odluči ili ne napravi korak.
6. Handoff se mijenja samo prema naprijed: gotovi `SN` se ne prepisuju.

## Stanje lanca

| Sesija | Paket | Stanje | Commit | Testovi | Napomena |
| --- | --- | --- | --- | --- | --- |
| S0 | plan, odluke, handoffi | gotovo | 0506839 | korijen 97 | Matija, 2026-11-19; odluke 1–13 |
| K0 | infrastruktura: Workeri, domene, test seed pripremljen | gotovo | cbeb792 | — | Matija; odluke 22–24 |
| S1 | Astro kostur, tipovi, mock, mjerenje SSR-a, design brief | gotovo | 010ab24 | web 13, korijen 97 | Ivan, 2026-11-19; odluke 100–107; SSR na Workersu radi |
| — | (!) dizajn u Claude Designu | gotovo | (ovaj commit) | — | 2026-11-19, stil kao Luma; 14 artboarda, `web/design/README.md` |
| S2 | dizajnerski sustav | gotovo | fdc3fed | web 26, korijen 97 | Ivan, 2026-11-19; odluke 200–209; snimke `/_komponente` |
| S2b | dorada sheme događaja (Ivanov prijedlog) | gotovo | (ovaj commit) | web 58, korijen 99 | Ivan, 2026-11-20; odluke 250–253; `domovina-api` zaseban PR |
| — | (!) migracija jezgre i `events-feed` | čeka | | | Matija; `docs/deploy-dug.md` #5, migracija prije `events-feed` |
| S3 | popis i događaj | gotovo | f81f559 | web 58, korijen 97 | Ivan, 2026-11-20; odluke 300–311; S2b i dalje otvoren |
| S4 | kupnja | gotovo | 6820547 | web 106, korijen 99 | Ivan, 2026-11-20; odluke 400–412; e2e kroz mock |
| S5 | narudžba, pravno, 404 | gotovo | 0e39ef1 | web 133, korijen 99 | Ivan, 2026-11-20; odluke 500–517; QR namjerno ne (501); `npm run e2e` |
| S6 | service binding, lokalna e2e | gotovo | 346b57b | web 133, korijen 108 | Ivan, 2026-11-20; odluke 600–607; `e2e:stack` kroz :8788 |
| — | (!) staging deploy | čeka | | | Matija |
| — | izvan lanca: prijava kodom, galerija, editor događaja | gotovo | a423316 | korijen 126, web 137 | Ivan, 2026-11-20; `docs/2026-11-20-prijava-kodom-galerija-editor.md`, deploy-dug #7–#9 |
| S7 | mjerenje, čišćenje SPA-a, dokumentacija | otvoreno | | | |

## Zajednička pravila (vrijede u svakoj sesiji)

- **Polazak:** `git fetch upstream && git merge --ff-only upstream/main`, zatim u korijenu
  `npm ci && npm test && npm run build`, a od S1 nadalje i `npm --prefix web ci && npm --prefix web run check`.
  Jedna rečenica da je zeleno. Ako nije, prvo to popravi.
- **Opseg:** smije se dirati `web/`, `shared/`, a `src/lib/api.ts` samo radi uvoza
  zajedničkih tipova. `worker/` samo u S2b (prosljeđivanje novih polja) i S6 (service binding) ili uz odluku 6.
  `../domovina-api` samo u S2b.
  `src/pages/` se briše tek u S7. Nikad: `migrations/`, `seeds/`, `mobile/` (osim
  `mobile/mock-api.mjs` po odluci 6), `wrangler.jsonc` u korijenu (osim S6).
- **Tvrdi uvjeti iz `plan.md`:** `web/` bez baze i tajni, nikad izravno na
  `api.domovina.ai`, ugovor `/api/*` se ne mijenja, novac u centima, produkcija ne.
- **Orkestracija:** posao rade Opus subagenti, glavna sesija orkestrira. Paket razbij na
  dva agenta: (a) implementacija, (b) testovi i spajanje. `effort` zadaj eksplicitno
  (`high` za kod, `medium` za čitanje). Najviše 2–3 agenta paralelno. Fable samo ako
  Matija izričito odobri.
- **Agentima zabrani** `TODO.md`, `plan.md`, `decisions.md` i handoffe. Orkestrator ih
  ažurira.
- **Testovi:** bez mreže, `skipped 0`. Mock (`mobile/mock-api.mjs`) je lokalni proces i
  smije se pokretati.
- **Brojke** (broj testova, veličina bundlea, Lighthouse) samo uz naredbu kojom su dobivene.
- **Trošak:** procjena prije svega što ima više od ~100 LLM poziva; nikad `claude -p` petlja.
- **Autonomno:** sitne odluke donesi sam i zapiši u `decisions.md` u bloku sesije. Commitaj
  svaki zeleni korak. Deploy, tajne i sve na Cloudflare računu ostavi Matiji.
- **Token budget:** bez Monitora za napredak. Oko 150k konteksta zatvori sesiju po lancu.
- **Istraživanja i mjerenja** idu u `web/docs/research/YYYY-MM-DD-*.md`.
- **Iz korijenskog `CLAUDE.md`:** hrvatski u UI-ju i dokumentaciji, commit
  `feat(web): …`; tajne nikad u repo; promjena koja traži deploy upisuje se u
  `docs/deploy-dug.md` u istom commitu.

## Fork i PR

Ivan radi u `IStep95/domovina-ulaznice` (`origin`), upstream je
`domovinatv/domovina-ulaznice` (`upstream`). Na kraju sesije:

```bash
git push origin main
gh pr create --repo domovinatv/domovina-ulaznice --head IStep95:main \
  --title "web: SN <paket>" --body-file web/docs/handoffs/SN.md
```

Sljedeća sesija kreće tek kad je PR mergean (polazak radi `merge --ff-only upstream/main`).
