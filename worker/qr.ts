// QR kod → PNG, bez ijedne native ovisnosti (radi u Workeru i u node:testu).
//
// Zašto vlastiti PNG enkoder: sve gotove biblioteke koje rade PNG u Nodeu
// (pngjs, canvas) vuku native/stream API koji Worker runtime nema. QR matricu
// računa `qrcode-generator` (čisti JS, bez ovisnosti), a slika je 1-bitni
// grayscale PNG s "stored" deflate blokovima — nekomprimirano, ali QR je crno-
// bijeli pa je i tako par kilobajta.
//
// Zašto PNG privitak, a ne <img src="data:…">: Gmail i Outlook blokiraju
// data: URI-je u e-mailu. Privitak s `content_id` (cid:) prolazi svugdje.
import qrcodeGenerator from "qrcode-generator";

/** Prefiks QR payloada — isti kao skener u domovina-api (events-checkin ga tolerira). */
export const QR_PREFIX = "dgdj1:";

export interface QrPngOptions {
  /** Piksela po modulu (4 → ~180 px za tipičnu ulaznicu). */
  scale?: number;
  /** Tiha zona u modulima (QR spec traži 4). */
  margin?: number;
}

/** QR matrica za goli 64-hex token (skener prima i s prefiksom i bez njega). */
export function qrMatrix(token: string): boolean[][] {
  const qr = qrcodeGenerator(0, "M");
  qr.addData(`${QR_PREFIX}${token}`);
  qr.make();
  const n = qr.getModuleCount();
  const out: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    out.push(row);
  }
  return out;
}

/** PNG bajtovi QR koda za dani token. */
export function qrPng(token: string, opts: QrPngOptions = {}): Uint8Array {
  const scale = opts.scale ?? 4;
  const margin = opts.margin ?? 4;
  const m = qrMatrix(token);
  const modules = m.length;
  const side = (modules + margin * 2) * scale;

  // 1 bit po pikselu: 0 = crno (tamni modul), 1 = bijelo.
  const rowBytes = Math.ceil(side / 8);
  const raw = new Uint8Array((rowBytes + 1) * side);
  for (let y = 0; y < side; y++) {
    const base = y * (rowBytes + 1);
    raw[base] = 0; // filter type 0 (None)
    const my = Math.floor(y / scale) - margin;
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / scale) - margin;
      const dark = my >= 0 && my < modules && mx >= 0 && mx < modules && m[my][mx];
      if (!dark) raw[base + 1 + (x >> 3)] |= 0x80 >> (x & 7); // bijelo = bit 1
    }
  }

  return buildPng(side, side, raw);
}

/** PNG kao data: URI (za pregled u browseru; u e-mail ide privitak). */
export function qrDataUri(token: string, opts?: QrPngOptions): string {
  return `data:image/png;base64,${base64(qrPng(token, opts))}`;
}

export function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ------------------------------------------------------------------- PNG kosti

function buildPng(width: number, height: number, raw: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const chunks = [
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return concat([sig, ...chunks]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib stream s nekomprimiranim ("stored") deflate blokovima. */
function zlibStored(data: Uint8Array): Uint8Array {
  const MAX = 65535;
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let off = 0;
  do {
    const len = Math.min(MAX, data.length - off);
    const final = off + len >= data.length ? 1 : 0;
    const head = new Uint8Array(5);
    head[0] = final;
    head[1] = len & 0xff;
    head[2] = (len >> 8) & 0xff;
    head[3] = ~len & 0xff;
    head[4] = (~len >> 8) & 0xff;
    parts.push(head, data.subarray(off, off + len));
    off += len;
  } while (off < data.length);
  const adler = new Uint8Array(4);
  new DataView(adler.buffer).setUint32(0, adler32(data));
  parts.push(adler);
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
