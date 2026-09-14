---
sourceHash: 04421ade309db1ce
title: Suche
sidebar_label: Suche
description: Wie sich .search() standardmäßig verhält und wie Sie eine Postgres-Collection für eine gerankte Volltextsuche über die von Ihnen benannten Felder aktivieren – einschließlich JSONB- und Array-Inhalten.
---

`.search("term")` funktioniert bei jeder Collection ohne Konfiguration. Zu was
es kompiliert wird, hängt davon ab, ob die Collection zusätzliche Einstellungen anfordert.

## Der Standard

Ohne Konfiguration ist `.search()` ein **Teilstring-Abgleich ohne Berücksichtigung der Groß-/Kleinschreibung** (case-insensitive),
der mit OR über die `string`-Eigenschaften der obersten Ebene der Collection verknüpft ist:

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

Dies reicht für eine kleine Collection aus, deren Text in einfachen Spalten liegt. Es hat
drei Einschränkungen, die durch keine interne Einstellung behoben werden können:

- **Es kann nicht in `map`- oder `array`-Eigenschaften hineinsehen.** Eine Collection, die ihre
  durchsuchbaren Inhalte in JSONB speichert – Tags, Zertifizierungen, ein Fragebogen –, hat
  ein Suchfeld, das stillschweigend keine Treffer liefert.
- **Es bietet keine Relevanz.** Zeilen werden in der Reihenfolge von `orderBy` zurückgegeben,
  sodass der beste Treffer auf Seite sieben liegen kann.
- **Es kann keinen Index verwenden.** Ein führendes `%` setzt einen B-Tree außer Kraft, sodass
  jede Suche ein sequentieller Scan ist. Bei tausend Zeilen in Ordnung; bei einer Million eine Katastrophe.

Der Begriff wird **wörtlich** abgeglichen: `%` und `_` sind LIKE-Metazeichen, und sie
werden vor dem Erstellen des Musters escaped. Eine Suche nach `50%` sucht also nach
`50%`, anstatt jede Zeile zurückzugeben. Wenn Sie Wildcards verwenden möchten, akzeptiert der
Filteroperator `like` ein Muster (`.where("title", "like", "post-%")`); `.search()`
nicht.

Das Standardverhalten ändert sich nicht, und eine Collection, die diese Option nicht aktiviert hat, kompiliert
zu genau dem SQL, zu dem sie es schon immer getan hat.

## Opting-in (Aktivierung)

Deklarieren Sie einen `search`-Block in einer Postgres-Collection und benennen Sie die Felder, die Sie
indizieren möchten:

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

Es wird nichts impliziert. Ein Feld wird nur dann durchsucht, wenn Sie es benennen, und ein Pfad,
der nicht aufgelöst werden kann, schlägt beim Systemstart fehl, anstatt stillschweigend übersprungen zu werden – ein
Suchfeld, von dem Sie glauben, dass es aktiv ist, es aber nicht ist, ist genau der Fehler, den dieser Block
verhindern soll.

`.search()` kompiliert dann zu einem gerankten Volltextabgleich, und die Zeilen werden mit einem
`_score` zurückgegeben:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Was durch die Deklaration erstellt wird

Eine `tsvector`-Spalte, `GENERATED ALWAYS AS … STORED`, und ein GIN-Index darauf.
Postgres berechnet die Spalte bei jedem Schreibvorgang eines Quellfelds neu und verweigert jeden
Versuch, direkt in sie zu schreiben, sodass der Index nicht von der Zeile abweichen kann. Die Spalte
wird niemals von der API zurückgegeben.

Sie werden in `drizzle/search.sql` neben `schema.sql` und
`policies.sql` generiert, und `rebase db push` wendet sie für Sie an – Sie müssen nichts Zusätzliches
ausführen. Sie erhalten eine eigene Datei, da eine generierte `tsvector`-Spalte zuerst eine
`IMMUTABLE`-Hilfsfunktion benötigt (`unaccent` ist nur `STABLE`, und das
Flattening eines `jsonb`-Dokuments erfordert eine Set-Returning-Function), und Atlas – die
Engine hinter `db push` – kann Funktionen in seinem kostenlosen Tier nicht verwalten.

Eine Konsequenz, die Sie kennen sollten, wenn Sie über Migrationen statt über Push deployen:
Das Hinzufügen eines `search`-Blocks allein erzeugt keine Migration, da sich das Schema,
das Atlas vergleicht, nicht geändert hat. `rebase db generate` meldet dies, wenn es vorkommt.
Der Block wird dennoch durch `rebase db push` und durch das Sicherstellen des Schemas beim Start
angewendet; um ihn explizit in eine Migration aufzunehmen, hängen Sie `drizzle/search.sql` an eine an.

### Nachträgliche Änderungen am Block

