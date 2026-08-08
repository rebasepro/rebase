---
title: Suche
sidebar_label: Suche
description: Wie sich .search() standardmäßig verhält und wie Sie eine Postgres-Collection für eine gerankte Volltextsuche über die von Ihnen benannten Felder aktivieren — einschließlich JSONB- und Array-Inhalten.
---

`.search("term")` funktioniert ohne Konfiguration auf jeder Collection. Wozu es
kompiliert wird, hängt davon ab, ob die Collection mehr angefordert hat.

## Der Standard

Ohne Konfiguration ist `.search()` eine **Substring-Übereinstimmung ohne
Berücksichtigung der Groß-/Kleinschreibung** (case-insensitive), die mittels OR
über die `string`-Eigenschaften der obersten Ebene der Collection verknüpft wird:

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

Dies reicht für eine kleine Collection mit Text in einfachen Spalten aus. Es hat
drei Einschränkungen, die durch keine Einstellung darin behoben werden können:

- **Es kann nicht in `map`- oder `array`-Eigenschaften hineinsehen.** Eine
  Collection, die ihre durchsuchbaren Inhalte in JSONB speichert — Tags,
  Zertifizierungen, einen Fragebogen —, hat ein Suchfeld, das stillschweigend zu
  keinen Treffern führt.
- **Es hat keine Relevanz.** Zeilen werden in der `orderBy`-Reihenfolge
  zurückgegeben, sodass der beste Treffer auf Seite sieben liegen kann.
- **Es kann keinen Index verwenden.** Ein führendes `%` setzt einen B-Tree außer
  Kraft, sodass jede Suche ein sequenzieller Scan ist. Bei tausend Zeilen in
  Ordnung; bei einer Million ein Absturz.

Der Standard ändert sich nicht, und eine Collection, die sich nicht dafür
entschieden hat (opted in), kompiliert genau zu dem SQL, das sie schon immer
generiert hat.

## Die Suche aktivieren

Deklarieren Sie einen `search`-Block in einer Postgres-Collection und nennen Sie
die Felder, die Sie indizieren möchten:

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

Nichts wird automatisch abgeleitet. Ein Feld wird nur dann durchsucht, wenn Sie
es explizit benennen, und ein Pfad, der nicht aufgelöst werden kann, schlägt beim
Starten (Boot) fehl, anstatt stillschweigend übersprungen zu werden — ein
Suchfeld, von dem Sie glauben, dass es aktiv ist, obwohl es das nicht ist, ist
genau der Fehler, den dieser Block verhindern soll.

`.search()` kompiliert dann zu einem gerankten Volltext-Match, und Zeilen werden
mit einem `_score` zurückgegeben:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Was durch die Deklaration erstellt wird

Eine `tsvector`-Spalte, `GENERATED ALWAYS AS … STORED`, und ein GIN-Index darauf.
Postgres berechnet die Spalte bei jedem Schreibvorgang auf ein Quellfeld neu und
lehnt jeden Versuch ab, sie direkt zu beschreiben, sodass der Index nicht von
der Zeile abweichen kann. Die Spalte wird von der API niemals zurückgegeben.

Sie werden in `drizzle/search.sql` generiert, neben `schema.sql` und
`policies.sql`, und `rebase db push` wendet sie für Sie an — Sie müssen nichts
weiter ausführen. Sie erhalten eine eigene Datei, da eine generierte `tsvector`-Spalte
voraussetzt, dass zuerst eine `IMMUTABLE`-Hilfsfunktion existiert (`unaccent` ist
nur `STABLE`, und das Flachklopfen eines `jsonb`-Dokuments erfordert eine
Funktion, die ein Set zurückgibt), und Atlas — die Engine hinter `db push` —
Funktionen in seinem kostenlosen Tarif nicht verwalten kann.

Eine Konsequenz, die Sie wissen sollten, wenn Sie über Migrationen statt über
Push bereitstellen: Das Hinzufügen eines `search`-Blocks allein erzeugt keine
Migration, da sich das von Atlas verglichene Schema nicht geändert hat.
`rebase db generate` meldet dies, wenn es passiert. Der Block wird weiterhin durch
`rebase db push` und durch die Schema-Sicherstellung beim Start angewendet; um ihn
explizit in eine Migration aufzunehmen, hängen Sie `drizzle/search.sql` an eine
solche an.

