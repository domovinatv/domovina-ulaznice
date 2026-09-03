// Rate limit nad KV-om — grubi brojač po IP-u.
//
// Zašto je uopće ovdje, a ne u bazi: `create_ticket_order` u pinka_finance ima
// limit od 10 narudžbi/h, ali veže ga na `contributor_account_id` ili
// `declared_payer_address`. Web kupac nema ni jedno (gost bez računa i bez
// walleta), pa je taj uvjet uvijek prazan i limit ne postoji — Zapisnik U1
// §Gotcha 5. Rate limiting narudžbi je obaveza Workera.
//
// KV nema atomarni increment; ovo je namjerno približno (u najgorem slučaju
// nekoliko zahtjeva viška po rubnom čvoru). Za zaštitu od zlouporabe je dovoljno,
// a za točnost bi trebao Durable Object — nije vrijedan trošak dok ne zatreba.
//
// Fail-open: ako KV binding ne postoji (lokalni dev, test), limit se preskače.
// Gubimo zaštitu, ne funkcionalnost.
import type { Env } from "./env";

export interface Rule {
  limit: number;
  windowSeconds: number;
}

export const DEFAULT_RULES: Record<string, Rule> = {
  // narudžba: 10 u 10 minuta po IP-u (kupac realno radi 1–2)
  order: { limit: 10, windowSeconds: 600 },
  // webhook: velikodušno — Stripe zna poslati nalet retryja
  webhook: { limit: 300, windowSeconds: 60 },
  // ponovna dostava e-maila: 3 u 10 minuta po narudžbi
  resend: { limit: 3, windowSeconds: 600 },
  // prijava organizatora/skenera: 10 pokušaja u 5 min po IP-u. Ovo je jedini
  // bucket koji brani TUĐI sustav (GoTrue) od pogađanja lozinke kroz nas.
  prijava: { limit: 10, windowSeconds: 300 },
  // sken na ulazu: velikodušno — na vratima se skenira u naletima, a
  // autorizacija je ionako server-side pri svakom skenu.
  sken: { limit: 600, windowSeconds: 60 },
};

/** Zapis "koliko/sekundi" iz env varijable ("10/600"). */
export function parseRule(spec: string | undefined, fallback: Rule): Rule {
  if (!spec) return fallback;
  const m = /^(\d+)\/(\d+)$/.exec(spec.trim());
  if (!m) return fallback;
  const limit = Number(m[1]);
  const windowSeconds = Number(m[2]);
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) {
    return fallback;
  }
  return { limit, windowSeconds };
}

export function ruleFor(env: Env, bucket: keyof typeof DEFAULT_RULES): Rule {
  const fallback = DEFAULT_RULES[bucket];
  if (bucket === "order") return parseRule(env.RL_ORDER_IP, fallback);
  if (bucket === "webhook") return parseRule(env.RL_WEBHOOK_IP, fallback);
  return fallback;
}

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

/** Potroši jedan token. `subject` je IP, order_id ili što god je prirodni ključ. */
export async function consume(
  env: Env,
  bucket: keyof typeof DEFAULT_RULES,
  subject: string,
): Promise<RateVerdict> {
  const rule = ruleFor(env, bucket);
  if (!env.RL) return { allowed: true, remaining: rule.limit, retryAfter: 0 };

  const window = Math.floor(Date.now() / 1000 / rule.windowSeconds);
  const key = `rl:${bucket}:${subject}:${window}`;
  let used = 0;
  try {
    used = Number((await env.RL.get(key)) ?? "0") || 0;
    if (used >= rule.limit) {
      const resetAt = (window + 1) * rule.windowSeconds;
      return { allowed: false, remaining: 0, retryAfter: Math.max(1, resetAt - Math.floor(Date.now() / 1000)) };
    }
    await env.RL.put(key, String(used + 1), { expirationTtl: Math.max(60, rule.windowSeconds * 2) });
  } catch (e) {
    // KV ispad ne smije oboriti prodaju
    console.error(`[ratelimit] ${bucket}/${subject}: ${String(e)}`);
    return { allowed: true, remaining: rule.limit, retryAfter: 0 };
  }
  return { allowed: true, remaining: rule.limit - used - 1, retryAfter: 0 };
}

export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
}
