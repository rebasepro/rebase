---
sourceHash: 7047b4fd73bde89d
title: Suche
sidebar_label: Suche
description: Wie sich .search() standardmäßig verhält und wie Sie eine Postgres-Collection für die gerankte Volltextsuche über die von Ihnen benannten Felder aktivieren – einschließlich JSONB- und Array-Inhalten.
---

`.search("term")` funktioniert auf jeder Collection ohne Konfiguration. Wozu es
kompiliert wird, hängt davon ab, ob die Collection zusätzliche Konfigurationen
definiert hat.

## Das Standardverhalten

Ohne Konfiguration ist `.search()` ein **Substring-Abgleich ohne Berücksichtigung
der Groß-/Kleinschreibung (case-insensitive)**, der über die `string`-Eigenschaften
der obersten Ebene der Collection per OR verknüpft wird. Der Suchstring wird an
Leerzeichen aufgeteilt und jeder Begriff muss übereinstimmen – diese können jedoch
mit verschiedenen Eigenschaften übereinstimmen, sodass ein Name, der über zwei
Spalten verteilt ist, dennoch gefunden wird:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Schließen Sie eine Wortfolge in doppelte Anführungszeichen ein – `.search('"ada lovelace"')` –,
um stattdessen nach der Phrase zu suchen, genau wie der unten beschriebene
Volltext-Pfad sie interpretiert.

Dies reicht für eine kleine Collection mit Text in einfachen Spalten aus. Es hat
jedoch drei Einschränkungen, die durch keine interne Einstellung behoben werden können:

- **Es kann nicht in `map`- oder `array`-Eigenschaften hineinsehen.** Eine Collection,
  die ihre durchsuchbaren Inhalte in JSONB speichert – Tags, Zertifizierungen, einen
  Fragebogen –, hat ein Suchfeld, das stillschweigend keine Treffer liefert.
- **Es gibt keine Relevanz.** Zeilen werden in `orderBy`-Reihenfolge zurückgegeben,
  sodass der beste Treffer auf Seite sieben liegen kann.
- **Es kann keinen Index verwenden.** Ein führendes `%` hebelt einen B-Tree aus,
  sodass jede Suche ein sequentieller Scan ist. Bei tausend Zeilen in Ordnung;
  bei einer Million ein steiler Abgrund.

Der Begriff wird **wörtlich (literal)** abgeglichen: `%` und `_` sind LIKE-Metazeichen
und werden escaped, bevor das Pattern erstellt wird. Die Suche nach `50%` sucht
also tatsächlich nach `50%`, anstatt jede Zeile zurückzugeben. Wenn Sie Wildcards
benötigen, akzeptiert der `like`-Filteroperator ein Pattern (`.where("title", "like", "post-%")`);
`.search()` tut dies nicht.

Eine Ein-Wort-Suche kompiliert zu exakt demselben SQL wie bisher.

## Aktivierung (Opt-in)