Eine generierte Spalte enthält ihren Ausdruck, und Postgres kann diesen Ausdruck nicht an Ort und Stelle
ändern – das Hinzufügen eines Felds, das Verschieben einer Gewichtung, das Ändern der Sprache
oder das Aktivieren von `unaccent` ist also **nichts**, was `ADD COLUMN IF NOT EXISTS` auf eine
bereits vorhandene Spalte anwenden kann.

Rebase speichert einen Fingerabdruck des Ausdrucks auf der Spalte, wenn es sie erstellt,
und vergleicht ihn bei jedem Start und jedem `db push`. Eine Änderung wird deutlich abgelehnt,
zusammen mit den beiden Anweisungen, die sie anwenden – ein `DROP COLUMN` und ein `ADD COLUMN`,
die die Tabelle umschreiben und den GIN-Index neu aufbauen. Führen Sie diese zu einem Zeitpunkt Ihrer
Wahl aus; nichts schreibt eine Live-Tabelle in Ihrem Namen um. (Das Aktivieren von `fuzzy` ist
additiv – eine zweite Spalte – und wird ohne all dies angewendet.)

Der Start wird verweigert, anstatt Anfragen zu bedienen, denn die Alternative ist das, was dieser Check
ersetzt hat: eine Spalte, die weiterhin den vorherigen Feldsatz indiziert, und eine Suche,
die für Inhalte, die eindeutig in der Zeile vorhanden sind, nichts zurückgibt.

## Was Sie in `fields` benennen können

| Pfad | Löst auf zu | Beispiel |
|------|-------------|---------|
| Einer `string`-Eigenschaft | der Spalte | `"full_name"` |
| Einer `string[]`-Eigenschaft | jedem Element | `"interests"` |
| Einer `map`-Eigenschaft | jedem String-Wert im Dokument | `"questionnaire"` |
| Einem Pfad innerhalb einer `map` | jedem String-Wert an oder unter diesem Punkt | `"questionnaire.certifications"` |

Ein Pfad in eine Map indiziert **String-Werte in beliebiger Tiefe** darunter – Arrays von
Strings, verschachtelte Objekte, Arrays von Objekten. JSON-*Schlüssel* werden niemals indiziert, nur
Werte, sodass ein Feldname, der in jeder Zeile vorkommt, nicht zu einem Begriff wird, der auf
jede Zeile zutrifft.

Die Angabe eines Enums, einer UUID, einer `json`- (anstelle einer `jsonb`-) Spalte oder eines Arrays von
Zahlen führt zu einem Fehler beim Systemstart mit einer Erklärung der Ursache. Insbesondere Enums sind ein festes
Vokabular: Filtern Sie diese mit `where`, was exakt ist und einen Index verwendet.

## Optionen

### `language`

Die Textsuchkonfiguration von Postgres, die Stemming und Stoppwörter bestimmt.
`"spanish"` reduziert `auditores` auf den Stamm `auditor` und verwirft `de`; der Standardwert,
`"simple"`, tut keines von beiden.

`"simple"` ist der Standard, da es die einzige Wahl ist, die niemals falsch ist – ein
Stemmer, der auf die falsche Sprache angewendet wird, verfälscht Lexeme unbemerkt. Setzen Sie ihn auf die
Sprache Ihres Inhalts, um Stemming zu aktivieren.

### `unaccent`

Entfernt Akzente vor dem Indizieren, sodass `auditoria` mit `auditoría` übereinstimmt.

Dies ist in einer Sprache mit Akzenten nicht nur kosmetischer Natur. Postgres reduziert die beiden Schreibweisen
auf **unterschiedliche Lexeme** – `to_tsvector('spanish', 'auditoría')` ergibt
`auditor`, während `'auditoria'` `auditori` ergibt. Ohne diese Option verfehlt eine ohne
Akzente eingegebene Abfrage jede Zeile, die sie enthält – was auf die meisten Abfragen zutrifft, die
Benutzer eingeben.

Erfordert die `unaccent`-Erweiterung.

### `fuzzy`

Ermöglicht auch den Abgleich basierend auf Trigram-Ähnlichkeit, sodass auch Beinahe-Treffer gerankt werden: `iso14000` findet
`ISO 14001`, was kein Stemming leisten kann, da es sich schlichtweg um
verschiedene Lexeme handelt.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Fügt eine zweite generierte Spalte und einen Trigram-Index hinzu und erfordert `pg_trgm`.
Kostet Schreibzeit und Speicherplatz; fängt dafür die häufigste Art fehlgeschlagener Suchen ab.

### `weight`

Jedes Feld hat eine der vier Gewichtungsklassen von Postgres, `A` (stärkste)
bis `D`. `ts_rank` bewertet einen `A`-Treffer weit höher als einen `D`-Treffer, wodurch ein
Name eine beiläufige Erwähnung in einer langen Beschreibung übertrifft. Felder haben standardmäßig `B`.

### `column`

