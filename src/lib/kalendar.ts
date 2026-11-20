// Birač datuma i vremena u editoru događaja (src/components/KalendarPolje.tsx).
// Radi nad zidnim vremenom „YYYY-MM-DDTHH:MM” (isti oblik kao datetime-local),
// bez zone: pretvorbu u UTC radi `zidnoVrijemeUUtc` u editor.ts. Sva aritmetika
// ide preko Date.UTC, pa zona preglednika ne pomiče dane.

export interface Dan {
  /** „YYYY-MM-DD” */
  iso: string;
  dan: number;
  uMjesecu: boolean;
}

const dvije = (n: number) => String(n).padStart(2, "0");
export const isoDana = (g: number, m: number, d: number) => {
  const t = new Date(Date.UTC(g, m, d));
  return `${t.getUTCFullYear()}-${dvije(t.getUTCMonth() + 1)}-${dvije(t.getUTCDate())}`;
};

/** 6 tjedana × 7 dana za mjesec `m` (0–11), tjedan počinje ponedjeljkom. */
export function mrezaMjeseca(g: number, m: number): Dan[] {
  const prvi = new Date(Date.UTC(g, m, 1));
  const pomak = (prvi.getUTCDay() + 6) % 7; // pon = 0
  return Array.from({ length: 42 }, (_, i) => {
    const t = new Date(Date.UTC(g, m, 1 - pomak + i));
    return { iso: isoDana(g, m, 1 - pomak + i), dan: t.getUTCDate(), uMjesecu: t.getUTCMonth() === m };
  });
}

export const DANI_KRATKO = ["pon", "uto", "sri", "čet", "pet", "sub", "ned"];

/** „srpanj 2027.” */
export function nazivMjeseca(g: number, m: number): string {
  const ime = new Intl.DateTimeFormat("hr-HR", { month: "long", timeZone: "UTC" })
    .formatToParts(new Date(Date.UTC(g, m, 1)))
    .find((p) => p.type === "month")?.value;
  return `${ime ?? ""} ${g}.`;
}

/** „2027-07-10T20:30” → „subota, 10. srpnja 2027. u 20:30”; neispravno → null. */
export function opisVremena(vrijednost: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(vrijednost);
  if (!m) return null;
  const datum = new Intl.DateTimeFormat("hr-HR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  return `${datum} u ${m[4]}:${m[5]}`;
}

/** Današnji datum po Zagrebu, „YYYY-MM-DD”. */
export function danasUZagrebu(sada = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zagreb" }).format(sada);
}

/** Sat koji kraj predlaže: dva sata nakon početka, najkasnije 23:45. */
export function predlozeniKraj(pocetak: string): string {
  const m = /T(\d{2}):(\d{2})$/.exec(pocetak);
  if (!m) return "22:00";
  const min = Math.min(+m[1] * 60 + +m[2] + 120, 23 * 60 + 45);
  return `${dvije(Math.floor(min / 60))}:${dvije(min % 60)}`;
}
