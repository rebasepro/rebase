---
sourceHash: 8f9daaf34155e283
title: Filterung in der REST-API
sidebar_label: Filterung
description: Listenabfragen über REST mit Operatoren im PostgREST-Stil, or/and-Gruppen und dem JSON-Dialekt where filtern – und wie die Filter zusammenwirken.
---

Verwenden Sie Query-Parameter im PostgREST-Stil, um Ergebnisse zu filtern. Das Format lautet `?field=operator.value`:

```bash
# Exact match
GET /api/data/products?active=eq.true

# Comparison operators
GET /api/data/products?price=gt.100
GET /api/data/products?price=lte.50

# Multiple filters (AND)
GET /api/data/products?active=eq.true&price=gt.10

# IN operator — match any value in a set
GET /api/data/products?status=in.(draft,published)

# NOT IN
GET /api/data/products?status=nin.(archived,deleted)

# Array contains
GET /api/data/products?tags=cs.electronics

# Array contains any
GET /api/data/products?tags=csa.(electronics,books)
```

## Filter-Operatoren

| Operator | Bedeutung | Beispiel |
|----------|-----------|----------|
| `eq` | Entspricht (`==`) | `?active=eq.true` |
| `neq` | Entspricht nicht (`!=`) | `?status=neq.draft` |
| `gt` | Größer als (`>`) | `?price=gt.100` |
| `gte` | Größer oder gleich (`>=`) | `?price=gte.100` |
| `lt` | Kleiner als (`<`) | `?price=lt.50` |
| `lte` | Kleiner oder gleich (`<=`) | `?price=lte.50` |
| `in` | In Array | `?status=in.(a,b,c)` |
| `nin` | Nicht in Array | `?status=nin.(a,b)` |
| `cs` | Array enthält | `?tags=cs.value` |
| `csa` | Array enthält mindestens ein Element | `?tags=csa.(a,b)` |
| `like` | Musterabgleich, case-sensitiv (`like`) | `?sku=like.AB-%` |
| `ilike` | Musterabgleich, case-insensitiv (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Entspricht nicht dem Muster (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Entspricht nicht, case-insensitiv (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | Spalte ist `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | Spalte ist nicht `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

Die vier Muster-Operatoren vergleichen Text. Eine Enum-Spalte wird über ihren Wert
abgeglichen (`?status=like.draft%25`); bei einer Zahl, einem Datum oder jeder anderen
Spalte, die kein Text ist, ergeben sie einen 400 `INVALID_FILTER_OPERATOR`.

`isnull` und `notnull` ignorieren ihren Wert — der Operator ist die gesamte Bedingung,
und alles nach dem Punkt wird verworfen. Das SDK schreibt `.null`, daher ist dies
die Schreibweise, die Sie bei der Übertragung sehen werden.

:::caution[`eq.null` ist die vier Zeichen lange Zeichenkette, nicht `IS NULL`]
`?deleted_at=eq.null` sucht nach dem buchstäblichen Text `null`. SQL `= NULL` ist
niemals wahr, daher gibt es keine Interpretation von `eq.null`, die die Null-Prüfung
bedeuten könnte — verwenden Sie dafür `isnull`. Das SDK serialisiert
`.where("deleted_at", "==", null)` genau aus diesem Grund als `isnull.null`.
:::

## Logische Operatoren

Verwenden Sie `or`, `and` und `not` für komplexe Bedingungen:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)

# NOT: everything that is not a discontinued in-stock item
GET /api/data/products?not=(discontinued.eq.true,stock.gt.0)
```

`not` negiert die **Konjunktion** seiner Bedingungen: `not(a)` ist `NOT a` und
`not(a,b)` ist `NOT (a AND b)`. Es wird zu einem echten SQL-`NOT (...)` kompiliert
und nicht zu invertierten Operatoren — SQL ist dreiwertig, sodass `NOT (a AND b)` und
`(NOT a) OR (NOT b)` in dem Moment nicht mehr übereinstimmen, in dem ein NULL im Spiel ist.
Eine Negation **schließt daher Zeilen ein, deren Spalte NULL ist**, was der Bedeutung
von `NOT` entspricht; verknüpfen Sie ein `notnull` per AND daneben, wenn dies nicht
gewünscht ist.

**Eine Gruppe pro Anfrage: `or` hat Vorrang vor `and`, und beide vor `not`.** Es
handelt sich um drei Schreibweisen desselben Slots, nicht um drei Filter. Schachteln
Sie stattdessen:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Gruppen können bis zu 32 Ebenen tief verschachtelt werden; darüber hinaus wird die
Anfrage mit `INVALID_LOGICAL_GROUP` abgelehnt.

Eine Bedingung innerhalb einer Gruppe, deren Operator der Dialekt nicht kennt —
`?not=(title.contains.x)` — ist ein 400 `UNKNOWN_FILTER_OPERATOR`, genau wie in einem
JSON-`where`. Sie wird nicht als Gleichheit auf `contains.x` gelesen, was innerhalb
von `not` jede Zeile getroffen hätte.

Eine Gruppe **grenzt** neben den Feldfiltern **ein**, anstatt sie zu ersetzen —
siehe [Wie die Filter kombiniert werden](#wie-die-filter-kombiniert-werden).

## Der `where`-JSON-Dialekt

Die obigen Feldfilter sind eine von zwei Möglichkeiten, einen Filter zu übermitteln.
Die andere ist ein einzelnes JSON-Objekt, welches das OpenAPI-Dokument bei jedem
`GET /api/data/{slug}` veröffentlicht und welches die verschachtelten Subcollection-Routen
entgegennehmen:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Jeder Schlüssel ist ein Feld, jeder Wert ein kanonisches `[operator, value]`-Tupel —
dieselben Tupel, die auch das SDK schreibt. Ein Wert kann auch ein vor-serialisierter
Punkt-String (`{"status":"eq.active"}`) oder ein einfacher Skalar (`{"status":"active"}`)
sein; alle drei kompilieren zur selben Bedingung.

Der wissenswerte Unterschied: **JSON überträgt Typen.** `?price=gte.100` sendet
die Zeichenkette `"100"` und der Treiber castet sie anhand des Spaltentyps, während
`?where={"price":[">=",100]}` eine Zahl sendet. Für eine Spalte, bei der sich Text-
und numerische Interpretationen unterscheiden — ein Versions-String, ein mit Nullen
aufgefüllter Code —, ist dies der zu wählende Parameter.

Ein fehlerhaftes `where` führt zu einem 400 `INVALID_WHERE` und wird nicht stillschweigend
verworfen: Das Verwerfen würde den Lesevorgang ungefiltert ausführen und alles zurückgeben,
was Row-Level Security zufällig erlaubt.

## Wie die Filter kombiniert werden
`?field=op.value`, `?where=`, `?or=`/`?and=` und `?searchString=` sind unabhängig
voneinander, und jeder vorhandene Parameter muss zutreffen:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Es gibt keine Möglichkeit, diese untereinander mit OR zu verknüpfen. Alles, was
kein einfaches AND dieser Gruppen ist, gehört in einen einzigen `or=`/`and=`-Baum.

## Nächste Schritte

- **[REST-API](/docs/backend/api)** — Endpunkte, Sortierung, Paginierung und das Einbinden von Relationen
- **[Daten abfragen](/docs/sdk/querying)** — Dieselben Filter aus dem typisierten SDK
