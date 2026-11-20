// Editor događaja (SPA /organizator/novi): pretvorbe iz forme u zahtjev za
// POST /api/organizator/dogadjaj. Čiste funkcije, testovi u worker-tests/editor.test.ts.

export const ZONA = "Europe/Zagreb";

/** Ponuđene vrste; jezgra traži `^[a-z0-9_]{1,40}$`, stranica kupaca ispisuje s velikim slovom. */
export const VRSTE: ReadonlyArray<[string, string]> = [
  ["koncert", "Koncert"],
  ["konferencija", "Konferencija"],
  ["predstava", "Predstava"],
  ["radionica", "Radionica"],
  ["festival", "Festival"],
  ["sport", "Sport"],
  ["ostalo", "Ostalo"],
];

/**
 * „25”, „25,5”, „25,50”, „1.250,00” → cijeli centi. Nikad float: dijelovi se
 * čitaju kao znamenke. Neispravan unos → null.
 */
export function centiIzUnosa(unos: string): number | null {
  const s = unos.trim().replace(/\s|€/g, "");
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const eura = Number(m[1].replace(/\./g, ""));
  const centi = Number((m[2] ?? "0").padEnd(2, "0"));
  const ukupno = eura * 100 + centi;
  return Number.isSafeInteger(ukupno) && ukupno <= 999_999_999 ? ukupno : null;
}

/**
 * Zidno vrijeme iz `<input type="datetime-local">` („2027-05-10T20:00”) u
 * zoni događaja → ISO u UTC. Ne ovisi o zoni preglednika: organizator iz
 * inozemstva i dalje upisuje sat po Zagrebu.
 */
export function zidnoVrijemeUUtc(vrijednost: string, zona = ZONA): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(vrijednost);
  if (!m) return null;
  const [g, mj, d, h, min] = m.slice(1).map(Number);
  const kaoUtc = Date.UTC(g, mj - 1, d, h, min);
  // pomak zone u tom trenutku; dvaput, da prelazak na ljetno računanje sjedne
  let t = kaoUtc - pomak(kaoUtc, zona);
  t = kaoUtc - pomak(t, zona);
  return new Date(t).toISOString();
}

function pomak(t: number, zona: string): number {
  const dijelovi = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zona,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(t))
      .map((p) => [p.type, p.value]),
  );
  const lokalno = Date.UTC(+dijelovi.year, +dijelovi.month - 1, +dijelovi.day, +dijelovi.hour, +dijelovi.minute);
  return lokalno - Math.floor(t / 60_000) * 60_000;
}

export interface UnosTiera {
  naziv: string;
  cijena: string;
  kolicina: string;
  imenska: boolean;
}

export interface UnosDogadjaja {
  accountId: string;
  naslov: string;
  vrsta: string;
  pocetak: string;
  kraj: string;
  mjesto: string;
  adresa: string;
  grad: string;
  opis: string;
  slika: string;
  organizator: string;
  email: string;
  web: string;
  tieri: UnosTiera[];
}

export const prazanTier = (): UnosTiera => ({ naziv: "", cijena: "", kolicina: "", imenska: false });

/** Greške po polju (ključ = ime polja ili `tier.<i>.<polje>`), poruke na hrvatskom. */
export type Greske = Record<string, string>;

export function provjeri(u: UnosDogadjaja): Greske {
  const g: Greske = {};
  if (!u.accountId) g.accountId = "Odaberi organizatora.";
  if (!u.naslov.trim()) g.naslov = "Upiši naziv događaja.";
  else if (u.naslov.trim().length > 160) g.naslov = "Naziv je predug (najviše 160 znakova).";
  if (!u.pocetak) g.pocetak = "Upiši početak.";
  else if (!zidnoVrijemeUUtc(u.pocetak)) g.pocetak = "Neispravan datum.";
  if (u.kraj && u.pocetak && u.kraj <= u.pocetak) g.kraj = "Kraj mora biti nakon početka.";
  if (!u.mjesto.trim()) g.mjesto = "Upiši mjesto (npr. dvoranu).";
  if (!u.grad.trim()) g.grad = "Upiši grad.";
  if (u.slika.trim() && !/^https:\/\/\S+$/i.test(u.slika.trim())) g.slika = "Link slike mora počinjati s https://.";
  if (u.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(u.email.trim())) g.email = "Neispravna e-mail adresa.";
  if (u.tieri.length === 0) g.tieri = "Dodaj barem jednu vrstu ulaznice.";
  u.tieri.forEach((t, i) => {
    if (!t.naziv.trim()) g[`tier.${i}.naziv`] = "Upiši naziv ulaznice.";
    if (centiIzUnosa(t.cijena) === null) g[`tier.${i}.cijena`] = "Upiši cijenu, npr. 25 ili 25,50.";
    if (t.kolicina.trim() && !/^\d{1,7}$/.test(t.kolicina.trim())) g[`tier.${i}.kolicina`] = "Količina je cijeli broj.";
  });
  return g;
}

/** Tijelo za POST /api/organizator/dogadjaj. Zove se tek kad `provjeri` nema grešaka. */
export function zahtjev(u: UnosDogadjaja, eventId: string): Record<string, unknown> {
  const prazno = (s: string) => s.trim() || null;
  return {
    event_id: eventId,
    account_id: u.accountId,
    title: u.naslov.trim(),
    event_type: u.vrsta,
    starts_at: zidnoVrijemeUUtc(u.pocetak),
    ends_at: u.kraj ? zidnoVrijemeUUtc(u.kraj) : null,
    timezone: ZONA,
    venue_name: u.mjesto.trim(),
    venue_address: prazno(u.adresa),
    venue_city: u.grad.trim(),
    description_hr: prazno(u.opis),
    cover_image_url: prazno(u.slika),
    organizer_name: prazno(u.organizator),
    organizer_email: prazno(u.email),
    organizer_web: prazno(u.web),
    tiers: u.tieri.map((t) => ({
      title: t.naziv.trim(),
      price_cents: centiIzUnosa(t.cijena),
      inventory_total: t.kolicina.trim() ? Number(t.kolicina.trim()) : null,
      imenska: t.imenska,
    })),
  };
}
