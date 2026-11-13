---
sourceHash: 598d10fdd9ac95db
title: Aggregate und Suche
sidebar_label: Aggregate & Suche
description: "Zählen, summieren und gruppieren mit dem SDK, innerhalb von JSON-Spalten filtern sowie Volltext- und Vektorsuche vom Client aus ausführen."
---

## Aggregate

`count`, `sum`, `avg`, `min`, `max` und die unten aufgeführten Funktionen über die Zeilen, die ein Filter auswählt, ohne sie abzurufen:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)
```

```json
{ "data": [{ "count": 128, "sum_total": 40522 }] }
```

Gruppieren, um eine Zeile pro Wert zu erhalten:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)&groupBy=status
```

```json
{
  "data": [
    { "status": "paid",    "count": 96, "sum_total": 31200 },
    { "status": "pending", "count": 32, "sum_total": 9322 }
  ]
}
```

Die Ergebnisse werden nach Funktion und Feld benannt – `count()` wird zu `count`, `sum(total)` wird zu `sum_total`.

### Weitere Funktionen

| `select` | SDK | Ergebnisschlüssel | Bedeutung |
|---|---|---|---|
| `countDistinct(sid)` | `{ fn: "countDistinct", field: "sid" }` | `count_distinct_sid` | Eindeutige Nicht-Null-Werte |
| `mode(lang)` | `{ fn: "mode", field: "lang" }` | `mode_lang` | Der häufigste Wert |
| `percentile(price,0.95)` | `{ fn: "percentile", field: "price", p: 0.95 }` | `p95_price` | Kontinuierliches Perzentil, `p` von 0 bis 1 (`0.5` ist der Median) |
| `distinct(lang)` | `{ fn: "distinct", field: "lang" }` | `distinct_lang` | Die eindeutigen Nicht-Null-Werte, sortiert, als Array |
| `fingerprint()` | `{ fn: "fingerprint" }` | `fingerprint` | Ein String, der sich ändert, sobald sich eine erfasste Zeile ändert |

### Gefilterte Aggregate und Namen

Ein Aggregat kann auch nur einen Teil der Zeilen zählen: Geben Sie ihm ein eigenes `where` (entspricht SQLs `FILTER (WHERE …)`). Mehrere davon bilden eine einzige Abfrage über die Zeilen, die das äußere `where` ausgewählt hat, sodass ein Dashboard mit acht Zählwerten in einem einzigen Scan abläuft. Benennen Sie jedes Aggregat mit `as`, was bei zwei Aggregaten derselben Funktion erforderlich ist:

```ts
const [stats] = await client.data.songs.aggregate({
    select: [
        { fn: "count", as: "rows" },
        { fn: "count", as: "live", where: { tags: ["!=", []] } },
        { fn: "count", as: "unplayable", where: { playable: ["==", false] } },
        { fn: "sum", field: "plays", as: "plays" }
    ]
});
// { rows: 30000, live: 21480, unplayable: 312, plays: 918211 }
```

Ein Name, der doppelt verwendet wird, oder der Schlüssel einer `groupBy`-Spalte wird abgelehnt (`INVALID_AGGREGATE_SELECT`), anstatt einen Wert zu überschreiben. Über HTTP wird ein Name nach PostgREST-Art geschrieben, `select=live:count()`; ein Aggregat mit eigenem `where` wird als JSON-Array übergeben – `select=[{"fn":"count","as":"live","where":{"tags":["!=",[]]}}]`.

Das `field` eines Aggregats kann ein JSON-Pfad sein, `props->>players`: `sum`, `avg` und `percentile` lesen den dortigen Wert als Zahl und ignorieren Werte, die keine sind; die übrigen lesen ihn als Text. Ein JSON-Pfad kann auch ein `groupBy`-Eintrag sein, der über den Pfad wie geschrieben adressiert wird:

```ts
await client.data.events.aggregate({
    select: [{ fn: "count" }, { fn: "avg", field: "props->>players", as: "players" }],
    groupBy: ["props->>music"]
});
// [{ "props->>music": "80s", count: 412, players: 3.4 }, …]
```

### Gruppieren nach einem Ausdruck

Ein `groupBy`-Eintrag kann seine Spalte transformieren. Über HTTP wird dies wie eine Funktion geschrieben, im SDK als `{ field, transform }`, und das Ergebnis wird unter `<transform>_<field>` zurückgegeben – was auch der Name ist, den `orderBy` verwendet:

| Transformation | Gruppiert nach |
|---|---|
| `lower(name)`, `upper(name)` | Die Spalte als Text in Klein- bzw. Großbuchstaben |
| `year(createdAt)`, `month(createdAt)`, `day(createdAt)` | Das Datum in UTC als `2026`, `2026-11`, `2026-11-08` – oder in einer Zeitzone: `day(createdAt,Europe/Madrid)`, `{ field, transform: "day", timeZone: "Europe/Madrid" }` |
| `unnest(tags)` | Jedes Element einer Array-Spalte: eine Gruppe pro Element |

