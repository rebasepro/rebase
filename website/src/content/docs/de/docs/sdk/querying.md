---
sourceHash: 6d40635c3d2f94ea
title: Daten abfragen
sidebar_label: Daten abfragen
description: CRUD-Operationen, Fluent Query Builder, Filteroperatoren, Sortierung, Spaltenauswahl und Aggregate mit dem Rebase Client SDK.
---

## Zugriff auf Collections

Greifen Sie über `client.data.<collectionName>` (camelCase, automatisch in snake_case umgewandelt) oder `client.data.collection<Record<string, unknown>>("slug")` (expliziter Slug) auf jede Collection zu:

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Strikter Modus (generiertes SDK):** Wenn Sie das generierte `collectionsDictionary` an `createRebaseClient` übergeben, validiert der Daten-Proxy Eigenschaftszugriffe direkt beim Zugriff. Ein Tippfehler wie `client.data.prodcuts` wirft sofort einen hilfreichen Fehler mit einem Vorschlag für den wahrscheinlichsten Treffer, anstatt später einen verwirrenden 404-Fehler zu erzeugen. Verwenden Sie `client.data.collection<Record<string, unknown>>("slug")`, um die Validierung für dynamische oder zur Laufzeit ermittelte Slugs zu umgehen.

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

### Einzelnen Datensatz per ID lesen

Zwei Methoden, da es zwei Situationen gibt und diese unterschiedlichen Code erfordern.

`get` ist für eine Zeile gedacht, von deren Existenz Sie ausgehen – die ID stammt aus einem Link, einem Routenparameter oder einer anderen Zeile. Es gibt die Zeile zurück, sodass im weiteren Verlauf keine Typeingrenzung nötig ist, und eine fehlende Zeile ist eine Ausnahme, auf die Sie reagieren können:

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

`findById` ist für eine Zeile gedacht, die möglicherweise berechtigterweise nicht existiert – ein Lookup anhand einer vom Benutzer eingegebenen ID oder eine Cache-Prüfung:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
Row-Level-Security sorgt dafür, dass „Zeile existiert nicht“ und „keine Leseberechtigung“ bewusst dieselbe Antwort liefern: Ein 404-Fehler, der dazwischen unterscheidet, würde die Existenz der Zeile bestätigen.
:::

### Schreiben

`create`, `upsert`, `update`, `delete` und ihre Batch-Formen finden Sie unter **[Daten schreiben](/docs/sdk/writing/)**, zusammen mit Feldoperationen, bedingten Schreibvorgängen und Idempotenzschlüsseln.