## Was Sie in `fields` angeben können

| Pfad | Wird aufgelöst zu | Beispiel |
|------|-------------|---------|
| Eine `string`-Eigenschaft | die Spalte | `"full_name"` |
| Eine `string[]`-Eigenschaft | jedes Element | `"interests"` |
| Eine `map`-Eigenschaft | jeden String-Wert im Dokument | `"questionnaire"` |
| Ein Pfad innerhalb einer `map` | jeden String-Wert an oder unter diesem Punkt | `"questionnaire.certifications"` |

Ein Pfad in eine Map indiziert **String-Werte in jeder Tiefe** darunter — Arrays
von Strings, verschachtelte Objekte, Arrays von Objekten. JSON-*Schlüssel*
werden niemals indiziert, nur Werte, sodass ein Feldname, der allen Zeilen
gemeinsam ist, nicht zu einem Begriff wird, der auf jede Zeile zutrifft.

Die Angabe eines Enums, einer UUID, einer `json`-Spalte (anstelle von `jsonb`)
oder eines Arrays von Zahlen führt zu einem Fehler beim Starten, der den Grund
erklärt. Insbesondere Enums sind ein festes Vokabular: Filtern Sie nach ihnen
mit `where`, was exakt ist und einen Index verwendet.

## Optionen

### `language`

Die Postgres-Textsuchkonfiguration, die über Stemming (Stammformenreduktion) und
Stoppwörter entscheidet. `"spanish"` führt beim Wort `auditores` ein Stemming zu
`auditor` durch und entfernt `de`; der Standardwert `"simple"` tut beides nicht.

`"simple"` ist der Standardwert, da dies die einzige Wahl ist, die niemals
falsch ist — ein Stemmer, der auf die falsche Sprache angewendet wird,
verunstaltet Lexeme stillschweigend. Stellen Sie ihn auf die Sprache Ihres Inhalts
ein, um Stemming zu nutzen.

### `unaccent`

Entfernt Akzente/Diakritika vor der Indizierung, sodass `auditoria` auch auf
`auditoría` passt.

Dies ist in einer Sprache mit Akzenten nicht bloß kosmetischer Natur. Postgres
reduziert die beiden Schreibweisen auf **unterschiedliche Lexeme** —
`to_tsvector('spanish', 'auditoría')` ergibt `auditor`, während `'auditoria'`
`auditori` ergibt. Ohne diese Option übersieht eine ohne Akzente eingegebene
Suchanfrage jede Zeile, die Akzente enthält — was auf die meisten Suchanfragen
der meisten Benutzer zutrifft.

Erfordert die Erweiterung `unaccent`.

### `fuzzy`

Gleicht zusätzlich auf Basis von Trigramm-Ähnlichkeit ab, sodass auch
Beinahe-Treffer geordnet werden: `iso14000` erreicht `ISO 14001`, was kein
Stemming erreichen würde, da es sich schlicht um unterschiedliche Lexeme handelt.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Fügt eine zweite generierte Spalte und einen Trigramm-Index hinzu und erfordert
`pg_trgm`. Kostet Schreibzeit und Speicherplatz; behebt die häufigste Kategorie
fehlgeschlagener Suchen.

### `weight`

Jedes Feld trägt eine der vier Gewichtungsklassen von Postgres, `A` (am stärksten)
bis `D`. `ts_rank` bewertet einen `A`-Treffer weit höher als einen `D`-Treffer.
So rangiert beispielsweise ein Name höher als eine beiläufige Erwähnung in einer
langen Beschreibung. Felder haben standardmäßig die Gewichtung `B`.

### `column`

Die generierte Spalte heißt `search_vector`. Ändern Sie dies nur, wenn es mit
einer bereits vorhandenen Spalte kollidiert — sie ist nach der Erstellung Teil
Ihres Schemas, und ein späteres Umbenennen erfordert ein Löschen und Neuerstellen
(Drop & Recreate), was die Tabelle neu schreibt.

## Ranking

`_score` entspricht `ts_rank` für dieselbe Suchanfrage, mit der die Zeilen
abgeglichen wurden, und ist nur vorhanden, wenn die Collection die Suche aktiviert
hat *und* die Anfrage einen Suchstring enthielt.