```ts
// How many songs carry each tag — the distinct elements of an array column.
const tags = await client.data.songs.aggregate({
    select: [{ fn: "count" }],
    groupBy: [{ field: "tags", transform: "unnest" }],
    orderBy: ["unnest_tags", "asc"]
});
// [{ unnest_tags: "pop", count: 812 }, …]

// Each artist's usual language, however the name is capitalised.
await client.data.songs.aggregate({
    select: [{ fn: "mode", field: "lang" }],
    groupBy: [{ field: "artist", transform: "lower" }]
});
```

```bash
GET /api/data/events/aggregate?select=count(),countDistinct(sid)&groupBy=day(at)&orderBy=day_at:asc
```

### Hat sich etwas geändert? `fingerprint()`

`fingerprint()` beantwortet die Frage: „Hat sich diese Tabelle geändert, seit ich das letzte Mal nachgesehen habe?“, ohne die Zeilen zu lesen: Behalten Sie den String, fragen Sie später erneut an und berechnen Sie alles, was Sie aus den Zeilen abgeleitet haben, nur dann neu, wenn er sich unterscheidet. Jedes Einfügen, Aktualisieren oder Löschen einer erfassten Zeile ändert ihn; ein Schreibvorgang, der nichts ändert (das Setzen einer Spalte auf ihren eigenen Wert), kann ihn ebenfalls ändern, und das Löschen einer gerade hinzugefügten Zeile stellt den vorherigen Zustand wieder her. Er deckt ab, was der Aufrufer sehen kann und was die Filter auswählen, und kann gruppiert werden, sodass `groupBy=lang` einen Fingerabdruck pro Sprache liefert.

```ts
let lastFingerprint: string | undefined;

async function catalogueChanged(): Promise<boolean> {
    const [{ fingerprint }] = await client.data.songs.aggregate({ select: [{ fn: "fingerprint" }] });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = String(fingerprint);
    return changed;
}
```

Er wird aus den Zeilenversionen berechnet, die Postgres vorhält, nicht aus den Werten selbst. Daher erfordert er lediglich einen Scan der Tabelle und kein Hashing jeder Zeile: Bei 30.000 Zeilen dauert dies 4 ms, während `md5(string_agg(...))` über die Zeilen 56 ms benötigt. Für eine reguläre View, die keine Zeilen speichert, steht er nicht zur Verfügung; eine materialisierte View verfügt über einen.

Gruppen lassen sich wie die Zeilen einer Auflistung paginieren. `limit` begrenzt sie, `offset` (oder `page`) überspringt sie und `orderBy` sortiert sie nach einem `groupBy`-Feld oder einem Ergebnisschlüssel. Die Sortierreihenfolge endet immer auf den Gruppenschlüsseln, sodass jede Seitengrenze an derselben Stelle liegt. Ein gruppiertes Aggregat ohne `limit` wird beim Standardwert für Auflistungen abgeschnitten (50 Gruppen), genau wie bei einer normalen Auflistung. Bei einem `limit` – einschließlich des Standardwerts – gibt die Antwort an, ob weitere vorhanden sind, und `aggregate()` des SDKs gibt dies als `meta` im Ergebnis zurück:

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` oder `orderBy` ohne ein `groupBy`, oder ein Cursor auf irgendeinem Aggregat, führt zu einem `400 INVALID_AGGREGATE_WINDOW`: Ein ungruppiertes Aggregat hat eine Zeile, und eine Gruppe ist keine Zeile, nach der ein Cursor fortgesetzt werden kann.

Ein Aggregat liest die gespeicherten Werte und führt niemals `afterRead` aus. Wenn also ein `afterRead`-Hook eine Tabelle umschreibt – sei es global, tabelleneigen oder über das `.transform()` einer Spalte –, werden sowohl über HTTP als auch im Prozess nur `count()` und `fingerprint()` ohne `groupBy` verarbeitet; alles andere führt zu einem `400 AGGREGATE_MASKED_BY_AFTER_READ`, da eine Summe, ein Maximum oder eine Gruppe die Werte lesen würde, die der Hook verbirgt.

Im SDK akzeptiert `aggregate()` dasselbe `orderBy` wie ein `find()` – ein einzelnes `[key, "asc" | "desc"]`-Tupel oder eine Liste davon –, wobei der Schlüssel eine `groupBy`-Spalte oder ein Ergebnisschlüssel ist. Beide sind typisiert: Bei einem generierten Modell führt ein Schlüssel, der keines von beiden ist, zu einem Kompilierungsfehler. Im Prozess (`rebase.data`) werden die Gruppen in derselben Reihenfolge zurückgegeben wie über HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Es akzeptiert dieselben Filter wie der Listen-Endpunkt, sodass ein Aggregat auf die gleiche Weise eingegrenzt werden kann wie eine Auflistung:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**Row-Level-Security gilt für die aggregierten Zeilen.** Ein Aggregat ist ein effizienter Weg, um Informationen über Zeilen zu erhalten, die man nicht lesen kann; daher wird es unter den Policies des Aufrufers ausgeführt: Wer nichts per SELECT abfragen darf, zählt auch nichts.
:::

Aggregate erfordern einen Treiber, der sie implementiert. Bei einem Treiber, der dies nicht tut, antwortet der Endpunkt mit `501` statt mit einem leeren Ergebnis – einem Dashboard sollte nicht „keine Treffer“ gemeldet werden, wenn die Wahrheit „nicht unterstützt“ lautet.

## Filtern innerhalb von JSON

Eine `json`- oder `jsonb`-Spalte kann mithilfe der Postgres-eigenen Pfeilsyntax nach Pfad gefiltert werden:

```typescript
// Orders whose metadata says the country is US
const { data } = await client.data.orders
    .where("metadata->>country", "==", "US")
    .find();

