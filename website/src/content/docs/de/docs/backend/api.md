---
sourceHash: 2499dc27f2076f94
title: REST API
sidebar_label: REST API
description: Automatisch generierte REST-API-Endpunkte für jede Collection, mit Filterung, Sortierung, Paginierung und Einbindung von Relationen.
---

## Übersicht

Rebase generiert automatisch eine vollständige API aus Ihren Collection-Definitionen:

- **REST-API** — CRUD-Endpunkte für jede Collection unter `/api/data/:slug`
- **OpenAPI-Spezifikation** — Maschinenlesbare Spezifikation unter `/api/docs`
- **Swagger UI** — Interaktiver API-Explorer unter `/api/swagger` (nur im Entwicklungsmodus)

Es ist kein Code erforderlich — definieren Sie Ihre Collections und die API steht automatisch zur Verfügung.

## REST-Endpunkte

Für jede Collection werden die folgenden Endpunkte generiert. Alle anderen vom Backend bereitgestellten Routen — Auth, Storage, Admin, Meta — finden Sie im [Endpunkt-Index](/docs/backend/endpoints/).

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| `GET` | `/api/data/:slug` | Entitäten auflisten |
| `GET` | `/api/data/:slug/count` | Entitäten zählen |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, optional gruppiert. Akzeptiert dieselben Filter wie der Listen-Endpunkt, und RLS gilt für die aggregierten Zeilen — siehe [Abfragen](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Eine einzelne Entität abrufen |
| `POST` | `/api/data/:slug` | Einen Datensatz erstellen |
| `PATCH` | `/api/data/:slug/:id` | Einen Datensatz aktualisieren (partiell — es werden nur die gesendeten Eigenschaften geschrieben) |
| `DELETE` | `/api/data/:slug/:id` | Einen Datensatz löschen |
| `POST` | `/api/data/:slug/bulk` | Mehrere Entitäten in einer Transaktion erstellen |
| `PATCH` | `/api/data/:slug/bulk` | Mehrere Entitäten in einer Transaktion aktualisieren |
| `POST` | `/api/data/:slug/bulk/delete` | Mehrere Entitäten in einer Transaktion löschen |
| `POST` | `/api/data/_batch` | Collection-**übergreifend** in einer Transaktion schreiben |

### Subcollection-Routen

Verschachtelte Relationen sind über URL-Pfade zugänglich:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Routing-Mechanik & Segment-Parsing

Um beliebige Verschachtelungstiefen von Subcollections zu verarbeiten, routet Rebase eingehende Anfragen mithilfe des `:rest{.+}`-Parameter-Regex von Hono. Die interne Segment-Parsing-Engine analysiert Pfade durch das Zählen von durch Schrägstriche getrennten Segmenten:
- **Ungerade Segmentanzahl** (z. B. `authors/42/posts` -> 3 Segmente) stellt eine Anfrage zum Auflisten einer Collection dar.
- **Gerade Segmentanzahl** (z. B. `authors/42/posts/7` -> 4 Segmente) stellt eine Operation auf einer bestimmten Entitäts-ID dar. Das letzte Segment wird als Ziel-`entityId` extrahiert.

Die Engine filtert reservierte System-Namespaces (z. B. `history`) aus der Pfadsegmentanalyse heraus, um Kollisionen mit integrierten Endpunkten zu verhindern.

## Authentifizierung

Alle Datenendpunkte erfordern standardmäßig eine Authentifizierung. Fügen Sie ein Bearer-Token in den `Authorization`-Header ein:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Verwenden Sie für Server-zu-Server-Aufrufe den Service-Key:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

## Filterung

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

### Filter-Operatoren

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

`isnull` und `notnull` ignorieren ihren Wert — der Operator ist die gesamte Bedingung,
und alles nach dem Punkt wird verworfen. Das SDK schreibt `.null`, daher ist dies
die Schreibweise, die Sie bei der Übertragung sehen werden.

:::caution[`eq.null` ist die vier Zeichen lange Zeichenkette, nicht `IS NULL`]
`?deleted_at=eq.null` sucht nach dem buchstäblichen Text `null`. SQL `= NULL` ist
niemals wahr, daher gibt es keine Interpretation von `eq.null`, die die Null-Prüfung
bedeuten könnte — verwenden Sie dafür `isnull`. Das SDK serialisiert
`.where("deleted_at", "==", null)` genau aus diesem Grund als `isnull.null`.
:::

### Logische Operatoren

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

Eine Gruppe **grenzt** neben den Feldfiltern **ein**, anstatt sie zu ersetzen —
siehe [Wie die Filter kombiniert werden](#how-the-filters-combine).

### Der `where`-JSON-Dialekt

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

### Wie die Filter kombiniert werden {#how-the-filters-combine}

`?field=op.value`, `?where=`, `?or=`/`?and=` und `?searchString=` sind unabhängig
voneinander, und jeder vorhandene Parameter muss zutreffen:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Es gibt keine Möglichkeit, diese untereinander mit OR zu verknüpfen. Alles, was
kein einfaches AND dieser Gruppen ist, gehört in einen einzigen `or=`/`and=`-Baum.

## Sortierung

Verwenden Sie `orderBy` mit dem Format `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Eine fehlende Richtung entspricht `asc`. Eine Richtung, die weder `asc` noch `desc`
ist, oder ein Feld, das die Collection nicht besitzt, führt zu einem **400** — nicht
zu einem 200 mit den Zeilen in einer beliebigen Reihenfolge der Datenbank, was von
einer funktionierenden Sortierung nicht zu unterscheiden wäre.

### Mehrere Sortierschlüssel

Die Kurzschreibweise unterstützt einen Schlüssel. Für mehrere übergeben Sie ein
JSON-Array — der zweite Schlüssel entscheidet bei Zeilen, die nach dem ersten gleich sind:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Beide Schreibweisen funktionieren bei jeder Route, die Zeilen auflistet, einschließlich
verschachtelter Routen (`/api/data/authors/:id/posts`). Jede Sortierung endet mit der
absteigenden Zeilen-ID, unabhängig davon, ob Sie dies angegeben haben: Das macht die
Sortierung total, und das Paginieren über eine nicht-totale Ordnung wiederholt oder
überspringt Zeilen.

Ein wiederholter `?orderBy=`-Parameter ist keine Sortierung nach mehreren Schlüsseln —
der letzte gewinnt, wie bei jedem anderen Query-Parameter. Verwenden Sie das Array.

### Positionierung von NULL-Werten bei der Sortierung

Standardmäßig werden NULL-Werte **aufsteigend als Letztes und absteigend als Erstes**
sortiert, was der Konvention von Postgres entspricht. Ein drittes, durch Doppelpunkt
abgetrenntes Segment bestimmt dies anders:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

Die JSON-Array-Form akzeptiert für denselben Zweck den Schlüssel `"nulls"`:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Alles andere als `first` oder `last` ist ein 400-Fehler, keine stillschweigend abweichende
Reihenfolge. Der unten beschriebene Cursor berücksichtigt die deklarierte Sortierung,
sodass die Paginierung über einen Nullable-Schlüssel bei beiden Platzierungen korrekt bleibt.

## Paginierung

Verwenden Sie `limit` und `offset`, oder `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

Das Standardlimit ist **50**, das Maximum liegt bei **1000**. Beide Werte stammen aus
`DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, was auch die generierte OpenAPI-Spezifikation
ausweist — ein `limit` über dem Maximum wird abgelehnt und nicht gekappt.

Alle drei Fenster-Parameter werden abgelehnt statt korrigiert, und jeder benennt sich
selbst: `INVALID_LIMIT`, `INVALID_OFFSET` (eine ganze Zahl von 0 oder mehr) und
`INVALID_PAGE` (eine ganze Zahl von 1 oder mehr). Ein Fenster, das sich stillschweigend
von dem angeforderten unterscheidet, lässt sich nicht vom Erreichen des Endes der Collection
unterscheiden, weshalb keines davon gekappt oder ignoriert wird.

### Cursor-Paginierung

`offset` zählt Zeilen bei jeder Anfrage neu, sodass eine zwischen zwei Seiten eingefügte
oder gelöschte Zeile das Fenster verschiebt und der Abruf stillschweigend Zeilen
überspringt oder wiederholt. `?after=` sucht stattdessen direkt (Seek-Verfahren):
Die nächste Seite beginnt strikt nach der zuletzt ausgelieferten Zeile.

Jede Listen-Antwort enthält `meta.nextCursor`, solange es eine weitere Seite gibt.
Senden Sie diesen unverändert zurück:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Der Cursor ist **opak** — er kodiert die Sortierschlüssel *und* die Werte der letzten
Zeile für diese —, woraus drei Regeln folgen, die jeweils zu einem 400-Fehler anstelle
einer falschen Seite führen:

| Situation | Code |
|-----------|------|
| `after` mit `offset` oder `page` | `CURSOR_WITH_OFFSET` — beide geben an, wo die Seite beginnt |
| `after` mit einem anderen `orderBy` als dem, unter dem er ausgestellt wurde | `CURSOR_ORDER_MISMATCH` |
| Ein Cursor, der nicht von dieser API ausgestellt wurde | `INVALID_CURSOR` |

Eine Anfrage, die kein `orderBy` angibt, **übernimmt die Sortierung des Cursors**,
sodass das Zurücksenden von `meta.nextCursor` ohne erneute Angabe der Sortierung funktioniert.

Sortierungen nach mehreren Schlüsseln und Nullable-Schlüssel werden beide korrekt paginiert:
Der Vergleich wird über jeden Schlüssel der Reihe nach aufgebaut, unter Berücksichtigung
der für die Sortierung deklarierten NULL-Platzierung. Die einzige Sortierung, die kein Cursor
beschreiben kann, ist Relevanz (`_score`) — pro Abfrage berechnet und nirgends gespeichert —,
und eine solche Auflistung enthält schlicht keinen `nextCursor`.

## Spalten auswählen

`?fields=` schränkt einen Lesevorgang auf die von Ihnen angegebenen Spalten ein.
Es handelt sich um eine Projektion, die in die Datenbankabfrage verschoben wird,
nicht um ein Kürzen der Antwort:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

Der Primärschlüssel wird immer zurückgegeben (eine Zeile, die nicht adressiert
werden kann, kann weder aktualisiert, gelöscht noch per Paginierung überschritten
werden — und der Cursor wird daraus abgeleitet), und Spalten mit `excludeFromApi`
bleiben verborgen, unabhängig davon, ob sie angegeben sind. Eine unbekannte Spalte
führt zu einem 400 `UNKNOWN_FIELD` statt zu einer Zeile, bei der stillschweigend ein
Feld fehlt.

`?distinct=true` fasst Zeilen zusammen, die bezüglich dieser Spalten identisch sind:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Es wird zusammen mit einem gerankten `searchString` oder einer Vektorsuche abgelehnt (400),
da diese einen Score pro Zeile anhängen, der jede Zeile per Konstruktion eindeutig macht,
sowie wenn `orderBy` eine Spalte benennt, die `fields` nicht zurückgibt
(`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres kann einen DISTINCT-Lesevorgang nicht
nach einem Ausdruck sortieren, der außerhalb seiner SELECT-Liste liegt.

`?fields=` und `?distinct=` funktionieren auch auf der Get-by-ID-Route und den
verschachtelten Subcollection-Routen.

### Antwortformat

Listen-Antworten enthalten Paginierungs-Metadaten:

```json
{
    "data": [
        { "id": 1, "name": "Widget", "price": 29.99 },
        { "id": 2, "name": "Gadget", "price": 49.99 }
    ],
    "meta": {
        "total": 150,
        "limit": 20,
        "offset": 0,
        "hasMore": true,
        "nextCursor": "eyJrIjpbWyJpZCIsImRlc2MiXV0sInYiOnsiaWQiOjJ9LCJpIjoyfQ"
    }
}
```

`nextCursor` ist vorhanden, solange `hasMore` wahr ist und die Seite mindestens eine
Zeile zurückgegeben hat; auf der letzten Seite und bei einer Sortierung, die kein
Cursor beschreiben kann, fehlt er.

Antworten für einzelne Entitäten geben ein flaches Objekt zurück:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Fehler

Jeder Fehler, von jeder Route, wird in einem einheitlichen Envelope zurückgegeben:

```json
{
    "error": {
        "message": "Unknown filter operator 'contains' on field 'title'.",
        "code": "UNKNOWN_FILTER_OPERATOR",
        "details": { "field": "title", "operator": "contains" },
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

`message` und `code` sind immer vorhanden. `details` erscheint, wenn sich die
Ablehnung auf etwas Konkretes *bezieht* — das fehlerhafte Feld, die fehlgeschlagenen
Pfade. `requestId` erscheint, wenn die Anfrage einen `X-Request-ID`-Header enthielt
oder ihr einer zugewiesen wurde; er wird auch im Response-Header zurückgegeben und
sollte in einem Fehlerbericht angegeben werden.

**Verzweigen Sie nach `code`, niemals nach `message` oder allein nach dem Status.**
Codes sind in `SCREAMING_SNAKE_CASE` und stabil; Meldungen sind für Personen verfasst,
die eine Konsole lesen, und können sich ändern. Der HTTP-Status befindet sich in der
Antwort, nicht im Body.

| Status | Typischer Code | Bedeutung |
|--------|----------------|-----------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | Die Anfrage ist fehlerhaft oder fordert etwas Unmögliches an |
| 401 | `UNAUTHORIZED` | Keine Anmeldedaten oder solche, die niemanden identifizieren |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | Anmeldedaten, die jemanden ohne die erforderlichen Rechte identifizieren |
| 404 | `NOT_FOUND` | Das adressierte Objekt existiert nicht |
| 409 | `CONFLICT` | Der Zustand steht in Konflikt — ein doppelter Schlüssel, ein veränderter Baum (Dirty Tree) |
| 501 | variiert | Die Schnittstelle existiert, ist aber auf diesem Deployment **nicht konfiguriert** |
| 503 | `SERVICE_UNAVAILABLE` | Eine Abhängigkeit ist nicht verfügbar; die Anfrage hat sie nie erreicht |

Eine Schnittstelle, die nicht vorhanden ist, weil dieses Deployment sie nicht aktiviert
hat, antwortet mit 501 samt Code und Begründung, nicht mit 404 — ein unerklärlicher 404
auf einer Route, die das UI gerade aufgerufen hat, wirkt wie ein fehlerhaftes Deployment.

Routen fügen darüber hinaus ihre eigenen spezifischeren Codes hinzu (`EMAIL_EXISTS`,
`TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), betrachten Sie die Liste der Codes daher
als offen. Das Client-SDK wandelt alle in einen einzigen `RebaseApiError` um, der
`status`, `code` und `details` enthält — siehe
[Fehlerbehandlung](/docs/backend#error-handling).

## Textsuche

Verwenden Sie `searchString` für die Volltextsuche über String-Felder:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Vektorsuche

Wenn eine Collection eine Eigenschaft vom Typ `vector` definiert, können Sie Hochgeschwindigkeits-Ähnlichkeitssuchen mithilfe von pgvector-Distanzoperationen durchführen, die direkt in die Datenbankabfrage kompiliert werden.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Vektor-Query-Parameter

| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| `vector_search` | `string` | Der Name der Vektor-Eigenschaft, gegen die abgefragt werden soll. |
| `vector` | `string` | Ein JSON-serialisiertes Array von Floats, das den Abfragevektor darstellt. |
| `vector_distance` | `string` | Die zu evaluierende Distanzmetrik. Unterstützte Werte: `cosine` (Standard, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Maximaler Distanz-Schwellenwert. Es werden nur Datensätze zurückgegeben, deren Distanz kleiner als dieser Schwellenwert ist. |

## Einbindung von Relationen

Verwenden Sie den Parameter `include`, um verknüpfte Entitäten einzubinden:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations, one hop deep
GET /api/data/articles?include=*

# A relation of a relation — up to three hops
GET /api/data/articles?include=comments.author
```

Ein Name, der keine Relation der Collection ist, führt auf jeder Ebene zu einem
**400 `UNKNOWN_RELATION`**. Früher wurde dies ignoriert, was mit 200 antwortete,
wobei das Feld einfach fehlte — nicht zu unterscheiden von einer Zeile, die
tatsächlich keine verknüpfte Zeile hat, sodass ein Tippfehler exakt wie leere
Daten aussah. Ein Pfad, der tiefer als drei Hops ist, führt zu `INCLUDE_TOO_DEEP`.

### Eine Relation eingrenzen

Die kommagetrennte Form bietet keine Möglichkeit, ein `limit` pro Relation
anzugeben, daher akzeptiert `include` auch JSON — erkennbar an einer führenden
geschweiften Klammer:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Schlüssel | Bedeutung |
|-----------|-----------|
| `limit` | Zeilen **pro übergeordneter Zeile**, nicht über die gesamte Seite |
| `where` | Derselbe Filterdialekt, den auch das Top-Level-`where` verwendet |
| `logical` | Eine `or`/`and`/`not`-Gruppe über die verknüpften Zeilen |
| `orderBy` | Dieselbe Sortierschreibweise, einschließlich der NULL-Platzierung |
| `fields` | Spalten der *verknüpften* Zeile; ihr Primärschlüssel bleibt immer erhalten |
| `include` | Relationen der verknüpften Zeile wiederum |

`true` bedeutet „vollständig laden“, sodass `{"author":true}` und `author` dieselbe
Anfrage sind. Beide Schreibweisen funktionieren auf der Listen-Route, der Get-by-ID-Route
und den verschachtelten Subcollection-Routen.

Jeder Hop ist eine gebatchte Abfrage für die gesamte Seite, niemals eine pro Zeile.

Eingebundene Relationen werden direkt in die Antwort eingebettet:

```json
{
    "id": 1,
    "title": "Getting Started",
    "authorId": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com"
    }
}
```

## Schreiboperationen

Idempotenzschlüssel, bedingte Schreibvorgänge (`ETag` / `If-Match`), Feldoperationen
(`$inc`, `$push`, `$pull`, `$merge`), Upsert auf einem natürlichen Schlüssel,
`Prefer: return=minimal` und der Collection-übergreifende Endpunkt `POST /api/data/_batch`
befinden sich alle auf einer eigenen Seite: **[Schreiboperationen über REST](/docs/backend/writes/)**.

## Lifecycle-Hook-Pipeline

Jede REST-Mutationsoperation (`POST`, `PATCH`, `DELETE`) durchläuft eine strikte, sequentielle Hook-Ausführungspipeline:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Blockierende vs. verzögerte Hooks

1. **Blockierende Hooks (`beforeSave`, `beforeDelete`)**
   Diese Hooks werden synchron im Haupt-Request-Zyklus ausgeführt, *bevor* die Datenbanktransaktion committet wird. Sie können eingehende Payloads modifizieren, benutzerdefinierte Validierungen durchführen oder die Anfrage durch das Auslösen eines Fehlers vollständig abbrechen.

2. **Verzögerte Hooks (`afterSave`, `afterDelete`)**
   Diese Hooks werden asynchron ausgeführt, nachdem die Datenbanktransaktion erfolgreich committet wurde. Sie nutzen Deferred Promises (Fire-and-Forget), was bedeutet, dass sie im Hintergrund laufen und die HTTP-Antwort an den Client nicht blockieren. Ideal für den Versand von Webhooks, das Auslösen von Push-Benachrichtigungen oder das Einreihen externer Aufgaben in eine Warteschlange.

## System-Endpunkte

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|--------------|
| `GET` | `/health` und `/api/health` | keine | Liveness-/Readiness-Prüfung |
| `GET` | `/api/docs` | keine | Die OpenAPI 3.0-JSON-Spezifikation |
| `GET` | `/api/swagger` | keine | Swagger UI. In der Entwicklung aktiviert, in der Produktion deaktiviert; `REBASE_ENABLE_SWAGGER` überschreibt dies in beiden Richtungen |
| `GET` | `/api/meta/schema-version` | keine | Der Schema-Hash, aus dem dieses Backend erstellt wurde — bewusst unauthentifiziert, und es wird nur dieser Hash zurückgegeben |
| `GET` | `/api/meta/contract` | Admin, Service-Key oder Admin-API-Key | Der vollständige Collection-Vertrag für `rebase generate-sdk --from`. Fail-closed: `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, falls gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |

## OpenAPI / Swagger

Die OpenAPI-Spezifikation wird automatisch aus Ihren Collection-Definitionen generiert: Sie beschreibt die Listen-, Lese-, Erstellungs-, Aktualisierungs-, Lösch- und Bulk-Endpunkte jeder vom Backend bereitgestellten Collection mitsamt deren Query-Parametern und Response-Schemas. Sie ist kein vollständiges Abbild der gesamten HTTP-Oberfläche — die Routen für Auth, Storage, Functions und Cron sind ausschließlich auf dieser Website dokumentiert — und als `excludeFromApi` markierte Spalten werden ausgelassen.

Automatisierte Aufrufer authentifizieren sich mit einem Key mit beschränktem Gültigkeitsbereich (Scoped Key) anstelle einer Session:
[API-Keys](/docs/backend/api-keys/).

## Schema-Metadaten

Das vollständige Collection-Schema des Projekts — jede Collection, Eigenschaft und Relation —
wird einem authentifizierten Admin bereitgestellt:

```bash
GET /api/meta/contract
```

Es ist **nur für Admins zugänglich** und wird auf einem Deployment ohne konfigurierte
Authentifizierung überhaupt nicht bereitgestellt (404 `CONTRACT_UNAVAILABLE`), anstatt
das Schema für jeden offenzulegen. Das Gegenstück dazu gibt einen Versions-String zurück,
der das Schema repräsentiert, ohne es zu beschreiben, und bewusst ohne Anmeldedaten
erreichbar ist — was von einem CI-Job abgefragt wird:

```bash
GET /api/meta/schema-version
```

Für die Struktur der Endpunkte statt des dahinterliegenden Schemas befindet sich das
OpenAPI-Dokument unter `GET /api/docs`, mit der Swagger UI unter `/api/swagger`,
wenn `enableSwagger` aktiviert ist.

## Nächste Schritte

- **[Client SDK](/docs/sdk)** — Typsicherer Client für die REST-API
- **[Collections](/docs/collections)** — Definieren Sie Ihr Datenschema
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules)** — Zugriff auf Zeilenebene steuern

---
