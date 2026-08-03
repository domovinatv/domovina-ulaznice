// QR → PNG: slika mora biti stvarno valjan PNG (potpis, IHDR, CRC, zlib),
// jer je to jedina kopija ulaznice koju kupac dobije.
import { strict as assert } from "node:assert";
import { inflateSync } from "node:zlib";
import { test } from "node:test";
import { QR_PREFIX, qrMatrix, qrPng } from "../worker/qr.ts";

const TOKEN = "a".repeat(64);

test("QR matrica sadrži prefiks skenera i kvadratna je", () => {
  const m = qrMatrix(TOKEN);
  assert.ok(m.length >= 21, "premala matrica");
  assert.equal(m.length, m[0].length);
  assert.ok(QR_PREFIX.length > 0);
  // finder pattern gore lijevo: 7×7 okvir, kut je uvijek taman
  assert.equal(m[0][0], true);
  assert.equal(m[0][6], true);
  assert.equal(m[1][1], false);
});

test("PNG ima ispravan potpis, IHDR i IEND", () => {
  const png = qrPng(TOKEN, { scale: 3, margin: 4 });
  assert.deepEqual(Array.from(png.slice(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(dv.getUint32(8), 13, "IHDR mora imati 13 bajtova");
  assert.equal(String.fromCharCode(...png.slice(12, 16)), "IHDR");

  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  const modules = qrMatrix(TOKEN).length;
  assert.equal(width, (modules + 8) * 3);
  assert.equal(height, width, "QR je kvadrat");
  assert.equal(png[24], 1, "bit depth 1");
  assert.equal(png[25], 0, "grayscale");

  assert.equal(String.fromCharCode(...png.slice(png.length - 8, png.length - 4)), "IEND");
});

test("IDAT je valjan zlib stream i dekodira se u očekivane retke", () => {
  const scale = 2;
  const margin = 4;
  const m = qrMatrix(TOKEN);
  const side = (m.length + margin * 2) * scale;
  const png = qrPng(TOKEN, { scale, margin });

  // pronađi IDAT chunk
  let off = 8;
  let idat: Uint8Array | null = null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.slice(off + 4, off + 8));
    if (type === "IDAT") idat = png.slice(off + 8, off + 8 + len);
    off += 12 + len;
  }
  assert.ok(idat, "nema IDAT chunka");

  const raw = inflateSync(Buffer.from(idat!));
  const rowBytes = Math.ceil(side / 8);
  assert.equal(raw.length, (rowBytes + 1) * side, "krivi broj bajtova nakon dekompresije");

  // prvi red je u tihoj zoni → sve bijelo (bitovi 1), filter bajt 0
  assert.equal(raw[0], 0);
  assert.equal(raw[1], 0xff);

  // prvi piksel prvog modula (nakon margine) mora biti taman (bit 0)
  const y = margin * scale;
  const base = y * (rowBytes + 1);
  const x = margin * scale;
  const bit = (raw[base + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
  assert.equal(bit, 0, "prvi modul finder patterna mora biti crn");
});

test("PNG ostaje razumno malen (ide kao privitak e-maila)", () => {
  const png = qrPng(TOKEN, { scale: 4 });
  assert.ok(png.length < 20_000, `PNG prevelik: ${png.length} B`);
});
