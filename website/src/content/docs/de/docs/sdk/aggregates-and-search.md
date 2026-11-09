---
sourceHash: 3cf0b5bcc258e52f
title: Aggregate und Suche
sidebar_label: Aggregate & Suche
description: "Zählen, summieren und gruppieren Sie mit dem SDK, filtern Sie innerhalb von JSON-Spalten und führen Sie Volltext- und Vektorsuchen vom Client aus durch."
---

## Aggregate

`count`, `sum`, `avg`, `min`, `max` und die untenstehenden Funktionen über die Zeilen, die ein Filter auswählt, ohne sie abzurufen:

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

Ergebnisse werden nach Funktion und Feld benannt – `count()` wird zu `count`, `sum(total)` wird zu `sum_total`.

### Weitere Funktionen

| `select` | SDK | Ergebnisschlüssel | Bedeutung |
|---|---|---|---|
| `countDistinct(sid)` | `{ fn: "countDistinct", field: "sid" }` | `count_distinct_sid` | Verschiedene Werte ungleich null |
| `mode(lang)` | `{ fn: "mode", field: "lang" }` | `mode_lang` | Der häufigste Wert |
| `percentile(price,0.95)` | `{ fn: "percentile", field: "price", p: 0.95 }` | `p95_price` | Kontinuierliches Perzentil, `p` von 0 bis 1 (`0.5` ist der Median) |
| `distinct(lang)` | `{ fn: "distinct", field: "lang" }` | `distinct_lang` | Die verschiedenen Werte ungleich null, sortiert, als Array |
| `fingerprint()` | `{ fn: "fingerprint" }` | `fingerprint` | Ein String, der sich ändert, sobald sich eine erfasste Zeile ändert |

### Gefilterte Aggregate und Namen

Ein Aggregat kann nur einen Teil der Zeilen zählen: Geben Sie ihm ein eigenes `where`
(SQLs `FILTER (WHERE …)`). Mehrere davon sind eine einzige Abfrage über die Zeilen, die das äußere
`where` ausgewählt hat, sodass ein Dashboard mit acht Zählungen ein einziger Scan ist. Benennen Sie
jedes mit `as`, was zwei Aggregate derselben Funktion benötigen:

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

Ein zweimal verwendeter Name oder der Schlüssel einer `groupBy`-Spalte wird abgelehnt
(`INVALID_AGGREGATE_SELECT`), statt einen Wert zu überschreiben. Über HTTP wird ein Name auf
PostgREST-Art geschrieben, `select=live:count()`; ein Aggregat mit eigenem `where` wird als
JSON-Array übergeben — `select=[{"fn":"count","as":"live","where":{"tags":["!=",[]]}}]`.

Das `field` eines Aggregats darf ein JSON-Pfad sein, `props->>players`: `sum`, `avg` und `percentile`
lesen den Wert dort als Zahl und lassen einen Wert aus, der keine ist, die übrigen lesen ihn als Text.
Ein JSON-Pfad ist auch als `groupBy`-Eintrag möglich, benannt nach dem Pfad, wie er geschrieben wurde:

```ts
await client.data.events.aggregate({
    select: [{ fn: "count" }, { fn: "avg", field: "props->>players", as: "players" }],
    groupBy: ["props->>music"]
});
// [{ "props->>music": "80s", count: 412, players: 3.4 }, …]
```

### Gruppieren nach einem Ausdruck

Ein `groupBy`-Eintrag kann seine Spalte transformieren. Über HTTP wird er wie eine Funktion geschrieben, im SDK als `{ field, transform }`, und er kommt unter `<transform>_<field>` zurück – das ist auch der Name, den `orderBy` verwendet:

| Transformation | Gruppiert nach |
|---|---|
| `lower(name)`, `upper(name)` | Der Spalte als Text in Klein- bzw. Großbuchstaben |
| `year(createdAt)`, `month(createdAt)`, `day(createdAt)` | Dem Datum, in UTC, als `2026`, `2026-11`, `2026-11-08` — oder in einer Zeitzone: `day(createdAt,Europe/Madrid)`, `{ field, transform: "day", timeZone: "Europe/Madrid" }` |
| `unnest(tags)` | Jedem Element einer Array-Spalte: eine Gruppe pro Element |

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

