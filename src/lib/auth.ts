// Prijava organizatora i osoblja na ulazu.
//
// Identitet je isti GoTrue kao `domovina.ai` i `domovina-fiskal-app` — nema
// zasebnih korisnika za ulaznice. Browser NE razgovara s GoTrueom izravno nego
// kroz vlastiti Worker (`/api/organizator/prijava`), pa mu ne treba ni anon
// ključ ni adresa jezgre.
//
// Token stoji u `sessionStorage`, ne u `localStorage`: skener se često otvara na
// posuđenom mobitelu na ulazu i sesija mora umrijeti sa zatvaranjem taba. Cijena
// je da se osoblje ujutro prijavi jednom — to je prihvatljivo; ostavljena
// vječna sesija na tuđem uređaju nije.
//
// ⚠️ REVIEW(fable): refresh token se namjerno ne traži ni ne čuva. Posljedica:
// duga smjena na ulazu (GoTrue access token je tipično 1 h) traži ponovnu
// prijavu usred događaja. To je stvarna neugodnost i legitimno je riješiti je
// drukčije — ali svako rješenje znači trajniju tajnu na tuđem uređaju, pa je
// odluka svjesno na strani kraće sesije.

const KLJUC = "ulaznice.sesija";

export interface Sesija {
  access_token: string;
  email: string;
  /** epoch ms kad token istječe (procjena iz expires_in) */
  istek: number;
}

export function procitajSesiju(): Sesija | null {
  try {
    const raw = sessionStorage.getItem(KLJUC);
    if (!raw) return null;
    const s = JSON.parse(raw) as Sesija;
    if (!s?.access_token || Date.now() > s.istek) {
      sessionStorage.removeItem(KLJUC);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function spremiSesiju(s: Sesija): void {
  try {
    sessionStorage.setItem(KLJUC, JSON.stringify(s));
  } catch {
    // privatni prozor bez pohrane: sesija živi samo u memoriji stranice
  }
}

export function odjavi(): void {
  try {
    sessionStorage.removeItem(KLJUC);
  } catch {
    /* nema što počistiti */
  }
}

export class AuthError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function json<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new AuthError("neispravan_odgovor");
  }
  if (!res.ok) {
    const code = (body as { error?: string }).error ?? `http_${res.status}`;
    if (res.status === 401) odjavi();
    throw new AuthError(code);
  }
  return body as T;
}

export async function prijavi(email: string, lozinka: string): Promise<Sesija> {
  const r = await json<{ access_token: string; expires_in: number; email: string }>(
    "/api/organizator/prijava",
    { method: "POST", body: JSON.stringify({ email, lozinka }) },
  );
  // 60 s rezerve da zahtjev ne krene sekundu prije isteka
  const s: Sesija = {
    access_token: r.access_token,
    email: r.email,
    istek: Date.now() + Math.max(60, r.expires_in - 60) * 1000,
  };
  spremiSesiju(s);
  return s;
}

// ------------------------------------------------------------------ pozivi

export interface OrgTier {
  id: string;
  title: string;
  price_cents: number;
  inventory_total: number | null;
  inventory_claimed: number;
  imenska: boolean;
}

export interface OrgEvent {
  campaign_id: string;
  account_id: string;
  slug: string;
  title: string;
  state: string;
  visibility: string;
  event: { venue_city?: string; starts_at?: string | null; timezone?: string } | null;
  tiers: OrgTier[];
}

export interface OrgPregled {
  accounts: Array<{ id: string; name: string; allowlisted: boolean; has_record: boolean }>;
  events: OrgEvent[];
}

export const dohvatiPregled = (token: string): Promise<OrgPregled> =>
  json<OrgPregled>("/api/organizator/pregled", { method: "GET" }, token);

export interface SkenRezultat {
  status: "checked_in" | "already_checked_in" | "void" | "not_found";
  serial?: string;
  holder_name?: string | null;
  tier_title?: string | null;
  event_title?: string | null;
  checked_in_at?: string | null;
  checked_in_by_email?: string | null;
  checked_in_count?: number;
}

export const skenirajToken = (token: string, qr: string): Promise<SkenRezultat> =>
  json<SkenRezultat>("/api/skener/sken", { method: "POST", body: JSON.stringify({ qr_token: qr }) }, token);

/** URL izvoza sudionika; poziva se s tokenom pa se datoteka dohvaća fetchom. */
export async function preuzmiHoldere(token: string, campaignId: string): Promise<Blob> {
  const res = await fetch(`/api/organizator/holderi.csv?campaign_id=${encodeURIComponent(campaignId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new AuthError(res.status === 401 ? "nije_prijavljen" : `http_${res.status}`);
  return res.blob();
}