Wenn `fuzzy` aktiviert ist, wird die Trigramm-Ähnlichkeit zu diesem Rang
**addiert**. Dies ist keine bloße Verfeinerung — es macht `fuzzy` überhaupt erst
zu einem Ranking. Ein Tippfehler führt auf dem exakten Pfad zu keinen Treffern,
sodass jede gefundene Zeile einen `ts_rank` von genau null hat; eine Sortierung
allein nach Rang würde den besten Treffer in einer beliebigen Reihenfolge der
Tabelle zurückgeben. Die beiden Terme werden summiert anstatt gewichtet, sodass
eine exakt passende Zeile zu beidem beiträgt und höher rangiert als eine lediglich
ähnliche Zeile, ohne dass dafür ein Koeffizient erforderlich ist. Außerhalb
dieser beiden Bedingungen ist `orderBy: "_score"` ein unbekanntes Feld und gibt
den Statuscode 400 zurück, anstatt stillschweigend unsortierte Zeilen zu liefern.

`_score` kann nicht mit Cursor-Paginierung (`startAfter`) kombiniert werden. Die
Relevanz wird pro Anfrage berechnet und nicht gespeichert, sodass es auf der
Cursor-Zeile keinen Wert gibt, mit dem die nächste Seite verglichen werden
könnte, und zwei Anfragen mit unterschiedlichen Suchstrings Scores erzeugen, die
nicht auf derselben Skala liegen. Verwenden Sie `limit`/`offset` für nach
Relevanz sortierte Seiten.

## Warum hat diese Zeile übereingestimmt?

Eine gerankte Liste sagt Ihnen, *welche* Zeilen passen, aber niemals, *warum* eine
Zeile enthalten ist. Fordern Sie jede Zeile auf, sich selbst zu erklären:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` ist genau der Pfad, wie er in `fields` deklariert wurde, sodass Sie ihn
für die Anzeige einem Label zuordnen können. Felder werden in der Reihenfolge
zurückgegeben, in der Sie sie deklariert haben.

Dies erfolgt pro Anfrage, nicht pro Collection, da die Kosten pro Anfrage anfallen:
ein `ts_headline` pro deklariertem Feld pro zurückgegebener Zeile, und
`ts_headline` parst das Dokument neu, anstatt den Index zu lesen. Richtig für
eine Ergebnisseite, falsch für einen Export.

**Das Snippet enthält bauartbedingt Markup** — jeder Treffer ist in `<mark>`
eingeschlossen. Rendern Sie es als HTML oder entfernen Sie die Tags, aber
behandeln Sie es nicht als Klartext und vertrauen Sie dem umgebenden Text nicht:
Es handelt sich um das, was der Benutzer eingegeben hat. Das Aufteilen an `<mark>`
und das Rendern der Teile ist sicherer als `dangerouslySetInnerHTML`.

Wenn `unaccent` aktiviert ist, werden Snippets ohne Akzente gelesen — `Auditoria`,
nicht `Auditoría`. `ts_headline` über dem Originaltext kann keinen Treffer finden,
den eine akzentfreie Suchanfrage erzeugt hat, sodass der Text ohne jegliche
Markierung zurückgegeben würde; ein lesbares Snippet, das Hervorhebungen enthält,
ist besser als ein schöneres, das dies stillschweigend versäumt.

## Hinzufügen des Blocks zu einer aktiven Collection

Die generierte Spalte wird durch die Schema-Sicherstellung beim Start wie jede
andere Spalte hinzugefügt, und ihr Index wird mit `CREATE INDEX CONCURRENTLY`
erstellt, sodass Schreibvorgänge nicht blockiert werden. Das Hinzufügen einer
*gespeicherten* (stored) generierten Spalte schreibt jedoch die Tabelle neu.
Planen Sie dies bei einer großen Tabelle wie jedes andere Umschreiben der
Tabelle ein.

## Welche Engines

Der `search`-Block ist Postgres-spezifisch und wird auf anderen Engines beim
Starten abgelehnt, anstatt stillschweigend ignoriert zu werden. MongoDB-Collections
behalten ihr Regex-basiertes Matching bei; Firestore-Collections verwenden
den externen Textsuch-Controller.
