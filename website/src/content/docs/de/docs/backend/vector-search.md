---
sourceHash: 333a5c7a8ba6fe64
title: Vektorsuche
sidebar_label: Vektorsuche
description: Nächste-Nachbarn-Suche über eine Vektor-Property per REST-API — die Query-Parameter, Schwellenwerte, für eine URL zu lange Embeddings und wie sich Filter auf einem HNSW-Index verhalten.
---

Definiert eine Collection eine Property vom Typ `vector`, können Sie mit pgvector-Distanzoperationen, die direkt in der Datenbankabfrage kompiliert werden, schnelle Ähnlichkeitssuchen ausführen.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Query-Parameter

| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| `vector_search` | `string` | Der Name der Vektor-Property, gegen die abgefragt wird. |
| `vector` | `string` | Ein JSON-serialisiertes Array von Floats, das den Abfragevektor darstellt. |
| `vector_distance` | `string` | Die auszuwertende Distanzmetrik. Unterstützte Werte: `cosine` (Standard, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Maximaler Distanz-Schwellenwert. Nur Datensätze mit einer Distanz unter diesem Schwellenwert werden zurückgegeben. |

<span class="since-badge" data-since="0.25">Seit 0.25</span> Eine Vektorsuche mit einem
`vector_threshold` hat kein `meta.total`: Die Zeilen innerhalb einer Distanz zu zählen
bedeutet, diese Distanz für jede Zeile der Tabelle zu berechnen, was kein Index bedient — ein
Mehrfaches der Kosten der Seite selbst, wachsend mit Zeilen × Dimensionen. `meta.hasMore` ist
exakt, durch das Lesen einer Zeile über die Seite hinaus. Ohne Schwellenwert ist die Zählung die
gewöhnliche.

Ein Embedding ist in einer URL lang: 768 Dimensionen sind etwa 17 KB Query-String und
1.536 etwa 33 KB. Der Server akzeptiert bis zu 64 KB an Request-Zeile und Headern
(<span class="since-badge" data-since="0.25">Seit 0.25</span>; zuvor 16 KB, ein 431
ab 768 Dimensionen), und ein Proxy davor akzeptiert meist weniger — beim Standard von nginx
sind es 8 KB. Senden Sie eine Vektorsuche stattdessen als [`POST …/query`](#abfragen-die-für-eine-url-zu-lang-sind);
das SDK tut das immer.

## Filter auf einem approximativen Index

<span class="since-badge" data-since="0.25">Seit 0.25</span> Eine Vektorsuche, die
zusätzlich filtert — ein `where`, eine Suche, Row-Level Security —, gibt die nächsten Zeilen zurück,
die passen. Ein HNSW-Index antwortet mit einer festen Anzahl nächster Kandidaten
(`hnsw.ef_search`, standardmäßig 40), und die anderen Bedingungen werden auf diese angewendet;
passen nur wenige davon, kam die Seite zu kurz oder leer zurück, obwohl viele Zeilen
passten, und Offset-Seiten übersprangen Zeilen. Ab pgvector 0.8.0 schaltet der Lesevorgang
den iterativen Index-Scan von pgvector ein (`hnsw.iterative_scan = strict_order`, nur für die Transaktion
dieses Lesevorgangs), der so lange weiterscannt, bis die Seite voll ist, bis zu
`hnsw.max_scan_tuples` (standardmäßig 20.000) — ein Filter, der nahe am Abfragevektor fast nichts trifft,
kann dennoch eine zu kurze Seite liefern. Bei einem älteren pgvector und bei
einem IVFFlat-Index behält eine gefilterte Vektorsuche das Verhalten mit zu kurzer Seite; ein exakter
Scan (`index: false`) hatte es nie.

## Abfragen, die für eine URL zu lang sind

<span class="since-badge" data-since="0.25">Seit 0.25</span> `POST /api/data/:slug/query`
ist die Auflistung, die `GET /api/data/:slug` beantwortet, mit den Query-Parametern in einem JSON-Body
statt in der URL. Verwenden Sie es, wenn die URL nicht passen würde — das Embedding einer Vektorsuche,
ein Filter auf einer langen `in`-Liste. Das SDK sendet jede Vektorsuche auf diese Weise
und jede andere Abfrage, deren URL 6 KB überschreiten würde.

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

Die Schlüssel des Bodys sind die Query-Parameter, und der Server liest sie über denselben Parser
zu genau den Parametern zurück, die das `GET` liest — dieselben Filter,
Seite, Zählung, Cursor und Includes, dieselbe Row-Level Security, dieselben Fehler. Ein Wert wird
so geschrieben, wie die URL ihn schreibt: ein String (oder eine Zahl oder ein Boolean), und für einen in der URL
wiederholten Filter eine Liste (`"views": ["gte.10", "lte.99"]`). `where`, `include`,
`orderBy` und `vector` nehmen ihren JSON-Wert selbst oder dieses JSON als String. Eine
Liste für einen Parameter, den die URL einmal liest, ein Objekt an jeder anderen Stelle oder ein Parameter,
der zusätzlich in die URL gesetzt wurde, ergibt 400 `INVALID_QUERY_BODY`.

Es liest nur, sodass ein API-Schlüssel dafür `data:read` braucht, nicht `data:write`, und es
zählt gegen dasselbe Rate-Limit wie das `GET`. Verschachtelte Auflistungen haben es ebenfalls:
`POST /api/data/authors/42/posts/query`. Ein Server älter als 0.24 antwortet darauf mit 404;
das SDK sendet dann das `GET`.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Die Zählung hat
denselben Zwilling: `POST /api/data/:slug/count` (und `POST /api/data/authors/42/posts/count`)
ist `GET /api/data/:slug/count` mit seinen Parametern im Body, genauso gelesen
und genauso abgelehnt. Eine Zählung trägt die Filter des `find()`, das sie beschreibt,
sodass ihre URL ebenso lang ist. Das `count()` des SDK folgt der Regel von `find()` — jede
Vektorsuche und jede Zählung, deren URL 6 KB überschreiten würde — und fällt gegen einen älteren Server
auf das `GET` zurück.

## Verwandte Themen

- [REST-API](/docs/backend/api/) — jeder andere Parameter, den eine Auflistung nimmt
- [Aggregate & Suche](/docs/sdk/aggregates-and-search/#vector-search) — `.vectorSearch()` aus dem SDK und der Index, den eine Vektor-Property erhält