// Nested paths walk with -> and take the leaf with ->>
await client.data.orders.where("metadata->address->>city", "==", "Berlin").find();
```

Über REST:

```bash
GET /api/data/orders?metadata->>country=eq.US
```

Pfadsegmente werden immer als gebundene Parameter gesendet, niemals direkt in das SQL eingefügt.

### Wie Werte verglichen werden

`->>` liefert **Text**, daher sind Vergleiche Textvergleiche – außer wenn ein Vergleichsoperator (`>`, `>=`, `<`, `<=`) mit einer **Zahl** aufgerufen wird; in diesem Fall wird nach numerisch gecastet:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Zeilen, deren Wert an diesem Pfad keine Zahl ist, werden aus einem numerischen Vergleich ausgeschlossen, anstatt dass die Abfrage fehlschlägt. Booleans werden als `"true"` / `"false"` verglichen, da `->>` sie so darstellt.

:::note
`array-contains` und die anderen Operatoren für ganze Spalten stehen für Pfade nicht zur Verfügung – sie stellen eine Bedingung an das gesamte Dokument; verwenden Sie sie daher auf der Spalte selbst.
:::

## Textsuche

```typescript
// Via find params
const { data } = await client.data.products.find({
    searchString: "wireless headphones"
});

// Fluent style
const { data } = await client.data.products
    .search("wireless headphones")
    .limit(10)
    .find();
