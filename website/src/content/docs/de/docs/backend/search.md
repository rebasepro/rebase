---
sourceHash: 72daf47d8a15bafe
title: Suche
sidebar_label: Suche
description: Wie sich .search() standardmäßig verhält und wie eine Tabelle die gerankte Volltextsuche über von Ihnen benannte Spalten aktiviert – einschließlich JSONB- und Array-Inhalten.
---

`.search("term")` funktioniert auf jeder Tabelle ohne Konfiguration. Worin es
kompiliert wird, hängt davon ab, ob die Tabelle mehr angefordert hat.

## Das Standardverhalten

Ohne Konfiguration ist `.search()` ein **Teilstring-Abgleich ohne Berücksichtigung der Groß-/Kleinschreibung** (case-insensitive substring match),
der per OR über die Textspalten der Tabelle verknüpft wird. Der Suchstring
wird an Leerzeichen aufgeteilt und jeder Begriff muss übereinstimmen – sie können
jedoch mit verschiedenen Spalten übereinstimmen, sodass ein Name, der über zwei Spalten verteilt ist, dennoch gefunden wird:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Setzen Sie eine Wortfolge in doppelte Anführungszeichen – `.search('"ada lovelace"')` –, um stattdessen
nach der Phrase zu suchen, genau wie der unten beschriebene Volltext-Pfad sie interpretiert.

Dies reicht für eine kleine Tabelle aus, deren Text in einfachen Spalten liegt. Es hat
drei Einschränkungen, die keine Einstellung darin beheben kann:

- **Es kann nicht in JSON- oder Array-Spalten hineinsehen.** Eine Tabelle, die
  ihre durchsuchbaren Inhalte in JSONB speichert – Tags, Zertifizierungen, einen Fragebogen –, hat
  ein Suchfeld, das stillschweigend zu keinen Treffern führt.
- **Es gibt keine Relevanz.** Zeilen werden in `orderBy`-Reihenfolge zurückgegeben,
  sodass sich der beste Treffer auf Seite sieben befinden kann.
- **Es kann keinen Index verwenden.** Ein führendes `%` hebelt einen B-Baum aus,
  sodass jede Suche ein sequentieller Scan ist. Bei tausend Zeilen in Ordnung; bei einer Million ein steiler Abgrund.
  `rebase doctor` nennt die Tabellen, bei denen dies relevant geworden ist: kein
  `search`-Block und mehr als etwa 10.000 Zeilen.

Der Begriff wird **wörtlich** abgeglichen: `%` und `_` sind LIKE-Metazeichen, und sie
werden maskiert, bevor das Muster erstellt wird, sodass die Suche nach `50%` tatsächlich nach
`50%` sucht, anstatt jede Zeile zurückzugeben. Wenn Sie Wildcards wünschen, akzeptiert der `like`-Filteroperator
ein Muster (`.where("title", "like", "post-%")`); `.search()` tut
dies nicht.

Eine Ein-Wort-Suche kompiliert zu genau demselben SQL wie zuvor.

