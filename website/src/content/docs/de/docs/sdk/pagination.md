---
sourceHash: e658ebda47d3942e
title: Paginierung
sidebar_label: Paginierung
description: Tabellen mit Limit/Offset, Seitennummern oder einem Keyset-Cursor paginieren – und wann welcher Ansatz an seine Grenzen stößt.
---

Drei Möglichkeiten, eine Tabelle zu durchlaufen: ein Offset, eine Seitennummer und ein Cursor. Die
ersten beiden sind positionsbasiert, die dritte nicht, und genau darin liegt der entscheidende Unterschied –
eine positionsbasierte Seite liest Daten erneut aus, indem sie vom Anfang an zählt, sodass Zeilen, die
während des Blätterns geschrieben werden, die Bedeutung von „Zeile 20“ verschieben.

```typescript
// Offset-based pagination
const page1 = await client.data.products.find({ limit: 20, offset: 0 });
const page2 = await client.data.products.find({ limit: 20, offset: 20 });

// Check if more pages exist
if (page1.meta.hasMore) {
    // fetch next page
}

// Page-number pagination (1-indexed)
const page = await client.data.products.find({ page: 2, limit: 20 });
```

Verwenden Sie entweder das eine oder das andere. `page` und `offset` zusammen
beschreiben dasselbe Fenster doppelt, und der Lesezugriff wird mit `PAGE_WITH_OFFSET`
abgelehnt, anstatt stillschweigend `page` anzuwenden. Das SDK lehnt dies noch vor jeder Anfrage
ab – über HTTP, im Prozess und offline; der Server beantwortet eine direkte Anfrage, die beides sendet,
mit einem 400-Fehler.

`limit` muss eine ganze Zahl zwischen 1 und 1000 sein. Ein größerer Wert – oder eine Null, ein
negativer Wert oder eine Kommazahl – wird mit einem 400 `INVALID_LIMIT` abgelehnt, anstatt
gekappt zu werden, da eine stillschweigend kleinere Seite nicht von der letzten Seite unterschieden werden kann.
Um über diese Obergrenze hinaus zu lesen, durchlaufen Sie die Seiten mit `iterate()` oder `findAll()`.

#### Cursor-Paginierung

Jede Listen-Antwort enthält ein `meta.nextCursor`, solange eine weitere Seite vorhanden ist.
Übergeben Sie diesen als `after` zurück, und die nächste Seite setzt **strikt nach der zuletzt gelieferten
Zeile** an, anstatt bei einer Zeilen*anzahl*, die durch gleichzeitige Schreibvorgänge
möglicherweise bereits verschoben wurde:

```typescript
let after: string | undefined;
do {
    const { data, meta } = await client.data.orders.find({
        orderBy: ["createdAt", "desc"],
        limit: 100,
        after
    });
    for (const order of data) await handle(order);
    after = meta.nextCursor;
} while (after);
```

`nextCursor` fehlt auf der letzten Seite sowie auf Seiten, die kein Cursor beschreiben kann:
eine nach Relevanz sortierte Suche (`_score`), eine Vektorsuche und eine `fields`-Projektion,
die eines der `orderBy`-Felder auslässt – der Cursor wird aus den Sortierwerten der letzten
Zeile gebildet, und diese Zeile enthält sie dann nicht. In solchen Fällen kann `meta.hasMore` `true` sein,
ohne dass ein `nextCursor` vorhanden ist, und die obige Schleife bricht vorzeitig ab: Fügen Sie die Sortierfelder
zu `fields` hinzu oder paginieren Sie per `offset`. Wird `iterate()` ein `cursor` übergeben, wird eine solche
Auflistung mit `cursor-missing` abgelehnt, anstatt anzuhalten. Eine Sortierung nach einem
[Aggregat über eine Relation](/docs/sdk/relations/) unterstützt die Cursor-Paginierung.

Der Cursor ist **opak**. Er kodiert die Sortierschlüssel *und* die entsprechenden Werte
der letzten Zeile, sodass er nur die Auflistung fortsetzen kann, aus der er stammt: Behalten Sie `orderBy`
über alle Seiten hinweg identisch bei, andernfalls wird die Anfrage mit
`CURSOR_ORDER_MISMATCH` abgelehnt, anstatt in einer Reihenfolge zu suchen, die niemand angefordert hat. Eine
Anfrage, die überhaupt kein `orderBy` angibt, übernimmt die Sortierung des Cursors, sodass Sie ihn
direkt zurückgeben können, ohne die Sortierung erneut angeben zu müssen.

