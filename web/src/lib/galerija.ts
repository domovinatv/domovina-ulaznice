// Galerija stranice događaja: naslovna slika + `event.gallery` (migracija
// `events_gallery` u jezgri). Ovdje je samo odabir i čišćenje; prikaz je
// `components/Galerija.astro`.
import type { EventDetails } from "./api.ts";
import { sigurniUrl } from "./format.ts";

export interface SlikaGalerije {
  url: string;
  alt: string;
}

/** Jezgra dopušta 20 u galeriji; naslovna je još jedna. */
export const NAJVISE_SLIKA = 21;

/**
 * Sve slike događaja redom prikaza: naslovna prva, pa galerija. Nesigurni
 * URL-ovi (sve osim http/https) i duplikati se izbacuju. Galerija se na
 * stranici prikazuje tek kad je slika više od jedne.
 */
export function slikeGalerije(
  d: Pick<EventDetails, "gallery"> | null | undefined,
  naslovna: { url: string; alt?: string | null } | null,
  naslovDogadjaja: string,
): SlikaGalerije[] {
  const kandidati = [...(naslovna ? [naslovna] : []), ...(Array.isArray(d?.gallery) ? d.gallery : [])];
  const vidjeno = new Set<string>();
  const slike: SlikaGalerije[] = [];
  for (const k of kandidati) {
    const url = typeof k?.url === "string" ? sigurniUrl(k.url) : null;
    if (!url || vidjeno.has(url)) continue;
    vidjeno.add(url);
    const alt = typeof k.alt === "string" ? k.alt.trim() : "";
    slike.push({ url, alt: alt || `${naslovDogadjaja}, slika ${slike.length + 1}` });
    if (slike.length === NAJVISE_SLIKA) break;
  }
  return slike;
}
