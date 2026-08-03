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
  PUBLIC_BASE_URL: string;
  DOMOVINA_API_URL: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  RL_ORDER_IP?: string;
  RL_WEBHOOK_IP?: string;

  // tajne (wrangler secret put)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  EVENTS_STRIPE_CONFIRM_SECRET?: string;
  DOMOVINA_API_SERVICE_KEY?: string;
  RESEND_API_KEY?: string;
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
