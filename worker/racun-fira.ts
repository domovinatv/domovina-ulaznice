// FIRA Custom Webshop API — račun kupcu na naplaćenu narudžbu.
//
// Zašto baš FIRA, i zašto prva: prvi organizator (Prilika za Susret) VEĆ izdaje
// račune kroz FIRA-u, iz retka koji u Google Sheet upiše Forms prijava
// (`stepanic/fira-forms-connector`). Ako prodaja pređe na platformu, tog retka
// više nema — pa nema ni računa. Za organizatora to nije regresija u udobnosti
// nego u zakonitosti: obveza fiskalizacije je aktivna od 1. 1. 2026., okidač je
// način naplate (kartica), a obveznik je organizator (docs/04 §1).
//
// Payload je preslikan iz `fira-forms-connector/google-apps-script/modules/
// Mapping.gs::buildPayload`, provjerenog protiv Swagger spec-a v1.0.0
// (`examples/fira-custom-api-openapi-spec.txt`). Ne izmišlja se ništa novo:
// ista polja, isti `FIRA-Api-Key` header, isti endpoint.
//
// Razlike u odnosu na Sheets tok, i zašto:
//
//   * **Iznos ide s decimalama.** Sheets tok tvrdi da `price` mora biti cijeli
//     broj — to je njihovo pravilo nad ručno upisanim stupcem UPLATA, ne
//     zahtjev API-ja (spec: `number/double`). Ovdje iznos dolazi iz Stripea u
//     centima i dijeli se sa 100, jer cijena ulaznice ne mora biti puni euro.
//   * **`paymentType: 'KARTICA'`** umjesto `TRANSAKCIJSKI` — plaćeno je karticom
//     i to je element fiskalnog računa, ne kozmetika.
//   * **`webshopOrderId` je izveden iz `order_id`**, ne slučajan broj. Slučajan
//     broj bi značio da retry stvara drugu narudžbu kod FIRA-e.
//
// ⚠️ REVIEW(fable): tri mjesta vrijedna osporavanja.
//   1. `webshopOrderId` je int64 izveden iz prvih 12 hex znamenki UUID-a. To je
//      determinističko (retry = isti broj), ali NIJE zajamčeno jedinstveno kroz
//      cijeli prostor UUID-a. Kolizija traži 2^48 narudžbi po organizatoru —
//      prihvatljivo, ali ako FIRA na duplikat vrati grešku umjesto da ga
//      prepozna, ovo je mjesto gdje će puknuti.
//   2. PDV: `VAT_ENABLED=false` je preuzeto iz PzS konfiguracije (udruga izvan
//      sustava PDV-a, klauzula čl. 90). Za organizatora U SUSTAVU PDV-a ovo je
//      pogrešno i mora doći iz postavki organizatora, ne iz koda. Danas je
//      env-konfiguracija; kad U3 donese postavke po organizatoru, seli se tamo.
//      Otvoreno pitanje iz docs/04 §6.4 (kotizacija sa smještajem = jedna
//      usluga ili više stopa) NIJE riješeno i ovaj kod ga ne rješava.
//   3. Storno na povrat NIJE implementiran — FIRA storno endpoint nije u
//      specifikaciji koju imamo. Danas se povrat samo bilježi u `invoices` sa
//      statusom `storniran` i podiže alarm, pa organizator storno napravi u
//      FIRA sučelju. Bolje nego pogoditi krivi endpoint nad fiskalnim računom.
import type { Env } from "./env";
import type { InvoiceProvider, NaplacenaNarudzba, IzdaniRacun } from "./racun";

const PUTANJA = "/api/v1/webshop/order/custom";

/**
 * Odredište FIRA API-ja. `FIRA_API_BASE` postoji ISKLJUČIVO za lokalni razvoj i
 * testove; kao kod Stripea i Resenda prihvaća samo localhost — inače bi ova
 * varijabla bila način da fiskalni podaci kupaca odu na tuđi host.
 */
export function firaBase(env: Env): string {
  const raw = env.FIRA_API_BASE;
  if (!raw) return "https://app.fira.finance";
  const u = new URL(raw);
  if (u.protocol !== "http:" || (u.hostname !== "127.0.0.1" && u.hostname !== "localhost")) {
    throw new Error("FIRA_API_BASE smije pokazivati samo na localhost");
  }
  return raw.replace(/\/$/, "");
}