Deklarieren Sie einen `search`-Block auf einer Postgres-Collection und benennen
Sie die Felder, die indexiert werden sollen:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const talents: PostgresCollectionConfig = {
    slug: "talents",
    table: "talents",
    name: "Candidates",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        full_name: { name: "Full name", type: "string" },
        bio: { name: "Bio", type: "string" },
        interests: { name: "Interests", type: "array", of: { name: "Interest", type: "string" } },
        questionnaire: { name: "Questionnaire", type: "map", properties: {} }
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "full_name", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications"
        ]
    }
};
```

Es wird nichts automatisch abgeleitet. Ein Feld wird genau dann durchsucht,
wenn Sie es explizit benennen, und ein Pfad, der nicht aufgelöst werden kann,
führt beim Start zu einem Fehler, anstatt stillschweigend übersprungen zu werden –
ein Suchfeld, von dem Sie annehmen, dass es aktiv ist, es aber nicht ist, ist
genau der Fehler, den dieser Block verhindern soll.

`.search()` kompiliert dann zu einem gerankten Volltext-Abgleich, und Zeilen
werden mit einem `_score` zurückgegeben:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Was durch die Deklaration erstellt wird

Eine `tsvector`-Spalte, `GENERATED ALWAYS AS … STORED`, und ein GIN-Index darauf.
Postgres berechnet die Spalte bei jedem Schreibvorgang eines Quellfelds neu und
verweigert jeden Versuch, direkt hineinzuschreiben, sodass der Index nicht von
der Zeile abweichen kann. Die Spalte wird niemals von der API zurückgegeben.

Sie werden in `drizzle/search.sql` generiert, neben `schema.sql` und
`policies.sql`, und `rebase db push` wendet sie für Sie an – es muss nichts
Zusätzliches ausgeführt werden. Sie erhalten eine eigene Datei, da eine generierte
`tsvector`-Spalte voraussetzt, dass zuvor eine `IMMUTABLE`-Hilfsfunktion existiert
(`unaccent` ist nur `STABLE`, und das Flattening eines `jsonb`-Dokuments erfordert
eine Set-Returning-Funktion), und Atlas – die Engine hinter `db push` – Funktionen
im Free-Tier nicht verwalten kann.

Eine wichtige Konsequenz, falls Sie per Migration statt per Push deployen:
Das Hinzufügen eines `search`-Blocks allein erzeugt keine Migration, da sich das
von Atlas verglichene Schema nicht geändert hat. `rebase db generate` weist
darauf hin, wenn dies passiert. Der Block wird dennoch durch `rebase db push`
und durch die Schema-Sicherstellung beim Start angewendet; um ihn explizit in
eine Migration aufzunehmen, hängen Sie `drizzle/search.sql` an eine Migration an.

### Nachträgliches Ändern des Blocks

Eine generierte Spalte beinhaltet ihren Ausdruck, und Postgres kann diesen
Ausdruck nicht in-place ändern – das Hinzufügen eines Feldes, das Verschieben
einer Gewichtung, das Ändern der Sprache oder das Aktivieren von `unaccent` ist
also **nichts**, was `ADD COLUMN IF NOT EXISTS` auf eine bereits vorhandene
Spalte anwenden kann.

Rebase zeichnet beim Erstellen einen Fingerabdruck des Ausdrucks auf der Spalte
auf und vergleicht ihn bei jedem Start und jedem `db push`. Eine Änderung wird
unmissverständlich verweigert, zusammen mit den beiden Anweisungen, die sie
anwenden – ein `DROP COLUMN` und ein `ADD COLUMN`, welche die Tabelle umschreiben
und den GIN-Index neu aufbauen. Führen Sie diese zu einem Zeitpunkt Ihrer Wahl
aus; nichts schreibt eine produktive Tabelle ungefragt in Ihrem Namen um.

Zwei Änderungen sind davon ausgenommen. Das Aktivieren von `fuzzy` ist additiv –
eine zweite Spalte – und wird ohne all dies angewendet. Das Setzen von [`mode`](#mode)
ändert die Abfrage statt der Spalte und wird daher direkt mit einem Deployment wirksam.

Der Bootvorgang bricht ab, anstatt den Dienst zu starten, denn die Alternative
ist das, was diese Überprüfung ersetzt hat: eine Spalte, die weiterhin die
vorherigen Felder indexiert, und eine Suche, die für Inhalte, die offensichtlich
in der Zeile vorhanden sind, nichts zurückgibt.

## Was Sie in `fields` angeben können

| Pfad | Löst auf zu | Beispiel |
|------|-------------|---------|
| Eine `string`-Eigenschaft | die Spalte | `"full_name"` |
| Eine `string[]`-Eigenschaft | jedes Element | `"interests"` |
| Eine `map`-Eigenschaft | jeden String-Wert im Dokument | `"questionnaire"` |
| Ein Pfad innerhalb einer `map` | jeden String-Wert an oder unterhalb dieses Punkts | `"questionnaire.certifications"` |

Ein Pfad in eine Map indexiert **String-Werte in beliebiger Tiefe** darunter –
Arrays von Strings, verschachtelte Objekte, Arrays von Objekten. JSON-*Schlüssel*
werden nie indexiert, nur Werte, sodass ein Feldname, der in jeder Zeile vorkommt,
nicht zu einem Begriff wird, der auf jede Zeile zutrifft.

Das Angeben eines Enums, einer UUID, einer `json`-Spalte (im Gegensatz zu `jsonb`)
oder eines Arrays von Zahlen führt zu einem Startfehler mit entsprechender
Erklärung. Insbesondere Enums stellen ein festes Vokabular dar: Filtern Sie diese
mit `where`, was exakt ist und einen Index nutzt.

## Optionen

### `language`

Die Postgres-Textsuchkonfiguration, die über Stemming (Wortstammbildung) und
Stoppwörter entscheidet. `"spanish"` reduziert `auditores` auf `auditor` und
verwirft `de`; der Standardwert `"simple"` macht keines von beiden.

`"simple"` ist die Standardeinstellung, da sie die einzige Wahl ist, die niemals
falsch ist – ein Stemmer, der auf die falsche Sprache angewendet wird, verfälscht
Lexeme unbemerkt. Setzen Sie sie auf die Sprache Ihres Inhalts, um Stemming zu
aktivieren.

### `mode`

Wie ein Suchbegriff mit den von Ihnen benannten Feldern abgeglichen wird.

| `mode` | Treffer | Findet `Muñoz` anhand von `munoz` | Findet `sebastian` anhand von `seb` |
|---|---|---|---|
| `"fts"` (Standard) | ganze Lexeme, über den `tsvector` und dessen GIN-Index | mit `unaccent` | nein |
| `"hybrid"` | dies, `ODER` ein Substring-Abgleich über dieselben Felder | **immer** | **ja** |

```typescript
search: {
    language: "spanish",
    mode: "hybrid",
    fields: ["full_name", "questionnaire.certifications"]
}
```

Der Standard und der Standard ohne Block haben gegensätzliche Schwachstellen,
die dieser Modus schließt. Gemessen an einer echten Postgres-Instanz mit fünf Zeilen
(`search-mode-matrix.test.ts` in `@rebasepro/server-postgres`):

| Abfrage | kein Block (ILIKE) | `"fts"` + `unaccent` | `"hybrid"` |
|---|---|---|---|
| `munoz` | `Ana Munoz` | `Ana Munoz`, `Sebastian Muñoz` | `Ana Munoz`, `Sebastian Muñoz` |
| `seb` | beide Sebastians | — | beide Sebastians |
| `audit` | der `Lead Auditor` | — | der `Lead Auditor` |
| `iso 14001` | die `ISO 14001`-Zeile | die `ISO 14001`-Zeile | die `ISO 14001`-Zeile |

`fuzzy` erreicht dieselben Zeilen, aber erst, wenn der Ähnlichkeits-Schwellenwert
angepasst wird: Beim Standardwert von 0.3 gibt `iso 14001` auch eine `ISO 9001`-Zeile
zurück. `"hybrid"` hat keinen Schwellenwert, der angepasst werden müsste – ein
Substring kommt entweder vor oder nicht.

**Die Kosten.** Der Substring-Teil kann den GIN-Index nicht nutzen; ein führendes
`%` kann das nie. Der `@@`-Teil wird weiterhin zuerst ausgeführt und nutzt weiterhin
den Index. Was der Modus also hinzufügt, ist ein Scan über die Zeilen, die der
Index verworfen hat. Bei einer großen Tabelle ist das der Unterschied zwischen
einem Index-Scan und einem sequentiellen Scan, weshalb dies ein Modus und nicht
der Standard ist.

**Das Ändern auf einer Produktivumgebung ist sicher** – die einzige Option in
diesem Block, bei der das der Fall ist. `mode` wirkt sich nur auf Abfrageseite
aus: Es ändert keine generierte Spalte, keinen Generierungsausdruck und keinen
Index, löst also nicht die unter [Nachträgliches Ändern des Blocks](#changing-the-block-later)
beschriebene Verweigerung aus. Das Aktivieren erfordert lediglich ein Deployment.

Es bereinigt Akzente im Substring-Teil **unabhängig davon, ob `unaccent` gesetzt ist**,
da diese Normalisierung ebenfalls abfrageseitig geschieht. Das ist beabsichtigt:
`unaccent` ist die Einstellung, die Sie später nicht aktivieren können, ohne die
Tabelle neu zu schreiben. So kann eine Collection, die ohne diese Einstellung
aufgesetzt wurde, dennoch aufhören, `Muñoz` zu übersehen. Was `unaccent` weiterhin
bringt, ist die Bereinigung im `@@`-Teil, wo die Lexeme gespeichert werden.

Es fügt der Datenbank die `unaccent`-Erweiterung und eine `IMMUTABLE`-Hilfsfunktion
hinzu, falls diese noch nicht vorhanden sind. Beide Anweisungen verwenden
`IF NOT EXISTS` / `CREATE OR REPLACE`, und keine von beiden berührt eine Tabelle.

### `unaccent`

Akzente vor der Indexierung entfernen (falten), sodass `auditoria` mit `auditoría`
übereinstimmt.

Dies ist in einer Sprache mit Akzenten keine reine Kosmetik. Postgres reduziert
die beiden Schreibweisen auf **unterschiedliche Lexeme** – `to_tsvector('spanish', 'auditoría')`
ergibt `auditor`, während `'auditoria'` `auditori` ergibt. Ohne diese Option
verfehlt eine Abfrage ohne Akzente jede Zeile, die Akzente enthält – was auf die
meisten Suchanfragen der meisten Benutzer zutrifft.

Erfordert die `unaccent`-Erweiterung.

### `fuzzy`

Gleicht zusätzlich auf Trigramm-Ähnlichkeit ab, sodass auch Beinahe-Treffer
berücksichtigt werden: `iso14000` findet `ISO 14001`, was kein Stemming der Welt
leisten könnte, da es sich schlicht um unterschiedliche Lexeme handelt.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Fügt eine zweite generierte Spalte und einen Trigramm-Index hinzu und erfordert
`pg_trgm`. Kostet Schreibzeit und Speicherplatz; fängt dafür die häufigste Art
fehlgeschlagener Suchen ab.

### `weight`

Jedes Feld besitzt eine der vier Gewichtungsklassen von Postgres, von `A` (am
stärksten) bis `D`. `ts_rank` bewertet einen Treffer in `A` weitaus höher als in
`D`, wodurch ein Name vor einer beiläufigen Erwähnung in einer langen Beschreibung
gerankt wird. Felder haben standardmäßig die Gewichtung `B`.

### `column`

Die generierte Spalte heißt `search_vector`. Ändern Sie diesen Namen nur, wenn
er mit einer bereits vorhandenen Spalte kollidiert – sobald sie erstellt wurde,
ist sie Teil Ihres Schemas, und ein späteres Umbenennen erfordert ein Drop und
Recreate, was die Tabelle umschreibt.

## Ranking

`_score` ist `ts_rank` für dieselbe Abfrage, mit der die Zeilen abgeglichen
wurden, und ist nur vorhanden, wenn die Collection aktiviert wurde *und* die
Anfrage einen Suchstring enthielt.

Bei `mode: "hybrid"` erhält eine Zeile, die nur durch den Substring-Teil
gefunden wurde, einen kleinen konstanten Wert (0.001) statt null – unterhalb des
kleinsten `ts_rank`, den ein echter Lexem-Treffer erzeugen kann. Dadurch
übertrifft ein Ganzwort-Treffer immer einen Substring-Treffer, und die Zeilen,
die reine Substring-Treffer sind, fallen auf den Tiebreaker der Abfrage zurück,
anstatt in beliebiger Reihenfolge der Tabelle zurückzukommen.

Wenn `fuzzy` aktiviert ist, wird die Trigramm-Ähnlichkeit zu diesem Rang
**addiert**. Dies ist keine bloße Verfeinerung – es macht `fuzzy` überhaupt
erst zu einem Ranking. Ein Tippfehler führt auf dem exakten Pfad zu keinem Treffer,
sodass jede gefundene Zeile einen `ts_rank` von exakt null hat; eine Sortierung
allein nach Rang würde den besten Treffer in beliebiger Reihenfolge zurückgeben.
Die beiden Terme werden summiert statt gewichtet, sodass eine Zeile mit exakter
Übereinstimmung zu beidem beiträgt und eine nur ähnliche Zeile übertrifft, ohne
dass ein Koeffizient definiert werden muss. Außerhalb dieser beiden Bedingungen
ist `orderBy: "_score"` ein unbekanntes Feld und gibt 400 zurück, anstatt
stillschweigend unsortierte Zeilen zu liefern.

`_score` kann nicht mit Cursor-Paginierung (`startAfter`) kombiniert werden.
Relevanz wird pro Abfrage berechnet und nicht gespeichert, sodass auf der
Cursor-Zeile kein Wert vorhanden ist, mit dem die nächste Seite verglichen werden
könnte, und zwei Anfragen mit unterschiedlichen Suchstrings erzeugen Scores auf
unterschiedlichen Skalen. Verwenden Sie `limit`/`offset` für nach Relevanz
sortierte Seiten.

## Warum stimmte diese Zeile überein?

Eine gerankte Liste verrät Ihnen, *welche* Zeilen zurückgegeben wurden, aber
niemals, *warum* eine Zeile dort aufgeführt ist. Lassen Sie sich von jeder Zeile
erklären, warum sie zutrifft:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` entspricht exakt dem in `fields` deklarierten Pfad, sodass Sie ihn für
die Anzeige einem Label zuordnen können. Die Felder werden in der Reihenfolge
zurückgegeben, in der Sie sie deklariert haben.

