---
sourceHash: 3cba57377cf922df
title: Daten abfragen
sidebar_label: Daten abfragen
description: CRUD-Operationen, Fluent Query Builder, Filteroperatoren, Sortierung, Spaltenauswahl und Aggregate mit dem Rebase Client SDK.
---

## Zugriff auf Collections

Greifen Sie auf jede Collection über `client.data.<collectionName>` (camelCase, wird automatisch in snake_case umgewandelt) oder `client.data.collection<Record<string, unknown>>("slug")` (expliziter Slug) zu:

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Strikter Modus (generiertes SDK):** Wenn Sie das generierte `collectionsDictionary` an `createRebaseClient` übergeben, validiert der Data-Proxy Eigenschaftszugriffe direkt beim Zugriff. Ein Tippfehler wie `client.data.prodcuts` wirft sofort einen hilfreichen Fehler mit einem Vorschlag für den nächsten Treffer, anstatt später einen verwirrenden 404-Fehler zu erzeugen. Verwenden Sie `client.data.collection<Record<string, unknown>>("slug")`, um die Validierung für dynamische oder erst zur Laufzeit bestimmte Slugs zu umgehen.

## CRUD-Operationen

### Find (Auflisten)

```typescript
// All products (default limit: 50)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["createdAt", "desc"],
    limit: 25,
    offset: 0
});

// data is Row[] — flat rows, with the id at the top level
// meta has { total, limit, offset, hasMore }
```

### Einen Datensatz anhand der ID lesen

Zwei Methoden, weil es zwei Situationen gibt und diese unterschiedlichen Code erfordern.

`get` ist für eine Zeile gedacht, von deren Existenz Sie ausgehen – die ID stammt aus einem Link, einem Routenparameter oder einer anderen Zeile. Es gibt die Zeile zurück, sodass nachgelagert nichts eingegrenzt (narrow) werden muss, und eine fehlende Zeile ist eine Exception, auf die Sie reagieren können:

```typescript
const product = await client.data.products.get(42);
product.name;    // Row, not Row | undefined
```