Die generierte Spalte heißt `search_vector`. Ändern Sie dies nur, wenn dieser Name
mit einer Spalte kollidiert, die Sie bereits haben – sie ist nach der Erstellung Teil Ihres Schemas, und
ein späteres Umbenennen erfordert ein Löschen und Neuerstellen, wodurch die Tabelle umgeschrieben wird.

## Ranking

`_score` ist `ts_rank` bezogen auf dieselbe Abfrage, mit der die Zeilen abgeglichen wurden, und ist
nur vorhanden, wenn die Collection die Option aktiviert hat *und* die Anfrage einen Such-String
enthielt.

Wenn `fuzzy` aktiviert ist, wird die Trigram-Ähnlichkeit zu diesem Rang **hinzugefügt**. Dies ist keine
Verfeinerung – es ist das, was `fuzzy` überhaupt erst zu einem Ranking macht. Ein Tippfehler liefert auf
dem exakten Pfad keine Treffer, sodass jede gefundene Zeile einen `ts_rank` von genau null hat; ein Sortieren
nur nach Rang würde den besten Treffer in einer beliebigen Reihenfolge der Tabelle zurückgeben.
Die beiden Terme werden summiert statt gewichtet, sodass eine Zeile, die exakt übereinstimmt,
zu beidem beiträgt und eine lediglich ähnliche Zeile übertrifft, ohne dass dafür ein Koeffizient
erforderlich ist. Außerhalb dieser beiden Bedingungen ist `orderBy: "_score"` ein unbekanntes Feld und
gibt 400 zurück, anstatt stillschweigend unsortierte Zeilen zu liefern.

`_score` kann nicht mit Cursor-Paginierung (`startAfter`) kombiniert werden. Die Relevanz wird
pro Abfrage berechnet und nicht gespeichert, sodass es auf der Cursor-Zeile keinen Wert gibt,
mit dem die nächste Seite verglichen werden könnte, und zwei Anfragen mit unterschiedlichen Such-Strings
erzeugen Scores, die nicht auf derselben Skala liegen. Verwenden Sie `limit`/`offset` für
nach Relevanz geordnete Seiten.

## Warum hat diese Zeile gematcht?

Eine gerankte Liste zeigt Ihnen, *welche* Zeilen zutreffen, aber niemals, *warum* eine dort steht. Lassen Sie sich
jede Zeile selbst erklären:

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` ist der Pfad genau wie in `fields` deklariert, sodass Sie ihn für die
Anzeige auf ein Label mappen können. Felder werden in der Reihenfolge zurückgegeben, in der Sie sie deklariert haben.

Pro Abfrage, nicht pro Collection, da die Kosten pro Abfrage anfallen: ein `ts_headline`
pro deklariertem Feld pro zurückgegebener Zeile, und `ts_headline` parst das Dokument neu,
anstatt den Index zu lesen. Passend für eine Ergebnisseite, ungeeignet für einen Export.

**Das Snippet enthält bauartbedingt Markup** – jeder Treffer ist in
`<mark>` eingeschlossen. Rendern Sie es als HTML oder entfernen Sie die Tags, aber behandeln Sie es nicht als
reinen Text und vertrauen Sie dem umgebenden Text nicht: Es ist genau das, was der Benutzer eingegeben hat.
Das Aufteilen anhand von `<mark>` und das Rendern der Teile ist sicherer als
`dangerouslySetInnerHTML`.

Wenn `unaccent` aktiviert ist, werden Snippets mit entfernten Akzenten dargestellt – `Auditoria`, nicht
`Auditoría`. `ts_headline` über dem Originaltext kann einen Treffer, den eine Abfrage ohne Akzente
erzeugt hat, nicht finden und würde den Text daher ganz ohne Hervorhebungen zurückgeben; ein
lesbares Snippet mit Hervorhebungen ist besser als ein hübscheres, das stillschweigend keine Treffer markiert.

## Hinzufügen des Blocks zu einer Live-Collection

Die generierte Spalte wird wie jede andere Spalte durch die Schema-Sicherstellung beim Start hinzugefügt,
und ihr Index wird mit `CREATE INDEX CONCURRENTLY` erstellt, sodass Schreibvorgänge
nicht blockiert werden. Das Hinzufügen einer *gespeicherten* (`STORED`) generierten Spalte schreibt die Tabelle jedoch um. Planen Sie dies
bei einer großen Tabelle wie jedes andere Umschreiben (Rewrite).

## Welche Engines

Der `search`-Block ist Postgres-exklusiv und wird auf anderen Engines beim Start abgelehnt,
anstatt stillschweigend ignoriert zu werden. MongoDB-Collections behalten ihren Regex-basierten
Abgleich; Firestore-Collections verwenden den externen Textsuch-Controller.

## Verwandte Themen

- [REST API](/docs/backend/api/) – die Abfrageparameter, als die eine Suche den Server erreicht
- [Indexes](/docs/backend/indexes/) – was der Suchblock erstellt und was er an Ressourcen kostet
- [Querying Data](/docs/sdk/querying/) – Suchen über das Client-SDK
