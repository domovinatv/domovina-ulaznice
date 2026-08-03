// Stripe Connect — DIRECT CHARGE na račun organizatora, 0 % naknade.
//
// Razlika prema presedanu (rodjendaonice/apps/marketplace/worker/stripe.ts):
// tamo je destination charge s `application_fee_amount` + `transfer_data`, jer
// tamo platforma uzima proviziju. Ovdje provizije NEMA, pa je ispravan model
// direct charge — `{ stripeAccount }` kao DRUGI argument poziva:
//
//   * naplata nastaje na Stripe računu organizatora; sredstva nikad ne dodiruju
//     balance platforme,
//   * Stripeovu procesorsku naknadu plaća organizator (kao da je sam integrirao),
//     povrat/chargeback/isplata su odnos organizator ↔ Stripe,
//   * platforma je tehnički posrednik: pruža softver, ne uslugu ulaska.
//
// ⚠️ `application_fee_amount` i `transfer_data` se NE ŠALJU. 0 % je proizvodna
// odluka (docs/03-stripe-connect-0-posto.md §1), ne konfiguracija — nema env
// varijable kojom se to uključuje, i namjerno je tako.
import Stripe from "stripe";
import type { Env } from "./env";
import { HttpError } from "./env";

/** Stripe checkout dopušta `expires_at` najranije +30 min (naša rezervacija je 20). */
export const CHECKOUT_TTL_MIN = 30;

/**
 * Preusmjeravanje Stripe API-ja na lokalni mock (`stripe-mock` ili naš shim) —
 * ISKLJUČIVO za lokalni razvoj bez pravih ključeva.
 *
 * Guard: prihvaća samo `http://127.0.0.1:*` i `http://localhost:*`. Bez toga bi
 * ova varijabla bila način da se plaćanja preusmjere na tuđi host — zato svaka
 * druga vrijednost ruši poziv umjesto da ga tiho pošalje drugamo.
 */
export function localStripeTarget(env: Env): { host: string; port: number; protocol: "http" } | null {
  const raw = env.STRIPE_API_BASE;
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(500, "stripe_api_base_invalid", "STRIPE_API_BASE nije valjan URL");
  }
  if (u.protocol !== "http:" || (u.hostname !== "127.0.0.1" && u.hostname !== "localhost")) {
    throw new HttpError(500, "stripe_api_base_forbidden", "STRIPE_API_BASE smije pokazivati samo na localhost");
  }
  return { host: u.hostname, port: Number(u.port || 80), protocol: "http" };
}

export function stripeClient(env: Env): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new HttpError(503, "stripe_not_configured", "STRIPE_SECRET_KEY nije postavljen");
  }
  const local = localStripeTarget(env);
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-02-24.acacia",
    httpClient: Stripe.createFetchHttpClient(),
    ...(local ? { host: local.host, port: local.port, protocol: local.protocol } : {}),
  });
}

export interface CheckoutParams {
  orderId: string;
  campaignId: string;
  eventTitle: string;
  eventSlug: string;
  eventWhen: string;
  tierTitle: string;
  quantity: number;
  unitAmountCents: number;
  buyerEmail?: string | null;
  stripeAccountId: string;
  chargesEnabled: boolean;
}

/** Ljudski čitljiv termin za opis stavke ("10.03.2027. u 08:00, Zagreb"). */
export function formatWhen(
  startsAt: string | null,
  venueCity: string | null,
  timeZone = "Europe/Zagreb",
): string {
  if (!startsAt) return venueCity ?? "";
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return venueCity ?? "";
  const fmt = new Intl.DateTimeFormat("hr-HR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  return venueCity ? `${fmt.format(d)}, ${venueCity}` : fmt.format(d);
}

export async function createCheckoutSession(
  env: Env,
  p: CheckoutParams,
): Promise<Stripe.Checkout.Session> {
  // Invariant iz rodjendaonice/worker/bookable.ts: bez spojenog i aktivnog
  // računa se session NIKAD ne kreira "u prazno" — inače kupac plati u prazno.
  if (!p.stripeAccountId) {
    throw new HttpError(409, "organizer_not_connected", "Organizator nema spojen Stripe račun");
  }
  if (!p.chargesEnabled) {
    throw new HttpError(409, "organizer_charges_disabled", "Organizatorov Stripe račun još ne prima uplate");
  }

  const stripe = stripeClient(env);
  const base = env.PUBLIC_BASE_URL;

  return stripe.checkout.sessions.create(
    {
      mode: "payment",
      // Naša rezervacija traje 20 min, Stripeov minimum je 30 — između 20. i 30.
      // minute uplata može stići na isteklu rezervaciju. To NIJE bug nego poznat
      // prozor: confirm pokuša re-rezervirati, a ako je tier u međuvremenu
      // rasprodan → `expired_sold_out` → automatski pun refund (webhooks.ts).
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_MIN * 60,
      ...(p.buyerEmail ? { customer_email: p.buyerEmail } : {}),
      line_items: [
        {
          quantity: p.quantity,
          price_data: {
            currency: "eur",
            unit_amount: p.unitAmountCents,
            product_data: {
              name: `${p.tierTitle} — ${p.eventTitle}`,
              ...(p.eventWhen ? { description: p.eventWhen } : {}),
            },
          },
        },
      ],
      payment_intent_data: {
        // ⚠️ NEMA application_fee_amount. NEMA transfer_data. 0 %.
        // capture_method ostaje 'automatic': kod ulaznica nema "potvrde
        // organizatora" kao kod rezervacije termina, pa manual capture nema svrhu.
        metadata: { order_id: p.orderId, campaign_id: p.campaignId },
      },
      metadata: { order_id: p.orderId, campaign_id: p.campaignId },
      success_url: `${base}/ulaznice/${p.orderId}?placeno=1`,
      cancel_url: `${base}/dogadjaj/${p.eventSlug}?otkazano=1`,
    },
    { stripeAccount: p.stripeAccountId }, // ← DIRECT CHARGE
  );
}

/**
 * Pun povrat na račun organizatora.
 *
 * Bez `reverse_transfer` i `refund_application_fee` — to su parametri
 * destination modela (rodjendaonice). Kod direct chargea nema ni transfera ni
 * feeja koji bi se vraćali.
 */
export async function refundPaymentIntent(
  env: Env,
  paymentIntent: string,
  stripeAccountId: string,
  amountCents?: number,
): Promise<Stripe.Refund> {
  return stripeClient(env).refunds.create(
    {
      payment_intent: paymentIntent,
      ...(amountCents != null ? { amount: amountCents } : {}),
    },
    { stripeAccount: stripeAccountId },
  );
}

export async function retrievePaymentIntent(
  env: Env,
  paymentIntent: string,
  stripeAccountId: string,
): Promise<Stripe.PaymentIntent> {
  return stripeClient(env).paymentIntents.retrieve(paymentIntent, { stripeAccount: stripeAccountId });
}

/**
 * Verifikacija webhook potpisa. Potpis se provjerava PRIJE ičega drugog;
 * bez tajne vraćamo 503 i ne idemo dalje (docs/03 §4 pravilo 1).
 */
export async function verifyWebhook(env: Env, req: Request): Promise<Stripe.Event> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new HttpError(503, "webhook_secret_missing", "STRIPE_WEBHOOK_SECRET nije postavljen");
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) throw new HttpError(400, "missing_signature", "Nedostaje stripe-signature header");
  const body = await req.text();
  return stripeClient(env).webhooks.constructEventAsync(
    body,
    sig,
    env.STRIPE_WEBHOOK_SECRET,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
}