`fingerprint()` beantwortet „Hat sich diese Collection seit meinem letzten Blick geändert?“, ohne die Zeilen zu lesen: Behalten Sie den String, fragen Sie später erneut und berechnen Sie alles, was Sie aus den Zeilen abgeleitet haben, nur dann neu, wenn er abweicht. Jedes Einfügen, Aktualisieren oder Löschen einer erfassten Zeile ändert ihn; auch ein Schreibvorgang, der nichts ändert (eine Spalte auf ihren eigenen Wert setzen), kann ihn ändern, und das Löschen einer soeben hinzugefügten Zeile bringt ihn zurück. Er erfasst, was der Aufrufer sehen kann und was die Filter auswählen, und er lässt sich gruppieren, sodass `groupBy=lang` einen Fingerprint pro Sprache liefert.

```ts
let lastFingerprint: string | undefined;

async function catalogueChanged(): Promise<boolean> {
    const [{ fingerprint }] = await client.data.songs.aggregate({ select: [{ fn: "fingerprint" }] });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = String(fingerprint);
    return changed;
}
```

Er wird aus den Zeilenversionen berechnet, die Postgres führt, nicht aus den Werten, kostet also einen Scan der Tabelle und nicht einen Hash jeder Zeile: bei 30.000 Zeilen 4 ms, wo `md5(string_agg(...))` über die Zeilen 56 benötigt. Bei einer einfachen View, die keine Zeilen speichert, ist er nicht verfügbar; eine Materialized View hat einen.

