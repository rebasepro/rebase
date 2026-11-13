---
sourceHash: 889a7fb508265011
title: Vektorsuche
sidebar_label: Vektorsuche
description: Nächste-Nachbarn-Suche über eine col.vector()-Spalte über die REST-API – die Abfrageparameter, Schwellenwerte, Embeddings, die zu lang für eine URL sind, und wie sich Filter auf einem HNSW-Index verhalten.
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Tabelle mit einer `col.vector()`-Spalte kann nach Ähnlichkeit durchsucht werden: die am nächsten liegenden
Zeilen zu einem Abfragevektor, bestimmt durch eine in der Datenbankabfrage berechnete pgvector-Distanz.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Deklarieren der Spalte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        name:      col.text().notNull(),
        embedding: col.vector({ dimensions: 1536, index: { method: "hnsw", metric: ["cosine", "l2"] } }),
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

`col.vector({ dimensions })` ist eine pgvector-`vector(dimensions)`-Spalte, die als
`number[]` gelesen und geschrieben wird. Sie erhält einen Approximate-Nearest-Neighbour-Index,
sofern `index` nichts anderes festlegt:

| `index`-Option | Standard | Funktion |
|---|---|---|
| `method` | `"hnsw"` | `"hnsw"` oder `"ivfflat"`. |
| `metric` | `"cosine"` | `"cosine"`, `"l2"` oder `"ip"` (Skalarprodukt / Inner Product), oder eine Liste: pro Metrik wird ein Index erstellt. |
| `m` | pgvector-Standard | HNSW: Verbindungen pro Ebene. |
| `efConstruction` | pgvector-Standard | HNSW: Größe der Kandidatenliste beim Erstellen. |
| `lists` | pgvector-Standard | IVFFlat: Anzahl der Listen. |

`index: false` erstellt keinen Index, sodass jede Vektorsuche ein exakter Scan ist. Eine
Suche über eine Distanz, die über keinen eigenen Index verfügt, ist ebenfalls ein exakter Scan;
indexieren Sie daher jede Metrik, nach der Sie abfragen. Der Abfrageparameter bezeichnet das
Skalarprodukt als `inner_product`; die Spaltenoption bezeichnet es als `ip`.


## Abfrageparameter

| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| `vector_search` | `string` | Der Schlüssel der Vektorspalte, die abgefragt werden soll. |
| `vector` | `string` | Ein JSON-serialisiertes Array von Floats, das den Abfragevektor darstellt. |
| `vector_distance` | `string` | Die auszuwertende Distanzmetrik. Unterstützte Werte: `cosine` (Standard, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Maximaler Distanz-Schwellenwert. Es werden nur Datensätze zurückgegeben, deren Distanz kleiner als dieser Schwellenwert ist. |

Eine Vektorsuche mit einem
`vector_threshold` besitzt kein `meta.total`: Das Zählen der Zeilen innerhalb einer Distanz bedeutet,
dass diese Distanz für jede Zeile der Tabelle berechnet werden muss, was kein Index bedienen kann – ein
Vielfaches der Kosten der Seite selbst, das mit Zeilen × Dimensionen ansteigt. `meta.hasMore` ist
exakt, da eine Zeile über die Seite hinaus gelesen wird. Ohne einen Schwellenwert entspricht die
Zählung dem normalen Standard.

Ein Embedding ist in einer URL sehr lang: 768 Dimensionen entsprechen etwa 17 KB Query-String und
1.536 etwa 33 KB. Der Server akzeptiert bis zu 64 KB für Anforderungszeile und Header (zuvor
16 KB, ein 431
ab 768 Dimensionen), und ein vorgeschalteter Proxy akzeptiert üblicherweise weniger – der
Standard von nginx liegt bei 8 KB. Senden Sie eine Vektorsuche stattdessen als [`POST …/query`](#abfragen-die-zu-lang-für-eine-url-sind);
das SDK handhabt dies grundsätzlich so.

## Filter auf einem approximativen Index

Eine Vektorsuche, die
auch filtert – ein `where`, eine Suche, Row-Level-Security –, gibt die am nächsten liegenden Zeilen
zurück, die übereinstimmen. Ein HNSW-Index antwortet mit einer festen Anzahl nächster Kandidaten
(`hnsw.ef_search`, standardmäßig 40), und die weiteren Bedingungen werden auf diese angewendet;
wenn nur wenige davon übereinstimmen, fiel die Seite kurz oder leer aus, obwohl viele Zeilen
passten, und Offset-Seiten übersprangen Zeilen. Ab pgvector 0.8.0 aktiviert der Lesevorgang
pgvectors iterativen Index-Scan (`hnsw.iterative_scan = strict_order`, ausschließlich für die
Transaktion dieses Lesevorgangs), der weitersucht, bis die Seite voll ist, bis zu
`hnsw.max_scan_tuples` (standardmäßig 20.000) – ein Filter, der in der Nähe des Abfragevektors
fast nichts matcht, kann dennoch eine unvollständige Seite zurückliefern. Bei einem älteren pgvector
und bei einem IVFFlat-Index behält eine gefilterte Vektorsuche das Verhalten mit unvollständigen
Seiten bei; ein exakter Scan (`index: false`) hatte dieses Problem nie.

## Abfragen, die zu lang für eine URL sind

`POST /api/data/:slug/query`
entspricht der Auflistung, die `GET /api/data/:slug` liefert, wobei die Abfrageparameter in einem JSON-Body
statt in der URL übergeben werden. Verwenden Sie diesen Endpunkt, wenn die URL zu lang wäre – das
Embedding einer Vektorsuche oder ein Filter auf eine lange `in`-Liste. Das SDK sendet jede Vektorsuche auf
diese Weise sowie jede andere Abfrage, deren URL 6 KB überschreiten würde.

```bash
POST /api/data/docs/query
Content-Type: application/json

{
  "vector_search": "embedding",
  "vector": [0.15, 0.22, -0.05],
  "vector_threshold": 0.8,
  "where": { "status": ["==", "published"] },
  "limit": 10
}
```

Die Schlüssel des Bodys sind die Abfrageparameter, und der Server liest sie über denselben
Parser exakt in dieselben Parameter ein, die auch das `GET` liest – dieselben Filter, Seite,
Zählung, Cursor und Includes, dieselbe Row-Level-Security, dieselben Fehler. Ein Wert wird so
angegeben, wie er in der URL stehen würde: als String (oder Zahl oder Boolean) und bei einem
in der URL wiederholten Filter als Liste (`"views": ["gte.10", "lte.99"]`). `where`, `include`,
`orderBy` und `vector` akzeptieren ihren JSON-Wert direkt oder dieses JSON als String. Eine
Liste für einen Parameter, den die URL nur einmal liest, ein Objekt an beliebiger anderer Stelle
oder ein Parameter, der zusätzlich in der URL angegeben wird, führt zu einem 400 `INVALID_QUERY_BODY`.

Da es sich um einen reinen Lesevorgang handelt, benötigt ein API-Schlüssel dafür `data:read`, nicht
`data:write`, und er wird auf dasselbe Rate-Limit angerechnet wie der `GET`-Request. Verschachtelte
Auflistungen unterstützen dies ebenfalls: `POST /api/data/authors/42/posts/query`. Ein Server älter
als 0.24 antwortet mit 404; das SDK sendet in diesem Fall den `GET`-Request.

Die Zählung hat dasselbe
Gegenstück: `POST /api/data/:slug/count` (und `POST /api/data/authors/42/posts/count`)
ist `GET /api/data/:slug/count` mit den Parametern im Body, die auf dieselbe Weise gelesen
und abgelehnt werden. Eine Zählung übernimmt die Filter des `find()`, das sie beschreibt,
daher ist ihre URL genauso lang. Das `count()` des SDK folgt derselben Regel wie `find()` – jede
Vektorsuche und jede Zählung, deren URL 6 KB überschreiten würde – und fällt bei einem älteren
Server auf das `GET` zurück.

## Verwandte Themen

- [REST API](/docs/backend/api/) – alle weiteren Parameter, die eine Auflistung unterstützt
- [Aggregates & search](/docs/sdk/aggregates-and-search/#vector-search) – `.vectorSearch()` über das SDK
