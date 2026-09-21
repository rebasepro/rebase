---
sourceHash: a6c102be4bcc017e
title: Suche
sidebar_label: Suche
description: Wie sich .search() standardmäßig verhält und wie Sie eine Postgres-Collection für die gerankte Volltextsuche über die von Ihnen benannten Felder aktivieren – einschließlich JSONB- und Array-Inhalten.
---

`.search("term")` funktioniert bei jeder Collection ohne Konfiguration. Worin
es kompiliert wird, hängt davon ab, ob die Collection zusätzliche Anforderungen gestellt hat.

## Der Standard

Ohne Konfiguration ist `.search()` ein **Teilstring-Abgleich ohne Berücksichtigung der Groß-/Kleinschreibung**,
der mit OR über die `string`-Eigenschaften der obersten Ebene der Collection verknüpft ist. Der Suchbegriff
wird an Leerzeichen aufgeteilt, und jeder Begriff muss übereinstimmen – sie können jedoch mit
unterschiedlichen Eigenschaften übereinstimmen, sodass ein in zwei Spalten geführter Name dennoch gefunden wird:

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Schließen Sie eine Sequenz in doppelte Anführungszeichen ein – `.search('"ada lovelace"')` –, um stattdessen
nach der Phrase zu suchen, genau wie es der unten beschriebene Volltextpfad liest.

Dies reicht für eine kleine Collection aus, deren Text in einfachen Spalten liegt. Es hat
drei Einschränkungen, die keine interne Einstellung beheben kann:

- **Es kann nicht in `map`- oder `array`-Eigenschaften hineinsehen.** Eine Collection, die ihre
  durchsuchbaren Inhalte in JSONB speichert – Tags, Zertifizierungen, ein Fragebogen –, hat
  ein Suchfeld, das stillschweigend keine Treffer liefert.
- **Es gibt keine Relevanz.** Zeilen werden in der `orderBy`-Reihenfolge zurückgegeben, sodass der beste Treffer
  auf Seite sieben liegen kann.
- **Es kann keinen Index verwenden.** Ein führendes `%` setzt einen B-Baum außer Kraft, sodass jede Suche
  ein sequentieller Scan ist. Bei tausend Zeilen in Ordnung; bei einer Million ein steiler Abgrund.

Der Begriff wird **wörtlich** abgeglichen: `%` und `_` sind LIKE-Metazeichen, und sie
werden maskiert, bevor das Muster erstellt wird, sodass die Suche nach `50%` nach
`50%` sucht, anstatt jede Zeile zurückzugeben. Wenn Sie Wildcards möchten, akzeptiert der
Filteroperator `like` ein Muster (`.where("title", "like", "post-%")`); `.search()` tut
dies nicht.

Eine Ein-Wort-Suche kompiliert genau zu dem SQL, zu dem sie es schon immer getan hat.

## Opt-in

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
der nicht aufgelöst werden kann, schlägt beim Booten fehl, anstatt stillschweigend übersprungen zu werden – ein
Suchfeld, von dem Sie glauben, dass es aktiv ist, es aber nicht ist, ist genau der Fehler, den dieser Block
verhindern soll.

`.search()` kompiliert dann zu einem gerankten Volltext-Abgleich, und Zeilen werden mit einem
`_score` zurückgegeben:

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Was die Deklaration erzeugt

Eine `tsvector`-Spalte, `GENERATED ALWAYS AS … STORED`, und ein GIN-Index darauf.
Postgres berechnet die Spalte bei jedem Schreibvorgang eines Quellfelds neu und verweigert jeden
Versuch, direkt in sie zu schreiben, sodass der Index nicht von der Zeile abweichen kann. Die Spalte
wird von der API niemals zurückgegeben.

Sie werden in `drizzle/search.sql` generiert, neben `schema.sql` und
`policies.sql`, und `rebase db push` wendet sie für Sie an – es muss nichts extra
ausgeführt werden. Sie erhalten eine eigene Datei, da eine generierte `tsvector`-Spalte voraussetzt,
dass zuerst eine `IMMUTABLE`-Hilfsfunktion existiert (`unaccent` ist nur `STABLE`, und
das Reduzieren eines `jsonb`-Dokuments erfordert eine Set-Returning-Funktion), und Atlas – die
Engine hinter `db push` – kann im Free-Tier keine Funktionen verwalten.

