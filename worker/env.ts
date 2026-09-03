// Env bindingi i tajne Workera.
//
// Pravilo: sve ovdje je server-side. Nijedna od ovih vrijednosti ne smije
// završiti u SPA bundleu (docs/handoffs/u2 §Sigurnost 3), a `acct_…` ne smije
// izaći ni u jednom odgovoru prema browseru (§Sigurnost 4).

export interface Env {
  // bindingi
  DB: D1Database;
  RL?: KVNamespace;
  ASSETS: { fetch(req: Request): Promise<Response> };

  // vars (wrangler.jsonc)
  //
  // NAJAVA="1" → okruženje NIJE prodajno: Worker vraća statičnu najavu na sve
  // rute, a /api/* i /webhook/* daju 404. Koristi produkcija dok prodaja ne
  // krene, da javna domena ne izgleda kao da radi. Namjerno se provjerava
  // točna vrijednost "1" — svaka druga (i odsutnost) znači normalan rad.
  NAJAVA?: string;
  PUBLIC_BASE_URL: string;
  DOMOVINA_API_URL: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  RL_ORDER_IP?: string;
  RL_WEBHOOK_IP?: string;

  /**
   * Anon ključ GoTruea (`api.domovina.ai`). NIJE tajna — po dizajnu putuje u
   * svakom browser bundleu Supabase aplikacije i isti ključ već stoji u
   * `domovina-fiskal/backend/wrangler.toml` uz istu napomenu. Ovdje je var, ne
   * secret, jer bez njega prijava organizatora i skenera ne postoji, a skrivanje
   * javnog ključa daje lažni osjećaj sigurnosti.
   *
   * Ono što JEST tajna i nikad ne smije ovamo: HS256 `JWT_SECRET` i service ključ.
   */
  DOMOVINA_API_ANON_KEY?: string;

  /** Adresa na koju idu alarmi rekoncilijacije i zaostale dostave. */
  ALARM_EMAIL?: string;
  /** Koliko minuta isti alarm šuti nakon slanja (zadano 180). */
  ALARM_PRIGUSI_MIN?: string;

  /**
   * Odredište FIRA API-ja. Kao kod Stripea i Resenda, override je dopušten samo
   * prema localhostu (v. `worker/racun-fira.ts::firaBase`).
   */
  FIRA_API_BASE?: string;

  // ⚠️ SAMO lokalni razvoj: preusmjeravanje vanjskih API-ja na mock.
  // Oba prihvaćaju isključivo http://127.0.0.1:* / http://localhost:* — svaka
  // druga vrijednost ruši poziv (v. stripe.ts::localStripeTarget, mail.ts::resendBase).
  STRIPE_API_BASE?: string;
  RESEND_API_BASE?: string;

  // tajne (wrangler secret put)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  EVENTS_STRIPE_CONFIRM_SECRET?: string;
  DOMOVINA_API_SERVICE_KEY?: string;
  RESEND_API_KEY?: string;
  /** FIRA Custom Webshop API ključ organizatora (header `FIRA-Api-Key`). */
  FIRA_API_KEY?: string;
}

/** Greška s HTTP statusom — router je pretvara u JSON odgovor. */
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}
