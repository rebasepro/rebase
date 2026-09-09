---
sourceHash: 72b63305690d555c
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

> **Strict Mode (generiertes SDK):** Wenn Sie das generierte `collectionsDictionary` an `createRebaseClient` übergeben, validiert der Daten-Proxy Eigenschaftszugriffe direkt beim Zugriff. Ein Tippfehler wie `client.data.prodcuts` wirft sofort einen hilfreichen Fehler mit einem Vorschlag für den wahrscheinlichsten Treffer, anstatt später einen verwirrenden 404-Fehler zu erzeugen. Verwenden Sie `client.data.collection<Record<string, unknown>>("slug")`, um die Validierung für dynamische oder zur Laufzeit ermittelte Slugs zu umgehen.

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

### Einen Datensatz per ID lesen

Zwei Methoden, da es zwei Situationen gibt, die unterschiedlichen Code erfordern.

`get` ist für eine Zeile gedacht, von der Sie erwarten, dass sie existiert – die ID stammt von einem Link, einem Routenparameter oder einer anderen Zeile. Es gibt die Zeile direkt zurück, sodass nachgelagert keine Typverfeinerung erforderlich ist, und eine fehlende Zeile ist eine Ausnahme, auf die Sie verzweigen können:

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

`findById` ist für eine Zeile gedacht, die berechtigterweise fehlen darf – eine Suche nach einer von einem Benutzer eingegebenen ID, eine Cache-Abfrage:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
Row-Level-Security macht "keine solche Zeile" und "nicht Ihre Berechtigung zum Lesen" ganz bewusst zur selben Antwort: Ein 404-Fehler, der zwischen beiden unterscheiden würde, würde die Existenz der Zeile bestätigen.
:::

### Schreiben

`create`, `upsert`, `update`, `delete` und deren Batch-Formen finden Sie unter **[Daten schreiben](/docs/sdk/writing/)**, zusammen mit Feldoperationen, bedingten Schreibvorgängen und Idempotenz-Schlüsseln.

