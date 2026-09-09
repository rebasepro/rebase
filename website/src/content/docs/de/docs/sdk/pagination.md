---
sourceHash: f040abfe0eee948c
title: Paginierung
sidebar_label: Paginierung
description: Paginieren Sie eine Collection mit Limit/Offset, Seitenzahlen oder einem Keyset-Cursor – und wann die jeweilige Methode nicht mehr korrekt funktioniert.
---

Drei Möglichkeiten, eine Collection zu durchlaufen: ein Offset, eine Seitenzahl und ein Cursor. Die
ersten beiden sind positionsbasiert und die dritte nicht, was den entscheidenden Unterschied ausmacht –
eine positionsbasierte Seite liest erneut, indem sie vom Anfang an zählt, sodass Zeilen, die während des
Paginierens geschrieben werden, die Bedeutung von „Zeile 20“ verschieben.

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

`limit` muss eine ganze Zahl zwischen 1 und 1000 sein. Ein größerer Wert – oder eine Null, ein negativer
Wert oder ein Bruch – wird mit 400 `INVALID_LIMIT` abgelehnt, anstatt begrenzt zu werden, da eine
stillschweigend kleinere Seite nicht von der letzten Seite unterschieden werden kann. Um über diese
Obergrenze hinaus zu lesen, durchlaufen Sie die Seiten mit `iterate()` oder `findAll()`.

#### Cursor-Paginierung

Jede Listenantwort enthält ein `meta.nextCursor`, solange eine weitere Seite vorhanden ist.
Übergeben Sie diesen als `after` zurück, und die nächste Seite setzt **strikt nach der zuletzt ausgelieferten Zeile**
an, anstatt bei einer Zeilen*anzahl*, die durch gleichzeitige Schreibvorgänge bereits verschoben wurde:

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

Der Cursor ist **opak**. Er kodiert die Sortierschlüssel *und* die Werte der letzten Zeile für diese
Schlüssel, sodass er nur die Auflistung fortsetzen kann, aus der er stammt: Behalten Sie `orderBy` über
alle Seiten hinweg identisch bei, andernfalls wird die Anfrage mit `CURSOR_ORDER_MISMATCH` abgelehnt,
anstatt in einer Reihenfolge zu suchen, die niemand angefordert hat. Eine Anfrage, die überhaupt kein
`orderBy` angibt, übernimmt die Sortierung des Cursors, sodass Sie ihn direkt zurückgeben können, ohne
die Sortierung erneut anzugeben.

Parsen Sie ihn nicht und erstellen Sie keinen eigenen: Die Kodierung existiert, um geändert werden zu
können, und alles andere führt zu `INVALID_CURSOR`.

Aus der Funktionsweise eines Cursors ergeben sich drei Dinge:

- **`after` kann nicht mit `offset` oder `page` kombiniert werden** (400
  `CURSOR_WITH_OFFSET`). Beide geben an, wo die Seite beginnt, und die Berücksichtigung beider würde
  Zeilen überspringen.
