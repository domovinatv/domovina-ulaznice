// Račun na naplaćenu narudžbu — pluggable provider (U5, minimalna jezgra).
//
// Tri pravila koja se ne krše, sva tri iz docs/04 i handoffa U5:
//
//   1. **Račun se izdaje TEK nakon uspješno izdanih ulaznica.** Račun za promet
//      koji se nije dogodio je gora greška od zakašnjelog računa.
//   2. **Pad providera NE poništava ulaznicu.** Kupac je platio, ulaznica
//      vrijedi; račun ide u red i podiže alarm. Ovo je razlog zašto se izdavanje
//      nikad ne izvodi tako da može baciti prema webhook handleru.
//   3. **Jedan račun po narudžbi i provideru**, i to na UNIQUE INDEX u D1, ne u
//      aplikacijskom kodu. U fiskalizaciji je dupli račun skuplji od duple
//      ulaznice: ulaznica se poništi, a broj u nizu je potrošen zauvijek.
//
// Zadani provider je `organizator` — ne radi ništa i to je namjerno. Dok
// ⚠️ ODLUKE 1–2 iz docs/04 §6 nisu odgovorene (tko je prodavatelj kod direct
// chargea s 0 %; pravni oblik punomoći), platforma ne smije izdavati fiskalne
// račune ni u čije ime. `organizator` znači: zabilježi da obveza postoji i
// isporuči organizatoru podatke, ne izdaj ništa.
//
// `domovina_fiskal` NIJE ovdje. Za njega vrijedi brava iz
// `rodjendaonice/apps/marketplace/worker/fiskal.ts::provjeriOkolinu()` (odbija
// svaki ne-test host) i to je zaseban posao — v. handoff U5.
import type { Env } from "./env";
import { firaProvider } from "./racun-fira";

export type ProviderId = "organizator" | "fira" | "domovina_fiskal";

export interface NaplacenaNarudzba {
  orderId: string;
  amountCents: number;
  quantity: number;
  tierTitle: string;
  kupac: { email: string; ime?: string | null };
  event: { title: string; venue_city: string | null; starts_at: string | null };
}

export interface IzdaniRacun {
  provider: ProviderId;
  ref: string | null;
  url: string | null;
  payload?: string;
}

export interface InvoiceProvider {
  readonly id: ProviderId;
  izdaj(env: Env, o: NaplacenaNarudzba): Promise<IzdaniRacun>;
}

/**
 * Zadani provider: platforma ne izdaje ništa, samo bilježi da obveza postoji.
 * Podaci (iznos, vrijeme naplate, kupac, način plaćanja) su organizatoru
 * vidljivi u pregledu prodaje i izvozu.
 */
export const organizatorProvider: InvoiceProvider = {
  id: "organizator",
  async izdaj(): Promise<IzdaniRacun> {
    return { provider: "organizator", ref: null, url: null };
  },
};

export function provider(id: string | null | undefined): InvoiceProvider {
  if (id === "fira") return firaProvider;
  // `domovina_fiskal` namjerno pada na `organizator` dok U5 ne donese bravu
  // okoline — tiho slanje fiskalnih podataka na krivi host je gore od nule.
  return organizatorProvider;
}

export type IzdavanjeIshod =
  | { status: "izdan"; racun: IzdaniRacun }
  | { status: "preskocen"; razlog: string }
  | { status: "vec_izdan" }
  | { status: "neuspjeh"; error: string };

/**
 * Izdaj račun za narudžbu — idempotentno, i nikad ne baca prema pozivatelju.
 *
 * Redoslijed je bitan: redak u `invoices` nastaje PRIJE poziva prema provideru.
 * Dva istovremena webhooka tako ne mogu oba krenuti u izdavanje — drugi puca na
 * unique indexu i odustane s `vec_izdan`.
 */
export async function izdajRacun(
  env: Env,
  providerId: string | null | undefined,
  o: NaplacenaNarudzba,
): Promise<IzdavanjeIshod> {
  const p = provider(providerId);

  if (p.id === "organizator") {
    await zapisi(env, o, "organizator", "preskocen", { detail: "obveza je na organizatoru" });
    return { status: "preskocen", razlog: "provider_organizator" };
  }

  // Zaključavanje: unique (order_id, provider). Ako redak već postoji i nije
  // neuspjeh, izdavanje je već obavljeno ili je u tijeku kod drugog pozivatelja.
  try {
    await env.DB.prepare(
      "INSERT INTO invoices (order_id, provider, status, amount_cents) VALUES (?,?,?,?)",
    )
      .bind(o.orderId, p.id, "u_tijeku", o.amountCents)
      .run();
  } catch {
    const red = await env.DB.prepare(
      "SELECT status FROM invoices WHERE order_id = ? AND provider = ?",
    )
      .bind(o.orderId, p.id)
      .first<{ status: string }>()
      .catch(() => null);
    if (red && red.status !== "neuspjeh") return { status: "vec_izdan" };
    // Prethodni pokušaj je pao — smijemo probati opet.
    await env.DB.prepare(
      "UPDATE invoices SET status = 'u_tijeku', attempts = attempts + 1, updated_at = datetime('now') " +
        "WHERE order_id = ? AND provider = ?",
    )
      .bind(o.orderId, p.id)
      .run()
      .catch(() => undefined);
  }

  try {
    const racun = await p.izdaj(env, o);
    await env.DB.prepare(
      "UPDATE invoices SET status = 'izdan', provider_ref = ?, payload = ?, error = NULL, " +
        "updated_at = datetime('now') WHERE order_id = ? AND provider = ?",
    )
      .bind(racun.ref, racun.payload ?? null, o.orderId, p.id)
      .run()
      .catch(() => undefined);
    console.log(JSON.stringify({ evt: "racun", order: o.orderId, provider: p.id, ref: racun.ref }));
    return { status: "izdan", racun };
  } catch (e) {
    const error = String((e as Error).message || e).slice(0, 500);
    await env.DB.prepare(
      "UPDATE invoices SET status = 'neuspjeh', error = ?, updated_at = datetime('now') " +
        "WHERE order_id = ? AND provider = ?",
    )
      .bind(error, o.orderId, p.id)
      .run()
      .catch(() => undefined);
    console.error(`[racun] ${p.id} za ${o.orderId}: ${error}`);
    return { status: "neuspjeh", error };
  }
}

/** Zabilježi ishod bez izdavanja (provider `organizator`, storno, preskakanje). */
export async function zapisi(
  env: Env,
  o: Pick<NaplacenaNarudzba, "orderId" | "amountCents">,
  providerId: ProviderId,
  status: string,
  extra: { ref?: string | null; detail?: string | null } = {},
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO invoices (order_id, provider, status, provider_ref, amount_cents, error) " +
      "VALUES (?,?,?,?,?,?) ON CONFLICT(order_id, provider) DO UPDATE SET " +
      "status = excluded.status, provider_ref = coalesce(excluded.provider_ref, invoices.provider_ref), " +
      "error = excluded.error, updated_at = datetime('now')",
  )
    .bind(o.orderId, providerId, status, extra.ref ?? null, o.amountCents, extra.detail ?? null)
    .run()
    .catch((e) => console.error(`[racun] zapis ${o.orderId}: ${String(e)}`));
}
