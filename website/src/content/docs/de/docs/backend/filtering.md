---
sourceHash: d75d6ec231ad3911
title: REST-API-Filterung
sidebar_label: Filterung
description: Filtern Sie REST-Listenabfragen mit Operatoren im PostgREST-Stil, or/and-Gruppen und dem where-JSON-Dialekt, und erfahren Sie, wie die Filter kombiniert werden.
---

Verwenden Sie Abfrageparameter im PostgREST-Stil, um Ergebnisse zu filtern. Das Format lautet `?field=operator.value`:

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

# Array contains all
GET /api/data/products?tags=csall.(electronics,refurbished)

# Array holds nothing outside the list
GET /api/data/products?tags=cd.(electronics,books,toys)
```

## Filteroperatoren

| Operator | Bedeutung | Beispiel |
|----------|-----------|----------|
| `eq` | Gleich (`==`) | `?active=eq.true` |
| `neq` | Ungleich (`!=`) | `?status=neq.draft` |
| `gt` | Größer als (`>`) | `?price=gt.100` |
| `gte` | Größer oder gleich (`>=`) | `?price=gte.100` |
| `lt` | Kleiner als (`<`) | `?price=lt.50` |
| `lte` | Kleiner oder gleich (`<=`) | `?price=lte.50` |
| `in` | Im Array | `?status=in.(a,b,c)` |
| `nin` | Nicht im Array | `?status=nin.(a,b)` |
| `cs` | Array enthält | `?tags=cs.value` |
| `csa` | Array enthält mindestens eines | `?tags=csa.(a,b)` |
| `csall` | Array enthält alle | `?tags=csall.(a,b)` |
| `cd` | Array enthalten in: kein Element außerhalb der Liste | `?tags=cd.(a,b)` |
| `like` | Musterabgleich, beachtet Groß-/Kleinschreibung (`like`) | `?sku=like.AB-%` |
| `ilike` | Musterabgleich, ignoriert Groß-/Kleinschreibung (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Entspricht nicht dem Muster (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Entspricht nicht dem Muster, ignoriert Groß-/Kleinschreibung (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | Spalte ist `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | Spalte ist nicht `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

Die vier Muster-Operatoren gleichen Text ab. Eine Enum-Spalte wird anhand ihres Werts abgeglichen (`?status=like.draft%25`); bei einer Zahl, einem Datum oder jeder anderen Spalte, die kein Text ist, führen sie zu einem 400 `INVALID_FILTER_OPERATOR`.

`isnull` und `notnull` akzeptieren keinen Operanden – der Operator ist die gesamte Bedingung, und `.null`, `.true`, `.false` oder gar nichts nach dem Punkt bedeuten alle dasselbe. Das SDK schreibt `.null`, weshalb dies die Schreibweise ist, die Sie bei der Übertragung sehen werden. Alles andere nach dem Punkt wird nicht als Operand interpretiert, sodass die gesamte Zeichenkette als Wert gelesen wird: `?reason=notnull.reason` gleicht den Text `notnull.reason` ab.

:::caution[`eq.null` ist die vier Zeichen lange Zeichenkette, nicht `IS NULL`]
`?deleted_at=eq.null` sucht nach dem Literaltext `null`. SQL `= NULL` ist niemals wahr, daher gibt es keine Interpretation von `eq.null`, die die Null-Prüfung bedeuten könnte – verwenden Sie dafür `isnull`. Genau aus diesem Grund serialisiert das SDK `.where("deleted_at", "==", null)` als `isnull.null`.
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

`not` negiert die **Konjunktion** seiner Bedingungen: `not(a)` ist `NOT a`, und `not(a,b)` ist `NOT (a AND b)`. Es wird zu einem echten SQL `NOT (...)` kompiliert anstatt zu invertierten Operatoren – SQL ist dreiwertig, daher stimmen `NOT (a AND b)` und `(NOT a) OR (NOT b)` nicht mehr überein, sobald ein NULL im Spiel ist. Eine Negation **schließt daher Zeilen ein, deren Spalte NULL ist**, was der Bedeutung von `NOT` entspricht; verknüpfen Sie es per AND mit einem `notnull`, wenn dies nicht das gewünschte Verhalten ist.

**Eine Gruppe pro Anfrage: `or` hat Vorrang vor `and`, und beide vor `not`.** Es handelt sich um drei Schreibweisen desselben Slots, nicht um drei Filter. Verschachteln Sie stattdessen:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Gruppen können bis zu 32 Ebenen tief verschachtelt werden; darüber hinaus wird die Anfrage mit `INVALID_LOGICAL_GROUP` abgelehnt.

Eine Bedingung innerhalb einer Gruppe, deren Operator im Dialekt nicht existiert – `?not=(title.contains.x)` –, führt zu einem 400 `UNKNOWN_FILTER_OPERATOR`, genau wie in einem JSON-`where`. Sie wird nicht als Gleichheitsprüfung auf `contains.x` interpretiert, was innerhalb von `not` auf jede Zeile zugetroffen hätte.

Eine Gruppe **schränkt** das Ergebnis zusammen mit den Feldfiltern **weiter ein**, anstatt sie zu ersetzen – siehe [Wie die Filter kombiniert werden](#wie-die-filter-kombiniert-werden).

## Der `where`-JSON-Dialekt

Die oben genannten Feldfilter sind eine von zwei Möglichkeiten, einen Filter zu übergeben. Die andere ist ein einzelnes JSON-Objekt, was auch im OpenAPI-Dokument bei jedem `GET /api/data/{slug}` veröffentlicht wird und was die geschachtelten Routen akzeptieren:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Jeder Schlüssel ist ein Feld, jeder Wert ein kanonisches `[operator, value]`-Tupel – dieselben Tupel, die auch das SDK schreibt. Ein Wert kann auch ein vor-serialisierter Punkt-String (`{"status":"eq.active"}`) oder ein einfacher Skalar (`{"status":"active"}`) sein; alle drei kompilieren zur selben Bedingung. Ein Array aus einfachen Werten ist ein implizites `in`: `{"category":["electronics","gadgets"]}` wird als `["in", ["electronics","gadgets"]]` interpretiert, während ein operator-förmiges erstes Element, das kein echter Operator ist (`["!!","x"]`), zu einem 400 `UNKNOWN_FILTER_OPERATOR` führt.

Dasselbe Objekt wird überall gleich interpretiert, wo es eintrifft: hier, im `where` des SDKs, in einer MCP-Abfrage und im `filter` des Realtime-Sockets – bei dessen Listen- und Count-Anfragen sowie dessen Live-Abonnements.

Der beachtenswerte Unterschied: **JSON überträgt Typen.** `?price=gte.100` sendet die Zeichenkette `"100"` und der Treiber castet sie anhand des Spaltentyps, während `?where={"price":[">=",100]}` eine Zahl sendet. Für eine Spalte, deren Text- und numerische Interpretationen sich unterscheiden – ein Versionsstring, ein mit Nullen aufgefüllter Code –, ist dies der Parameter der Wahl.

Ein fehlerhaftes `where` führt zu einem 400 `INVALID_WHERE` und wird nicht stillschweigend ignoriert: Würde es ignoriert, liefe der Lesezugriff ungefiltert ab und würde alles zurückgeben, was die Row-Level-Security gerade erlaubt.

## Wie die Filter kombiniert werden

`?field=op.value`, `?where=`, `?or=`/`?and=`/`?not=` und `?searchString=` sind unabhängig voneinander, und jeder vorhandene Parameter muss zutreffen:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Die einzige Ausnahme ist ein Feld, das sowohl in `?field=op.value` als auch in `where` angegeben ist: Dort **ersetzt** der Abfrageparameter die `where`-Bedingung für dieses Feld als die spezifischere Anfrage, anstatt mit ihr per AND verknüpft zu werden.

Es gibt keine Möglichkeit, diese untereinander per OR zu verknüpfen. Alles, was kein einfaches AND dieser Gruppen ist, gehört in einen einzelnen `or=`/`and=`-Baum.

## Nächste Schritte

- **[REST-API](/docs/backend/api)** — Endpunkte, Sortierung, Paginierung und Einbindung von Relationen
- **[Daten abfragen](/docs/sdk/querying)** — Dieselben Filter aus dem typisierten SDK