Eine Konsequenz, die Sie kennen sollten, wenn Sie per Migration statt per Push deployen:
Das Hinzufügen eines `search`-Blocks allein erzeugt keine Migration, da sich das Schema,
das Atlas vergleicht, nicht geändert hat. `rebase db generate` meldet dies, wenn es vorkommt.
Der Block wird dennoch von `rebase db push` und durch das Schema-Ensure beim Booten angewendet;
um ihn explizit in eine Migration aufzunehmen, hängen Sie `drizzle/search.sql` an eine an.

### Nachträgliches Ändern des Blocks

Eine generierte Spalte trägt ihren Ausdruck in sich, und Postgres kann diesen Ausdruck nicht
direkt an Ort und Stelle ändern – daher ist das Hinzufügen eines Felds, das Ändern einer Gewichtung, das Ändern der Sprache
oder das Aktivieren von `unaccent` **nichts**, was `ADD COLUMN IF NOT EXISTS` auf
eine bereits vorhandene Spalte anwenden kann.

Rebase erfasst einen Fingerprint des Ausdrucks auf der Spalte, wenn es diese erstellt,
und vergleicht ihn bei jedem Booten und jedem `db push`. Eine Änderung wird deutlich abgelehnt,
zusammen mit den beiden Anweisungen, die sie anwenden – ein `DROP COLUMN` und ein `ADD COLUMN`,
welche die Tabelle neu schreiben und den GIN-Index neu aufbauen. Führen Sie diese zu einem Zeitpunkt
Ihrer Wahl aus; niemand schreibt eine produktive Tabelle in Ihrem Namen neu. (Das Aktivieren von `fuzzy` ist
additiv – eine zweite Spalte – und wird ohne all dies angewendet.)

Der Boot-Vorgang verweigert den Dienst, anstatt Anfragen zu bedienen, denn die Alternative ist das,
was diese Prüfung ersetzt hat: eine Spalte, die weiterhin die vorherige Feldmenge indiziert, und eine Suche,
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
Werte, sodass ein Feldname, der jeder Zeile gemein ist, nicht zu einem Begriff wird, der
auf jede Zeile zutrifft.

Das Benennen eines Enums, einer UUID, einer `json`-Spalte (im Gegensatz zu `jsonb`) oder eines Arrays von
Zahlen ist ein Boot-Fehler, der erklärt, warum. Insbesondere Enums sind ein festes
Vokabular: Filtern Sie darauf mit `where`, was exakt ist und einen Index verwendet.

## Optionen

### `language`

Die Postgres-Textsuchkonfiguration, die über Stemming und Stopwörter entscheidet.
`"spanish"` führt das Stemming von `auditores` zu `auditor` durch und entfernt `de`; der Standardwert,
`"simple"`, tut keines von beidem.

`"simple"` ist der Standardwert, da es die einzige Wahl ist, die niemals falsch ist – ein
Stemmer, der auf die falsche Sprache angewendet wird, verstümmelt Lexeme unbemerkt. Setzen Sie ihn auf die
Sprache Ihres Inhalts, um Stemming zu erhalten.

### `unaccent`

Entfernt Akzente vor dem Indizieren, sodass `auditoria` mit `auditoría` übereinstimmt.

Dies ist in einer Sprache mit Akzenten nicht nur kosmetischer Natur. Postgres führt für die beiden Schreibweisen ein Stemming zu
**unterschiedlichen Lexemen** durch – `to_tsvector('spanish', 'auditoría')` ergibt
`auditor`, während `'auditoria'` `auditori` ergibt – ohne dies verfehlt eine Abfrage,
die ohne Akzente eingegeben wurde, jede Zeile, die diese enthält, was den meisten Abfragen der
meisten Benutzer entspricht.

Erfordert die Extension `unaccent`.

### `fuzzy`

Gleicht auch auf Trigram-Ähnlichkeit ab, sodass Beinahe-Treffer dennoch gerankt werden: `iso14000` erreicht
`ISO 14001`, was kein Stemming der Welt erreichen wird, da es sich schlicht um
unterschiedliche Lexeme handelt.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Fügt eine zweite generierte Spalte und einen Trigram-Index hinzu und erfordert `pg_trgm`.
Kostet Schreibzeit und Speicherplatz; fängt die häufigste Art fehlgeschlagener Suchen ab.

### `weight`

Jedes Feld trägt eine der vier Gewichtungsklassen von Postgres, `A` (am stärksten)
bis `D`. `ts_rank` bewertet einen `A`-Treffer weit höher als einen `D`-Treffer, wodurch ein
Name eine beiläufige Erwähnung in einer langen Beschreibung übertrifft. Felder sind standardmäßig `B`.

### `column`