/** UUID → int64 koji preživi retry. Prvih 12 hex znamenki = 48 bita. */
export function webshopOrderId(orderId: string): number {
  return parseInt(orderId.replace(/-/g, "").slice(0, 12), 16);
}

/** "Zagreb, Croatia" → { city, country } — obrazac iz Mapping.gs. */
export function mjestoIzGrada(city: string | null): { city: string; country: string } {
  return { city: city ?? "", country: "HR" };
}

const dvijeDecimale = (n: number): number => Math.round(n * 100) / 100;

/** `YYYY-MM-DD HH:mm:ss` — format koji Sheets tok šalje u `createdAt`. */
export function firaVrijeme(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function firaPayload(env: Env, o: NaplacenaNarudzba): Record<string, unknown> {
  const bruttoEur = dvijeDecimale(o.amountCents / 100);
  const jedinicaEur = dvijeDecimale(bruttoEur / Math.max(1, o.quantity));
  const mjesto = mjestoIzGrada(o.event.venue_city);

  // Udruga izvan sustava PDV-a: stopa 0 i klauzula čl. 90 na PDF-u. Za
  // obveznika PDV-a ovo mora doći iz postavki organizatora (v. REVIEW gore).
  const stopa = 0;

  return {
    webshopOrderId: webshopOrderId(o.orderId),
    webshopType: "CUSTOM",
    invoiceType: "FISKALNI_RAČUN",

    paymentGatewayCode: "domovina-ulaznice",
    paymentGatewayName: "Račun je plaćen karticom. The invoice is already successfully paid.",

    createdAt: firaVrijeme(new Date()),

    currency: "EUR",
    taxesIncluded: false,

    billingAddress: {
      name: o.kupac.ime || o.kupac.email,
      address1: "",
      address2: "",
      city: "",
      country: "HR",
      phone: "",
      zipCode: "",
      email: o.kupac.email,
      vatNumber: "",
      company: "",
      oib: "",
    },

    // FIRA na PDF-u koristi shippingAddress.city kao "Mjesto isporuke" —
    // za ulaznicu je to mjesto događaja.
    shippingAddress: {
      name: o.kupac.ime || o.kupac.email,
      address1: "",
      address2: "",
      city: mjesto.city,
      country: mjesto.country,
      phone: "",
      zipCode: "",
      email: "",
    },

    taxValue: 0,
    brutto: bruttoEur,
    netto: bruttoEur,

    lineItems: [
      {
        name: `${o.tierTitle} — ${o.event.title}`,
        description: o.quantity > 1 ? `${o.quantity} ulaznice/a` : "Ulaznica",
        price: jedinicaEur,
        quantity: o.quantity,
        unit: "usluga",
        taxRate: stopa,
      },
    ],
    discounts: [],

    customerLocale: "HR",
    internalNote: `domovina-ulaznice | narudžba ${o.orderId}`.slice(0, 250),
    paymentType: "KARTICA",

    termsHR:
      "Oslobođeno od plaćanja PDV-a sukladno čl. 90. st. 1. Zakona o porezu na dodanu vrijednost.\n" +
      "Račun je plaćen karticom — ulaznica za događaj.",
    termsEN: "Exempt from VAT under Art. 90(1) of the Croatian VAT Act. The invoice is already paid by card.",
    termsDE: "Von der Mehrwertsteuer befreit gemäß Art. 90 Abs. 1 des kroatischen MwSt-Gesetzes. Bereits per Karte bezahlt.",
  };
}

export const firaProvider: InvoiceProvider = {
  id: "fira",

  async izdaj(env, o): Promise<IzdaniRacun> {
    if (!env.FIRA_API_KEY) {
      throw new Error("FIRA_API_KEY nije postavljen");
    }
    const res = await fetch(`${firaBase(env)}${PUTANJA}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "FIRA-Api-Key": env.FIRA_API_KEY,
      },
      body: JSON.stringify(firaPayload(env, o)),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`fira ${res.status}: ${text.slice(0, 300)}`);
    }
    let parsed: { id?: string | number } = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`fira: odgovor nije JSON: ${text.slice(0, 200)}`);
    }
    const id = parsed.id != null ? String(parsed.id) : null;
    return {
      provider: "fira",
      ref: id,
      url: id ? `https://app.fira.finance/user/invoices/details/${id}` : null,
      payload: text.slice(0, 1000),
    };
  },
};