```

Standardmäßig ist dies ein **Substring-Abgleich ohne Berücksichtigung der Groß-/Kleinschreibung** über die Textspalten auf oberster Ebene der Tabelle. Es handelt sich nicht um Volltextsuche: Es greift nicht in JSON- oder Array-Spalten hinein, führt kein Stemming oder Ranking durch und kann keinen Index nutzen.

Eine Tabelle kann echte Volltextsuche aktivieren, indem sie einen `search`-Block deklariert, wodurch Ergebnisse auch nach `_score` gerankt werden können. Siehe [Suche](/docs/backend/search).

## Vektorsuche

Für Tabellen mit einer `col.vector()`-Spalte können Zeilen nach Ähnlichkeit zu einem Query-Embedding sortiert werden. Die Zeilen werden nach Nähe sortiert zurückgegeben (die ähnlichsten zuerst), jeweils mit einer `_distance`. Die Distanz bestimmt die Sortierung: Ein `orderBy` in derselben Abfrage wird ignoriert. Ohne `limit` gibt eine Vektorsuche 10 Zeilen zurück, nicht die 50 einer regulären Auflistung.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

Ein `where` in derselben Abfrage dient als Filter dafür, welche Zeilen überhaupt Kandidaten sind – dies gibt die ähnlichsten Zeilen zurück, die auch die Bedingung erfüllen, und filtert nicht erst nachträglich die ähnlichsten Zeilen. Auf dem HNSW-Index gilt dies ab pgvector 0.8.0 (siehe [Filter bei einem approximativen Index](/docs/backend/vector-search/#filters-on-an-approximate-index)); bei einer älteren Version von pgvector liefert ein Filter, den nur wenige der ähnlichsten Zeilen bestehen, eine kurze Ergebnisseite. Die Erstellung von `queryVector` liegt in Ihrer Verantwortung: Rebase speichert und durchsucht Embeddings, berechnet sie jedoch nicht.

Das SDK sendet eine Vektorsuche als `POST /api/data/<table>/query`, mit dem Embedding im Request-Body: In der URL machen 768 Dimensionen etwa 17 KB aus, was mehr ist, als Node (16 KB) und die meisten Proxys (nginx: 8 KB) akzeptieren. `count()` mit einer Vektorsuche funktioniert genauso, als `POST /api/data/<table>/count`. Bei einem Server, der älter als 0.24 ist und über keine solche Route verfügt, greifen beide auf das `GET` zurück – und ein langes Embedding kann dort weiterhin mit einem Statuscode 431 oder 414 abgelehnt werden.

Mit einem `threshold` enthält das Ergebnis kein `meta.total` – das Zählen der Zeilen innerhalb einer Distanz würde eine Berechnung für jede Zeile der Tabelle erfordern. Paginieren Sie mit `meta.hasMore`, das exakt bleibt.

### Was Sie bereitstellen müssen

- **pgvector.** Eine `vector`-Eigenschaft wird zu einer `VECTOR(n)`-Spalte kompiliert, und dieser Typ stammt aus der `vector`-Extension. Rebase installiert sie für Sie, jedoch nur dort, wo Sie es ausdrücklich erlauben:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Diese Zeile ist eher eine Berechtigung als eine Anforderung – Rebase führt `CREATE EXTENSION IF NOT EXISTS vector` nur dann aus, wenn etwas in Ihrem Schema dies benötigt. Dies ist Opt-in, da die Installation einer Extension von Voraussetzungen abhängt, die Rebase aus der Verbindung heraus nicht einsehen kann: Das Image muss die Bibliothek enthalten (das `pgvector/pgvector:pg18` des Scaffolds tut dies, ein Standard-`postgres:18` nicht), die Rolle muss die Berechtigung zur Installation haben und ein Managed Provider muss sie auf einer Allowlist führen.

  Geben Sie nichts an, installiert Rebase auch nichts – installieren Sie sie stattdessen einmal manuell. In beiden Fällen wird die Spalte erstellt, und Postgres lehnt sie auf einer Datenbank, die keines von beiden hat, mit `type "vector" does not exist` ab, wobei beide Lösungswege genannt werden.

Die Spalte, ihr ANN-Index und dieser `CREATE EXTENSION`-Befehl werden in `.rebase/sql/vector.sql` neben `schema.sql` und `policies.sql` generiert, und `rebase db push` wendet sie für Sie an. Sie befinden sich in einer eigenen Datei, weil Atlas – die Engine hinter `db push` – sein Diff berechnet, indem es `schema.sql` in einer temporären Scratch-Datenbank materialisiert, die zu Beginn jedes Laufs gelöscht wird; ein `VECTOR(n)` darin würde sonst gegen eine Datenbank aufgelöst, die niemals pgvector haben kann.

`rebase db generate` hängt diese Datei an die Migration an, die es schreibt, sodass eine auf einer frischen Datenbank ausgeführte Migration auch die Spalte erstellt. Eine Änderung allein an der Vector-Eigenschaft erzeugt keine Migration, da das Schema, das Atlas vergleicht, unverändert ist – `db generate` weist darauf hin, wenn dies der Fall ist.

### Der Index

Jede Vektorspalte erhält einen HNSW-Index für Kosinusdistanz, der zusammen mit der Tabelle erstellt und beim Start gemeldet wird. Kosinus, weil `vectorSearch` standardmäßig damit misst, sofern Sie kein `distance` übergeben – ein Index bedient genau einen Operator, sodass eine `l2`-Abfrage gegen einen Kosinus-Index stillschweigend auf einen sequentiellen Scan zurückfällt.

Passen Sie ihn an oder deaktivieren Sie ihn direkt an der Eigenschaft:

```ts
embedding: {
    type: "vector",
    dimensions: 1536,
    // Defaults: one HNSW index, cosine. Any of these may be omitted.
    index: {
        method: "hnsw",              // or "ivfflat"
        distance: ["cosine", "l2"],  // one index each
        m: 24,                       // hnsw
        efConstruction: 128          // hnsw
    }
}
```

`index: false` behält den exakten Scan absichtlich bei. Über 2000 Dimensionen kann pgvector keinen der beiden Indextypen erstellen, daher wird die Spalte erstellt und verbleibt unindiziert, was beim Start gemeldet wird – `vectorSearch` funktioniert weiterhin als exakter Scan.

`vectorSearch` ist eine Abfrage, keine Subscription: Ein `.listen()` darauf wird abgewiesen, anstatt als einfache Auflistung ausgeführt zu werden, da bei Schreibvorgängen keine Distanzen neu berechnet werden.

## Nächste Schritte

- [Daten abfragen](/docs/sdk/querying/) – der Query-Builder, auf dem diese basieren
- [Suche](/docs/backend/search/) – wie Volltext- und Vektorsuche im Backend konfiguriert werden
- [REST-API](/docs/backend/api/) – dieselben Abfragen über HTTP