## Aktivierung (Opt-in)

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Deklarieren Sie `search` auf einer Tabelle und benennen Sie die Spalten, die Sie indexiert haben möchten:

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const talents = defineTable("talents", {
    columns: {
        id:            col.uuid().primaryKey().defaultRandom(),
        fullName:      col.text().notNull(),
        bio:           col.text(),
        interests:     col.text().array(),
        questionnaire: col.jsonb(json.object({ certifications: json.array(json.string()) }, { additional: true })),
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "fullName", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications",
        ],
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

Nichts wird implizit abgeleitet. Ein Feld wird genau dann durchsucht, wenn Sie es benennen, und ein Pfad,
der sich nicht auflösen lässt, wird bei der Kompilierung des Schemas abgelehnt, anstatt
stillschweigend übersprungen zu werden – ein Suchfeld, von dem Sie glauben, dass es aktiv ist, es aber nicht ist, ist genau der
Fehler, den dieser Block verhindern soll. Dasselbe gilt für eine Spalte, die durch `.private()` oder
`.access({ read })` eingeschränkt ist: Der Index wird von allen Aufrufern gemeinsam genutzt.

`.search()` kompiliert dann zu einem gerankten Volltext-Match, und Zeilen werden mit einem
`_score` zurückgegeben:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Was durch die Deklaration erstellt wird

Eine `tsvector`-Spalte, `GENERATED ALWAYS AS … STORED`, und ein GIN-Index darauf.
Postgres berechnet die Spalte bei jedem Schreibvorgang in ein Quellfeld neu und verweigert jeden
Versuch, direkt hineinzuschreiben, sodass der Index nicht von der Zeile abweichen kann. Die Spalte
wird niemals von der API zurückgegeben.

Sie werden in `.rebase/sql/search.sql` neben `schema.sql` und
`policies.sql` generiert, und `rebase db push` wendet sie für Sie an – es muss nichts Zusätzliches
ausgeführt werden. Sie erhalten eine eigene Datei, da eine generierte `tsvector`-Spalte voraussetzt, dass zuerst eine
`IMMUTABLE`-Hilfsfunktion existiert (`unaccent` ist nur `STABLE`, und
das Reduzieren eines `jsonb`-Dokuments erfordert eine Set-Returning-Funktion), und Atlas – die
Engine hinter `db push` – in seiner kostenlosen Version keine Funktionen verwalten kann.

Eine beachtenswerte Konsequenz, wenn Sie per Migration statt per Push deployen:
Das Hinzufügen eines `search`-Blocks allein erzeugt keine Migration, da sich das Schema, das
Atlas vergleicht, nicht geändert hat. `rebase db generate` weist darauf hin, wenn dies geschieht.
Der Block wird weiterhin durch `rebase db push` und durch das Überprüfen des Schemas beim Start
angewendet; um ihn explizit in eine Migration aufzunehmen, hängen Sie `.rebase/sql/search.sql`,
die von `rebase db generate` frisch geschrieben wurde, an eine Migration an.

### Den Block später ändern

Eine generierte Spalte behält ihren Ausdruck bei, und Postgres kann diesen
Ausdruck nicht direkt an Ort und Stelle ändern – das Hinzufügen eines Felds, das Ändern einer Gewichtung, das Wechseln der Sprache
oder das Aktivieren von `unaccent` ist also **nichts**, was `ADD COLUMN IF NOT EXISTS` auf
eine bereits vorhandene Spalte anwenden kann.

Rebase speichert beim Erstellen der Spalte einen Fingerprint des Ausdrucks
und vergleicht ihn bei jedem Start und jedem `db push`. Eine Änderung wird mit deutlicher Fehlermeldung verweigert,
zusammen mit den zwei Anweisungen, die sie anwenden – einem `DROP COLUMN` und einem `ADD COLUMN`,
die die Tabelle neu schreiben und den GIN-Index neu aufbauen. Führen Sie diese zu einem von Ihnen
gewählten Zeitpunkt aus; nichts schreibt eine Produktivtabelle ungefragt in Ihrem Namen um.

Zwei Änderungen sind davon ausgenommen. Das Aktivieren von `fuzzy` ist additiv – eine zweite Spalte – und
wird ohne all dies angewendet. Das Festlegen von [`mode`](#mode) ändert die Abfrage statt
der Spalte, wird also einfach mit einem Deployment wirksam.

Der Startvorgang bricht ab, anstatt Anfragen zu bedienen, denn die Alternative ist das, was diese
Überprüfung ersetzt hat: eine Spalte, die weiterhin den vorherigen Feldsatz indexiert, und eine Suche, die
für Inhalte, die eindeutig in der Zeile vorhanden sind, nichts zurückgibt.

## Was Sie in `fields` angeben können

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Pfad beginnt mit einem Spaltenschlüssel.

| Pfad | Löst sich auf zu | Beispiel |
|------|-------------|---------|
| Eine Textspalte | die Spalte | `"fullName"` |
| Eine `col.text().array()`-Spalte | jedes Element | `"interests"` |
| Eine `col.jsonb()`-Spalte | jeden String-Wert im Dokument | `"questionnaire"` |
| Ein Pfad innerhalb einer `col.jsonb()`-Spalte | jeden String-Wert an oder unterhalb dieses Punkts | `"questionnaire.certifications"` |

Ein Pfad in eine Map indexiert **String-Werte in beliebiger Tiefe** darunter – Arrays von
Strings, verschachtelte Objekte, Arrays von Objekten. JSON-*Schlüssel* werden nie indexiert, nur
Werte, sodass ein Feldname, der in jeder Zeile vorkommt, nicht zu einem Begriff wird, der auf
jede Zeile zutrifft.

Die Angabe eines Enums, einer UUID, einer `json`-Spalte (anstelle von `jsonb`) oder eines Arrays von
Zahlen wird unter Angabe des Grundes verweigert. Insbesondere Enums stellen ein festes
Vokabular dar: Filtern Sie diese mit `where`, was exakt ist und einen Index verwendet.

## Optionen

### `language`

Die Postgres-Textsuchkonfiguration, die über Stemming und Stoppwörter entscheidet.
`"spanish"` führt `auditores` auf `auditor` zurück und entfernt `de`; der Standardwert,
`"simple"`, tut keines von beiden.

`"simple"` ist der Standardwert, weil es die einzige Wahl ist, die niemals falsch ist – ein
Stemmer, der auf die falsche Sprache angewendet wird, verfälscht Lexeme stillschweigend. Setzen Sie ihn auf die
Sprache Ihrer Inhalte, um Stemming zu aktivieren.

### `mode`

Wie ein Suchstring mit den von Ihnen benannten Feldern abgeglichen wird.

| `mode` | Gleicht ab | Findet `Muñoz` über `munoz` | Findet `sebastian` über `seb` |
|---|---|---|---|
| `"fts"` (Standard) | ganze Lexeme über den `tsvector` und dessen GIN-Index | mit `unaccent` | nein |
| `"hybrid"` | das, `ODER` ein Teilstring-Abgleich über dieselben Felder | **immer** | **ja** |

```typescript
search: {
    language: "spanish",
    mode: "hybrid",
    fields: ["fullName", "questionnaire.certifications"]
}
```

Der Standard und das Verhalten ohne Block haben jeweils gegensätzliche Lücken, und genau diese
schließt dieser Modus. Gemessen an einer echten Postgres-Instanz über fünf Zeilen
(`search-mode-matrix.test.ts` in `@rebasepro/server-postgres`):

| Abfrage | kein Block (ILIKE) | `"fts"` + `unaccent` | `"hybrid"` |
|---|---|---|---|
| `munoz` | `Ana Munoz` | `Ana Munoz`, `Sebastian Muñoz` | `Ana Munoz`, `Sebastian Muñoz` |
| `seb` | beide Sebastians | — | beide Sebastians |
| `audit` | der `Lead Auditor` | — | der `Lead Auditor` |
| `iso 14001` | die `ISO 14001`-Zeile | die `ISO 14001`-Zeile | die `ISO 14001`-Zeile |

`fuzzy` erreicht dieselben Zeilen, aber erst, wenn dessen Ähnlichkeitsschwelle angepasst wird:
Beim Standardwert von 0.3 gibt `iso 14001` auch eine `ISO 9001`-Zeile zurück. `"hybrid"` hat keinen
Schwellenwert, der angepasst werden müsste – ein Teilstring kommt entweder vor oder nicht.

**Was es kostet.** Der Teilstring-Teil kann den GIN-Index nicht nutzen; ein führendes `%`
kann das nie. Der `@@`-Teil läuft weiterhin zuerst und nutzt den Index, sodass der
Modus lediglich einen Scan über die Zeilen hinzufügt, die der Index verworfen hat. Bei einer großen Tabelle ist das
der Unterschied zwischen einem Index-Scan und einem sequentiellen Scan – weshalb dies
ein optionaler Modus und nicht der Standard ist.

**Eine Änderung an einer Produktivtabelle ist sicher** – die einzige Option in diesem Block,
bei der dies zutrifft. `mode` wirkt sich nur auf die Abfrageseite aus: Es ändert weder eine generierte Spalte, noch einen
Generierungsausdruck oder einen Index und löst daher nicht die unter
[Den Block später ändern](#den-block-später-ändern) beschriebene Ablehnung aus. Das Aktivieren erfordert
lediglich ein Deployment und sonst nichts.

Es bereinigt Akzente im Teilstring-Teil, **unabhängig davon, ob `unaccent` gesetzt ist oder nicht**,
da diese Normalisierung ebenfalls abfrageseitig erfolgt. Das ist Absicht: `unaccent` ist die
Einstellung, die Sie später nicht aktivieren können, ohne die Tabelle neu zu schreiben, sodass eine Tabelle
ohne diese Einstellung dennoch aufhören kann, `Muñoz` zu übersehen. Was `unaccent` weiterhin bringt, ist die
Bereinigung auf der `@@`-Seite, wo die Lexeme gespeichert sind.

Es fügt der Datenbank die Extension `unaccent` und eine `IMMUTABLE`-Hilfsfunktion
hinzu, falls diese noch nicht vorhanden sind. Beide Anweisungen lauten
`IF NOT EXISTS` / `CREATE OR REPLACE`, und keine von beiden fasst eine Tabelle an.

### `unaccent`

Akzente vor der Indexierung entfernen, sodass `auditoria` auf `auditoría` passt.

Dies ist in einer Sprache mit Akzenten nicht bloß kosmetischer Natur. Postgres führt die beiden Schreibweisen auf
**unterschiedliche Lexeme** zurück – `to_tsvector('spanish', 'auditoría')` ergibt
`auditor`, während `'auditoria'` `auditori` ergibt. Ohne diese Option verfehlt eine
ohne Akzente eingegebene Abfrage jede Zeile, die Akzente enthält – was auf die meisten Abfragen
der meisten Benutzer zutrifft.

Erfordert die Extension `unaccent`.

### `fuzzy`

Ebenfalls auf Trigram-Ähnlichkeit abgleichen, sodass Fast-Treffer dennoch gerankt werden: `iso14000` findet
so `ISO 14001`, was kein Stemming der Welt leisten kann, da es sich schlicht um
unterschiedliche Lexeme handelt.

```typescript
search: {
    fields: ["fullName", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Fügt eine zweite generierte Spalte und einen Trigram-Index hinzu und erfordert `pg_trgm`.
Kostet Schreibzeit und Speicherplatz; deckt dafür die häufigste Ursache fehlgeschlagener Suchanfragen ab.

### `weight`

Jedes Feld besitzt eine der vier Gewichtungsklassen von Postgres, von `A` (am stärksten)
bis `D`. `ts_rank` bewertet einen Treffer der Klasse `A` weitaus höher als einen der Klasse `D`, wodurch ein
Name höher eingestuft wird als eine beiläufige Erwähnung in einer langen Beschreibung. Felder sind standardmäßig auf `B` gesetzt.

### `column`

Die generierte Spalte heißt `search_vector`. Ändern Sie diesen Namen nur, wenn
er mit einer bereits vorhandenen Spalte kollidiert – sie ist nach der Erstellung Teil Ihres Schemas, und
ein späteres Umbenennen erfordert ein Löschen und Neuerstellen, wodurch die Tabelle neu geschrieben wird.

## Ranking

`_score` ist das `ts_rank` bezüglich derselben Abfrage, mit der die Zeilen abgeglichen wurden, und
ist nur vorhanden, wenn die Tabelle die Funktion aktiviert hat *und* die Anfrage einen
Suchstring enthielt.

Mit `mode: "hybrid"` erhält eine Zeile, die nur durch den Teilstring-Teil gefunden wurde, einen kleinen
konstanten Wert (0.001) statt null – kleiner als das kleinste `ts_rank`, das ein echter
Lexem-Treffer erzeugen kann. Dadurch wird ein Treffer auf ganze Wörter stets höher bewertet als ein Teilstring-Treffer, und die
reinen Teilstring-Zeilen fallen auf das abfrageeigene Tiebreaking zurück, anstatt
in beliebiger Reihenfolge der Tabelle zurückgegeben zu werden.

Wenn `fuzzy` aktiviert ist, wird die Trigram-Ähnlichkeit zu diesem Rang **addiert**. Dies ist keine
bloße Verfeinerung – es ist das, was `fuzzy` überhaupt erst zu einem Ranking macht. Ein Tippfehler matcht auf
dem exakten Pfad nichts, sodass jede dadurch gefundene Zeile ein `ts_rank` von exakt null hat; eine Sortierung
allein nach Rang würde den besten Treffer in beliebiger Reihenfolge zurückgeben.
Die beiden Terme werden addiert statt gewichtet, sodass eine exakt passende Zeile
zu beidem beiträgt und eine bloß ähnliche Zeile übertrifft, ohne dass ein Koeffizient
nötig wäre. Außerhalb dieser beiden Bedingungen ist `orderBy: "_score"` ein unbekanntes Feld und
gibt 400 zurück, anstatt stillschweigend unsortierte Zeilen zu liefern.

`_score` kann nicht mit Cursor-Pagination (`startAfter`) kombiniert werden. Die Relevanz wird
pro Abfrage berechnet und nicht gespeichert, sodass auf der Cursor-Zeile kein Wert existiert,
mit dem die nächste Seite verglichen werden könnte, und zwei Anfragen mit unterschiedlichen Suchstrings
Scores erzeugen, die nicht auf derselben Skala liegen. Verwenden Sie `limit`/`offset` für
nach Relevanz sortierte Seiten.

## Warum hat diese Zeile gematcht?

Eine gerankte Liste verrät Ihnen, *welche* Zeilen matchen, aber nie, *warum* eine dort steht. Lassen Sie sich
von jeder Zeile erklären, warum sie gematcht hat:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` entspricht exakt dem in `fields` deklarierten Pfad, sodass Sie ihn für die Anzeige auf
ein Label mappen können. Felder werden in der Reihenfolge zurückgegeben, in der Sie sie deklariert haben.

Pro Abfrage, nicht pro Tabelle, da die Kosten pro Abfrage anfallen: ein `ts_headline`
pro deklariertem Feld pro zurückgegebener Zeile, und `ts_headline` analysiert das Dokument erneut,
anstatt den Index zu lesen. Genau richtig für eine Ergebnisseite, ungeeignet für einen Export.

**Das Snippet enthält bauartbedingt Markup** – jeder Treffer ist in
`<mark>` eingeschlossen. Rendern Sie es als HTML oder entfernen Sie die Tags, aber behandeln Sie es nicht als reinen
Text und vertrauen Sie dem umgebenden Text nicht: Er enthält das, was der Benutzer eingegeben hat.
Das Aufteilen an `<mark>` und Rendern der Einzelteile ist sicherer als
`dangerouslySetInnerHTML`.

Unter `mode: "hybrid"` wird auch ein Feld gemeldet, das nur über einen Teilstring gematcht hat – es
ist das Feld, das den Treffer ausgelöst hat. Dessen Snippet wird ohne Markierungen zurückgegeben:
`ts_headline` markiert Lexeme, und ein halbes Wort ist kein Lexem.

Wenn `unaccent` aktiviert ist, werden Snippets mit entfernten Akzenten ausgegeben – `Auditoria`, nicht
`Auditoría`. Ein `ts_headline` auf dem Originaltext kann einen Treffer, den eine
akzentfreie Abfrage erzeugt hat, nicht finden und würde den Text folglich völlig ohne Markierungen
zurückgeben; ein lesbares Snippet mit Hervorhebungen ist besser als ein schöneres, das stillschweigend
nichts hervorhebt.

## Den Block zu einer Produktivtabelle hinzufügen

Die generierte Spalte wird wie jede andere Spalte durch die Schema-Prüfung beim Start hinzugefügt.
Ihr Index wird im Hintergrund aufgebaut, nachdem der Server bereits Anfragen bedient – mit
`CREATE INDEX CONCURRENTLY`, sodass Schreibvorgänge nicht blockiert werden (siehe
[Indexes](/docs/backend/indexes#when-they-are-created)). Bis der Index aufgebaut ist, funktioniert eine
Suche zwar, liest aber die gesamte Tabelle. Das Hinzufügen einer *stored* generierten Spalte
schreibt die Tabelle jedoch neu um; planen Sie dies bei einer großen Tabelle daher wie jeden anderen Rewrite.

## Verwandte Themen

- [REST API](/docs/backend/api/) — die Abfrageparameter, als die eine Suche den Server erreicht
- [Indexes](/docs/backend/indexes/) — was der search-Block erstellt und was er kostet
- [Querying Data](/docs/sdk/querying/) — Suchen mit dem typisierten SDK
