---
sourceHash: 6774e2ad2b2e95b0
title: Aggregate und Suche
sidebar_label: Aggregate & Suche
description: "Zählen, summieren und gruppieren mit dem SDK, Filtern in JSON-Spalten und Ausführen von Volltext- und Vektorsuche über den Client."
---

## Aggregate

`count`, `sum`, `avg`, `min` und `max` über die Zeilen, die ein Filter auswählt,
ohne diese abzurufen:

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

Die Ergebnisse sind nach Funktion und Feld benannt — `count()` wird zu `count`,
`sum(total)` wird zu `sum_total`.

Es akzeptiert dieselben Filter wie der List-Endpunkt, sodass ein Aggregat auf die
gleiche Weise wie eine Auflistung eingegrenzt werden kann:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**Row-Level Security gilt für die Zeilen, die aggregiert werden.** Ein Aggregat ist
ein effizienter Weg, um Informationen über Zeilen zu erhalten, die man nicht lesen
kann. Daher läuft es unter den Richtlinien des Aufrufers: Wer nichts auswählen kann,
zählt auch nichts.
:::

Aggregate erfordern einen Treiber, der sie implementiert. Bei einem Treiber, der
dies nicht tut, antwortet der Endpunkt mit `501` statt mit einem leeren Ergebnis —
einem Dashboard sollte nicht "keine Treffer" mitgeteilt werden, wenn die Wahrheit
"nicht unterstützt" lautet.

## Filtern in JSON

Eine `json`- oder `jsonb`-Spalte kann per Pfad gefiltert werden, unter Verwendung
der Pfeil-Syntax von Postgres:

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

Pfadsegmente werden immer als gebundene Parameter übergeben, niemals direkt in
SQL eingefügt.

### Wie Werte verglichen werden

`->>` liefert **Text**, daher sind Vergleiche Textvergleiche — außer, wenn einem
Vergleichsoperator (`>`, `>=`, `<`, `<=`) eine **Zahl** übergeben wird, wodurch
in einen numerischen Typ konvertiert wird:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Zeilen, deren Wert an diesem Pfad keine Zahl ist, werden von einem numerischen
Vergleich ausgeschlossen, anstatt dass die Abfrage fehlschlägt. Booleans werden
als `"true"` / `"false"` verglichen, da `->>` sie so darstellt.

:::note
`array-contains` und die anderen Ganzspalten-Operatoren sind auf einem Pfad nicht
verfügbar — sie stellen eine Bedingung an das gesamte Dokument; verwenden Sie sie
daher auf der Spalte selbst.
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

Standardmäßig handelt es sich hierbei um einen **Teilstring-Abgleich ohne
Berücksichtigung von Groß-/Kleinschreibung** über die obersten `string`-Eigenschaften
der Collection. Es ist keine Volltextsuche: Es greift nicht in `map`- oder
`array`-Eigenschaften hinein, führt kein Stemming oder Ranking durch und kann keinen
Index verwenden.

Eine Postgres-Collection kann eine echte Volltextsuche aktivieren, indem sie einen
`search`-Block deklariert, wodurch Ergebnisse auch nach `_score` sortiert werden können.
Siehe [Suche](/docs/backend/search).

## Vektorsuche

