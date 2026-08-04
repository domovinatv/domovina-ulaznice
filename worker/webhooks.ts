// Stripe webhook — JEDINI izvor istine o plaćanju.
//
// `success_url` redirect samo prikazuje stanje; narudžbu kreditira isključivo
// ovaj put, i to tek nakon što je potpis verificiran (docs/03 §4).
//
// Idempotencija ima DVA sloja i oba su nužna:
//   1. D1 `webhook_events` PK — isti `evt_…` se ne obrađuje dvaput. Ako obrada
//      PADNE, zaključavanje se BRIŠE i vraćamo 500 da Stripe ponovi. Bez toga
//      bi retry bio odbačen kao duplikat, a posao nikad odrađen (stvarni bug iz
//      rodjendaonice/worker/webhooks.ts).
//   2. baza u domovina-api — unique (payment_rail, external_payment_ref).
//      Ponovljena dostava vraća `already_paid` i ne izdaje nove ulaznice.
//      Sloj 1 je optimizacija i trag; sloj 2 je jamstvo.
import type Stripe from "stripe";
import type { Env } from "./env";
import { HttpError } from "./env";
import * as api from "./api";
import type { ConfirmResponse } from "./api";
import { refundPaymentIntent, verifyWebhook } from "./stripe";
import { refundMail, sendEmail, ticketAttachments, ticketMail, type EventInfo } from "./mail";

export async function handleStripeWebhook(req: Request, env: Env): Promise<Response> {
  let event: Stripe.Event;
  try {
    event = await verifyWebhook(env, req);
  } catch (e) {
    const err = e as HttpError;
    // Bez tajne je 503 (kvar konfiguracije), krivi potpis je 400 (odbijeno).
    const status = err.status === 503 ? 503 : 400;
    return json({ error: err.code ?? "bad_signature" }, status);
  }

  // Connect endpoint: svaki event nosi račun organizatora na kojem se dogodio.
  const account = (event as Stripe.Event & { account?: string }).account ?? null;

  try {
    await env.DB.prepare(
      "INSERT INTO webhook_events (id, type, stripe_account, order_id, payment_intent, raw) VALUES (?,?,?,?,?,?)",
    )
      .bind(
        event.id,
        event.type,
        account,
        orderIdHint(event),
        paymentIntentHint(event),
        JSON.stringify(event.data.object).slice(0, 4000),
      )
      .run();
  } catch {
    return json({ received: true, duplicate: true });
  }

  let outcome = "ignored";
  try {
    outcome = await processEvent(env, event, account);
  } catch (e) {
    await env.DB.prepare("DELETE FROM webhook_events WHERE id = ?").bind(event.id).run().catch(() => undefined);
    console.error(
      JSON.stringify({ evt: "webhook_error", id: event.id, type: event.type, error: String((e as Error).message || e) }),
    );
    // 500 → Stripe ponavlja. Bez ovoga bi jedan neuspjeh značio trajni gubitak.
    return json({ error: "obrada_nije_uspjela" }, 500);
  }

  await env.DB.prepare("UPDATE webhook_events SET outcome = ? WHERE id = ?")
    .bind(outcome, event.id)
    .run()
    .catch(() => undefined);
  return json({ received: true, outcome });
}

// ------------------------------------------------------------------ obrada

async function processEvent(env: Env, event: Stripe.Event, account: string | null): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed":
      return await onCheckoutCompleted(env, event.data.object as Stripe.Checkout.Session, account);

    case "charge.refunded":
      return await onChargeRefunded(env, event.data.object as Stripe.Charge, account);

    case "account.updated": {
      const a = event.data.object as Stripe.Account;
      const matched = await api.upsertOrganizerRail(env, {
        stripe_account_id: a.id,
        charges_enabled: !!a.charges_enabled && !!a.details_submitted,
        payouts_enabled: !!a.payouts_enabled,
      });
      return matched ? "rail_updated" : "rail_unknown_account";
    }

    case "payment_intent.payment_failed":
      // Checkout session i dalje vrijedi (kupac može drugom karticom), a
      // rezervacija istječe sama. Samo trag.
      return "payment_failed_logged";

    case "charge.dispute.created": {
      // Ulaznicu NE poništavamo automatski — spor može biti riješen u korist
      // organizatora, a poništena ulaznica na ulazu je nepopravljiva šteta.
      const d = event.data.object as Stripe.Dispute;
      await logMoney(env, {
        orderId: null,
        account,
        paymentIntent: typeof d.payment_intent === "string" ? d.payment_intent : null,
        op: "dispute.created",
        amount: d.amount ?? null,
        result: "ok",
        detail: d.reason ?? null,
      });
      return "dispute_logged";
    }
  }
  return "ignored";
}