### Count (Zählen)

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
|---------|-------------|----------|
| `.where(field, op, value)` | Filterbedingung hinzufügen | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Auf einem [Relations-](#querying-through-a-relation) oder [JSON-Pfad](#filtering-inside-json) filtern | `.where("author.name", "==", "bob")` |
| `.where(group)` | Eine [OR/AND-Gruppe](#logical-conditions-or--and) hinzufügen | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ergebnisse sortieren | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Nach einem [Aggregat über eine Relation](#sort-by-an-aggregate-over-a-relation) sortieren | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Anzahl der Ergebnisse begrenzen | `.limit(25)` |
| `.offset(n)` | Erste N Ergebnisse überspringen | `.offset(50)` |
| `.after(cursor)` | Nach einem [Cursor](#cursor-pagination) fortfahren | `.after(meta.nextCursor)` |
| `.fields(...columns)` | [Nur diese Spalten](#returning-fewer-columns) zurückgeben | `.fields("id", "title")` |
| `.distinct()` | Zeilen zusammenfassen, die über diese Spalten hinweg identisch sind | `.fields("status").distinct()` |
| `.search(text)` | Textsuche – siehe [Suche](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Nearest-Neighbour-Suche über eine `vector`-Eigenschaft | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Verknüpfte Zeilen laden](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Führt die Abfrage aus | Gibt `FindResult<M>` zurück |
| `.aggregate(params)` | [Reduzieren statt Zeilen zurückgeben](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Jede passende Zeile streamen](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Jede passende Zeile sammeln](#reading-everything-iterate-and-findall) | Gibt `M[]` zurück |
| `.count()` | Zählt die passenden Zeilen | Gibt `number` zurück |
| `.listen(onUpdate, onError?)` | Echtzeit-Aktualisierungen abonnieren | Gibt `unsubscribe()` zurück |

### Filteroperatoren

| Operator | Alias | Beschreibung |
|----------|-------|-------------|
| `"=="` | `"eq"` | Gleich |
| `"!="` | `"neq"` | Ungleich |
| `">"` | `"gt"` | Größer als |
| `">="` | `"gte"` | Größer als oder gleich |
| `"<"` | `"lt"` | Kleiner als |
| `"<="` | `"lte"` | Kleiner als oder gleich |
| `"in"` | | Wert im Array enthalten |
| `"not-in"` | `"nin"` | Wert nicht im Array enthalten |
| `"array-contains"` | `"cs"` | Array-Feld enthält Wert |
| `"array-contains-any"` | `"csa"` | Array-Feld enthält einen der Werte |
| `"like"` | `"like"` | Mustervergleich unter Berücksichtigung der Groß-/Kleinschreibung (case-**sensitive**); `%` und `_` sind Platzhalter |
| `"ilike"` | `"ilike"` | Mustervergleich ohne Berücksichtigung der Groß-/Kleinschreibung (case-insensitive) |
| `"not-like"` | `"nlike"` | Entspricht nicht dem Muster |
| `"not-ilike"` | `"nilike"` | Entspricht nicht dem Muster (case-insensitive) |
| `"is-null"` | `"isnull"` | Spalte ist `NULL`. Nimmt keinen Wert an – was auch immer Sie übergeben, wird ignoriert/normalisiert |
| `"is-not-null"` | `"notnull"` | Spalte ist nicht `NULL`. Nimmt keinen Wert an |

Die Spalte "Alias" ist die Schreibweise auf **Übertragungsebene (Wire)**, die in REST-Query-Strings verwendet wird. Sie taucht niemals im Anwendungscode auf: Sowohl das SDK als auch das Admin-Panel verwenden den kanonischen Operator auf der linken Seite.

### Where-Klausel-Syntaxen

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

> **Hinweis:** Vor-serialisierte PostgREST-Strings (Format 2) sind eine Ausweichmöglichkeit (Escape Hatch), um Filterwerte zu übergeben, die bereits im Wire-Format vorliegen. Bevorzugen Sie die Tupel-Syntax für Typsicherheit und Lesbarkeit.

## Logische Bedingungen (OR / AND / NOT)

Jedes Feld in `where` wird mit UND verknüpft (AND-Verknüpfung). Um Bedingungen mit ODER (OR) zu verknüpfen oder eine Gruppe zu negieren, erstellen Sie eine **logische Bedingung** mit den Hilfsfunktionen `or`, `and`, `not` und `cond`, die das SDK exportiert:

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

`cond` übernimmt den kanonischen Operator – die linke Spalte der Tabelle [Filteroperatoren](#filter-operators). Ein Operator, den der Dialekt nicht unterstützt, führt bei der Serialisierung der Abfrage zu einem `TypeError` und nicht zu einer stillschweigend veränderten Abfrage.

### Negation

`not` negiert die **Konjunktion** seiner Bedingungen: `not(a)` ist `NOT a`, und `not(a, b)` ist `NOT (a AND b)`. Gruppen lassen sich verschachteln, De Morgans andere Hälfte lautet also `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Dies wird zu einem echten SQL `NOT (...)` kompiliert, nicht zu invertierten Operatoren. Dieser Unterschied ist nicht nur kosmetischer Natur: SQL ist dreiwertig, daher stimmen `NOT (a AND b)` und `(NOT a) OR (NOT b)` in dem Moment nicht mehr überein, in dem ein `NULL` involviert ist – und nur einer von beiden entspricht der Abfrage, die Sie geschrieben haben.

Das bedeutet auch, dass eine Negation **Zeilen einschließt, deren Spalte NULL ist** – `not(cond("status", "==", "draft"))` gibt Zeilen zurück, die überhaupt keinen Status haben. Genau das bedeutet `NOT`, und meistens ist es das, was Sie wollen; falls nicht, verknüpfen Sie ein `is-not-null` per AND daneben.

### Wie es sich mit dem Rest der Abfrage zusammensetzt

`where`, `logical` und `search` sind drei unabhängige Gruppen, die untereinander mit AND verknüpft sind:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Es gibt keine Möglichkeit, `where` mit `logical` über OR zu verknüpfen. Alles, was kein einfaches AND dieser drei ist, muss innerhalb eines einzelnen `logical`-Baums ausgedrückt werden – verschieben Sie die Felder, die Sie mit OR verknüpfen möchten, dorthin.

### Auf der Leitung (Wire Format)

Eine logische Gruppe wird als einzelner Query-Parameter `or=`, `and=` oder `not=` übertragen, und zwar in derselben Punkt-Syntax, die auch Feldfilter verwenden:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Pro Anfrage greift nur einer der drei Parameter – `or` hat Vorrang vor `and`, und beide vor `not`. Verschachteln Sie eine Gruppe in einer anderen, um sie zu kombinieren.

Drei Encodings sind wissenswert, da sie diejenigen sind, bei denen ein manuell geschriebener Query-String oft falsch liegt:

| Bedingung | Wire-Form | Hinweis |
|-----------|-----------|---------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` ist eine Suche nach dem vierstelligen String `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` ist eine Liste, die einen leeren String enthält, was eine andere Abfrage darstellt |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | ein [Relationspfad](#querying-through-a-relation) behält seinen Punkt |

Kommata, Klammern und Backslashes innerhalb eines Werts werden mit einem Backslash maskiert, sodass `cond("name", "==", "Doe, John")` als `name.eq.Doe\, John` übertragen wird und die Gruppe nicht aufspaltet.

Gruppen dürfen bis zu 32 Ebenen tief verschachtelt sein. Darüber hinaus wird die Anfrage mit `INVALID_LOGICAL_GROUP` abgelehnt – flachen Sie sie ab, da `or(a,or(b,c))` identisch ist mit `or(a,b,c)`.

## Paginierung

Offsets, Seitennummern und Keyset-Cursoren haben ihre eigene Seite:
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

Eine weggelassene Richtung entspricht `"asc"` – dieselbe Bedeutung wie `?orderBy=name` über HTTP, unabhängig von der zugrunde liegenden Datenbank.

### Sortieren nach mehr als einer Spalte

Eine Sortierung ist eine *Liste* von Schlüsseln. Der zweite entscheidet zwischen Zeilen, die der erste als gleich einstuft, der dritte zwischen Zeilen, bei denen die ersten beiden übereinstimmen – daher akzeptiert `orderBy` eine Liste von `[Feld, Richtung]`-Paaren genauso einfach wie ein einzelnes Paar:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Der Fluent Builder drückt dasselbe aus, indem `.orderBy()` erneut aufgerufen wird. Jeder Aufruf **fügt** einen Schlüssel unter den vorherigen hinzu, anstatt sie zu ersetzen:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Jede Sortierung endet auf der Zeilen-ID (absteigend), unabhängig davon, ob Sie dies angegeben haben oder nicht. Das ist es, was die Sortierung *total* macht: Ohne dies werden zwei Zeilen mit demselben Wert in beliebiger Reihenfolge zurückgegeben, wie es der Datenbank gefällt. Das Paging über eine Reihenfolge, die sich zwischen zwei Durchläufen derselben Abfrage unterscheiden kann, wiederholt einige Zeilen und überspringt andere.

Eine mehrspaltige Sortierung lässt sich problemlos mit einem [Cursor](#cursor-pagination) paginieren: Der Vergleich wird über jeden Schlüssel der Reihe nach aufgebaut. Die einzige Sortierung, die ein Cursor nicht beschreiben kann, ist **`_score`** – siehe [Suche](/docs/backend/search). Die Relevanz wird pro Abfrage berechnet und nicht gespeichert, sodass auf der Cursor-Zeile kein Wert vorhanden ist, mit dem die nächste Seite verglichen werden könnte, und eine solche Auflistung enthält keinen `nextCursor`.

### Wo NULL-Werte einsortiert werden

Standardmäßig werden NULL-Werte **aufsteigend als Letztes und absteigend als Erstes** sortiert – die Konvention von Postgres selbst. Dieser Standard führt dazu, dass jede Zeile ohne Datum ganz oben in einer "Neueste zuerst"-Liste landet, noch vor allen echten Daten. Der einzige Ausweg war bisher ein `is-not-null`-Filter, der diese Zeilen vollständig verworfen hat.

Ein drittes Element im Schlüssel gibt an, wohin sie stattdessen gehören:

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

Über HTTP ist es ein drittes Doppelpunkt-Segment, `?orderBy=publishedAt:desc:last`, oder ein `"nulls"`-Schlüssel in der JSON-Array-Form. Alles andere als `first`/`last` führt zu einem 400-Fehler anstelle einer stillschweigend geänderten Reihenfolge.

Der [Cursor](#cursor-pagination) berücksichtigt die deklarierte Sortierung, sodass das Paging über einen nullbaren Schlüssel bei beiden Platzierungen korrekt bleibt.

## Weniger Spalten zurückgeben

`fields` beschränkt einen Lesevorgang auf die von Ihnen benannten Spalten. Es handelt sich um eine Projektion auf Datenbankebene – das sind die Spalten, die tatsächlich *gelesen* werden, nicht diejenigen, die nach dem Zurechtschneiden der Antwort übrig bleiben –, sodass eine Abfrage, die zwei Felder einer breiten Zeile benötigt, nicht für den Rest bezahlen muss:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Zwei Dinge gelten immer, unabhängig davon, was Sie angeben:

- **Der Primärschlüssel wird immer zurückgegeben.** Eine Zeile, die nicht adressiert werden kann, kann nicht aktualisiert, gelöscht oder überblättert werden – und `meta.nextCursor` wird daraus abgeleitet, sodass eine Projektion ohne ihn das Paging stillschweigend deaktivieren würde.
- **`excludeFromApi`-Spalten bleiben verborgen.** Die Benennung einer solchen Spalte hebt deren Ausblendung nicht auf.

Eine unbekannte Spalte führt zu einem 400 `UNKNOWN_FIELD`. Würde dies als "weglassen" interpretiert, würde ein falsch geschriebenes `fields: ["titel"]` Zeilen ohne Titel und ohne Hinweis auf den Grund zurückgeben.

Eine in `include` angegebene Relation wird geladen, unabhängig davon, ob sie in `fields` vorkommt; um die Spalten *innerhalb* einer Relation einzugrenzen, siehe [Optionen pro Relation](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

<span class="since-badge" data-since="0.20">Seit 0.20</span>

`distinct` fasst Zeilen zusammen, die über die zurückgegebenen Spalten hinweg identisch sind, und ein Distinct-Lesevorgang gibt **nur** die von Ihnen benannten Spalten zurück – der Primärschlüssel wird im Gegensatz zu jedem anderen Lesevorgang aus der Projektion weggelassen. Das muss so sein: Ein Surrogatschlüssel unterscheidet sich in jeder Zeile, sodass seine Beibehaltung jede Zeile per Definition eindeutig machen würde und die Abfrage mit einem Status 200 antworten würde, ohne etwas bewirkt zu haben.

Dadurch ist es nur zusammen mit `fields` sinnvoll. Ohne dieses fordern Sie jede sichtbare Spalte an, einschließlich des Schlüssels, und nichts wird zusammengefasst:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Ein Distinct-Lesevorgang adressiert keine Zeilen – es gibt keinen Schlüssel, über den sie adressiert werden könnten –, daher gibt er eine Menge von Werten zurück und nicht eine Menge von Zeilen zum Aktualisieren oder Löschen, und er enthält keinen `nextCursor`. Er meldet auch **kein `meta.total`**: Das Zählen würde ein `COUNT(DISTINCT …)` erfordern, das der Treiber nicht absetzt, und das Melden der Zeilenanzahl würde stattdessen eine andere Menge beschreiben als die ausgelieferte – ein vollständiges Zwei-Zeilen-Ergebnis kam als `total: 8, hasMore: true` zurück, was dazu führt, dass ein Client endlos weitersucht. `hasMore` stammt von der Seite selbst.

Zwei Kombinationen werden abgelehnt, anstatt nutzlose Antworten zu liefern:

- **Eine Abfrage, die jede Zeile bewertet** – ein geranktes `search()` oder ein `vectorSearch()` hängt einen `_score`/`_distance` pro Zeile an, sodass niemals zwei Zeilen gleich sind und `DISTINCT` keine Wirkung hätte. (Eine einfache Teilstring-Suche fügt nichts an und funktioniert problemlos.)
- **Sortieren nach einer Spalte, die Sie nicht zurückgegeben haben.** Postgres kann einen `DISTINCT`-Lesevorgang nicht nach einem Ausdruck ordnen, der außerhalb der Select-Liste liegt; die Anfrage führt zu einem 400 `DISTINCT_ORDER_BY_NOT_SELECTED` statt zu einem 500-Fehler, der SQL zitiert, das Sie nie geschrieben haben.

Über HTTP: `?fields=status&distinct=true`.

## Aggregate

`aggregate()` reduziert die passenden Zeilen, anstatt sie zurückzugeben – `count`, `sum`, `avg`, `min`, `max`, optional gruppiert:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

Die Filter des Builders werden übernommen, was normalerweise die kürzere Schreibweise ist:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Ergebnisschlüssel werden **abgeleitet**, nicht frei gewählt: `sum(total)` wird als `sum_total` zurückgegeben, ein einfaches `count()` als `count`. Ihnen die Benennung zu überlassen würde bedeuten, prüfen zu müssen, dass der Name nicht gleichzeitig ein `groupBy`-Feld ist – eine Regel, die niemand erraten würde, und ein stillschweigend überschriebener Wert, bliebe dies ungeprüft.

`limit` begrenzt die Anzahl der **Gruppen** (die Gruppierung nach einer Spalte mit hoher Kardinalität entspricht einer ganzen Tabelle voller Zeilen in einer einzigen Antwort) und wird ohne ein `groupBy` ignoriert, da ein ungruppiertes Aggregat genau eine Zeile ist. `orderBy`, `include` und die Paginierung greifen nicht: Ein Aggregat hat keine Zeilen zum Sortieren, keine Relationen zum Laden und keine Seite zum Fortsetzen.

Der ganze Sinn besteht darin, keine Zeilen abzurufen, nur um sie zu reduzieren. "Umsatz nach Status" über eine Million Bestellungen ist hier eine Abfrage und eine Zeile pro Status, während es überall sonst ein `findAll()` plus eine Schleife wäre – was unter einem `limit` falsch und ohne eines unbezahlbar ist. Es läuft über dasselbe Request-Scoped-Handle wie jeder andere Lesevorgang, sodass Row-Level-Security auf die aggregierten Zeilen angewendet wird.

Über HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

JSON-Filterung, Volltextsuche und Vektorsuche haben eine eigene Seite:
[Aggregate und Suche](/docs/sdk/aggregates-and-search/).

Das Lesen verknüpfter Entitäten – `include` und die Accessoren, die über eine Relation abfragen – hat eine eigene Seite: [Relationen abfragen](/docs/sdk/relations/).

## Benutzerdefinierte Endpunkte

Rufen Sie benutzerdefinierte Server-Endpunkte auf, die über das Funktionssystem registriert wurden:

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

Beide geben **den Antwort-Body der Funktion unverändert zurück**. Keines von beiden greift hinein, um nach einem `data`-Schlüssel zu suchen. Eine Funktion, die mit `{ data: [...] }` antwortet, gibt Ihnen dieses Objekt zurück und Sie lesen `.data` selbst aus.

`call()` nimmt einen vollständigen Pfad entgegen und verwendet immer POST; `invoke()` nimmt einen Funktionsnamen entgegen und kann eine Methode, einen Unterpfad und Header akzeptieren. Verwenden Sie `invoke()`, es sei denn, Sie rufen etwas auf, das keine Funktion ist.

## Nächste Schritte

- **[Authentifizierung](/docs/sdk/authentication)** — Anmelden, Registrieren, OAuth, Sitzungen
- **[Echtzeit-Abonnements](/docs/sdk/realtime)** — Live-Daten mit WebSockets
- **[Speicher & Dateien](/docs/sdk/storage)** — Dateien hochladen, herunterladen und verwalten
- **[Relationen](/docs/collections/relations)** — Relationen zwischen Collections definieren

---
