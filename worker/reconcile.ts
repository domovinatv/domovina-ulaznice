// Rekoncilijacija (cron, svakih 15 min) — obrazac iz
// rodjendaonice/apps/marketplace/worker/reconcile.ts, tablica provjera je
// docs/03-stripe-connect-0-posto.md §6.
//
// Zašto uopće: webhook je izvor istine, ali dostava webhooka nije zajamčena.
// Bez ovoga jedan propušten `checkout.session.completed` znači naplaćenog
// kupca bez ulaznice — i nitko to ne bi primijetio.
//
// Sve provjere su idempotentne: `events-stripe-confirm` na već kreditiranu
// narudžbu vrati `already_paid`, a `refund_ticket_order` `already_refunded`.
import type { Env } from "./env";
import * as api from "./api";
import { retrievePaymentIntent } from "./stripe";
import { logMoney } from "./webhooks";

export interface ReconcileReport {
  checked: number;
  confirmed: number;
  refunded: number;
  pendingDeliveries: number;
  problems: string[];
}

/** Koliko unatrag gledamo nesparene uplate (Stripe retry prozor + rezerva). */
const LOOKBACK_HOURS = 72;

export async function reconcile(env: Env): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    checked: 0,
    confirmed: 0,
    refunded: 0,
    pendingDeliveries: 0,
    problems: [],
  };

  // ── 1. uplaćene sesije bez ishoda: propušten ili pao webhook ──────────────
  // `outcome IS NULL` znači da je event zaključan pa obrada nikad nije upisala
  // ishod (Worker je pao između). Za takve pitamo Stripe što se stvarno dogodilo.
  const stale = await env.DB.prepare(
    "SELECT id, order_id, payment_intent, stripe_account FROM webhook_events " +
      "WHERE type = 'checkout.session.completed' AND order_id IS NOT NULL AND payment_intent IS NOT NULL " +
      "AND (outcome IS NULL OR outcome IN ('unknown_status','tx_already_credited')) " +
      "AND created_at > datetime('now', ?) LIMIT 50",
  )
    .bind(`-${LOOKBACK_HOURS} hours`)
    .all<{ id: string; order_id: string; payment_intent: string; stripe_account: string | null }>();

  for (const row of stale.results ?? []) {
    report.checked++;
    try {
      if (!row.stripe_account) {
        report.problems.push(`${row.id}: nepoznat connected account`);
        continue;
      }
      const pi = await retrievePaymentIntent(env, row.payment_intent, row.stripe_account);
      if (pi.status !== "succeeded") continue; // ništa naplaćeno → rezervacija istekne sama

      const confirm = await api.stripeConfirm(env, {
        order_id: row.order_id,
        external_ref: row.payment_intent,
        amount_cents: Number(pi.amount_received ?? pi.amount ?? 0),
        ...(pi.receipt_email ? { payer_email: pi.receipt_email } : {}),
      });
      await env.DB.prepare("UPDATE webhook_events SET outcome = ? WHERE id = ?")
        .bind(`reconcile:${confirm.status}`, row.id)
        .run();
      if (confirm.status === "paid" || confirm.status === "already_paid") {
        report.confirmed++;
        // Tokeni su jednokratni: ako ih confirm više ne vraća, e-mail je već
        // otišao. Ako ih vraća, dostava je propuštena — zabilježi dug.
        if (confirm.tickets?.some((t) => t.qr_token)) {
          report.problems.push(`${row.order_id}: tokeni dohvaćeni u rekoncilijaciji, dostava ručno`);
        }
      }
      if (confirm.status === "expired_sold_out" || confirm.status === "duplicate_payment") {
        report.problems.push(`${row.order_id}: ${confirm.status} — potreban povrat`);
      }
    } catch (e) {
      report.problems.push(`${row.id}: ${String((e as Error).message || e)}`);
    }
  }

  // ── 2. neuspjele dostave ulaznica ─────────────────────────────────────────
  // QR tokeni su potrošeni pa ih cron NE MOŽE ponovno dohvatiti — ovo je red za
  // podršku, ne automatski retry (v. Zapisnik U2 §Gotchai).
  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pending_deliveries WHERE attempts < 10",
  ).first<{ n: number }>();
  report.pendingDeliveries = Number(pending?.n ?? 0);
  if (report.pendingDeliveries > 0) {
    report.problems.push(`${report.pendingDeliveries} narudžbi čeka ručnu dostavu ulaznica`);
  }

  // ── 3. povrati zabilježeni na Stripeu, a ne kod nas ───────────────────────
  const refunds = await env.DB.prepare(
    "SELECT order_id, payment_intent FROM payment_log WHERE op LIKE 'refund.%' AND result = 'ok' " +
      "AND order_id IS NOT NULL AND created_at > datetime('now', ?) LIMIT 50",
  )
    .bind(`-${LOOKBACK_HOURS} hours`)
    .all<{ order_id: string; payment_intent: string | null }>();

  for (const row of refunds.results ?? []) {
    try {
      const status = await api.orderStatus(env, row.order_id);
      if (!status || status.order.state === "refunded") continue;
      const res = await api.refundOrder(env, {
        order_id: row.order_id,
        reason: "reconcile",
        external_ref: row.payment_intent,
      });
      if (res.status === "refunded") report.refunded++;
    } catch (e) {
      report.problems.push(`refund ${row.order_id}: ${String((e as Error).message || e)}`);
    }
  }

  if (report.problems.length) {
    await logMoney(env, {
      orderId: null,
      account: null,
      paymentIntent: null,
      op: "reconcile.problems",
      amount: null,
      result: "error",
      detail: report.problems.slice(0, 10).join(" | ").slice(0, 900),
    });
  }
  console.log(JSON.stringify({ evt: "reconcile", ...report, problems: report.problems.length }));
  return report;
}