```typescript
import { RebaseApiError } from "@rebasepro/client";

async function loadProduct(id: string) {
    try {
        return await client.data.products.get(id);
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

`findById` ist für eine Zeile gedacht, die berechtigterweise möglicherweise nicht existiert – ein Lookup anhand einer vom Benutzer eingegebenen ID, eine Cache-Prüfung:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
Row-Level Security macht „Keine solche Zeile“ und „Keine Leseberechtigung“ ganz bewusst zur selben Antwort: Ein 404-Fehler, der dazwischen unterscheiden würde, würde die Existenz der Zeile bestätigen.
:::

### Schreiben

`create`, `upsert`, `update`, `delete` und ihre Batch-Varianten finden Sie unter **[Daten schreiben](/docs/sdk/writing/)**, zusammen mit Feldoperationen, bedingten Schreibvorgängen und Idempotenzschlüsseln.

### Count

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Fluent Query Builder

Verketten Sie Methoden für ausdrucksstärkere Abfragen:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Verfügbare Methoden

| Methode | Beschreibung | Beispiel |
|---------|--------------|----------|
| `.where(field, op, value)` | Filterbedingung hinzufügen | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Nach einer [Relation](#querying-through-a-relation) oder einem [JSON-Pfad](#filtering-inside-json) filtern | `.where("author.name", "==", "bob")` |
| `.where(group)` | Eine [OR/AND-Gruppe](#logical-conditions-or--and) hinzufügen | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ergebnisse sortieren | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Nach einem [Aggregat über eine Relation](#sort-by-an-aggregate-over-a-relation) sortieren | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Ergebnisanzahl begrenzen | `.limit(25)` |
| `.offset(n)` | Erste N Ergebnisse überspringen | `.offset(50)` |
| `.after(cursor)` | Nach einem [Cursor](#cursor-pagination) fortsetzen | `.after(meta.nextCursor)` |
| `.fields(...columns)` | [Nur diese Spalten](#returning-fewer-columns) zurückgeben | `.fields("id", "title")` |
| `.distinct()` | Zeilen zusammenfassen, die in diesen Spalten identisch sind | `.fields("status").distinct()` |
| `.search(text)` | Textsuche – siehe [Suche](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Nearest-Neighbour-Suche über eine `vector`-Eigenschaft | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Zugehörige Zeilen laden](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Abfrage ausführen | Gibt `FindResult<M>` zurück |
| `.aggregate(params)` | [Aggregieren statt Zeilen zurückzugeben](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Jede passende Zeile streamen](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Jede passende Zeile sammeln](#reading-everything-iterate-and-findall) | Gibt `M[]` zurück |
| `.count()` | Passende Zeilen zählen | Gibt `number` zurück |
| `.listen(onUpdate, onError?)` | Echtzeit-Updates abonnieren | Gibt `unsubscribe()` zurück |

### Filteroperatoren

| Operator | Alias | Beschreibung |
|----------|-------|--------------|
| `"=="` | `"eq"` | Gleich |
| `"!="` | `"neq"` | Ungleich |
| `">"` | `"gt"` | Größer als |
| `">="` | `"gte"` | Größer als oder gleich |
| `"<"` | `"lt"` | Kleiner als |
| `"<="` | `"lte"` | Kleiner als oder gleich |
| `"in"` | | Wert im Array enthalten |
| `"not-in"` | `"nin"` | Wert nicht im Array enthalten |
| `"array-contains"` | `"cs"` | Array-Feld enthält Wert |
| `"array-contains-any"` | `"csa"` | Array-Feld enthält einen beliebigen der Werte |
| `"like"` | `"like"` | Mustervergleich unter Berücksichtigung von **Groß-/Kleinschreibung**; `%` und `_` sind die Platzhalter |
| `"ilike"` | `"ilike"` | Mustervergleich ohne Berücksichtigung von Groß-/Kleinschreibung |
| `"not-like"` | `"nlike"` | Entspricht nicht dem Muster |
| `"not-ilike"` | `"nilike"` | Entspricht nicht dem Muster (ohne Berücksichtigung von Groß-/Kleinschreibung) |
| `"is-null"` | `"isnull"` | Spalte ist `NULL`. Akzeptiert keinen Wert – was auch immer übergeben wird, wird normalisiert entfernt |
| `"is-not-null"` | `"notnull"` | Spalte ist nicht `NULL`. Akzeptiert keinen Wert |

Die Alias-Spalte ist die **Wire**-Schreibweise, die in REST-Query-Strings verwendet wird. Sie taucht niemals im Anwendungscode auf: Sowohl das SDK als auch das Admin-Panel verwenden den kanonischen Operator auf der linken Seite.

### Syntax der Where-Klausel

Der Parameter `where` in `find()` unterstützt zwei Formate:

```typescript no-verify
// 1. Tuple syntax — [operator, value] (recommended)
await client.data.products.find({
    where: {
        status: ["==", "active"],
        featured: ["==", true],
        price: [">=", 100],
        category: ["in", ["electronics", "gadgets"]],
        deleted_at: ["!=", null]
    }
});

// 2. Pre-serialized PostgREST string syntax (advanced)
await client.data.products.find({
    where: { status: "eq.published", price: "gte.100" }
});
```

> **Hinweis:** Vorab serialisierte PostgREST-Strings (Format 2) sind eine Ausweichmöglichkeit (Escape Hatch), um Filterwerte zu übergeben, die bereits im Wire-Format vorliegen. Bevorzugen Sie die Tupel-Syntax für Typsicherheit und Lesbarkeit.

## Logische Bedingungen (OR / AND / NOT)

Jedes Feld in `where` wird mit UND verknüpft. Um Bedingungen mit ODER zu verknüpfen oder eine Gruppe zu negieren, erstellen Sie eine **logische Bedingung** mit den vom SDK exportierten Hilfsfunktionen `or`, `and`, `not` und `cond`:

```typescript
import { or, and, not, cond } from "@rebasepro/client";

