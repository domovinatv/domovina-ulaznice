import { Link } from "react-router-dom";

/**
 * Uvjeti korištenja i politika privatnosti.
 *
 * ⚠️ OVO JE NACRT I TAKO SE I PRIKAZUJE. Dva podatka koja tekstu nedostaju nisu
 * stvar pisanja nego odluke koja još nije donesena:
 *
 *   1. **pravni subjekt platforme** (ITalk ili subjekt Domovine) — otvoreno
 *      pitanje iz `docs/2026-09-03-plan-do-produkcije.md` §3.2,
 *   2. **politika povrata** — mora je odrediti organizator, ne mi.
 *
 * Praznine su ostavljene kao vidljivi placeholderi umjesto da budu popunjene
 * uvjerljivim izmišljotinama. Isto načelo kao kod podataka organizatora: tekst
 * koji izgleda gotovo, a nije, opasniji je od teksta koji priznaje da nije.
 * Prije javne prodaje ovo mora proći pravnu provjeru.
 */

const SUBJEKT = "[PRAVNI SUBJEKT PLATFORME — nije određen]";

function Nacrt() {
  return (
    <div className="greska">
      <strong>Nacrt.</strong> Ovaj tekst još nije pravno provjeren i ne primjenjuje
      se na stvarnu prodaju. Prije prve naplate mora ga potvrditi pravnik.
    </div>
  );
}

function Podnozje() {
  return (
    <p className="podnozje">
      <Link to="/uvjeti">Uvjeti korištenja</Link> · <Link to="/privatnost">Politika privatnosti</Link> ·{" "}
      <Link to="/">Popis događaja</Link>
    </p>
  );
}

export function Uvjeti() {
  return (
    <main className="omot">
      <h1>Uvjeti korištenja</h1>
      <Nacrt />

      <h2>1. Tko je prodavatelj</h2>
      <p>
        Ulaznicu prodaje <strong>organizator događaja</strong>, ne platforma. Ugovor o
        ulasku na događaj sklapate izravno s organizatorom, koji je naveden na
        stranici svakog događaja. Platforma ({SUBJEKT}) pruža organizatoru
        softver za prodaju i dostavu ulaznica.
      </p>
      <p>
        Plaćanje karticom obrađuje Stripe, izravno na račun organizatora.
        <strong> Platforma ne naplaćuje naknadu na prodanu ulaznicu i ne drži novac kupaca.</strong>
      </p>

      <h2>2. Račun</h2>
      <p>
        Za izdavanje računa i fiskalizaciju odgovoran je organizator kao
        prodavatelj usluge. Ovisno o njegovim postavkama, račun stiže e-mailom
        neposredno nakon plaćanja ili ga izdaje organizator svojim sustavom.
      </p>

      <h2>3. Ulaznica i ulazak</h2>
      <p>
        Ulaznica je QR kod poslan e-mailom nakon potvrđenog plaćanja. QR kod
        vrijedi <strong>za jedan ulazak</strong>; prvi uspješan sken poništava daljnje.
        Ako zatražite ponovnu dostavu, izdaju se novi QR kodovi, a
        <strong> prethodno poslani prestaju vrijediti</strong>.
      </p>
      <p>
        Imenske ulaznice glase na ime navedeno pri kupnji i na ulazu se može
        tražiti identifikacijski dokument.
      </p>

      <h2>4. Otkazivanje i povrat</h2>
      <p>
        [POLITIKA POVRATA — određuje organizator; rok i uvjeti moraju stajati
        ovdje prije prve prodaje.]
      </p>
      <p>
        Neovisno o tome: ako je uplata zaprimljena nakon što su ulaznice
        rasprodane, cijeli iznos se vraća automatski. Ako organizator otkaže
        događaj, povrat izvršava organizator.
      </p>

      <h2>5. Odgovornost</h2>
      <p>
        Za održavanje događaja, njegov sadržaj, termin i uvjete ulaska odgovara
        organizator. Platforma odgovara za rad softvera za prodaju i dostavu
        ulaznica.
      </p>

      <h2>6. Kontakt</h2>
      <p>
        Za pitanja o događaju obratite se organizatoru. Za tehničke probleme s
        kupnjom ili dostavom ulaznice: <a href="mailto:podrska@domovina.ai">podrska@domovina.ai</a>.
      </p>

      <Podnozje />
    </main>
  );
}

export function Privatnost() {
  return (
    <main className="omot">
      <h1>Politika privatnosti</h1>
      <Nacrt />

      <h2>1. Tko obrađuje podatke</h2>
      <p>
        Voditelj obrade je <strong>organizator događaja</strong>; platforma ({SUBJEKT})
        obrađuje podatke u njegovo ime kao izvršitelj obrade.
      </p>

      <h2>2. Koje podatke prikupljamo</h2>
      <ul>
        <li><strong>E-mail kupca</strong> — za dostavu ulaznica i obavijesti o narudžbi.</li>
        <li><strong>Ime holdera</strong> (samo kod imenskih ulaznica) — jer ulaznica glasi na ime.</li>
        <li><strong>Podatke o plaćanju</strong> obrađuje Stripe; broj kartice ne dolazi do nas i ne pohranjuje se.</li>
        <li><strong>Tehnički zapis</strong> o narudžbi i dostavi e-maila, radi rješavanja reklamacija.</li>
      </ul>

      <h2>3. QR kod</h2>
      <p>
        U bazi se trajno čuva samo kriptografski otisak (sha256) QR koda, nikad
        sam kod. Čitljiv kod postoji samo u poruci koju ste primili.
      </p>

      <h2>4. Koliko dugo čuvamo podatke</h2>
      <p>
        Ime i e-mail holdera anonimiziraju se <strong>90 dana nakon završetka događaja</strong>.
        Podaci potrebni za knjigovodstvene i porezne obveze čuvaju se u zakonskom roku.
      </p>

      <h2>5. Vaša prava</h2>
      <p>
        Imate pravo na pristup, ispravak, brisanje i prigovor. Zahtjev pošaljite
        organizatoru ili na <a href="mailto:podrska@domovina.ai">podrska@domovina.ai</a>.
      </p>

      <h2>6. Kolačići</h2>
      <p>
        Stranica prodaje ulaznica <strong>ne koristi kolačiće za praćenje ni analitiku</strong>.
        Prijava organizatora koristi privremenu pohranu u pregledniku koja se briše
        zatvaranjem kartice.
      </p>

      <Podnozje />
    </main>
  );
}
