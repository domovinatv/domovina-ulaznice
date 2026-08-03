// Dostava ulaznica e-mailom (Resend REST, bez SDK-a).
//
// Tri pravila preuzeta iz rodjendaonice/worker/email.ts:
//   1. slanje ima VIDLJIV ishod — svaki pokušaj ide u `sent_emails`,
//   2. slanje NIKAD ne ruši već upisanu promjenu stanja (nikad ne baca),
//   3. sve što dolazi iz baze ili korisničkog unosa ide kroz `esc` prije HTML-a.
//
// ⚠️ QR tokeni su JEDNOKRATNI (Zapisnik U1 §Gotcha 3): plaintext postoji samo u
// odgovoru prve dostave, u bazi ostaje sha256 hash. Zato je e-mail JEDINA
// trajna kopija QR-a — ako slanje ne uspije, narudžba ide u `pending_deliveries`
// i cron pokušava ponovno dok tokeni još postoje.
import type { Env } from "./env";
import type { ConfirmTicket } from "./api";
import { base64, qrPng } from "./qr";

export type EmailStatus = "sent" | "failed" | "skipped";

export interface EmailResult {
  ok: boolean;
  status: EmailStatus;
  id?: string;
  error?: string;
}

export interface Attachment {
  filename: string;
  content: string; // base64
  content_type?: string;
  content_id?: string;
}

export interface EventInfo {
  title: string;
  slug: string;
  starts_at: string | null;
  timezone: string | null;
  venue_name: string | null;
  venue_city: string | null;
  organizer_name?: string | null;
}

export const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function formatWhenHr(startsAt: string | null, timeZone: string | null): string {
  if (!startsAt) return "termin još nije objavljen";
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "termin još nije objavljen";
  return new Intl.DateTimeFormat("hr-HR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timeZone ?? "Europe/Zagreb",
  }).format(d);
}

export const eur = (cents: number): string =>
  new Intl.NumberFormat("hr-HR", { style: "currency", currency: "EUR" }).format(cents / 100);

// ------------------------------------------------------------------ predlošci

const SHELL = (title: string, body: string): string => `<!doctype html>
<html lang="hr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14331f">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
${body}
<hr style="border:none;border-top:1px solid #e6e8eb;margin:28px 0">
<p style="font-size:12px;color:#6b7280;margin:0">
Ulaznice prodaje organizator izravno. Platforma ne naplaćuje naknadu na prodaju.
</p></div></body></html>`;

export interface TicketMailData {
  event: EventInfo;
  tickets: ConfirmTicket[];
  orderUrl: string;
  amountCents: number;
}

export function ticketMail(d: TicketMailData): { subject: string; html: string; text: string } {
  const when = formatWhenHr(d.event.starts_at, d.event.timezone);
  const place = [d.event.venue_name, d.event.venue_city].filter(Boolean).join(", ");
  const rows = d.tickets
    .map(
      (t, i) => `
<div style="border:1px solid #e6e8eb;border-radius:10px;padding:16px;margin:12px 0;text-align:center">
  <div style="font-weight:600;font-size:15px">${esc(t.holder_name ?? "Ulaznica")}</div>
  <div style="font-size:12px;color:#6b7280;margin-bottom:10px">${esc(t.serial)}</div>
  ${t.qr_token ? `<img src="cid:qr${i}" alt="QR ${esc(t.serial)}" width="200" height="200" style="display:block;margin:0 auto">` : `<div style="font-size:13px;color:#b45309">QR kod nije dostupan — javite nam se.</div>`}
</div>`,
    )
    .join("");

  const html = SHELL(
    `Ulaznice — ${d.event.title}`,
    `<h1 style="font-size:20px;margin:0 0 4px">Vaše ulaznice</h1>
<p style="margin:0 0 16px;font-size:15px"><strong>${esc(d.event.title)}</strong><br>
${esc(when)}${place ? `<br>${esc(place)}` : ""}</p>
${rows}
<p style="font-size:14px;margin:20px 0 0">Ukupno plaćeno: <strong>${esc(eur(d.amountCents))}</strong></p>
<p style="font-size:14px;margin:12px 0 0">
  Na ulazu pokažite QR kod s ove poruke.
  <a href="${esc(d.orderUrl)}" style="color:#2f855a">Pregled narudžbe</a>
</p>
<p style="font-size:13px;color:#6b7280;margin:16px 0 0">
  Sačuvajte ovu poruku — QR kod se iz sigurnosnih razloga izdaje jednom.
</p>`,
  );

  const text = [
    `Vaše ulaznice — ${d.event.title}`,
    when,
    place,
    "",
    ...d.tickets.map((t) => `${t.serial}${t.holder_name ? ` — ${t.holder_name}` : ""}`),
    "",
    `Ukupno: ${eur(d.amountCents)}`,
    `Pregled narudžbe: ${d.orderUrl}`,
    "QR kodovi su u HTML inačici poruke; sačuvajte je jer se izdaju jednom.",
  ].join("\n");

  return { subject: `Ulaznice — ${d.event.title}`, html, text };
}