const { data } = await client.data.products.find({
    logical: or(
        cond("status", "==", "active"),
        and(
            cond("status", "==", "draft"),
            cond("authorId", "==", currentUserId)
        )
    )
});
```

Der Fluent Builder akzeptiert denselben Baum:

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` akzeptiert den kanonischen Operator – die linke Spalte der Tabelle [Filteroperatoren](#filter-operators). Ein Operator, den der Dialekt nicht unterstützt, führt bei der Serialisierung der Abfrage zu einem `TypeError` und nicht zu einer stillschweigend veränderten Abfrage.

### Negation

`not` negiert die **Konjunktion** seiner Bedingungen: `not(a)` ist `NOT a` und `not(a, b)` ist `NOT (a AND b)`. Gruppen können verschachtelt werden, sodass die andere Hälfte der De Morganschen Gesetze `not(or(a, b))` ist.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Es wird zu einem echten SQL `NOT (...)` kompiliert, nicht zu invertierten Operatoren. Dieser Unterschied ist nicht nur kosmetischer Natur: SQL ist dreiwertig, sodass `NOT (a AND b)` und `(NOT a) OR (NOT b)` in dem Moment nicht mehr übereinstimmen, in dem ein `NULL` im Spiel ist – und nur eine davon ist die Abfrage, die Sie geschrieben haben.

Es bedeutet auch, dass eine Negation **Zeilen einschließt, deren Spalte NULL ist** – `not(cond("status", "==", "draft"))` gibt auch Zeilen zurück, die überhaupt keinen Status haben. Das ist die Bedeutung von `NOT` und in der Regel auch das, was gewünscht ist; falls nicht, verknüpfen Sie zusätzlich ein `is-not-null` mit UND.

### Zusammenspiel mit dem Rest der Abfrage

`where`, `logical` und `search` sind drei unabhängige Gruppen, die miteinander durch UND verknüpft werden:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Es gibt keine Möglichkeit, `where` mit `logical` über ODER zu verknüpfen. Alles, was kein einfaches UND dieser drei ist, muss innerhalb eines einzigen `logical`-Baums ausgedrückt werden – verschieben Sie die Felder, die mit ODER verknüpft werden sollen, dorthin.

### Wire-Format (Übertragung)

Eine logische Gruppe wird als einzelner Query-Parameter `or=`, `and=` oder `not=` übertragen, in derselben Punkt-Syntax, die auch Feldfilter verwenden:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Pro Anfrage gilt nur einer der drei Parameter – `or` hat Vorrang vor `and`, und beide vor `not`. Verschachteln Sie eine Gruppe in einer anderen, um sie zu kombinieren.

Drei Encodings sind wissenswert, da sie bei manuell geschriebenen Query-Strings häufig falsch gemacht werden:

| Bedingung | Wire-Form | Hinweis |
|-----------|-----------|---------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` sucht nach dem vier Zeichen langen String `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` ist eine Liste, die einen leeren String enthält, was eine andere Abfrage darstellt |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | Ein [Relationspfad](#querying-through-a-relation) behält seinen Punkt |

Kommas, Klammern und Backslashes innerhalb eines Werts werden mit einem Backslash maskiert, sodass `cond("name", "==", "Doe, John")` als `name.eq.Doe\, John` übertragen wird und die Gruppe nicht aufteilt.

Gruppen können bis zu 32 Ebenen tief verschachtelt werden. Darüber hinaus wird die Anfrage mit `INVALID_LOGICAL_GROUP` abgelehnt – reduzieren Sie die Schachtelungstiefe, da `or(a,or(b,c))` äquivalent zu `or(a,b,c)` ist.

## Paginierung

Offsets, Seitenzahlen und Keyset-Cursoren haben eine eigene Seite:
[Paginierung](/docs/sdk/pagination/).

## Sortierung

```typescript
// Sort by field (format: ["field", "direction"])
const { data } = await client.data.products.find({
    orderBy: ["createdAt", "desc"]
});

// Fluent style
const { data } = await client.data.products
    .orderBy("price", "asc")
    .find();
```

Wird die Richtung weggelassen, ist der Standardwert `"asc"` – dieselbe Bedeutung wie `?orderBy=name` über HTTP, unabhängig von der zugrunde liegenden Datenbank.

### Nach mehreren Spalten sortieren

Eine Sortierung ist eine *Liste* von Schlüsseln. Der zweite Schlüssel entscheidet zwischen Zeilen, die der erste als gleich einstuft, der dritte zwischen Zeilen, bei denen die ersten beiden gleich sind – daher akzeptiert `orderBy` eine Liste von `[field, direction]`-Paaren genauso wie ein einzelnes Paar:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Im Fluent Builder wird dasselbe durch einen erneuten Aufruf von `.orderBy()` ausgedrückt. Jeder Aufruf **fügt** einen Schlüssel unter den vorherigen hinzu, anstatt sie zu ersetzen:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Jede Sortierung endet mit der Zeilen-ID in absteigender Reihenfolge, unabhängig davon, ob dies explizit angegeben wurde. Genau das macht die Sortierung *vollständig*: Ohne sie würden zwei Zeilen mit demselben Wert in beliebiger Reihenfolge von der Datenbank zurückgegeben werden, und das Paginieren über eine Sortierung, die sich zwischen zwei Durchläufen derselben Abfrage unterscheiden kann, würde einige Zeilen wiederholen und andere überspringen.

Eine mehrspaltige Sortierung lässt sich problemlos mit einem [Cursor](#cursor-pagination) paginieren: Der Vergleich wird der Reihe nach über jeden Schlüssel aufgebaut. Die einzige Sortierung, die ein Cursor nicht beschreiben kann, ist **`_score`** – siehe [Suche](/docs/backend/search). Die Relevanz wird pro Abfrage berechnet und nicht gespeichert, sodass auf der Cursor-Zeile kein Wert vorhanden ist, mit dem die nächste Seite verglichen werden könnte, und eine solche Auflistung enthält keinen `nextCursor`.

### Platzierung von NULL-Werten bei der Sortierung

Standardmäßig werden NULL-Werte **aufsteigend als Letztes und absteigend als Erstes** sortiert – dies entspricht der Postgres-eigenen Konvention. Dieser Standard führt dazu, dass jede Zeile ohne Datum ganz oben in einer „Neueste zuerst“-Liste landet, noch vor allen tatsächlichen Einträgen. Der einzige Ausweg bestand bisher in einem `is-not-null`-Filter, der diese Zeilen komplett verwarf.

Ein drittes Element im Schlüssel gibt an, wohin sie stattdessen sortiert werden:

```typescript
// Newest first, and the ones with no date at the end where they belong.
const { data } = await client.data.posts.find({
    orderBy: [["publishedAt", "desc", "last"]]
});
```

```typescript
const { data } = await client.data.posts
    .orderBy("publishedAt", "desc", "last")
    .find();
```

Über HTTP ist dies ein drittes, durch Doppelpunkt getrenntes Segment (`?orderBy=publishedAt:desc:last`) oder ein `"nulls"`-Schlüssel in der JSON-Array-Form. Alles andere als `first`/`last` führt zu einem 400-Fehler statt zu einer stillschweigend abweichenden Sortierung.

Der [Cursor](#cursor-pagination) berücksichtigt die definierte Sortierung, sodass das Paginieren über einen Nullable-Schlüssel bei beiden Platzierungen korrekt bleibt.

## Weniger Spalten zurückgeben

`fields` beschränkt einen Lesevorgang auf die angegebenen Spalten. Es handelt sich um eine Projektion auf Datenbankebene – das sind die Spalten, die tatsächlich *gelesen* werden, nicht diejenigen, die nach dem Kürzen der Antwort übrig bleiben –, sodass eine Abfrage, die zwei Felder einer breiten Zeile benötigt, nicht für den Rest bezahlen muss:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Zwei Dinge gelten immer, unabhängig von der Auswahl:

- **Der Primärschlüssel wird immer zurückgegeben.** Eine Zeile, die nicht adressiert werden kann, kann weder aktualisiert, gelöscht noch durchblättert werden – und `meta.nextCursor` wird daraus abgeleitet, sodass eine Projektion ohne ihn das Cursoring stillschweigend deaktivieren würde.
- **`excludeFromApi`-Spalten bleiben verborgen.** Das Benennen einer solchen Spalte hebt deren Ausblendung nicht auf.

Eine unbekannte Spalte führt zu einem 400-Fehler `UNKNOWN_FIELD`. Würde dies einfach als „weglassen“ interpretiert, würde ein Tippfehler wie `fields: ["titel"]` Zeilen ohne Titel zurückgeben, ohne jeden Hinweis auf die Ursache.

Eine in `include` angegebene Relation wird unabhängig davon geladen, ob sie in `fields` aufgeführt ist; um die Spalten *innerhalb* einer Relation einzuschränken, siehe [Optionen pro Relation](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` fasst Zeilen zusammen, die in den zurückgegebenen Spalten identisch sind, und ein Distinct-Lesevorgang gibt **ausschließlich** die von Ihnen angegebenen Spalten zurück – der Primärschlüssel wird, anders als bei jedem anderen Lesevorgang, aus der Projektion ausgeschlossen. Das muss so sein: Ein Surrogatschlüssel unterscheidet sich in jeder Zeile, sodass das Beibehalten des Schlüssels jede Zeile per Definition eindeutig machen würde und die Abfrage mit einem Status 200 antworten würde, ohne etwas bewirkt zu haben.

Daher ist dies nur in Kombination mit `fields` sinnvoll. Ohne diese Angabe werden alle sichtbaren Spalten einschließlich des Schlüssels angefordert, und es wird nichts zusammengefasst:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Ein Distinct-Lesevorgang adressiert keine Zeilen – es gibt keinen Schlüssel, über den sie adressiert werden könnten –, daher gibt er eine Menge von Werten zurück anstatt einer Menge von Zeilen, die aktualisiert oder gelöscht werden könnten, und er enthält keinen `nextCursor`. Er liefert zudem **kein `meta.total`**: Ein Zählen würde ein `COUNT(DISTINCT …)` erfordern, das der Treiber nicht ausführt, und die Rückgabe der reinen Zeilenanzahl würde eine andere Menge beschreiben als die gelieferte – ein vollständiges Ergebnis mit zwei Zeilen käme als `total: 8, hasMore: true` zurück, was dazu führen würde, dass ein Client endlos paginiert. `hasMore` stammt aus der Seite selbst.

Zwei Kombinationen werden abgelehnt, anstatt ein unbrauchbares Ergebnis zu liefern:

- **Eine Abfrage, die jede Zeile bewertet** – eine gewichtete Suche mit `search()` oder ein `vectorSearch()` fügt jeder Zeile ein `_score`/`_distance` hinzu, sodass niemals zwei Zeilen identisch sind und `DISTINCT` wirkungslos wäre. (Eine einfache Teilstringsuche hängt nichts an und ist problemlos möglich.)
- **Sortieren nach einer Spalte, die nicht zurückgegeben wurde.** Postgres kann einen `DISTINCT`-Lesevorgang nicht nach einem Ausdruck außerhalb der SELECT-Liste sortieren; die Anfrage schlägt mit einem 400 `DISTINCT_ORDER_BY_NOT_SELECTED` fehl, anstatt einen 500-Fehler mit SQL-Code zu werfen, den Sie nie geschrieben haben.

Über HTTP: `?fields=status&distinct=true`.

## Aggregate

`aggregate()` aggregiert die übereinstimmenden Zeilen, anstatt sie zurückzugeben – `count`, `sum`, `avg`, `min`, `max`, optional gruppiert:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

Die Filter des Builders werden übernommen, was üblicherweise die kürzere Schreibweise ist:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Ergebnisschlüssel werden **abgeleitet**, nicht frei gewählt: `sum(total)` wird als `sum_total` zurückgegeben, ein einfaches `count()` als `count`. Eine freie Benennung würde erfordern zu prüfen, dass der Name nicht gleichzeitig ein `groupBy`-Feld ist – eine Regel, die kaum jemand erwarten würde, und ein stillschweigend überschriebener Wert, wenn dies ungeprüft bliebe.

`limit` begrenzt die Anzahl der **Gruppen** (eine Gruppierung nach einer Spalte mit hoher Kardinalität entspräche dem gesamten Inhalt einer Tabelle in einer einzigen Antwort) und wird ohne `groupBy` ignoriert, da ein ungruppiertes Aggregat aus genau einer Zeile besteht. `orderBy`, `include` und Paginierung sind hier nicht anwendbar: Ein Aggregat hat keine Zeilen zum Sortieren, keine Relationen zum Laden und keine Seite zum Fortsetzen.

Der eigentliche Sinn besteht darin, Zeilen nicht erst abrufen zu müssen, um sie anschließend zu aggregieren. „Umsatz nach Status“ über eine Million Bestellungen ist hier eine einzige Abfrage mit einer Zeile pro Status – anderswo hingegen ein `findAll()` samt Schleife, was bei einem `limit` falsch und ohne ein solches nicht tragbar ist. Die Ausführung erfolgt über denselben anforderungsbezogenen Handle wie jeder andere Lesevorgang, sodass Row-Level Security auch für die aggregierten Zeilen gilt.

Über HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

JSON-Filterung, Volltextsuche und Vektorsuche haben eine eigene Seite:
[Aggregate und Suche](/docs/sdk/aggregates-and-search/).

Das Lesen verknüpfter Entitäten – `include` sowie die Accessoren zur Abfrage über Relationen – hat eine eigene Seite: [Relationen abfragen](/docs/sdk/relations/).

## Eigene Endpunkte (Custom Endpoints)

Rufen Sie benutzerdefinierte Server-Endpunkte auf, die über das Functions-System registriert wurden:

```typescript
// Using client.functions.invoke()
const result = await client.functions.invoke<{ summary: string }>(
    "generate-summary",
    { articleId: 42 }
);

// With options
const result = await client.functions.invoke<{ status: string }>(
    "process-order",
    { orderId: 123 },
    { method: "POST", path: "status/check" }
);

// Shorthand via client.call()
const result = await client.call<{ summary: string }>(
    "functions/generate-summary",
    { articleId: 42 }
);
```

Beide geben **den Response-Body der Funktion unverändert (verbatim)** zurück. Keiner der Aufrufe greift auf einen internen `data`-Schlüssel zu; gibt eine Funktion also `{ data: [...] }` zurück, erhalten Sie genau dieses Objekt und greifen selbst auf `.data` zu.

`call()` erwartet einen vollständigen Pfad und führt immer einen POST-Request aus; `invoke()` erwartet einen Funktionsnamen und kann eine HTTP-Methode, einen Unterpfad und Header entgegennehmen. Verwenden Sie `invoke()`, es sei denn, Sie rufen etwas auf, das keine Funktion ist.

## Nächste Schritte

- **[Authentifizierung](/docs/sdk/authentication)** — Anmelden, Registrieren, OAuth, Sitzungen
- **[Echtzeit-Abonnements](/docs/sdk/realtime)** — Live-Daten über WebSockets
- **[Speicher & Dateien](/docs/sdk/storage)** — Dateien hochladen, herunterladen und verwalten
- **[Relationen](/docs/collections/relations)** — Beziehungen zwischen Collections definieren

---