Dies geschieht pro Abfrage, nicht pro Collection, da die Kosten pro Abfrage
anfallen: ein `ts_headline` pro deklariertem Feld pro zurückgegebener Zeile,
und `ts_headline` parst das Dokument neu, anstatt den Index zu lesen. Passend
für eine Ergebnisseite, ungeeignet für einen Export.

**Das Snippet enthält konstruktionsbedingt Markup** – jeder Treffer ist in
`<mark>` eingeschlossen. Rendern Sie es als HTML oder entfernen Sie die Tags,
aber behandeln Sie es nicht als reinen Text und vertrauen Sie dem umgebenden
Text nicht: Es ist der Text, den der Benutzer eingegeben hat. Das Aufteilen
anhand von `<mark>` und Rendern der Einzelteile ist sicherer als
`dangerouslySetInnerHTML`.

Unter `mode: "hybrid"` wird auch ein Feld gemeldet, das nur per Substring
übereinstimmt – es ist das Feld, das den Treffer verursacht hat. Dessen Snippet
wird ohne Markierungen zurückgegeben: `ts_headline` markiert Lexeme, und ein
halbes Wort ist kein Lexem.

Wenn `unaccent` aktiviert ist, werden Snippets mit entfernten Akzenten
dargestellt – `Auditoria`, nicht `Auditoría`. `ts_headline` über dem
Originaltext kann einen Treffer, den eine unakzentuierte Abfrage erzeugt hat,
nicht finden und würde den Text komplett ohne Markierungen zurückgeben; ein
lesbares Snippet mit Hervorhebungen ist besser als ein optisch schöneres, das
stillschweigend nichts hervorhebt.

## Den Block zu einer Produktiv-Collection hinzufügen

Die generierte Spalte wird wie jede andere Spalte durch die Schema-Sicherstellung
beim Start hinzugefügt, und ihr Index wird mit `CREATE INDEX CONCURRENTLY`
erstellt, sodass Schreibvorgänge nicht blockiert werden. Das Hinzufügen einer
*gespeicherten (stored)* generierten Spalte schreibt die Tabelle jedoch um –
planen Sie dies bei einer großen Tabelle wie jedes andere Tabellen-Rewrite.

## Welche Engines

Der `search`-Block ist Postgres-exklusiv und wird auf anderen Engines beim Start
abgewiesen, anstatt stillschweigend ignoriert zu werden. MongoDB-Collections
behalten ihren Regex-basierten Abgleich bei; Firestore-Collections verwenden
den externen Text-Search-Controller.

## Verwandte Themen

- [REST API](/docs/backend/api/) — die Abfrageparameter, als die eine Suche den Server erreicht
- [Indexes](/docs/backend/indexes/) — was der Search-Block erstellt und was er kostet
- [Querying Data](/docs/sdk/querying/) — Suchen über das Client-SDK