### Anzahl zählen

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
| `.where(path, op, value)` | Nach einem [Relations-](#querying-through-a-relation) oder [JSON-](#filtering-inside-json)Pfad filtern | `.where("author.name", "==", "bob")` |
| `.where(group)` | Eine [OR/AND-Gruppe](#logical-conditions-or--and) hinzufügen | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ergebnisse sortieren | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Nach einem [Aggregat über eine Relation](#sort-by-an-aggregate-over-a-relation) sortieren | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Anzahl der Ergebnisse begrenzen | `.limit(25)` |
| `.offset(n)` | Erste N Ergebnisse überspringen | `.offset(50)` |
| `.after(cursor)` | Nach einem [Cursor](#cursor-pagination) fortsetzen | `.after(meta.nextCursor)` |
| `.fields(...columns)` | [Nur diese Spalten](#returning-fewer-columns) zurückgeben | `.fields("id", "title")` |
| `.distinct()` | Zeilen zusammenführen, die in diesen Spalten identisch sind | `.fields("status").distinct()` |
| `.search(text)` | Textsuche – siehe [Suche](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Nächste-Nachbarn-Suche über eine `vector`-Eigenschaft | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Zugehörige Zeilen laden](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Abfrage ausführen | Gibt `FindResult<M>` zurück |
| `.aggregate(params)` | [Aggregieren statt Zeilen zurückgeben](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Jede übereinstimmende Zeile streamen](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Alle übereinstimmenden Zeilen sammeln](#reading-everything-iterate-and-findall) | Gibt `M[]` zurück |
| `.count()` | Übereinstimmende Zeilen zählen | Gibt `number` zurück |
| `.listen(onUpdate, onError?)` | Echtzeit-Aktualisierungen abonnieren | Gibt `unsubscribe()` zurück |

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
| `"like"` | `"like"` | Musterabgleich mit Berücksichtigung der Groß-/**Kleinschreibung**; `%` und `_` sind Platzhalter |
| `"ilike"` | `"ilike"` | Musterabgleich ohne Berücksichtigung der Groß-/Kleinschreibung |
| `"not-like"` | `"nlike"` | Entspricht nicht dem Muster |
| `"not-ilike"` | `"nilike"` | Entspricht nicht dem Muster (ohne Berücksichtigung der Groß-/Kleinschreibung) |
| `"is-null"` | `"isnull"` | Spalte ist `NULL`. Erfordert keinen Wert – was auch immer übergeben wird, wird verworfen |
| `"is-not-null"` | `"notnull"` | Spalte ist nicht `NULL`. Erfordert keinen Wert |

Die Alias-Spalte zeigt die **Netzwerk**-Schreibweise, die in REST-Query-Strings verwendet wird. Sie erscheint nie im Anwendungscode: Sowohl das SDK als auch das Admin-Panel verwenden den kanonischen Operator auf der linken Seite.

### Where-Klausel-Syntaxen

Der `where`-Parameter in `find()` unterstützt zwei Formate:

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

Jedes Feld in `where` wird mit AND verknüpft. Um Bedingungen mit OR zu verknüpfen oder eine Gruppe zu negieren, erstellen Sie eine **logische Bedingung** mit den Hilfsfunktionen `or`, `and`, `not` und `cond`, die das SDK exportiert:

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

Der Fluent Builder akzeptiert dieselbe Baumstruktur:

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` erwartet den kanonischen Operator – die linke Spalte der Tabelle [Filteroperatoren](#filter-operators). Ein Operator, den der Dialekt nicht unterstützt, führt bei der Serialisierung der Abfrage zu einem `TypeError` und nicht zu einer stillschweigend abweichenden Abfrage.

### Negierung

`not` negiert die **Konjunktion** seiner Bedingungen: `not(a)` ist `NOT a`, und `not(a, b)` ist `NOT (a AND b)`. Gruppen lassen sich verschachteln, die andere De-Morgansche Regel lautet also `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Dies wird zu einem echten SQL-`NOT (...)` kompiliert, nicht zu invertierten Operatoren. Dieser Unterschied ist nicht nur kosmetischer Natur: SQL ist dreiwertig, daher stimmen `NOT (a AND b)` und `(NOT a) OR (NOT b)` nicht mehr überein, sobald ein `NULL`-Wert im Spiel ist – und nur eine davon entspricht der Abfrage, die Sie geschrieben haben.

Das bedeutet auch, dass eine Negierung **Zeilen einschließt, deren Spalte NULL ist** – `not(cond("status", "==", "draft"))` liefert auch Zeilen zurück, die überhaupt keinen Status haben. Das ist die Bedeutung von `NOT` und in der Regel auch das gewünschte Verhalten; falls nicht, verknüpfen Sie es per AND mit einem `is-not-null`.

### Zusammenspiel mit dem Rest der Abfrage

`where`, `logical` und `search` sind drei unabhängige Gruppen, die per AND miteinander verknüpft werden:

```
(where-Felder, mit AND verknüpft)  AND  (logische Gruppe)  AND  (search)
```

Es gibt keine Möglichkeit, `where` mit `logical` per OR zu verknüpfen. Alles, was kein einfaches AND dieser drei Teile ist, muss innerhalb eines einzigen `logical`-Baums ausgedrückt werden – verschieben Sie die Felder, die per OR verknüpft werden sollen, dorthin.

### Übertragung ("On the wire")

Eine logische Gruppe wird als einzelner Query-Parameter `or=`, `and=` oder `not=` übertragen, in derselben Punkt-Syntax, die auch die Feldfilter verwenden:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Pro Anfrage greift nur einer der drei Parameter – `or` hat Vorrang vor `and`, und beide vor `not`. Verschachteln Sie Gruppen ineinander, um sie zu kombinieren.

Drei Kodierungen sollte man kennen, da bei ihnen in manuell erstellten Query-Strings häufig Fehler passieren:

| Bedingung | Wire-Format | Hinweis |
|-----------|-------------|---------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` ist eine Suche nach der vier Zeichen langen Zeichenkette `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` ist eine Liste, die einen leeren String enthält, was eine andere Abfrage darstellt |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | ein [Relationspfad](#querying-through-a-relation) behält seinen Punkt |

Kommata, Klammern und Backslashes innerhalb eines Werts werden mit einem Backslash maskiert, sodass `cond("name", "==", "Doe, John")` als `name.eq.Doe\, John` übertragen wird und die Gruppe nicht aufteilt.

Gruppen können bis zu 32 Ebenen tief verschachtelt werden. Darüber hinaus wird die Anfrage mit `INVALID_LOGICAL_GROUP` abgelehnt – flachen Sie die Struktur ab, da `or(a,or(b,c))` äquivalent zu `or(a,b,c)` ist.

## Paginierung

Offsets, Seitennummern und Keyset-Cursors haben eine eigene Seite: [Paginierung](/docs/sdk/pagination/).

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

Wird die Richtung weggelassen, gilt `"asc"` – dieselbe Bedeutung, die `?orderBy=name` über HTTP hat, unabhängig von der zugrunde liegenden Datenbank.

### Sortierung nach mehreren Spalten

Eine Sortierung ist eine *Liste* von Schlüsseln. Der zweite entscheidet bei Zeilen, die der erste als gleich einstuft, der dritte bei Zeilen, bei denen die ersten beiden gleich sind – daher akzeptiert `orderBy` ebenso eine Liste von `[field, direction]`-Paaren wie ein einzelnes Paar:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Der Fluent Builder drückt dasselbe durch wiederholtes Aufrufen von `.orderBy()` aus. Jeder Aufruf **fügt** einen Schlüssel unter den vorherigen hinzu, anstatt sie zu ersetzen:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Jede Sortierung endet mit der Zeilen-ID in absteigender Reihenfolge, unabhängig davon, ob dies explizit angegeben wurde. Das macht die Sortierung *vollständig* (total): Ohne dies würden zwei Zeilen mit demselben Wert in beliebiger Reihenfolge von der Datenbank zurückgegeben werden. Ein Paginieren über eine Sortierung, die sich zwischen zwei Durchläufen derselben Abfrage ändern kann, würde dazu führen, dass manche Zeilen wiederholt und andere übersprungen werden.

Eine mehrspaltige Sortierung funktioniert problemlos mit einem [Cursor](#cursor-pagination): Der Vergleich wird über jeden Schlüssel der Reihe nach aufgebaut. Die einzige Sortierung, die ein Cursor nicht abbilden kann, ist **`_score`** – siehe [Suche](/docs/backend/search). Relevanz wird pro Abfrage berechnet und nicht gespeichert; daher gibt es auf der Cursor-Zeile keinen Wert, mit dem die nächste Seite verglichen werden könnte, und eine solche Auflistung enthält keinen `nextCursor`.

### Sortierposition von NULL-Werten

Standardmäßig werden NULL-Werte **aufsteigend zuletzt und absteigend zuerst** sortiert – die Standardkonvention von Postgres. Dieser Standardwert sorgt dafür, dass jede Zeile ohne Datum ganz oben in einer „Neueste zuerst“-Liste landet, noch vor allen tatsächlichen Werten. Der einzige Ausweg war bisher ein `is-not-null`-Filter, der diese Zeilen komplett ausschloss.

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

Über HTTP ist dies ein drittes, durch Doppelpunkt getrenntes Segment (`?orderBy=publishedAt:desc:last`) oder ein `"nulls"`-Schlüssel in der JSON-Array-Form. Jeder Wert außer `first`/`last` führt zu einem 400-Fehler anstelle einer stillschweigend abweichenden Sortierung.

Der [Cursor](#cursor-pagination) berücksichtigt die definierte Sortierung, sodass das Paginieren über einen Nullable-Schlüssel bei beiden Platzierungen korrekt bleibt.

## Weniger Spalten zurückgeben

`fields` beschränkt einen Lesevorgang auf die angegebenen Spalten. Es handelt sich um eine Projektion auf Datenbankebene – das sind die Spalten, die tatsächlich *gelesen* werden, nicht nur diejenigen, die nach dem Zurechtschneiden der Antwort übrig bleiben. Eine Abfrage, die nur zwei Felder einer breiten Zeile benötigt, erzeugt somit keinen Overhead für den Rest:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Zwei Dinge gelten immer, unabhängig von Ihrer Auswahl:

- **Der Primärschlüssel wird immer zurückgegeben.** Eine Zeile, die nicht adressiert werden kann, kann weder aktualisiert, gelöscht noch paginiert werden – und `meta.nextCursor` wird daraus abgeleitet, sodass eine Projektion ohne ihn das Cursoring stillschweigend deaktivieren würde.
- **`excludeFromApi`-Spalten bleiben verborgen.** Die Angabe einer solchen Spalte hebt deren Verborgenheit nicht auf.

Eine unbekannte Spalte führt zu einem 400-Fehler `UNKNOWN_FIELD`. Würde man dies einfach ignorieren („weglassen“), würde ein Tippfehler wie `fields: ["titel"]` Zeilen ohne Titel zurückgeben, ohne jeden Hinweis auf die Ursache.

Eine in `include` angegebene Relation wird unabhängig davon geladen, ob sie in `fields` aufgeführt ist; um die Spalten *innerhalb* einer Relation einzuschränken, siehe [Optionen pro Relation](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` fasst Zeilen zusammen, die bezüglich der zurückgegebenen Spalten identisch sind. Dies ist nur in Kombination mit `fields` sinnvoll, da der Primärschlüssel standardmäßig immer in der Projektion enthalten ist und jede Zeile somit bereits eindeutig wäre:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

`meta.total` zählt ebenfalls die eindeutigen Zeilen, sodass `hasMore` die paginierte Menge korrekt beschreibt. Zwei Kombinationen werden abgelehnt, anstatt ein nutzloses Ergebnis zu liefern:

- **Eine Abfrage, die jede Zeile bewertet** – ein geranktes `search()` oder ein `vectorSearch()` fügt jeder Zeile einen `_score`/`_distance`-Wert hinzu, sodass keine zwei Zeilen jemals identisch sind und `DISTINCT` wirkungslos bliebe. (Eine einfache Teilstring-Suche fügt nichts hinzu und funktioniert einwandfrei.)
- **Sortieren nach einer Spalte, die nicht zurückgegeben wird.** Postgres kann einen `DISTINCT`-Lesevorgang nicht nach einem Ausdruck sortieren, der nicht in der Select-Liste enthalten ist; die Anfrage führt zu einem 400-Fehler `DISTINCT_ORDER_BY_NOT_SELECTED` statt zu einem 500-Fehler, der SQL zitiert, das Sie nie geschrieben haben.

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

Die Filter des Query Builders werden übernommen, was meist die kürzere Schreibweise ist:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Die Ergebnisschlüssel werden **abgeleitet** und nicht frei gewählt: `sum(total)` wird als `sum_total` zurückgegeben, ein einfaches `count()` als `count`. Ein freies Benennen würde erfordern zu prüfen, dass der Name nicht gleichzeitig ein `groupBy`-Feld ist – eine Regel, die kaum jemand vermuten würde, und ein stillschweigend überschriebener Wert, wenn sie ungeprüft bliebe.

`limit` beschränkt die Anzahl der **Gruppen** (eine Gruppierung nach einer Spalte mit hoher Kardinalität entspräche sonst einer ganzen Tabelle voller Zeilen in einer einzigen Antwort) und wird ohne `groupBy` ignoriert, da ein ungruppiertes Aggregat nur aus einer einzigen Zeile besteht. `orderBy`, `include` und Paginierung finden keine Anwendung: Ein Aggregat hat keine Zeilen zum Sortieren, keine Relationen zum Laden und keine Seite zum Fortsetzen.

Der eigentliche Sinn besteht darin, Zeilen nicht erst abrufen zu müssen, um sie anschließend zusammenzufassen. „Umsatz nach Status“ über eine Million Bestellungen ist hier eine einzige Abfrage und eine Zeile pro Status – im Gegensatz zu einem `findAll()` samt Schleife anderswo, was bei gesetztem `limit` fehlerhaft und ohne unbezahlbar langsam wäre. Es läuft über dasselbe anfragebezogene Handle wie jeder andere Lesevorgang, sodass Row-Level-Security auch auf die aggregierten Zeilen angewendet wird.

Über HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

JSON-Filterung, Volltextsuche und Vektorsuche haben eine eigene Seite: [Aggregate und Suche](/docs/sdk/aggregates-and-search/).

Das Lesen verknüpfter Entitäten – `include` und die Accessoren, die über eine Relation abfragen – hat eine eigene Seite: [Relationen abfragen](/docs/sdk/relations/).

## Benutzerdefinierte Endpunkte

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

Beide geben **den Response-Body der Funktion unverändert (verbatim)** zurück. Keiner von beiden greift darin nach einem `data`-Schlüssel; eine Funktion, die `{ data: [...] }` zurückgibt, liefert Ihnen genau dieses Objekt, und Sie lesen `.data` selbst aus.

`call()` nimmt einen vollständigen Pfad entgegen und sendet immer einen POST-Request; `invoke()` nimmt einen Funktionsnamen entgegen und kann eine HTTP-Methode, einen Unterpfad und Header akzeptieren. Verwenden Sie `invoke()`, es sei denn, Sie rufen etwas auf, das keine Funktion ist.

## Nächste Schritte

- **[Authentifizierung](/docs/sdk/authentication)** — Anmelden, Registrieren, OAuth, Sitzungen
- **[Echtzeit-Abonnements](/docs/sdk/realtime)** — Live-Daten mit WebSockets
- **[Speicher & Dateien](/docs/sdk/storage)** — Dateien hochladen, herunterladen und verwalten
- **[Relationen](/docs/collections/relations)** — Relationen zwischen Collections definieren

---