async function onCheckoutCompleted(
  env: Env,
  s: Stripe.Checkout.Session,
  account: string | null,
): Promise<string> {
  const orderId = s.metadata?.order_id ?? null;
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null;
  if (!orderId || !pi) return "no_order_metadata";
  // Nenaplaćena sesija (npr. `unpaid` kod odgođenih metoda) ne smije izdati ulaznice.
  if (s.payment_status && s.payment_status !== "paid") return `not_paid_${s.payment_status}`;

  const amount = Number(s.amount_total ?? 0);
  const payerEmail = s.customer_details?.email ?? s.customer_email ?? undefined;

  const confirm: ConfirmResponse = await api.stripeConfirm(env, {
    order_id: orderId,
    external_ref: pi,
    amount_cents: amount,
    ...(payerEmail ? { payer_email: payerEmail } : {}),
  });

  switch (confirm.status) {
    case "paid":
    case "already_paid":
      await deliverTicketsEmail(env, orderId, confirm, payerEmail ?? null, amount);
      return confirm.status;

    case "expired_sold_out":
      // Poznati prozor: rezervacija 20 min < Stripe checkout 30 min. Kupac je
      // naplaćen, a mjesta više nema → pun povrat + isprika (docs/03 §5).
      await autoRefund(env, {
        orderId,
        account,
        paymentIntent: pi,
        amount,
        reason: "expired_sold_out",
        apologize: true,
        recipient: payerEmail ?? null,
      });
      return "expired_sold_out_refunded";

    case "duplicate_payment":
      // Dvije checkout sesije iste narudžbe → kupac naplaćen dvaput.
      // Vraća se OVA uplata; ona koja je kreditirala narudžbu ostaje.
      await autoRefund(env, {
        orderId,
        account,
        paymentIntent: pi,
        amount,
        reason: "duplicate_payment",
        apologize: false,
        recipient: payerEmail ?? null,
      });
      return "duplicate_payment_refunded";

    case "amount_insufficient":
      // Kod Checkouta se ne bi smjelo dogoditi (iznos je naš). Ako se dogodi,
      // narudžba NIJE kreditirana — novac je nezasluženo primljen, pa ide natrag.
      await autoRefund(env, {
        orderId,
        account,
        paymentIntent: pi,
        amount,
        reason: "amount_insufficient",
        apologize: true,
        recipient: payerEmail ?? null,
      });
      return "amount_insufficient_refunded";

    case "tx_already_credited":
      // Isti PaymentIntent već kreditirao DRUGU narudžbu → ne diramo novac,
      // ovo ide u red za ručno sparivanje (audit zapis je u jezgri).
      await logMoney(env, {
        orderId,
        account,
        paymentIntent: pi,
        op: "confirm.tx_already_credited",
        amount,
        result: "error",
        detail: "ista uplata kreditirala drugu narudžbu — ručno sparivanje",
      });
      return "tx_already_credited";
  }
  return "unknown_status";
}

async function onChargeRefunded(env: Env, c: Stripe.Charge, account: string | null): Promise<string> {
  const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id ?? null;
  if (!pi) return "no_payment_intent";

  // Povrat izveden izvan našeg toka (Stripe dashboard organizatora) mora
  // proizvesti isti učinak kao naš: narudžba refunded, ulaznice void.
  const orderId = await orderIdByPaymentIntent(env, pi);
  if (!orderId) return "order_unknown";

  const res = await api.refundOrder(env, {
    order_id: orderId,
    amount_cents: c.amount_refunded ?? null,
    reason: "stripe_refund",
    external_ref: pi,
  });
  await logMoney(env, {
    orderId,
    account,
    paymentIntent: pi,
    op: "webhook.charge_refunded",
    amount: c.amount_refunded ?? null,
    result: "ok",
    detail: res.status,
  });
  return `refund_${res.status}`;
}

// ------------------------------------------------------------------ dostava

async function deliverTicketsEmail(
  env: Env,
  orderId: string,
  confirm: ConfirmResponse,
  payerEmail: string | null,
  amountCents: number,
): Promise<void> {
  const tickets = confirm.tickets ?? [];
  const recipient = payerEmail ?? tickets.find((t) => t.holder_email)?.holder_email ?? null;

  // Tokeni su jednokratni: ako ih u odgovoru nema, e-mail je već poslan na
  // prvom prolazu (retry webhooka). Ne šaljemo poruku bez QR-a.
  const hasTokens = tickets.some((t) => t.qr_token);
  if (!recipient || !hasTokens) return;

  const event = await eventInfoForOrder(env, orderId);
  const mail = ticketMail({
    event,
    tickets,
    orderUrl: `${env.PUBLIC_BASE_URL}/ulaznice/${orderId}`,
    amountCents,
  });
  const res = await sendEmail(env, {
    to: recipient,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    template: "ulaznice",
    orderId,
    attachments: ticketAttachments(tickets),
  });

  if (res.ok) {
    await env.DB.prepare("DELETE FROM pending_deliveries WHERE order_id = ?")
      .bind(orderId)
      .run()
      .catch(() => undefined);
    return;
  }
  // Neuspjela dostava: QR tokeni su POTROŠENI i ne mogu se ponovno dohvatiti.
  // Bilježimo dug da ga cron i podrška vide (v. Zapisnik U2 §Gotchai).
  await env.DB.prepare(
    "INSERT INTO pending_deliveries (order_id, recipient, attempts, last_error) VALUES (?,?,1,?) " +
      "ON CONFLICT(order_id) DO UPDATE SET attempts = attempts + 1, last_error = excluded.last_error, " +
      "updated_at = datetime('now')",
  )
    .bind(orderId, recipient, res.error ?? "nepoznato")
    .run()
    .catch(() => undefined);
}

