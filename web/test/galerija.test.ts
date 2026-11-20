// Galerija stranice događaja: naslovna + `event.gallery`, čišćenje URL-ova.
import { test } from "node:test";
import assert from "node:assert/strict";

import { NAJVISE_SLIKA, slikeGalerije } from "../src/lib/galerija.ts";

const naslovna = { url: "https://slike.hr/naslovna.jpg", alt: "Naslovna" };

test("naslovna je prva, galerija slijedi redom", () => {
  const s = slikeGalerije(
    { gallery: [{ url: "https://slike.hr/1.jpg", alt: "Prva" }, { url: "https://slike.hr/2.jpg" }] },
    naslovna,
    "Koncert",
  );
  assert.deepEqual(
    s.map((x) => x.url),
    ["https://slike.hr/naslovna.jpg", "https://slike.hr/1.jpg", "https://slike.hr/2.jpg"],
  );
  assert.equal(s[1].alt, "Prva");
  assert.equal(s[2].alt, "Koncert, slika 3", "bez alta dobiva opisni zamjenski tekst");
});

test("bez galerije i bez naslovne nema slika; stara jezgra (bez polja) ne puca", () => {
  assert.deepEqual(slikeGalerije({}, null, "X"), []);
  assert.deepEqual(slikeGalerije(null, null, "X"), []);
  assert.equal(slikeGalerije({ gallery: [] }, naslovna, "X").length, 1);
});

test("nesigurni URL-ovi, duplikati i smeće se izbacuju", () => {
  const s = slikeGalerije(
    {
      gallery: [
        { url: "javascript:alert(1)" },
        { url: "data:image/png;base64,AAAA" },
        { url: "https://slike.hr/naslovna.jpg" },
        { url: 7 as unknown as string },
        { url: "https://slike.hr/ok.jpg", alt: "   " },
      ],
    },
    naslovna,
    "Y",
  );
  assert.deepEqual(
    s.map((x) => x.url),
    ["https://slike.hr/naslovna.jpg", "https://slike.hr/ok.jpg"],
  );
  assert.equal(s[1].alt, "Y, slika 2");
});

test("najviše NAJVISE_SLIKA slika", () => {
  const gallery = Array.from({ length: 40 }, (_, i) => ({ url: `https://slike.hr/${i}.jpg` }));
  assert.equal(slikeGalerije({ gallery }, naslovna, "Z").length, NAJVISE_SLIKA);
});
