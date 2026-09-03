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
import { alarm } from "./alarm";

export interface ReconcileReport {
  checked: number;
  confirmed: number;
  refunded: number;
  pendingDeliveries: number;
  failedInvoices: number;
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
    failedInvoices: 0,
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

  // ── 4. neizdani računi ────────────────────────────────────────────────────
  // Pad providera ne poništava ulaznicu (racun.ts pravilo 2), ali
  // ostavlja obvezu neispunjenom — a to nitko ne vidi iz same prodaje.
  const racuni = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM invoices WHERE status IN ('neuspjeh','u_tijeku') " +
      "AND created_at > datetime('now', ?)",
  )
    .bind(`-${LOOKBACK_HOURS} hours`)
    .first<{ n: number }>()
    .catch(() => null);
  report.failedInvoices = Number(racuni?.n ?? 0);
  if (report.failedInvoices > 0) {
    report.problems.push(`${report.failedInvoices} narudžbi bez izdanog računa`);
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
    // Log je trag za poslije; alarm je jedini način da netko sazna danas.
    await alarm(env, {
      kljuc: "reconcile.problemi",
      naslov: `Rekoncilijacija: ${report.problems.length} problema`,
      redci: report.problems.slice(0, 20),
    }).catch((e) => console.error(`[cron] alarm: ${String(e)}`));
  }
  console.log(JSON.stringify({ evt: "reconcile", ...report, problems: report.problems.length }));
  return report;
}
