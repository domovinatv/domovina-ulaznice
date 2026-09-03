// Alarmi — problem koji nitko ne gleda nije prijavljen.
//
// Prije ovoga je rekoncilijacija svoje nalaze pisala u `console.log` i
// `payment_log`. Oboje je trag za forenziku POSLIJE događaja, a ne način da
// netko sazna da kupac nema ulaznicu DANAS. Neisporučena ulaznica koja čeka do
// dana događaja je izgubljen kupac; ista ulaznica uhvaćena za sat vremena je
// jedan e-mail podrške.
//
// Dvije stvari koje ovaj modul mora imati, inače je gori od ničega:
//
//   1. **Prigušivanje.** Cron ide svakih 15 min. Bez prigušivanja bi jedan
//      zaglavljen problem poslao 96 identičnih poruka dnevno i alarmi bi za
//      tjedan dana završili u filteru. Ključ je stabilan opis problema, ne
//      trenutak; prigušeni pokušaji se broje i pokažu u sljedećoj poruci
//      ("potisnuto 11 istih").
//   2. **Alarm ne smije rušiti posao koji prijavljuje.** Svaka greška ovdje se
//      guta i logira — rekoncilijacija se ne prekida zato što mail nije prošao.
import type { Env } from "./env";
import { esc, sendEmail } from "./mail";

const ZADANO_PRIGUSI_MIN = 180;

export interface AlarmResult {
  poslano: boolean;
  razlog?: "nema_adrese" | "prigusen" | "greska";
}

/** Koliko minuta isti ključ šuti nakon poslanog alarma. */
export function prigusiMinuta(env: Env): number {
  const n = Number(env.ALARM_PRIGUSI_MIN);
  return Number.isInteger(n) && n >= 0 ? n : ZADANO_PRIGUSI_MIN;
}

export async function alarm(
  env: Env,
  p: { kljuc: string; naslov: string; redci: string[] },
): Promise<AlarmResult> {
  const sadrzaj = p.redci.join("\n");

  // Bez adrese alarm ostaje u logu — ali kao console.error, da se barem u
  // `wrangler tail` vidi crveno. Tiho gutanje bi bilo najgora opcija.
  if (!env.ALARM_EMAIL) {
    console.error(JSON.stringify({ evt: "alarm_bez_adrese", kljuc: p.kljuc, naslov: p.naslov, sadrzaj }));
    return { poslano: false, razlog: "nema_adrese" };
  }

  const minuta = prigusiMinuta(env);
  let potisnuti = 0;
  try {
    const red = await env.DB.prepare(
      "SELECT zadnji_put, broj_potisnutih FROM alarms WHERE kljuc = ?",
    )
      .bind(p.kljuc)
      .first<{ zadnji_put: string; broj_potisnutih: number }>();

    if (red) {
      const proteklo = (Date.now() - Date.parse(red.zadnji_put)) / 60000;
      if (Number.isFinite(proteklo) && proteklo < minuta) {
        await env.DB.prepare(
          "UPDATE alarms SET broj_potisnutih = broj_potisnutih + 1, zadnji_sadrzaj = ? WHERE kljuc = ?",
        )
          .bind(sadrzaj.slice(0, 2000), p.kljuc)
          .run();
        return { poslano: false, razlog: "prigusen" };
      }
      potisnuti = Number(red.broj_potisnutih ?? 0);
    }
  } catch (e) {
    // Kvar prigušivanja ne smije spriječiti alarm — radije poruka viška.
    console.error(`[alarm] čitanje stanja: ${String(e)}`);
  }

  const naslov = `[ulaznice] ${p.naslov}`;
  const dodatak = potisnuti > 0
    ? [`(u međuvremenu potisnuto ${potisnuti} istih obavijesti)`]
    : [];
  const svi = [...p.redci, ...dodatak];

  const res = await sendEmail(env, {
    to: env.ALARM_EMAIL,
    subject: naslov,
    html:
      `<h2 style="font:600 16px/1.4 system-ui">${esc(p.naslov)}</h2>` +
      `<ul style="font:14px/1.6 system-ui">${svi.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` +
      `<p style="font:13px/1.5 system-ui;color:#6b7280">` +
      `Okruženje: ${esc(env.PUBLIC_BASE_URL)} · prigušivanje ${minuta} min</p>`,
    text: [p.naslov, "", ...svi, "", `Okruženje: ${env.PUBLIC_BASE_URL}`].join("\n"),
    template: "alarm",
  });

  if (!res.ok) {
    console.error(`[alarm] slanje nije uspjelo (${p.kljuc}): ${res.error ?? "nepoznato"}`);
    return { poslano: false, razlog: "greska" };
  }

  try {
    await env.DB.prepare(
      "INSERT INTO alarms (kljuc, zadnji_put, broj_potisnutih, zadnji_sadrzaj) VALUES (?,?,0,?) " +
        "ON CONFLICT(kljuc) DO UPDATE SET zadnji_put = excluded.zadnji_put, " +
        "broj_potisnutih = 0, zadnji_sadrzaj = excluded.zadnji_sadrzaj",
    )
      .bind(p.kljuc, new Date().toISOString(), sadrzaj.slice(0, 2000))
      .run();
  } catch (e) {
    console.error(`[alarm] zapis stanja: ${String(e)}`);
  }

  return { poslano: true };
}
