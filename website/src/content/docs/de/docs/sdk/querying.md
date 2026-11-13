---
sourceHash: 45064786f1785a65
title: Daten abfragen
sidebar_label: Daten abfragen
description: CRUD-Operationen, Fluent Query Builder, Filteroperatoren, Sortierung, Spaltenauswahl und Aggregate mit dem typisierten Rebase SDK.
---

## Zugriff auf Tabellen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Greifen Sie über `client.data.<tableName>` (camelCase, wird automatisch in snake_case umgewandelt) oder `client.data.table<Record<string, unknown>>("slug")` (expliziter Slug) auf jede Tabelle zu:

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.table<Record<string, unknown>>("blog_posts")
```

> **Strikter Modus (generiertes SDK):** Wenn Sie das generierte `tablesDictionary` als `tables` an `createRebaseClient` übergeben, validiert der Daten-Proxy Eigenschaftszugriffe direkt beim Zugriff. Ein Tippfehler wie `client.data.prodcuts` löst sofort `UNKNOWN_TABLE` mit einem Vorschlag für die ähnlichste Übereinstimmung aus, anstatt später einen verwirrenden 404-Fehler zu erzeugen. Verwenden Sie `client.data.table<Record<string, unknown>>("slug")`, um die Validierung für dynamische oder zur Laufzeit ermittelte Slugs zu umgehen.

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

`get` ist für eine Zeile gedacht, von deren Existenz Sie ausgehen – die ID stammt aus einem Link, einem Routenparameter oder einer anderen Zeile. Sie gibt die Zeile zurück, sodass nachfolgender Code keine Typ-Einschränkung vornehmen muss, und eine fehlende Zeile stellt eine Exception dar, auf die Sie reagieren können:

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

`findById` ist für Zeilen gedacht, die berechtigterweise möglicherweise nicht existieren – etwa eine Suche nach einer vom Benutzer eingegebenen ID oder ein Cache-Test:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

`findById` akzeptiert wie `find` zu ladende Relationen:
`findById(1, { include: ["tags"] })`.

:::note
Row-Level-Security liefert für „Zeile existiert nicht“ und „keine Leseberechtigung“ bewusst dieselbe Antwort: Ein 404-Fehler, der dazwischen unterscheiden würde, würde die Existenz der Zeile bestätigen.
:::

### Schreiben

`create`, `upsert`, `update`, `delete` und deren Batch-Varianten finden Sie unter **[Daten schreiben](/docs/sdk/writing/)**, zusammen mit Feldoperationen, bedingten Schreibvorgängen und Idempotenzschlüsseln.

### Anzahl (Count)

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
| `.where(path, op, value)` | Nach einem [Relations-](/docs/sdk/relations#querying-through-a-relation) oder [JSON-Pfad](/docs/sdk/aggregates-and-search#filtering-inside-json) filtern | `.where("author.name", "==", "bob")` |
| `.where(group)` | Eine [OR/AND-Gruppe](#logische-bedingungen-or--and--not) hinzufügen | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ergebnisse sortieren | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Nach einem [Aggregat über eine Relation](/docs/sdk/relations#sort-by-an-aggregate-over-a-relation) sortieren | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Ergebnisanzahl begrenzen | `.limit(25)` |
| `.offset(n)` | Erste N Ergebnisse überspringen | `.offset(50)` |
| `.after(cursor)` | Nach einem [Cursor](/docs/sdk/pagination#cursor-pagination) fortsetzen | `.after(meta.nextCursor)` |
| `.fields(...columns)` | [Nur diese Spalten](#spaltenauswahl-einschränken) zurückgeben | `.fields("id", "title")` |
| `.distinct()` | Zeilen zusammenführen, die in diesen Spalten identisch sind | `.fields("status").distinct()` |
| `.search(text)` | Volltextsuche – siehe [Suche](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Nearest-Neighbor-Suche über eine `vector`-Eigenschaft | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Verknüpfte Zeilen laden](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Abfrage ausführen | Gibt `FindResult<M>` zurück |
| `.aggregate(params)` | [Aggregieren statt Zeilen zurückzugeben](#aggregate) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Jede passende Zeile streamen](/docs/sdk/pagination#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Jede passende Zeile sammeln](/docs/sdk/pagination#reading-everything-iterate-and-findall) | Gibt `M[]` zurück |
| `.count()` | Anzahl der passenden Zeilen zählen | Gibt `number` zurück |
| `.listen(onUpdate, onError?)` | Echtzeit-Updates abonnieren | Gibt `unsubscribe()` zurück |

### Filteroperatoren

| Operator | Alias | Beschreibung |
|----------|-------|-------------|
| `"=="` | `"eq"` | Gleich |
| `"!="` | `"neq"` | Ungleich |
| `">"` | `"gt"` | Größer als |
| `">="` | `"gte"` | Größer oder gleich |
| `"<"` | `"lt"` | Kleiner als |
| `"<="` | `"lte"` | Kleiner oder gleich |
| `"in"` | | Wert im Array enthalten |
| `"not-in"` | `"nin"` | Wert nicht im Array enthalten |
| `"array-contains"` | `"cs"` | Array-Feld enthält Wert |
| `"array-contains-any"` | `"csa"` | Array-Feld enthält mindestens einen der Werte |
| `"array-contains-all"` | `"csall"` | Array-Feld enthält alle Werte |
| `"array-contained-by"` | `"cd"` | Array-Feld enthält ausschließlich diese Werte (einschließlich eines leeren Arrays) |
| `"like"` | `"like"` | Mustervergleich mit Beachtung der Groß-/Kleinschreibung (**case-sensitive**); `%` und `_` sind Platzhalter |
| `"ilike"` | `"ilike"` | Mustervergleich ohne Beachtung der Groß-/Kleinschreibung (case-insensitive) |
| `"not-like"` | `"nlike"` | Entspricht nicht dem Muster |
| `"not-ilike"` | `"nilike"` | Entspricht nicht dem Muster (case-insensitiv) |
| `"is-null"` | `"isnull"` | Spalte ist `NULL`. Akzeptiert keinen Wert – was auch immer übergeben wird, wird ignoriert |
| `"is-not-null"` | `"notnull"` | Spalte ist nicht `NULL`. Akzeptiert keinen Wert |

Die Alias-Spalte zeigt die **Wire-Format**-Schreibweise, die in REST-Query-Strings verwendet wird. Sie taucht niemals im Anwendungscode auf: Sowohl das SDK als auch das Admin-Panel verwenden den kanonischen Operator auf der linken Seite.

Die vier Array-Operatoren funktionieren sowohl auf nativen Array-Spalten (`text[]`, `integer[]`, …) als auch auf JSONB-Arrays, und ein GIN-Index auf der Spalte unterstützt sie alle. Um die eindeutigen Elemente einer Array-Spalte aufzulisten, gruppieren Sie ein Aggregat nach `unnest(<field>)` (siehe [Aggregate](/docs/sdk/aggregates-and-search/#grouping-by-an-expression)).

Die vier Muster-Operatoren vergleichen Text. Ein `enum`-Feld wird anhand seines Wertes abgeglichen, sodass `{ status: ["like", "draft%"] }` auch für einen Status funktioniert, der als Postgres-Enum gespeichert ist. Bei Zahlen, Datumsangaben oder anderen Nicht-Text-Feldern werden sie mit einem 400 `INVALID_FILTER_OPERATOR` abgelehnt.

### Groß-/Kleinschreibung ignorieren: `lower(field)`

Ein Filterschlüssel kann ein Textfeld in eine bestimmte Schreibweise umwandeln – `lower(artist)` oder `upper(code)` – und jeder Operator vergleicht dann den umgewandelten Wert. Schreiben Sie die Vergleichswerte daher in dieser Schreibweise:

```typescript
await client.data.songs.find({
    where: { "lower(artist)": ["in", ["abba", "queen"]] }
});
```

Dies wird zu `lower(artist) = ANY($1)` kompiliert: eine gebundene Liste beliebiger Länge, die von einem Index auf `lower(artist)` bedient werden kann. Über HTTP wird der Schlüssel genauso geschrieben: `?lower(artist)=in.(abba,queen)`.

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

> **Hinweis:** Vorab serialisierte PostgREST-Strings (Format 2) sind eine Ausweichmöglichkeit (Escape Hatch), um Filterwerte zu übergeben, die bereits im Wire-Format vorliegen. Bevorzugen Sie die Tupel-Syntax für Typsicherheit und bessere Lesbarkeit.

## Logische Bedingungen (OR / AND / NOT)

Jedes Feld in `where` wird mit AND verknüpft. Um Bedingungen mit OR zu verknüpfen oder eine Gruppe zu negieren, erstellen Sie eine **logische Bedingung** mit den vom SDK exportierten Hilfsfunktionen `or`, `and`, `not` und `cond`:

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

`cond` erwartet den kanonischen Operator – die linke Spalte der Tabelle [Filteroperatoren](#filteroperatoren). Ein Operator, den der Dialekt nicht unterstützt, führt bei der Serialisierung der Abfrage zu einem `TypeError` und nicht zu einer stillschweigend veränderten Abfrage.

Bei einem Client mit [generierten Typen](/docs/sdk#typed-sdk-generation) prüfen `logical` und `.where(group)` jede Bedingung im Baum gegen die Zeile, genauso wie `where`: Eine Spalte, die in der Zeile nicht existiert, oder ein Wert mit dem falschen Typ für den Operator (`cond("views", "==", "many")` auf einer numerischen Spalte) führt zu einem Compile-Fehler. Ein Relations- oder JSON-Pfad (`author.name`, `metadata->>tier`) wird nicht geprüft.

### Negation

`not` negates die **Konjunktion** seiner Bedingungen: `not(a)` ist `NOT a` und `not(a, b)` ist `NOT (a AND b)`. Gruppen lassen sich verschachteln, sodass die andere De-Morgan-Regel `not(or(a, b))` lautet.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Es wird zu einem echten SQL `NOT (...)` kompiliert, nicht zu invertierten Operatoren. Dieser Unterschied ist keineswegs kosmetischer Natur: SQL ist dreiwertig, sodass `NOT (a AND b)` und `(NOT a) OR (NOT b)` nicht mehr übereinstimmen, sobald ein `NULL`-Wert im Spiel ist – und nur eine Variante entspricht der Abfrage, die Sie geschrieben haben.

Das bedeutet auch, dass eine Negation **Zeilen einschließt, deren Spalte NULL ist** – `not(cond("status", "==", "draft"))` gibt Zeilen zurück, die überhaupt keinen Status haben. Genau das bedeutet `NOT`, und meistens ist es auch das, was man erwartet; falls nicht, verknüpfen Sie es zusätzlich per AND mit einem `is-not-null`.

### Zusammenspiel mit dem Rest der Abfrage

`where`, `logical` und `search` sind drei unabhängige Gruppen, die per AND miteinander verknüpft werden:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Es gibt keine Möglichkeit, `where` und `logical` mit OR zu verknüpfen. Alles, was kein einfaches AND dieser drei Komponenten ist, muss innerhalb eines einzigen `logical`-Baums ausgedrückt werden – verschieben Sie die Felder, die Sie per OR verknüpfen möchten, dorthin.

### Über das Netzwerk (Wire-Format)

Eine logische Gruppe wird als einzelner `or=`, `and=` oder `not=` Query-Parameter übertragen, in derselben Punkt-Syntax, die auch Feldfilter verwenden:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Pro Anfrage greift nur einer der drei Parameter – `or` hat Vorrang vor `and`, und beide vor `not`. Verschachteln Sie Gruppen ineinander, um sie zu kombinieren.

Drei Kodierungen sollte man kennen, da man sie bei manuell geschriebenen Query-Strings leicht falsch macht:

| Bedingung | Wire-Format | Hinweis |
|-----------|-------------|---------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` sucht nach der vier Zeichen langen Zeichenkette `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` ist eine Liste, die einen leeren String enthält, was eine andere Abfrage darstellt |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | ein [Relations-Pfad](/docs/sdk/relations#querying-through-a-relation) behält seinen Punkt |

Kommas, Klammern und Backslashes innerhalb eines Wertes werden mit einem Backslash maskiert, sodass `cond("name", "==", "Doe, John")` als `name.eq.Doe\, John` übertragen wird und die Gruppe nicht aufteilt.

Gruppen können bis zu 32 Ebenen tief verschachtelt werden. Darüber hinaus wird die Anfrage mit `INVALID_LOGICAL_GROUP` abgewiesen – flachen Sie sie ab, da `or(a,or(b,c))` gleichbedeutend mit `or(a,b,c)` ist.

## Paginierung

Offsets, Seitennummern und Keyset-Cursorn ist eine eigene Seite gewidmet:
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

Wird die Richtung weggelassen, gilt standardmäßig `"asc"` – genau wie `?orderBy=name` über HTTP bedeutet, unabhängig von der zugrunde liegenden Datenbank.

### Nach mehr als einer Spalte sortieren

Eine Sortierung ist eine *Liste* von Schlüsseln. Der zweite entscheidet bei Zeilen, die der erste als gleich einstuft, der dritte bei Zeilen, bei denen die ersten beiden gleich sind – daher akzeptiert `orderBy` ebenso eine Liste von `[field, direction]`-Paaren wie ein einzelnes Paar:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

Beim Fluent Builder geschieht dasselbe durch erneutes Aufrufen von `.orderBy()`. Jeder Aufruf **fügt** einen Schlüssel unter den vorherigen hinzu, anstatt sie zu ersetzen:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Jede Sortierung endet mit der Zeilen-ID absteigend, egal ob Sie dies angegeben haben oder nicht. Das macht die Sortierung *vollständig* (total): Ohne dies würden zwei Zeilen mit demselben Wert in beliebiger Reihenfolge von der Datenbank zurückgegeben. Das Paginieren über eine Sortierung, die sich zwischen zwei Durchläufen derselben Abfrage unterscheiden kann, würde dazu führen, dass Zeilen doppelt vorkommen oder übersprungen werden.

Eine mehrspaltige Sortierung lässt sich problemlos mit einem [Cursor](/docs/sdk/pagination#cursor-pagination) paginieren: Der Vergleich wird der Reihe nach über alle Schlüssel aufgebaut. Die einzige Sortierung, die ein Cursor nicht abbilden kann, ist **`_score`** – siehe [Suche](/docs/backend/search). Relevanz wird pro Abfrage berechnet und nicht gespeichert; daher gibt es auf der Cursor-Zeile keinen Wert, mit dem die nächste Seite verglichen werden könnte, und eine solche Auflistung enthält keinen `nextCursor`.

### Wo NULL-Werte einsortiert werden

Standardmäßig werden NULL-Werte **aufsteigend zuletzt und absteigend zuerst** einsortiert – die Postgres-eigene Konvention. Dieser Standard führt dazu, dass jede Zeile ohne Datum ganz oben in einer „Neueste zuerst“-Liste landet, noch vor allen tatsächlichen Einträgen. Der einzige Ausweg bestand bisher in einem `is-not-null`-Filter, der diese Zeilen komplett ausschloss.

Ein drittes Element im Schlüssel bestimmt, wo sie stattdessen landen:

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

Über HTTP ist dies ein dritter Doppelpunkt-Abschnitt, `?orderBy=publishedAt:desc:last`, oder ein `"nulls"`-Schlüssel in der JSON-Array-Form. Alles andere als `first`/`last` führt zu einem 400-Fehler anstelle einer stillschweigend veränderten Reihenfolge.

Der [Cursor](/docs/sdk/pagination#cursor-pagination) berücksichtigt die deklarierte Sortierung, sodass das Paginieren über einen Nullable-Schlüssel bei beiden Platzierungen korrekt bleibt.

## Spaltenauswahl einschränken

`fields` beschränkt einen Lesevorgang auf die von Ihnen angegebenen Spalten. Es handelt sich um eine Projektion auf Datenbankebene – das sind die tatsächlich *gelesenen* Spalten und nicht solche, die nach dem Zurechtschneiden der Antwort übrig bleiben. Eine Abfrage, die nur zwei Felder einer breiten Zeile benötigt, muss somit nicht für den Rest aufkommen:

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

- **Der Primärschlüssel wird immer zurückgegeben.** Eine Zeile, die nicht adressiert werden kann, kann weder aktualisiert, gelöscht noch weiter paginiert werden – und `meta.nextCursor` wird daraus abgeleitet, sodass eine Projektion ohne ihn das Weiterblättern stillschweigend deaktivieren würde.
- **`excludeFromApi`-Spalten bleiben verborgen.** Die explizite Angabe einer solchen Spalte hebt deren Ausblendung nicht auf.

Eine unbekannte Spalte führt zu einem 400 `UNKNOWN_FIELD`. Würde dies als „einfach weglassen“ interpretiert, würde ein falsch geschriebenes `fields: ["titel"]` Zeilen ohne Titel zurückgeben, ohne jeden Hinweis auf die Ursache.

Eine in `include` angegebene Relation wird unabhängig davon geladen, ob sie in `fields` auftaucht; um die Spalten *innerhalb* einer Relation einzuschränken, siehe [Optionen pro Relation](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` fasst Zeilen zusammen, die in den zurückgegebenen Spalten identisch sind. Ein Distinct-Lesevorgang gibt **ausschließlich** die von Ihnen angegebenen Spalten zurück – der Primärschlüssel wird, anders als bei jedem anderen Lesevorgang, aus der Projektion ausgeschlossen. Das muss so sein: Ein Surrogatschlüssel unterscheidet sich in jeder Zeile; würde er beibehalten, wäre jede Zeile von vornherein einzigartig und die Abfrage würde mit 200 antworten, ohne etwas bewirkt zu haben.

Das macht es nur in Verbindung mit `fields` sinnvoll. Ohne diese Angabe fordern Sie jede sichtbare Spalte inklusive Schlüssel an, und es wird nichts zusammengefasst:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Ein Distinct-Lesevorgang adressiert keine Zeilen – es gibt keinen Schlüssel, über den sie adressiert werden könnten –, weshalb er eine Menge von Werten anstelle einer Menge von Zeilen zum Aktualisieren oder Löschen zurückgibt und keinen `nextCursor` enthält. Er liefert zudem **kein `meta.total`**: Das Zählen würde ein `COUNT(DISTINCT …)` erfordern, welches der Treiber nicht absetzt, und die einfache Rückgabe der Zeilenanzahl würde eine andere Menge beschreiben als die ausgelieferte – ein vollständiges Ergebnis aus zwei Zeilen würde dann als `total: 8, hasMore: true` zurückgegeben, was dazu führen würde, dass ein Client endlos weiter paginiert. `hasMore` wird aus der Seite selbst ermittelt.

Zwei Kombinationen werden abgelehnt, anstatt ein unbrauchbares Ergebnis zu liefern:

- **Eine Abfrage, die jede Zeile bewertet (Scoring)** – eine gerankte `search()` oder eine `vectorSearch()` hängt einen `_score`/`_distance` an jede Zeile an, sodass niemals zwei Zeilen identisch sind und `DISTINCT` keine Wirkung hätte. (Eine einfache Teilstring-Suche hängt nichts an und ist unproblematisch.)
- **Sortieren nach einer Spalte, die nicht zurückgegeben wird.** Postgres kann einen `DISTINCT`-Lesevorgang nicht nach einem Ausdruck außerhalb der Select-Liste sortieren; die Anfrage schlägt mit einem 400 `DISTINCT_ORDER_BY_NOT_SELECTED` fehl, anstatt mit einem 500-Fehler, der SQL zitiert, das Sie nie geschrieben haben.

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

Die Filter des Builders werden übernommen, was meist die kürzere Schreibweise ist:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

Ergebnisschlüssel werden **abgeleitet**, nicht frei gewählt: `sum(total)` wird als `sum_total` zurückgegeben, ein einfaches `count()` als `count`. Ein freies Benennen würde erfordern sicherzustellen, dass der Name nicht gleichzeitig ein `groupBy`-Feld ist – eine Regel, die niemand erraten würde und die ungeprüft zu stillschweigend überschriebenen Werten führen würde.

Gruppen werden wie die Zeilen einer Auflistung paginiert: `limit` begrenzt sie und `offset` überspringt sie (eine Gruppierung nach einer Spalte mit hoher Kardinalität entspräche einer ganzen Tabelle voller Zeilen in einer einzigen Antwort). Ein gruppiertes Aggregat ohne `limit` erhält den Auflistungsstandard – **50 Gruppen** über HTTP – prüfen Sie daher `meta` im Ergebnis, bevor Sie davon ausgehen, dass es vollständig ist:

```typescript
const byCustomer = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }],
    groupBy: ["customerId"],
    limit: 200
});
byCustomer.meta; // { limit: 200, offset: 0, hasMore: true } — page on with offset: 200
```

Das Ergebnis ist weiterhin ein Array von Zeilen; `meta` ist eine nicht-zählbare Eigenschaft (non-enumerable property) darauf, sodass ein Spread-Operator oder `JSON.stringify` nur die Zeilen erfasst. Sie ist immer vorhanden, wenn die Gruppen durch ein `limit` begrenzt wurden. Ohne `groupBy` gibt es genau eine Zeile, `limit` hat keine Auswirkung und `offset` wird abgewiesen. In einer Serverfunktion (`rebase.data`, `context.data`) gibt ein gruppiertes Aggregat ohne `limit` alle Gruppen zurück. `include` wird bei einem Aggregat nicht übermittelt: Es gibt keine Relationen zu laden. Gruppen können mit `orderBy` sortiert werden, entweder nach einer `groupBy`-Spalte oder dem Schlüssel eines Aggregats – siehe [Aggregate und Suche](/docs/sdk/aggregates-and-search/).

Der eigentliche Sinn besteht darin, Zeilen nicht erst abrufen zu müssen, um sie zu aggregieren. „Umsatz nach Status“ über eine Million Bestellungen ist hier eine einzige Abfrage und eine Zeile pro Status – anderswo erfordert dies ein `findAll()` plus Schleife, was bei einem `limit` fehlerhaft und ohne ein solches unbezahlbar ist. Es läuft über dasselbe anfragebezogene Handle wie jeder andere Lesevorgang, sodass Row-Level-Security auch auf die aggregierten Zeilen angewendet wird.

Über HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

JSON-Filterung, Volltextsuche und Vektorsuche haben eine eigene Seite:
[Aggregate und Suche](/docs/sdk/aggregates-and-search/).

Das Lesen verknüpfter Entitäten – `include` und die Accessoren für Abfragen über eine Relation – wird auf einer eigenen Seite behandelt: [Relationen abfragen](/docs/sdk/relations/).

## Eigene Endpunkte

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

Beide geben **den Response-Body der Funktion unverändert (verbatim)** zurück. Keiner von beiden greift auf einen `data`-Schlüssel darin zu. Eine Funktion, die mit `{ data: [...] }` antwortet, liefert Ihnen also genau dieses Objekt, und Sie greifen selbst auf `.data` zu.

`call()` nimmt einen vollständigen Pfad entgegen und sendet immer per POST; `invoke()` erwartet einen Funktionsnamen und kann eine HTTP-Methode, einen Unterpfad und Header entgegennehmen. Verwenden Sie `invoke()`, es sei denn, Sie rufen etwas auf, das keine Funktion ist.

## Nächste Schritte

- **[Authentifizierung](/docs/sdk/authentication)** — Anmelden, Registrieren, OAuth, Sitzungen
- **[Echtzeit-Abonnements](/docs/sdk/realtime)** — Live-Daten mit WebSockets
- **[Speicher & Dateien](/docs/sdk/storage)** — Dateien hochladen, herunterladen und verwalten
- **[Relationen](/docs/collections/relations)** — Relationen zwischen Tabellen definieren
