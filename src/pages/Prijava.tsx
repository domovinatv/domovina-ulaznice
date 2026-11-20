import { useState, type FormEvent } from "react";
import { AuthError, posaljiKod, potvrdiKod, prijavi, type Sesija } from "../lib/auth";
import { poruka } from "../lib/api";

/**
 * Zajednički obrazac prijave za skener i pregled organizatora.
 *
 * Glavni put je kod na e-mail (isti domovina.ai račun), lozinka je sporedni:
 * osoblje na ulazu s tuđeg mobitela ne može čekati mail (REVIEW(fable) u
 * `worker/api.ts`). „Nastavi s Googleom” čeka redirect URL-ove u GoTrueu.
 *
 * Namjerno bez „zapamti me": token živi u sessionStorageu i umire sa zatvaranjem
 * taba (v. `src/lib/auth.ts`). Na ulazu se često koristi tuđi mobitel.
 */
type Korak = "email" | "kod" | "lozinka";

export default function Prijava({ naslov, onPrijava }: { naslov: string; onPrijava: (s: Sesija) => void }) {
  const [korak, setKorak] = useState<Korak>("email");
  const [email, setEmail] = useState("");
  const [kod, setKod] = useState("");
  const [lozinka, setLozinka] = useState("");
  const [greska, setGreska] = useState<string | null>(null);
  const [obavijest, setObavijest] = useState<string | null>(null);
  const [salje, setSalje] = useState(false);

  const posalji = (posao: () => Promise<void>) => async (e?: FormEvent) => {
    e?.preventDefault();
    setGreska(null);
    setObavijest(null);
    setSalje(true);
    try {
      await posao();
    } catch (err) {
      setGreska(poruka((err as AuthError).code));
    } finally {
      setSalje(false);
    }
  };

  const zatraziKod = posalji(async () => {
    await posaljiKod(email.trim());
    setKod("");
    setKorak("kod");
  });

  const promijeniKorak = (k: Korak) => {
    setGreska(null);
    setObavijest(null);
    setKorak(k);
  };

  return (
    <main className="prijava">
      <p className="prijava__nadnaslov">{naslov}</p>
      <div className="prijava__kartica">
        <h1>Prijava</h1>

        {korak === "kod" ? (
          <p className="prijava__uvod">
            Poslali smo kod za prijavu na <strong>{email.trim()}</strong>. Upiši ga ispod.
          </p>
        ) : (
          <p className="prijava__uvod">
            Prijavi se svojim Domovina računom — isti račun vrijedi na domovina.ai i pinka.io (jedan identitet za
            cijeli ekosustav).
          </p>
        )}

        {greska && <div className="greska">{greska}</div>}
        {obavijest && <div className="obavijest">{obavijest}</div>}

        {korak === "email" && (
          <>
            <button
              type="button"
              className="prijava__google"
              onClick={() => setObavijest("Prijava Googleom još nije uključena. Zasad koristi kod na e-mail.")}
            >
              <GoogleLogo />
              Nastavi s Googleom
            </button>
            <div className="prijava__ili" aria-hidden="true">
              ILI
            </div>
            <form onSubmit={zatraziKod}>
              <label htmlFor="email" className="sr">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="tvoja@adresa.hr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button className="prijava__gumb" type="submit" disabled={salje}>
                {salje ? "Šaljem…" : "Pošalji kod za prijavu"}
              </button>
            </form>
            <button type="button" className="prijava__veza" onClick={() => promijeniKorak("lozinka")}>
              Prijava lozinkom
            </button>
          </>
        )}

        {korak === "kod" && (
          <>
            <form onSubmit={posalji(async () => onPrijava(await potvrdiKod(email.trim(), kod)))}>
              <label htmlFor="kod" className="sr">
                Kod iz e-maila
              </label>
              <input
                id="kod"
                className="prijava__kod"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={kod}
                onChange={(e) => setKod(e.target.value)}
                autoFocus
                required
              />
              <button className="prijava__gumb" type="submit" disabled={salje || kod.replace(/\s/g, "").length < 6}>
                {salje ? "Prijava…" : "Prijavi se"}
              </button>
            </form>
            <div className="prijava__veze">
              <button
                type="button"
                className="prijava__veza"
                disabled={salje}
                onClick={posalji(async () => {
                  await posaljiKod(email.trim());
                  setObavijest("Poslali smo novi kod.");
                })}
              >
                Pošalji novi kod
              </button>
              <button type="button" className="prijava__veza" onClick={() => promijeniKorak("email")}>
                Promijeni e-mail
              </button>
            </div>
          </>
        )}

        {korak === "lozinka" && (
          <>
            <form onSubmit={posalji(async () => onPrijava(await prijavi(email.trim(), lozinka)))}>
              <label htmlFor="email">E-mail</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="tvoja@adresa.hr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <label htmlFor="lozinka">Lozinka</label>
              <input
                id="lozinka"
                type="password"
                autoComplete="current-password"
                value={lozinka}
                onChange={(e) => setLozinka(e.target.value)}
                required
              />
              <button className="prijava__gumb" type="submit" disabled={salje || !email || lozinka.length < 6}>
                {salje ? "Prijava…" : "Prijavi se"}
              </button>
            </form>
            <button type="button" className="prijava__veza" onClick={() => promijeniKorak("email")}>
              Prijava kodom na e-mail
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