Bei Collections mit einer `vector`-Eigenschaft können Zeilen nach der Ähnlichkeit
zu einem Query-Embedding sortiert werden. Die Zeilen werden mit dem ähnlichsten
Ergebnis zuerst zurückgegeben, jeweils mit einer `_distance`.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` und `orderBy` in derselben Abfrage fungieren als Filter, die *vor* der
Sortierung angewendet werden — dies gibt die nächstgelegenen Zeilen zurück, die
ebenfalls übereinstimmen, nicht die nächstgelegenen Zeilen, die nachträglich
gefiltert wurden. Die Erstellung des `queryVector` liegt in Ihrer Verantwortung:
Rebase speichert und durchsucht Embeddings, berechnet sie jedoch nicht.

### Was Sie bereitstellen müssen

- **pgvector.** Eine `vector`-Eigenschaft wird zu einer `VECTOR(n)`-Spalte kompiliert,
  und dieser Typ stammt aus der `vector`-Extension. Rebase installiert sie für Sie,
  jedoch nur dort, wo Sie es erlauben:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Diese Zeile ist eher eine Berechtigung als eine Anforderung — Rebase führt
  `CREATE EXTENSION IF NOT EXISTS vector` nur aus, wenn etwas in Ihrem Schema
  dies benötigt. Es handelt sich um ein Opt-in, da die Installation einer Extension
  von Faktoren abhängt, die Rebase aus der Verbindung heraus nicht einsehen kann:
  Das Image muss die Bibliothek bereitstellen (das `pgvector/pgvector:pg18` des
  Scaffolds tut dies, ein Standard-`postgres:18` nicht), die Rolle muss die
  Berechtigung zur Installation haben, und ein Managed Provider muss sie auf einer
  Allowlist führen.

  Geben Sie nichts an, installiert Rebase nichts — installieren Sie sie in diesem
  Fall einmalig manuell. In beiden Fällen wird die Spalte erstellt, und Postgres
  weist sie mit `type "vector" does not exist` auf einer Datenbank ab, die keines
  von beidem hat, und nennt dabei beide Auswege.

Die Spalte, ihr ANN-Index und das `CREATE EXTENSION` werden in `drizzle/vector.sql`
generiert, neben `schema.sql` und `policies.sql`, und `rebase db push` wendet sie
für Sie an. Sie haben eine eigene Datei, da Atlas — die Engine hinter `db push` —
seinen Diff berechnet, indem es `schema.sql` in einer temporären Scratch-Datenbank
materialisiert, die es zu Beginn jedes Laufs löscht. Ein dortiges `VECTOR(n)` würde
daher gegen eine Datenbank aufgelöst, die niemals pgvector haben kann.

`rebase db generate` hängt diese Datei an die Migration an, die es schreibt, sodass
eine Migration, die auf einer neuen Datenbank ausgeführt wird, die Spalte ebenfalls
erstellt. Eine Änderung ausschließlich an der Vektor-Eigenschaft erzeugt keine
Migration, da das Schema, das Atlas vergleicht, unverändert ist — `db generate`
weist darauf hin, wenn dies geschieht.

### Der Index

Jede Vektorspalte erhält einen HNSW-Index für die Kosinus-Distanz, der zusammen mit
der Tabelle erstellt und beim Start gemeldet wird. Kosinus, weil `vectorSearch` damit
misst, sofern Sie keine andere `distance` übergeben — ein Index bedient genau einen
Operator, daher greift eine `l2`-Abfrage auf einem Kosinus-Index stillschweigend auf
einen Scan zurück.

Passen Sie ihn an oder deaktivieren Sie ihn auf der Eigenschaft:

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

`index: false` behält den exakten Scan absichtlich bei. Über 2000 Dimensionen kann
pgvector keinen der beiden Indextypen erstellen, sodass die Spalte unindiziert
bleibt und dies beim Start gemeldet wird — `vectorSearch` antwortet weiterhin,
als exakter Scan.

`vectorSearch` ist eine Abfrage, keine Subscription: Ein `.listen()` darauf wird
abgewiesen, anstatt als einfache Auflistung bereitgestellt zu werden, da bei einem
Schreibvorgang keine Distanzen neu berechnet werden.

## Nächste Schritte

- [Daten abfragen](/docs/sdk/querying/) — der Query-Builder, auf dem diese Abfragen aufbauen
- [Suche](/docs/backend/search/) — wie Volltext- und Vektorsuche im Backend konfiguriert werden
- [REST-API](/docs/backend/api/) — dieselben Abfragen über HTTP

---