async function autoRefund(
  env: Env,
  p: {
    orderId: string;
    account: string | null;
    paymentIntent: string;
    amount: number;
    reason: string;
    apologize: boolean;
    recipient: string | null;
  },
): Promise<void> {
  if (!p.account) {
    await logMoney(env, {
      orderId: p.orderId,
      account: null,
      paymentIntent: p.paymentIntent,
      op: `refund.${p.reason}`,
      amount: p.amount,
      result: "error",
      detail: "nepoznat connected account — povrat nije izveden",
    });
    return;
  }
  try {
    await refundPaymentIntent(env, p.paymentIntent, p.account);
    await logMoney(env, {
      orderId: p.orderId,
      account: p.account,
      paymentIntent: p.paymentIntent,
      op: `refund.${p.reason}`,
      amount: p.amount,
      result: "ok",
      detail: null,
    });
  } catch (e) {
    await logMoney(env, {
      orderId: p.orderId,
      account: p.account,
      paymentIntent: p.paymentIntent,
      op: `refund.${p.reason}`,
      amount: p.amount,
      result: "error",
      detail: String((e as Error).message || e),
    });
    throw e; // 500 → Stripe ponavlja; novac se ne smije tiho izgubiti
  }

  if (!p.apologize || !p.recipient) return;
  const event = await eventInfoForOrder(env, p.orderId);
  const mail = refundMail({
    event,
    amountCents: p.amount,
    supportEmail: env.EMAIL_REPLY_TO || "podrska@domovina.ai",
  });
  await sendEmail(env, {
    to: p.recipient,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    template: "isprika_refund",
    orderId: p.orderId,
  });
}

// ------------------------------------------------------------------ pomoćnici

export async function eventInfoForOrder(env: Env, orderId: string): Promise<EventInfo> {
  const fallback: EventInfo = {
    title: "Događaj",
    slug: "",
    starts_at: null,
    timezone: "Europe/Zagreb",
    venue_name: null,
    venue_city: null,
  };
  try {
    const status = await api.orderStatus(env, orderId);
    if (!status) return fallback;
    const { events } = await api.feed(env);
    const ev = events.find((e) => e.campaign_id === status.order.campaign_id);
    if (!ev) return fallback;
    return {
      title: ev.title,
      slug: ev.slug,
      starts_at: ev.event?.starts_at ?? null,
      ends_at: ev.event?.ends_at ?? null,
      timezone: ev.event?.timezone ?? "Europe/Zagreb",
      venue_name: ev.event?.venue_name ?? null,
      venue_city: ev.event?.venue_city ?? null,
      organizer_name: ev.event?.organizer_name ?? null,
    };
  } catch (e) {
    console.error(`[webhook] podaci o eventu za ${orderId}: ${String(e)}`);
    return fallback;
  }
}

async function orderIdByPaymentIntent(env: Env, pi: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT order_id FROM webhook_events WHERE payment_intent = ? AND order_id IS NOT NULL ORDER BY created_at LIMIT 1",
  )
    .bind(pi)
    .first<{ order_id: string }>();
  return row?.order_id ?? null;
}

export async function logMoney(
  env: Env,
  p: {
    orderId: string | null;
    account: string | null;
    paymentIntent: string | null;
    op: string;
    amount: number | null;
    result: "ok" | "error";
    detail: string | null;
  },
): Promise<void> {
  console.log(JSON.stringify({ evt: "money", ...p }));
  await env.DB.prepare(
    "INSERT INTO payment_log (order_id, stripe_account, payment_intent, op, amount_cents, result, detail) " +
      "VALUES (?,?,?,?,?,?,?)",
  )
    .bind(p.orderId, p.account, p.paymentIntent, p.op, p.amount, p.result, p.detail)
    .run()
    .catch((e) => console.error(`[payment_log] ${String(e)}`));
}

function orderIdHint(event: Stripe.Event): string | null {
  const obj = event.data.object as { metadata?: Record<string, string> | null };
  return obj?.metadata?.order_id ?? null;
}

function paymentIntentHint(event: Stripe.Event): string | null {
  const obj = event.data.object as { payment_intent?: string | { id: string } | null; id?: string };
  if (typeof obj?.payment_intent === "string") return obj.payment_intent;
  if (obj?.payment_intent && typeof obj.payment_intent === "object") return obj.payment_intent.id;
  if (typeof obj?.id === "string" && obj.id.startsWith("pi_")) return obj.id;
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