Versuchen Sie nicht, ihn zu parsen oder selbst zu erstellen: Die Kodierung kann sich jederzeit ändern,
und alles andere führt zu `INVALID_CURSOR`.

Aus der Natur eines Cursors ergeben sich vier Konsequenzen:

- **`after` kann nicht mit `offset` oder `page` kombiniert werden** (400
  `CURSOR_WITH_OFFSET`). Beide bestimmen, wo die Seite beginnt, und die Berücksichtigung beider
  würde Zeilen überspringen.
- **Sortierungen über mehrere Schlüssel und Nullable-Schlüssel funktionieren beide.** Der Vergleich wird
  über jeden Schlüssel der Reihe nach aufgebaut, unter Berücksichtigung der [NULL-Platzierung](/docs/sdk/querying#where-nulls-sort),
  die in der Sortierung deklariert wurde – nicht als einzelnes `>` auf einer Spalte.
- **Relevanz kann kein Cursor sein.** Ein `_score` wird pro Abfrage berechnet und nirgends
  gespeichert, und zwei Abfragen mit unterschiedlichen Suchbegriffen erzeugen Scores, die nicht auf derselben
  Skala liegen. Eine solche Auflistung enthält schlicht keinen `nextCursor`; paginieren Sie diese
  mit `offset`. Das Gleiche gilt für die Distanz einer Vektorsuche; ein zusammen mit ihr gesendeter Cursor
  wird mit `VECTOR_CURSOR_UNSUPPORTED` abgelehnt.
- **Eine Subscription kann nicht von einem Cursor aus fortgesetzt werden.** `listen()` führt seine Abfrage
  bei jedem Schreibvorgang erneut aus, und `after` benennt eine Stelle in einem einzelnen Durchlauf davon. Daher wird
  `listen({ after })` noch vor dem Senden mit `CURSOR_NOT_LIVE` abgelehnt. Verwenden Sie `offset` oder
  `page` für ein Live-Fenster oder `find({ after })`, um die Seite einmalig zu lesen.

Über HTTP ist es ein einziger Parameter:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Zählen überspringen

`meta.total` ist ein `COUNT(*)` über alle Zeilen, die der Abfrage entsprechen, ausgeführt parallel
zur Seite – und bei einer großen Tabelle kostet dies mehr als die Seite selbst. Ein Lesezugriff, der nur
vorwärts blättert, benötigt diesen Wert nie, da `meta.hasMore` nicht davon abhängt:
Übergeben Sie `count: "none"`, und die Leseoperation fordert stattdessen eine Zeile über das Seitenende hinaus an.

```typescript
const { data, meta } = await client.data.orders.find({ limit: 100, count: "none" });
meta.hasMore; // exact
```

Ohne Zählung gibt es keine Gesamtzahl zu melden: Über HTTP fehlt `meta.total`,
und im Prozess entspricht der Wert den Zeilen bis zum Ende der Seite (`offset` plus die
Seite). Über HTTP lautet der Parameter `?count=none`; `?count=exact` ist der Standardwert, und
jeder andere Wert führt zu einem 400 `INVALID_COUNT`. `iterate()` und `findAll()` senden dies
automatisch bei jeder Seite mit, da ein Durchlauf keine Gesamtzahl meldet.

#### Welche Leseoperationen gewrappt sind und welche nicht

Zwei Formen und eine Regel: **Ein Fenster wird gewrappt, eine vollständige Antwort nicht.**

| Methode | Rückgabewert | Warum |
|--------|---------|-----|
| `find()`, `listen()` | `{ data, meta }` | Eine Seite. `meta.total` / `meta.hasMore` sind die einzige Möglichkeit zu erfahren, ob weitere Daten vorhanden sind |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Nichts weiter zu melden – der Durchlauf ist abgeschlossen oder der Batch *besteht* aus den Zeilen |
| `iterate()` | eine Zeile nach der anderen | Es wird überhaupt nichts materialisiert |
| `findById()`, `get()`, `create()`, `update()` | eine Zeile | Keine Liste |

`data` ist kein Wrapper, den das SDK manchmal hinzufügt und manchmal vergisst. Hier
befinden sich die Paginierungs-Metadaten, und es ist genau dann vorhanden, wenn welche existieren.

#### Alles lesen: `iterate()` und `findAll()`

`iterate()` streamt jede Zeile, die einer Abfrage entspricht, einzeln nacheinander und ruft im
Hintergrund jeweils eine Seite auf einmal ab. Da nichts akkumuliert wird, ist dies die richtige
Wahl für Tabellen, die nicht komplett in den Arbeitsspeicher passen:

```typescript
for await (const order of client.data.orders.iterate({
    where: { status: ["==", "pending"] }
})) {
    await handleOrder(order);
}
```

`findAll()` ist derselbe Durchlauf, jedoch gesammelt in einem Array:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
```

Beide stehen auch über den Fluent Builder zur Verfügung, wo `.limit()` zur **Seitengröße**
statt zu einer Gesamtobergrenze wird:

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Vier Optionen bestimmen den Durchlauf:

| Option | Standard | Funktion |
|--------|---------|--------------|
| `pageSize` | 200 | Zeilen pro Anfrage. |
| `cursor` | — | Seeking erzwingen: Fehler auslösen, anstatt auf Offset zurückzugreifen. Siehe unten. |
| `maxPages` | 10 000 | Obergrenze für Anfragen, damit ein Server, der endlos `hasMore` meldet, nicht in eine Endlosschleife gerät. |
| `maxRows` | 10 000 | Nur für `findAll()`. Das Überschreiten **löst einen Fehler aus**, anstatt ein abgeschnittenes Array zurückzugeben, als wäre es das vollständige Ergebnis. Übergeben Sie `Infinity`, um dies zu deaktivieren, oder verwenden Sie `iterate()`. |

**Der Durchlauf führt das Seeking automatisch durch.** Nach der ersten Seite übergibt er
[den Cursor des Servers](#cursor-paginierung) – `meta.nextCursor` – als `after` zurück,
sodass jede Anfrage Zeilen strikt nach der zuletzt gesehenen Zeile anfordert. Gleichzeitige
Schreibvorgänge vor dieser Zeile können das Fenster nicht verschieben, und die Datenbank muss nie
Zeilen anhand eines Zählers überspringen – genau das, was lange Offset-Durchläufe langsam machte:
Jede Seite kostete mehr als die vorherige.

Gibt der Server keinen Cursor aus – etwa bei einer nach Relevanz sortierten Suche, einer Vektorsuche,
einem `distinct`-Lesezugriff oder einer `fields`-Projektion, die ein Sortierfeld auslässt –,
paginiert der Durchlauf stattdessen per Offset. Eine Zeile, die *während des Durchlaufs*
eingefügt oder gelöscht wird, kann dazu führen, dass Zeilen übersprungen oder doppelt gelesen werden.
Übergeben Sie `cursor`, um Seeking zur Voraussetzung statt zu einer Präferenz zu machen:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` benennt die Spalte, nach der sortiert werden soll, falls die Abfrage dies nicht bereits festlegt, und
wandelt den Offset-Fallback in einen Fehler um. Der Durchlauf erstellt keinen eigenen Vergleich,
weshalb auch Sortierungen über mehrere Schlüssel funktionieren –

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

– und warum dies auch für Nullable-Sortierschlüssel gilt.

Die Sortierung muss dennoch **total** sein, was in der Praxis eindeutig bedeutet: Die Zeilen-ID
bricht den finalen Gleichstand auf, sodass jede Spalte als Tie-Breaker fungieren kann. Wird `cursor` angegeben,
löst ein Durchlauf, dessen Cursor nicht mehr voranschreitet, `cursor-stalled` aus, anstatt in einer
Endlosschleife zu verharren, und eine Abfrage, die kein Cursor beschreiben kann (Relevanz), löst
`cursor-missing` aus; lassen Sie `cursor` weg, paginiert der Durchlauf diese per Offset.

## Siehe auch

- [Daten abfragen](/docs/sdk/querying/) – Filter, der Fluent Builder, Sortierung.
- [Aggregate & Suche](/docs/sdk/aggregates-and-search/) – warum Relevanz nicht als Cursor-Schlüssel dienen kann.