Gruppen werden wie die Zeilen einer Auflistung paginiert. `limit` begrenzt sie, `offset` (oder `page`) überspringt sie und `orderBy` sortiert sie nach einem `groupBy`-Feld oder einem Ergebnisschlüssel. Die Sortierreihenfolge endet immer mit den Gruppenschlüsseln, sodass jede Seitengrenze an derselben Stelle liegt. Ein gruppiertes Aggregat ohne `limit` wird wie ein Listing beim Standardwert abgeschnitten (50 Gruppen). Mit einem `limit` – einschließlich des Standardwerts – gibt die Antwort an, ob weitere vorhanden sind, und das `aggregate()` des SDKs gibt dies als `meta` im Ergebnis zurück:

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` oder `orderBy` ohne ein `groupBy` oder ein Cursor auf einem Aggregat führt zu einem `400 INVALID_AGGREGATE_WINDOW`: Ein ungruppiertes Aggregat hat nur eine Zeile, und eine Gruppe ist keine Zeile, nach der ein Cursor fortfahren kann.

Ein Aggregat liest die gespeicherten Werte und führt `afterRead` nie aus. Wenn also ein `afterRead`-Callback eine Collection umschreibt – global, auf Collection- oder Property-Ebene –, wird sowohl über HTTP als auch in-process nur `count()` und `fingerprint()` ohne `groupBy` bedient; alles andere führt zu einem `400 AGGREGATE_MASKED_BY_AFTER_READ`, da eine Summe, ein Maximum oder eine Gruppe die Werte lesen würde, die der Callback verbirgt.

Im SDK akzeptiert `aggregate()` dasselbe `orderBy` wie ein `find()` – ein einzelnes `[key, "asc" | "desc"]`-Tupel oder eine Liste davon –, wobei der Schlüssel eine `groupBy`-Spalte oder ein Ergebnisschlüssel ist. Beide sind typisiert: Bei einem generierten Modell kompiliert ein Schlüssel, der keines von beidem ist, nicht. In-Process (`rebase.data`) werden die Gruppen in derselben Reihenfolge wie über HTTP zurückgegeben.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Es unterstützt dieselben Filter wie der Listen-Endpunkt, sodass ein Aggregat auf dieselbe Weise wie ein Listing eingegrenzt werden kann:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**Row-Level Security gilt für die Zeilen, die aggregiert werden.** Ein Aggregat ist ein effizienter Weg, um Informationen über Zeilen zu erhalten, die man nicht lesen kann; daher wird es unter den eigenen Policies des Aufrufers ausgeführt: Wer nichts abfragen darf, zählt nichts.
:::

Aggregate erfordern einen Treiber, der sie implementiert. Bei einem Treiber, der dies nicht tut, antwortet der Endpunkt mit `501` statt eines leeren Ergebnisses – einem Dashboard sollte nicht „keine Treffer“ gemeldet werden, wenn die Wahrheit „nicht unterstützt“ lautet.

## Filtern innerhalb von JSON

Eine `json`- oder `jsonb`-Spalte kann nach Pfad gefiltert werden, indem die pfeilbasierte Postgres-Syntax verwendet wird:

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

Pfadsegmente werden immer als gebundene Parameter gesendet und niemals direkt in SQL eingefügt.

### Wie Werte verglichen werden

`->>` liefert **Text**, daher sind Vergleiche Textvergleiche – außer wenn ein Vergleichsoperator (`>`, `>=`, `<`, `<=`) mit einer **Zahl** übergeben wird, wodurch ein Cast zu numerisch erfolgt:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Zeilen, deren Wert an diesem Pfad keine Zahl ist, werden aus einem numerischen Vergleich ausgeschlossen, anstatt dass die Abfrage fehlschlägt. Booleans werden als `"true"` / `"false"` verglichen, so wie `->>` sie darstellt.

:::note
`array-contains` und die anderen Operatoren für ganze Spalten sind auf einem Pfad nicht verfügbar – sie beziehen sich auf das gesamte Dokument; verwenden Sie sie daher direkt auf der Spalte selbst.
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

Standardmäßig handelt es sich um einen **Teilstring-Abgleich ohne Berücksichtigung der Groß-/Kleinschreibung** (case-insensitive) über die Top-Level-`string`-Properties der Collection. Es ist keine Volltextsuche: Sie greift nicht in `map`- oder `array`-Properties hinein, führt kein Stemming oder Ranking durch und kann keinen Index nutzen.

Eine Postgres-Collection kann echte Volltextsuche aktivieren, indem ein `search`-Block deklariert wird, wodurch Ergebnisse auch nach `_score` gerankt werden können. Siehe [Suche](/docs/backend/search).

## Vektorsuche

Für Collections mit einer `vector`-Property können Zeilen nach der Ähnlichkeit zu einem Query-Embedding sortiert werden. Die Zeilen werden in der Reihenfolge der größten Ähnlichkeit (closest-first) zurückgegeben, jeweils mit einer `_distance`. Die Distanz bestimmt die Sortierung: Ein `orderBy` in derselben Abfrage wird ignoriert. Ohne ein `limit` gibt eine Vektorsuche 10 Zeilen zurück, nicht die 50 eines normalen Listings.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` in derselben Abfrage filtert, welche Zeilen Kandidaten sind – dies gibt die ähnlichsten Zeilen zurück, die ebenfalls übereinstimmen, anstatt die ähnlichsten Zeilen erst im Nachhinein zu filtern. Bei dem HNSW-Index gilt dies ab pgvector 0.8.0 (siehe [Filters on an approximate index](/docs/backend/vector-search/#filters-on-an-approximate-index)); bei einem älteren pgvector liefert ein Filter, den nur wenige der nächsten Zeilen bestehen, eine kurze Seite. Die Erstellung von `queryVector` liegt in Ihrer Verantwortung: Rebase speichert und durchsucht Embeddings, berechnet sie jedoch nicht.

Das SDK sendet eine Vektorsuche als `POST /api/data/<collection>/query`, mit dem Embedding im Body: In der URL betragen 768 Dimensionen etwa 17 KB, was über dem liegt, was Node (16 KB) und die meisten Proxies (nginx: 8 KB) akzeptieren. `count()` mit einer Vektorsuche verfährt genauso als `POST /api/data/<collection>/count`. Bei einem Server, der älter als 0.24 ist und keine solche Route hat, fällt beides auf das `GET` zurück – und ein langes Embedding dort kann immer noch mit einem 431 oder 414 abgelehnt werden.

Mit einem `threshold` enthält das Ergebnis kein `meta.total` – das Zählen der Zeilen innerhalb einer Distanz würde dies für jede Zeile der Tabelle berechnen. Paginieren Sie stattdessen mit `meta.hasMore`, was exakt bleibt.

### Was Sie bereitstellen müssen

- **pgvector.** Eine `vector`-Property wird zu einer `VECTOR(n)`-Spalte kompiliert, und dieser Typ stammt aus der `vector`-Extension. Rebase installiert sie für Sie, jedoch nur dort, wo Sie es erlauben:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Diese Zeile ist eher eine Berechtigung als eine Anforderung – Rebase führt `CREATE EXTENSION IF NOT EXISTS vector` nur dann aus, wenn etwas in Ihrem Schema es benötigt. Dies ist Opt-in, da die Installation einer Extension von Dingen abhängt, die Rebase von innerhalb der Verbindung nicht einsehen kann: Das Image muss die Bibliothek mitbringen (das Scaffold-Image `pgvector/pgvector:pg18` tut dies, ein Standard-`postgres:18` nicht), die Rolle muss die Berechtigung haben, sie zu installieren, und ein Managed Provider muss sie auf einer Allowlist führen.

  Geben Sie nichts an, installiert Rebase nichts – installieren Sie sie stattdessen einmal manuell. In beiden Fällen wird die Spalte erstellt, und Postgres lehnt sie auf einer Datenbank, die keines von beidem hat, mit `type "vector" does not exist` ab, wobei beide Lösungswege genannt werden.

Die Spalte, ihr ANN-Index und dieses `CREATE EXTENSION` werden in `.rebase/sql/vector.sql` neben `schema.sql` und `policies.sql` generiert, und `rebase db push` wendet sie für Sie an. Sie haben eine eigene Datei, da Atlas – die Engine hinter `db push` – sein Diff berechnet, indem es `schema.sql` in einer Scratch-Datenbank materialisiert, die zu Beginn jedes Laufs gelöscht wird; ein `VECTOR(n)` darin würde also gegen eine Datenbank aufgelöst, die pgvector niemals haben kann.

`rebase db generate` hängt diese Datei an die geschriebene Migration an, sodass eine Migration, die auf einer frischen Datenbank erneut ausgeführt wird, die Spalte ebenfalls erstellt. Eine Änderung allein an der Vector-Property erzeugt keine Migration, da das Schema, das Atlas vergleicht, unverändert ist – `db generate` weist darauf hin, wenn dies geschieht.

### Der Index

Jede Vektor-Spalte erhält einen HNSW-Index für Kosinus-Distanz, der zusammen mit der Tabelle erstellt und beim Start gemeldet wird. Kosinus, weil `vectorSearch` standardmäßig damit misst, sofern Sie kein `distance` übergeben – ein Index bedient genau einen Operator, sodass eine `l2`-Abfrage gegen einen Kosinus-Index stillschweigend auf einen Scan zurückfällt.

Passen Sie ihn an oder deaktivieren Sie ihn direkt an der Property:

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

`index: false` behält den exakten Scan bewusst bei. Bei mehr als 2000 Dimensionen kann pgvector keinen der beiden Indextypen erstellen, daher wird die Spalte erstellt und bleibt unindiziert, worauf beim Boot hingewiesen wird – `vectorSearch` funktioniert weiterhin als exakter Scan.

`vectorSearch` ist eine Abfrage, kein Abonnement: `.listen()` darauf wird abgelehnt, anstatt als einfaches Listing bedient zu werden, da bei einem Schreibvorgang nichts die Distanzen neu berechnet.

## Nächste Schritte

- [Daten abfragen](/docs/sdk/querying/) — der Query-Builder, auf dem diese aufsetzen
- [Suche](/docs/backend/search/) — wie Volltext- und Vektorsuche im Backend konfiguriert werden
- [REST-API](/docs/backend/api/) — dieselben Abfragen über HTTP