export function ticketAttachments(tickets: ConfirmTicket[]): Attachment[] {
  const out: Attachment[] = [];
  tickets.forEach((t, i) => {
    if (!t.qr_token) return;
    out.push({
      filename: `${t.serial}.png`,
      content: base64(qrPng(t.qr_token)),
      content_type: "image/png",
      content_id: `qr${i}`,
    });
  });
  return out;
}

export function refundMail(d: { event: EventInfo; amountCents: number; supportEmail: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const html = SHELL(
    `Povrat — ${d.event.title}`,
    `<h1 style="font-size:20px;margin:0 0 4px">Ispričavamo se — ulaznice više nije bilo</h1>
<p style="font-size:15px">Vaša uplata za <strong>${esc(d.event.title)}</strong> stigla je nakon što je
rezervacija istekla, a preostale ulaznice su u međuvremenu rasprodane.</p>
<p style="font-size:15px">Cijeli iznos od <strong>${esc(eur(d.amountCents))}</strong> vraćen je na karticu
kojom je plaćeno. Povrat je vidljiv u roku od nekoliko radnih dana, ovisno o banci.</p>
<p style="font-size:14px">Ako nešto ne štima, javite se na
<a href="mailto:${esc(d.supportEmail)}" style="color:#2f855a">${esc(d.supportEmail)}</a>.</p>`,
  );
  return {
    subject: `Povrat uplate — ${d.event.title}`,
    html,
    text:
      `Ispričavamo se — ulaznice za ${d.event.title} rasprodane su prije nego je uplata stigla.\n` +
      `Cijeli iznos (${eur(d.amountCents)}) vraćen je na karticu.\nKontakt: ${d.supportEmail}`,
  };
}

// --------------------------------------------------------------------- slanje

/**
 * Odredište Resend API-ja. `RESEND_API_BASE` služi ISKLJUČIVO lokalnom razvoju
 * (hvatanje poruka umjesto stvarnog slanja) i, kao kod Stripea, prihvaća samo
 * localhost — inače bi bila način da poruke s ulaznicama odu na tuđi host.
 */
export function resendBase(env: Env): string {
  const raw = env.RESEND_API_BASE;
  if (!raw) return "https://api.resend.com";
  const u = new URL(raw);
  if (u.protocol !== "http:" || (u.hostname !== "127.0.0.1" && u.hostname !== "localhost")) {
    throw new Error("RESEND_API_BASE smije pokazivati samo na localhost");
  }
  return raw.replace(/\/$/, "");
}

export async function sendEmail(
  env: Env,
  p: {
    to: string;
    subject: string;
    html: string;
    text: string;
    template: string;
    orderId?: string | null;
    attachments?: Attachment[];
  },
): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) {
    const prod = /^https:\/\//.test(env.PUBLIC_BASE_URL ?? "") &&
      !/localhost|127\.0\.0\.1|\.workers\.dev/.test(env.PUBLIC_BASE_URL ?? "");
    const line = `[email:${prod ? "NEDOSTAJE KLJUČ" : "dev"}] to=${p.to} subject="${p.subject}"`;
    if (prod) console.error(`${line} — RESEND_API_KEY nije postavljen, poruka NIJE poslana`);
    else console.log(line);
    await logEmail(env, p, "skipped", { error: "RESEND_API_KEY nije postavljen" });
    return { ok: false, status: "skipped", error: "RESEND_API_KEY nije postavljen" };
  }

  // Jedan ponovni pokušaj na 5xx/429 i na pucanje mreže; 4xx je naša greška.
  const endpoint = `${resendBase(env)}/emails`;
  let last = "nepoznata greška";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let status = 0;
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM || "ulaznice@domovina.ai",
          to: [p.to],
          ...(env.EMAIL_REPLY_TO ? { reply_to: [env.EMAIL_REPLY_TO] } : {}),
          subject: p.subject,
          html: p.html,
          text: p.text,
          ...(p.attachments?.length ? { attachments: p.attachments } : {}),
        }),
      });
      status = r.status;
      if (r.ok) {
        const id = await r
          .json()
          .then((j) => (j as { id?: string }).id)
          .catch(() => undefined);
        await logEmail(env, p, "sent", { providerId: id });
        return { ok: true, status: "sent", id };
      }
      last = `${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`;
    } catch (e) {
      last = String((e as Error).message || e);
    }
    if (attempt === 1 && (status === 0 || status === 429 || status >= 500)) continue;
    break;
  }
  console.error(`[email] slanje nije uspjelo (${p.to}, "${p.subject}"): ${last}`);
  await logEmail(env, p, "failed", { error: last });
  return { ok: false, status: "failed", error: last };
}

async function logEmail(
  env: Env,
  p: { to: string; subject: string; template: string; orderId?: string | null },
  status: EmailStatus,
  extra: { providerId?: string; error?: string } = {},
): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO sent_emails (order_id, recipient, template, subject, status, provider_id, error) " +
        "VALUES (?,?,?,?,?,?,?)",
    )
      .bind(
        p.orderId ?? null,
        p.to,
        p.template,
        p.subject,
        status,
        extra.providerId ?? null,
        extra.error ?? null,
      )
      .run();
  } catch (e) {
    console.error(`[email] zapis u sent_emails nije uspio: ${String(e)}`);
  }
}