Die generierte Spalte heißt `search_vector`. Ändern Sie dies nur, wenn dies mit
einer Spalte kollidiert, die Sie bereits haben – sie ist nach der Erstellung Teil Ihres Schemas, und
eine spätere Umbenennung erfordert ein Löschen und Neuerstellen, wodurch die Tabelle neu geschrieben wird.

## Ranking

`_score` ist `ts_rank` bezogen auf dieselbe Abfrage, mit der die Zeilen abgeglichen wurden, und ist
nur vorhanden, wenn die Collection aktiviert wurde *und* die Anfrage einen Suchstring
enthielt.

Wenn `fuzzy` aktiviert ist, wird die Trigram-Ähnlichkeit zu diesem Rang **hinzugefügt**. Dies ist keine
Verfeinerung – es ist das, was `fuzzy` überhaupt erst zu einem Ranking macht. Ein Tippfehler findet auf
dem exakten Pfad keine Treffer, sodass jede gefundene Zeile einen `ts_rank` von genau null hat; ein
Sortieren nach Rang allein würde den besten Treffer in beliebiger Reihenfolge der Tabelle zurückgeben.
Die beiden Terme werden summiert statt gewichtet, sodass eine Zeile, die exakt übereinstimmte,
zu beidem beiträgt und eine nur ähnliche Zeile übertrifft, ohne dass ein Koeffizient dafür
angegeben werden muss. Außerhalb dieser beiden Bedingungen ist `orderBy: "_score"` ein unbekanntes Feld und
gibt 400 zurück, anstatt stillschweigend unsortierte Zeilen zu liefern.

`_score` kann nicht mit Cursor-Paginierung (`startAfter`) kombiniert werden. Relevanz wird
pro Abfrage berechnet und nicht gespeichert, sodass es auf der Cursor-Zeile keinen Wert gibt,
mit dem die nächste Seite verglichen werden könnte, und zwei Anfragen mit unterschiedlichen Suchstrings
erzeugen Scores, die nicht auf derselben Skala liegen. Verwenden Sie `limit`/`offset` für
nach Relevanz geordnete Seiten.

## Warum hat diese Zeile gematcht?

Eine gerankte Liste sagt Ihnen, *welche* Zeilen matchen, niemals *warum* eine dort ist. Bitten Sie jede Zeile,
sich selbst zu erklären:

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
anstatt den Index zu lesen. Richtig für eine Ergebnisseite, falsch für einen Export.

**Das Snippet enthält bauartbedingt Markup** – jeder Treffer ist in
`<mark>` eingeschlossen. Rendern Sie es als HTML oder entfernen Sie die Tags, aber behandeln Sie es nicht als reinen
Text, und vertrauen Sie dem umgebenden Text nicht: Es ist das, was der Benutzer eingegeben hat.
Das Aufteilen an `<mark>` und Rendern der Teile ist sicherer als
`dangerouslySetInnerHTML`.

Wenn `unaccent` aktiviert ist, werden Snippets mit entfernten Akzenten gelesen – `Auditoria`, nicht
`Auditoría`. `ts_headline` über dem Originaltext kann einen Treffer, den eine
akzentfreie Abfrage erzeugt hat, nicht finden, sodass der Text ohne jegliche Markierungen zurückgegeben
würde; ein lesbares Snippet, das hervorhebt, ist besser als ein hübscheres, das stillschweigend
nichts hervorhebt.

## Hinzufügen des Blocks zu einer Live-Collection

Die generierte Spalte wird durch das Schema-Ensure beim Booten hinzugefügt, wie jede andere
Spalte auch, und ihr Index wird mit `CREATE INDEX CONCURRENTLY` erstellt, sodass Schreibvorgänge
nicht blockiert werden. Das Hinzufügen einer *gespeicherten* (stored) generierten Spalte schreibt die Tabelle jedoch neu. Planen Sie dies bei einer
großen Tabelle daher wie jedes andere Umschreiben ein.

## Welche Engines

Der `search`-Block ist Postgres-exklusiv und wird bei anderen Engines beim Booten
abgelehnt, anstatt stillschweigend ignoriert zu werden. MongoDB-Collections behalten ihren Regex-basierten
Abgleich bei; Firestore-Collections verwenden den externen Textsuch-Controller.

## Verwandte Themen

- [REST-API](/docs/backend/api/) — die Abfrageparameter, als die eine Suche den Server erreicht
- [Indizes](/docs/backend/indexes/) — was der Suchblock erstellt und was er kostet
- [Daten abfragen](/docs/sdk/querying/) — Suchen über das Client-SDK