- **Sortierungen über mehrere Schlüssel und null-fähige Schlüssel funktionieren beide.** Der Vergleich
  wird über jeden Schlüssel der Reihe nach aufgebaut, mit der [NULL-Platzierung](#where-nulls-sort),
  die die Sortierung deklariert hat – nicht ein einzelnes `>` auf einer Spalte.
- **Relevanz kann kein Cursor sein.** Ein `_score` wird pro Abfrage berechnet und nirgendwo gespeichert,
  und zwei Abfragen mit unterschiedlichen Suchbegriffen erzeugen Scores, die nicht auf derselben Skala
  liegen. Eine solche Auflistung enthält schlicht kein `nextCursor`; paginieren Sie diese mit `offset`.

Über HTTP ist es ein Parameter:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Welche Leseoperationen gewrappt sind und welche nicht

Zwei Formen und eine Regel: **Ein Ausschnitt ist gewrappt, eine vollständige Antwort nicht.**

| Methode | Rückgabewert | Warum |
|---------|--------------|-------|
| `find()`, `listen()` | `{ data, meta }` | Eine Seite. `meta.total` / `meta.hasMore` sind die einzige Möglichkeit zu wissen, ob noch mehr vorhanden ist |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Nichts übrig, was berichtet werden müsste – der Durchlauf ist beendet oder der Batch *sind* die Zeilen |
| `iterate()` | eine Zeile nach der anderen | Es wird überhaupt nichts materialisiert |
| `findById()`, `get()`, `create()`, `update()` | eine Zeile | Keine Liste |

`data` ist kein Wrapper, den das SDK manchmal hinzufügt und manchmal vergisst. Hier befinden sich die
Paginierungs-Metadaten, und es ist genau dann vorhanden, wenn es welche gibt.

#### Alles lesen: `iterate()` und `findAll()`

`iterate()` streamt jede Zeile, die zu einer Abfrage passt, nacheinander und ruft im Hintergrund
seitenweise Daten ab. Es sammelt sich nichts an, daher ist dies die Methode der Wahl für eine Collection,
die Sie nicht vollständig im Speicher halten können:

```typescript
for await (const order of client.data.orders.iterate({
    where: { status: ["==", "pending"] }
})) {
    await handleOrder(order);
}
```

`findAll()` ist derselbe Durchlauf, gesammelt in einem Array:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
```

Beide sind auch auf dem Fluent Builder verfügbar, wo `.limit()` zur **Seitengröße** anstelle einer
Gesamtzahl wird:

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Drei Optionen steuern den Durchlauf:

| Option | Standard | Was sie bewirkt |
|--------|----------|-----------------|
| `pageSize` | 200 | Zeilen pro Anfrage. |
| `cursor` | — | Sucht über eine Spalte, anstatt per Offset zu paginieren. Siehe unten. |
| `maxPages` | 10 000 | Obergrenze für Anfragen, damit ein Server, der nie aufhört, `hasMore` zu melden, nicht endlos läuft. |
| `maxRows` | 10 000 | Nur `findAll()`. Ein Überschreiten **wirft einen Fehler**, anstatt ein abgeschnittenes Array zurückzugeben, als wäre es das vollständige Ergebnis. Übergeben Sie `Infinity`, um dies zu deaktivieren, oder verwenden Sie `iterate()`. |

**Bevorzugen Sie `cursor`, wann immer die Collection eine eindeutige, sortierbare Spalte hat.**
Offset-Paginierung zählt Zeilen bei jeder Anfrage neu, sodass eine Zeile, die *während des Durchlaufs*
eingefügt oder gelöscht wird, das Fenster verschiebt und der Durchlauf stillschweigend Zeilen überspringt
oder wiederholt. Beim Seeking werden Zeilen strikt nach der zuletzt gesehenen angefordert, was durch
gleichzeitige Schreibvorgänge vor dem Cursor nicht verschoben werden kann:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` bedeutet hier „Seek statt Paginierung per Offset“ und gibt die Spalte an, nach der sortiert
werden soll, wenn die Abfrage dies nicht bereits definiert. Das Seeking selbst ist
[der Cursor des Servers](#cursor-pagination): Der Durchlauf gibt `meta.nextCursor` als `after` zurück
und baut keinen eigenen Vergleich auf, weshalb auch eine Sortierung über mehrere Schlüssel funktioniert –

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— und warum auch ein null-fähiger Sortierschlüssel funktioniert.

Die Sortierung muss dennoch **total** sein, was in der Praxis eindeutig bedeutet: Die Zeilen-ID
löst den finalen Gleichstand auf, sodass jede Spalte als Tie-Breaker funktioniert. Ein Durchlauf, dessen
Cursor nicht mehr voranschreitet, wirft jedoch `cursor-stalled`, anstatt in einer Endlosschleife zu
verharren. Eine Abfrage, die kein Cursor beschreiben kann (Relevanz), wirft `cursor-missing`; entfernen
Sie `cursor` und paginieren Sie per Offset.

## Siehe auch

- [Daten abfragen](/docs/sdk/querying/) – Filter, der Fluent Builder, Sortierung.
- [Aggregate & Suche](/docs/sdk/aggregates-and-search/) – Warum Relevanz keinen Cursor bestimmen kann.

---
