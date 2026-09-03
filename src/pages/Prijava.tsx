import { useState } from "react";
import { AuthError, prijavi, type Sesija } from "../lib/auth";
import { poruka } from "../lib/api";

/**
 * Zajednički obrazac prijave za skener i pregled organizatora.
 *
 * Namjerno bez „zapamti me": token živi u sessionStorageu i umire sa zatvaranjem
 * taba (v. `src/lib/auth.ts`). Na ulazu se često koristi tuđi mobitel.
 */
export default function Prijava({ naslov, onPrijava }: { naslov: string; onPrijava: (s: Sesija) => void }) {
  const [email, setEmail] = useState("");
  const [lozinka, setLozinka] = useState("");
  const [greska, setGreska] = useState<string | null>(null);
  const [salje, setSalje] = useState(false);

  return (
    <main className="omot">
      <h1>{naslov}</h1>
      <p className="meta">Prijavite se računom organizatora (isti kao na domovina.ai).</p>
      {greska && <div className="greska">{greska}</div>}
      <form
        className="kartica"
        onSubmit={async (e) => {
          e.preventDefault();
          setGreska(null);
          setSalje(true);
          try {
            onPrijava(await prijavi(email.trim(), lozinka));
          } catch (err) {
            setGreska(poruka((err as AuthError).code));
          } finally {
            setSalje(false);
          }
        }}
      >
        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
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
        <button className="gumb" type="submit" disabled={salje || !email || lozinka.length < 6}>
          {salje ? "Prijava…" : "Prijavi se"}
        </button>
      </form>
    </main>
  );
}
