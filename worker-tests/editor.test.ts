// Editor događaja (SPA /organizator/novi): pretvorbe forme u zahtjev.
import { test } from "node:test";
import assert from "node:assert/strict";
import { centiIzUnosa, prazanTier, provjeri, zahtjev, zidnoVrijemeUUtc, type UnosDogadjaja } from "../src/lib/editor.ts";

test("cijena: hrvatski zapis u cijele cente, bez floata", () => {
  assert.equal(centiIzUnosa("25"), 2500);
  assert.equal(centiIzUnosa("25,5"), 2550);
  assert.equal(centiIzUnosa("25,50 €"), 2550);
  assert.equal(centiIzUnosa("0,10"), 10);
  assert.equal(centiIzUnosa("1.250,00"), 125000);
  assert.equal(centiIzUnosa("0"), 0);
  for (const los of ["", "abc", "25.5", "25,555", "-5", "1,2,3"]) assert.equal(centiIzUnosa(los), null, los);
});

test("vrijeme: zidni sat u Zagrebu → UTC, i zimi i ljeti", () => {
  assert.equal(zidnoVrijemeUUtc("2027-01-15T20:00"), "2027-01-15T19:00:00.000Z");
  assert.equal(zidnoVrijemeUUtc("2027-07-15T20:00"), "2027-07-15T18:00:00.000Z");
  // dan prelaska na ljetno (28. 3. 2027.)
  assert.equal(zidnoVrijemeUUtc("2027-03-28T12:00"), "2027-03-28T10:00:00.000Z");
  assert.equal(zidnoVrijemeUUtc("nije datum"), null);
});

const unos = (izmjene: Partial<UnosDogadjaja> = {}): UnosDogadjaja => ({
  accountId: "00000000-0000-4000-8000-0000000000d2",
  naslov: "Koncert u parku",
  vrsta: "koncert",
  pocetak: "2027-06-01T20:00",
  kraj: "2027-06-01T22:30",
  mjesto: "Park Maksimir",
  adresa: "",
  grad: "Zagreb",
  opis: "",
  slika: "",
  organizator: "",
  email: "",
  web: "",
  tieri: [{ naziv: "Ulaz", cijena: "15", kolicina: "200", imenska: false }],
  ...izmjene,
});

test("provjera: ispravan unos nema grešaka, prazan ima sve obavezne", () => {
  assert.deepEqual(provjeri(unos()), {});
  const g = provjeri(unos({ accountId: "", naslov: " ", pocetak: "", mjesto: "", grad: "", tieri: [] }));
  for (const k of ["accountId", "naslov", "pocetak", "mjesto", "grad", "tieri"]) assert.ok(g[k], k);
});

test("provjera: kraj prije početka, loša slika i loša cijena ulaznice", () => {
  const g = provjeri(
    unos({ kraj: "2027-06-01T19:00", slika: "http://nesigurno.hr/a.jpg", tieri: [{ ...prazanTier(), naziv: "A", cijena: "x" }] }),
  );
  assert.ok(g.kraj);
  assert.ok(g.slika);
  assert.ok(g["tier.0.cijena"]);
});

test("zahtjev: centi, UTC, prazna polja kao null, količina prazna = neograničeno", () => {
  const z = zahtjev(unos({ tieri: [{ naziv: " Parter ", cijena: "25,50", kolicina: "", imenska: true }] }), "id-1");
  assert.equal(z.event_id, "id-1");
  assert.equal(z.starts_at, "2027-06-01T18:00:00.000Z");
  assert.equal(z.timezone, "Europe/Zagreb");
  assert.equal(z.venue_address, null);
  assert.deepEqual(z.tiers, [{ title: "Parter", price_cents: 2550, inventory_total: null, imenska: true }]);
});

// ------------------------------------------------------------ birač datuma

import { danasUZagrebu, mrezaMjeseca, nazivMjeseca, opisVremena, predlozeniKraj } from "../src/lib/kalendar.ts";

test("kalendar: mreža počinje ponedjeljkom, 42 dana, ispravni rubovi", () => {
  const srpanj = mrezaMjeseca(2027, 6); // 1. 7. 2027. je četvrtak
  assert.equal(srpanj.length, 42);
  assert.deepEqual(srpanj.slice(0, 4).map((d) => d.iso), ["2027-06-28", "2027-06-29", "2027-06-30", "2027-07-01"]);
  assert.equal(srpanj[3].uMjesecu, true);
  assert.equal(srpanj[0].uMjesecu, false);
  assert.equal(srpanj.filter((d) => d.uMjesecu).length, 31);
  // veljača prijestupne godine, prvi je ponedjeljak
  const veljaca = mrezaMjeseca(2028, 1);
  assert.equal(veljaca.filter((d) => d.uMjesecu).length, 29);
  assert.equal(mrezaMjeseca(2027, 2)[0].iso, "2027-03-01");
});

test("kalendar: hrvatski opisi i prijedlog kraja", () => {
  assert.equal(nazivMjeseca(2027, 6), "srpanj 2027.");
  assert.equal(opisVremena("2027-07-10T20:30"), "subota, 10. srpnja 2027. u 20:30");
  assert.equal(opisVremena(""), null);
  assert.equal(predlozeniKraj("2027-07-10T20:30"), "22:30");
  assert.equal(predlozeniKraj("2027-07-10T22:30"), "23:45");
  assert.equal(predlozeniKraj(""), "22:00");
  assert.equal(danasUZagrebu(new Date("2027-01-01T23:30:00Z")), "2027-01-02");
});
