---
sourceHash: 10463431afdfaea5
title: REST-API
sidebar_label: REST-API
description: Automatisch generierte REST-API-Endpunkte für jede Collection mit Filterung, Sortierung, Paginierung und Relationen-Einbindung.
---

## Übersicht

Rebase generiert automatisch eine vollständige API aus Ihren Collection-Definitionen:

- **REST-API** — CRUD-Endpunkte für jede Collection unter `/api/data/:slug`
- **OpenAPI-Spezifikation** — Maschinenlesbare Spezifikation unter `/api/docs`
- **Swagger UI** — Interaktiver API-Explorer unter `/api/swagger` (nur im Entwicklungsmodus)

Kein Code erforderlich – definieren Sie Ihre Collections, und die API steht automatisch bereit.

## REST-Endpunkte

Für jede Collection werden die folgenden Endpunkte generiert. Jede andere vom Backend bereitgestellte Route – Authentifizierung, Speicher, Administration, Meta – finden Sie im [Endpunkt-Index](/docs/backend/endpoints/).

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Entitäten auflisten |
| `GET` | `/api/data/:slug/count` | Entitäten zählen |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, optional gruppiert. Akzeptiert dieselben Filter wie der Listen-Endpunkt, und RLS gilt für die aggregierten Zeilen – siehe [Abfragen](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Eine einzelne Entität abrufen |
| `POST` | `/api/data/:slug` | Einen Datensatz erstellen |
| `PATCH` | `/api/data/:slug/:id` | Einen Datensatz aktualisieren (partiell – nur die übergebenen Eigenschaften werden geschrieben) |
| `DELETE` | `/api/data/:slug/:id` | Einen Datensatz löschen |
| `POST` | `/api/data/:slug/bulk` | Mehrere Entitäten in einer einzigen Transaktion erstellen |
| `PATCH` | `/api/data/:slug/bulk` | Mehrere Entitäten in einer einzigen Transaktion aktualisieren |
| `POST` | `/api/data/:slug/bulk/delete` | Mehrere Entitäten in einer einzigen Transaktion löschen |
| `POST` | `/api/data/_batch` | Collection-**übergreifend** in einer einzigen Transaktion schreiben |

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

Um beliebig tief verschachtelte Subcollections zu handhaben, leitet Rebase eingehende Anfragen mithilfe des Hono-Regex-Parameters `:rest{.+}` weiter. Die interne Segment-Parsing-Engine analysiert Pfade durch Zählen der durch Schrägstriche getrennten Segmente:
- **Ungerade Segmentanzahl** (z. B. `authors/42/posts` -> 3 Segmente) repräsentiert eine Collection-Listenanfrage.
- **Gerade Segmentanzahl** (z. B. `authors/42/posts/7` -> 4 Segmente) repräsentiert eine Operation auf einer spezifischen Entitäts-ID. Das letzte Segment wird als Ziel-`entityId` extrahiert.

Die Engine filtert reservierte System-Namespaces (z. B. `history`) aus der Pfadsegmentanalyse heraus, um Kollisionen mit integrierten Endpunkten zu verhindern.

## Authentifizierung

Alle Daten-Endpunkte erfordern standardmäßig eine Authentifizierung. Fügen Sie ein Bearer-Token im `Authorization`-Header hinzu:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Für Server-zu-Server-Aufrufe verwenden Sie den Service-Key:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

## Filterung

Verwenden Sie Query-Parameter im PostgREST-Stil, um Ergebnisse zu filtern. Das Format ist `?field=operator.value`:

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
| `csa` | Array enthält beliebige | `?tags=csa.(a,b)` |
| `like` | Mustervergleich, beachtet Groß-/Kleinschreibung (`like`) | `?sku=like.AB-%` |
| `ilike` | Mustervergleich, ignoriert Groß-/Kleinschreibung (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Entspricht nicht dem Muster (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Entspricht nicht, ignoriert Groß-/Kleinschreibung (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | Spalte ist `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | Spalte ist nicht `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

`isnull` und `notnull` ignorieren ihren Wert – der Operator bildet die gesamte Bedingung ab, und alles nach dem Punkt wird verworfen. Das SDK schreibt `.null`, weshalb dies die Schreibweise ist, die Sie bei der Übertragung sehen.

:::caution[`eq.null` ist die vier Zeichen lange Zeichenkette, nicht `IS NULL`]
`?deleted_at=eq.null` sucht nach dem Literaltext `null`. Ein SQL `= NULL` ist niemals wahr, daher gibt es keine Interpretation von `eq.null`, die als Null-Prüfung fungieren könnte – verwenden Sie dafür `isnull`. Das SDK serialisiert `.where("deleted_at", "==", null)` genau aus diesem Grund als `isnull.null`.
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

`not` negiert die **Konjunktion** seiner Bedingungen: `not(a)` ist `NOT a`, und `not(a,b)` ist `NOT (a AND b)`. Es wird zu echtem SQL `NOT (...)` kompiliert anstatt zu invertierten Operatoren – SQL ist dreiwertig, sodass `NOT (a AND b)` und `(NOT a) OR (NOT b)` in dem Moment nicht mehr übereinstimmen, in dem ein NULL im Spiel ist. Eine Negation **beinhaltet daher Zeilen, deren Spalte NULL ist**, was der Bedeutung von `NOT` entspricht; kombinieren Sie es über AND mit `notnull`, falls dies nicht gewünscht ist.

**Eine Gruppe pro Anfrage: `or` hat Vorrang vor `and`, und beide vor `not`.** Es handelt sich um drei Schreibweisen desselben Slots, nicht um drei Filter. Schachteln Sie stattdessen:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Gruppen können bis zu 32 Ebenen tief verschachtelt werden; darüber hinaus wird die Anfrage mit `INVALID_LOGICAL_GROUP` abgelehnt.

Eine Gruppe **schränkt** neben den Feldfiltern **ein**, anstatt sie zu ersetzen – siehe [Wie die Filter kombiniert werden](#wie-die-filter-kombiniert-werden).

### Der `where`-JSON-Dialekt

Die obigen Feldfilter sind eine von zwei Möglichkeiten, einen Filter zu übermitteln. Die andere ist ein einzelnes JSON-Objekt, das das OpenAPI-Dokument für jedes `GET /api/data/{slug}` publiziert und das auch die verschachtelten Subcollection-Routen akzeptieren:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Jeder Schlüssel ist ein Feld, jeder Wert ein kanonisches `[operator, value]`-Tupel – dieselben Tupel, die das SDK schreibt. Ein Wert kann auch ein vorserialisierter Punkt-String (`{"status":"eq.active"}`) oder ein einfacher Skalar (`{"status":"active"}`) sein; alle drei kompilieren zur gleichen Bedingung.

Der wichtige Unterschied: **JSON überträgt Typen.** `?price=gte.100` sendet den String `"100"` und der Treiber castet ihn anhand des Spaltentyps, während `?where={"price":[">=",100]}` eine Zahl sendet. Für eine Spalte, deren Text- und numerische Interpretation sich unterscheiden – ein Versionsstring, ein mit Nullen aufgefüllter Code – ist dies der bevorzugte Parameter.

Ein fehlerhaftes `where` führt zu einem 400 `INVALID_WHERE` und wird nicht stillschweigend verworfen: Ein Verwerfen würde den Lesevorgang ungefiltert ausführen und alles zurückgeben, was die Zeilenebenen-Sicherheit (RLS) gerade erlaubt.

### Wie die Filter kombiniert werden

`?field=op.value`, `?where=`, `?or=`/`?and=` und `?searchString=` sind unabhängig voneinander, und jeder vorhandene Parameter muss zutreffen:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Es gibt keine Möglichkeit, diese Parameter untereinander mit ODER zu verknüpfen. Alles, was keine einfache UND-Verknüpfung dieser Gruppen ist, gehört in einen einzelnen `or=`/`and=`-Baum.

## Sortierung

Verwenden Sie `orderBy` im Format `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Eine fehlende Richtungsangabe entspricht `asc`. Eine Richtung, die weder `asc` noch `desc` ist, oder ein Feld, das in der Collection nicht existiert, führt zu einem **400**-Fehler – nicht zu einem 200-Status mit Zeilen in beliebiger Datenbankreihenfolge, was von einer erfolgreichen Sortierung nicht zu unterscheiden wäre.

### Mehrere Schlüssel

Die Kurzschreibweise unterstützt einen Schlüssel. Für mehrere übergeben Sie ein JSON-Array – der zweite Schlüssel entscheidet zwischen Zeilen, die der erste als gleichwertig einstuft:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Beide Schreibweisen funktionieren bei allen Routen, die Zeilen auflisten, einschließlich verschachtelter Routen (`/api/data/authors/:id/posts`). Jede Sortierung endet standardmäßig absteigend nach der Zeilen-ID, unabhängig davon, ob dies explizit angegeben wurde: Dadurch wird die Sortierung total (eindeutig), und das Paginieren über eine nicht-totale Sortierung würde Zeilen wiederholen oder überspringen.

Ein wiederholter `?orderBy=`-Parameter ist keine Multi-Key-Sortierung – der letzte gewinnt, wie bei jedem anderen Query-Parameter. Verwenden Sie das Array.

### Sortierposition von NULL-Werten

Standardmäßig werden NULL-Werte **aufsteigend zuletzt und absteigend zuerst** sortiert, was der Postgres-eigenen Konvention entspricht. Ein drittes, durch Doppelpunkt abgetrenntes Segment ermöglicht ein abweichendes Verhalten:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

Die JSON-Array-Form akzeptiert dafür einen `"nulls"`-Schlüssel:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Jeder andere Wert als `first` oder `last` führt zu einem 400-Fehler, nicht zu einer stillschweigend abweichenden Reihenfolge. Der Cursor weiter unten berücksichtigt die deklarierte Sortierung, sodass die Paginierung über nullable Schlüssel bei beiden Platzierungen korrekt bleibt.

## Paginierung

Verwenden Sie `limit` und `offset` oder `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

Das Standardlimit ist **50**, das Maximum liegt bei **1000**. Beide Werte stammen aus `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, was auch in der generierten OpenAPI-Spezifikation ausgewiesen wird – ein `limit` oberhalb des Maximums wird abgelehnt statt gekürzt.

Alle drei Fensterparameter werden abgelehnt statt korrigiert und benennen den Fehler präzise: `INVALID_LIMIT`, `INVALID_OFFSET` (eine ganze Zahl >= 0) und `INVALID_PAGE` (eine ganze Zahl >= 1). Ein Fenster, das stillschweigend von der Anfrage abweicht, lässt sich nicht vom Erreichen des Endes der Collection unterscheiden; daher wird keiner der Werte gekürzt oder ignoriert.

### Cursor-Paginierung

`offset` zählt Zeilen bei jeder Anfrage neu, sodass eine zwischen zwei Seiten eingefügte oder gelöschte Zeile das Fenster verschiebt und beim Durchlaufen unbemerkt Zeilen übersprungen oder wiederholt werden. `?after=` positioniert stattdessen zeigerbasiert: Die nächste Seite beginnt strikt nach der zuletzt ausgelieferten Zeile.

Jede Listenantwort enthält `meta.nextCursor`, solange eine weitere Seite verfügbar ist. Senden Sie diesen unverändert zurück:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Der Cursor ist **opak** – er kodiert die Sortierschlüssel *und* die Werte der letzten Zeile für diese – woraus drei Regeln folgen (die jeweils zu einem 400-Fehler statt einer falschen Seite führen):

| Situation | Code |
|-----------|------|
| `after` mit `offset` oder `page` | `CURSOR_WITH_OFFSET` — beide definieren, wo die Seite beginnt |
| `after` mit einem anderen `orderBy` als bei der Erstellung | `CURSOR_ORDER_MISMATCH` |
| Ein Cursor, der nicht von dieser API generiert wurde | `INVALID_CURSOR` |

Eine Anfrage ohne `orderBy` **übernimmt die Sortierung des Cursors**, sodass das Zurücksenden von `meta.nextCursor` ohne erneute Angabe der Sortierung funktioniert.

Multi-Key-Sortierungen und Nullable-Schlüssel paginieren beide korrekt: Der Vergleich wird über alle Schlüssel der Reihe nach aufgebaut, unter Berücksichtigung der deklarierten NULL-Platzierung. Die einzige Sortierung, die kein Cursor beschreiben kann, ist Relevanz (`_score`) – diese wird pro Abfrage berechnet und nirgends gespeichert; eine solche Auflistung enthält schlicht keinen `nextCursor`.

## Spalten auswählen

`?fields=` beschränkt einen Lesevorgang auf die angegebenen Spalten. Es handelt sich um eine Projektion, die direkt in die Datenbankabfrage verschoben wird, nicht um ein nachträgliches Kürzen der Antwort:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

Der Primärschlüssel wird immer zurückgegeben (eine Zeile, die nicht adressiert werden kann, kann weder aktualisiert, gelöscht noch überblättert werden – und der Cursor wird daraus abgeleitet), und als `excludeFromApi` markierte Spalten bleiben verborgen, unabhängig davon, ob sie angegeben wurden. Eine unbekannte Spalte führt zu einem 400 `UNKNOWN_FIELD` anstelle einer Zeile, in der ein Feld stillschweigend fehlt.

`?distinct=true` fasst Zeilen zusammen, die über diese Spalten hinweg identisch sind:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Dies wird (mit 400) abgewiesen, wenn gleichzeitig ein gerankter `searchString` oder eine Vektorsuche verwendet wird (da diese einen Score pro Zeile anhängen, der jede Zeile konstruktionsbedingt eindeutig macht), sowie wenn `orderBy` eine Spalte benennt, die `fields` nicht zurückgibt (`DISTINCT_ORDER_BY_NOT_SELECTED`) – Postgres kann einen DISTINCT-Lesevorgang nicht nach einem Ausdruck sortieren, der nicht in der SELECT-Liste enthalten ist.

`?fields=` und `?distinct=` funktionieren auch auf der Get-by-ID-Route und den verschachtelten Subcollection-Routen.

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

`nextCursor` ist vorhanden, solange `hasMore` true ist und die Seite mindestens eine Zeile zurückgegeben hat; auf der letzten Seite sowie bei einer Sortierung, die kein Cursor beschreiben kann, fehlt er.

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

Jeder Fehler, von jeder Route, wird in einem einheitlichen Umschlag (Envelope) zurückgegeben:

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

`message` und `code` sind immer vorhanden. `details` erscheint, wenn sich die Ablehnung auf etwas *Konkretes* bezieht – das fehlerhafte Feld, die Pfade, die fehlgeschlagen sind. `requestId` erscheint, wenn die Anfrage einen `X-Request-ID`-Header enthielt oder ihr einer zugewiesen wurde; er wird auch im Response-Header zurückgegeben und ist die Referenz, die bei einem Fehlerbericht anzugeben ist.

**Verzweigen Sie nach `code`, niemals nach `message` oder allein nach dem Status.** Codes sind in `SCREAMING_SNAKE_CASE` formatiert und stabil; Nachrichten sind für Personen geschrieben, die eine Konsole lesen, und können sich ändern. Der HTTP-Status befindet sich in der Response, nicht im Body.

| Status | Typischer Code | Bedeutung |
|--------|----------------|-----------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | Die Anfrage ist fehlerhaft oder verlangt etwas Unmögliches |
| 401 | `UNAUTHORIZED` | Keine Anmeldedaten oder solche, die niemanden identifizieren |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | Anmeldedaten identifizieren jemanden ohne ausreichende Berechtigung |
| 404 | `NOT_FOUND` | Das adressierte Objekt existiert nicht |
| 409 | `CONFLICT` | Zustandskonflikt – ein doppelter Schlüssel, ein ungültiger Baumzustand |
| 501 | variiert | Der Endpunkt existiert, ist aber auf diesem Deployment **nicht konfiguriert** |
| 503 | `SERVICE_UNAVAILABLE` | Eine Abhängigkeit ist nicht erreichbar; die Anfrage hat sie nie erreicht |

Ein Endpunktbereich, der fehlt, weil dieses Deployment ihn nicht aktiviert hat, antwortet mit 501 samt Code und Begründung, nicht mit 404 – ein unerklärter 404 auf einer Route, die das UI gerade aufgerufen hat, wirkt wie ein fehlerhaftes Deployment.

Routen fügen darüber hinaus eigene spezifischere Codes hinzu (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), daher ist die Liste der Codes als offen zu betrachten. Das Client-SDK wandelt alle in einen einzigen `RebaseApiError` um, der `status`, `code` und `details` enthält – siehe [Fehlerbehandlung](/docs/backend#error-handling).

## Textsuche

Verwenden Sie `searchString` für die Volltextsuche über String-Felder:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Vektorsuche

Wenn eine Collection eine Eigenschaft vom Typ `vector` definiert, können Sie hochperformante Ähnlichkeitssuchen mithilfe von pgvector-Distanzoperationen durchführen, die direkt in die Datenbankabfrage kompiliert werden.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Vektor-Query-Parameter

| Parameter | Typ | Beschreibung |
|-----------|------|-------------|
| `vector_search` | `string` | Der Name der Vektoreigenschaft, gegen die abgefragt werden soll. |
| `vector` | `string` | Ein JSON-serialisiertes Array von Floats, das den Abfragevektor darstellt. |
| `vector_distance` | `string` | Die zu evaluierende Distanzmetrik. Unterstützte Werte: `cosine` (Standard, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Maximaler Distanz-Schwellenwert. Es werden nur Datensätze zurückgegeben, deren Distanz kleiner als dieser Schwellenwert ist. |

## Einbindung von Relationen

Verwenden Sie den Parameter `include`, um verknüpfte Entitäten einzubetten:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations, one hop deep
GET /api/data/articles?include=*

# A relation of a relation — up to three hops
GET /api/data/articles?include=comments.author
```

Ein Name, der keine Relation der Collection ist, führt auf jeder Ebene zu einem **400 `UNKNOWN_RELATION`**. Früher wurde dies ignoriert, was mit 200 antwortete, wobei das Feld einfach fehlte – nicht zu unterscheiden von einer Zeile, die tatsächlich keine verknüpfte Zeile hat, sodass ein Tippfehler wie leere Daten aussah. Ein Pfad, der tiefer als drei Ebenen geht, führt zu `INCLUDE_TOO_DEEP`.

### Eine Relation einschränken

Die durch Kommas getrennte Form bietet keine Möglichkeit für ein `limit` pro Relation; daher akzeptiert `include` auch JSON – erkennbar an einer führenden geschweiften Klammer:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Schlüssel | Bedeutung |
|-----|---------|
| `limit` | Zeilen **pro Elternzeile**, nicht über die gesamte Seite |
| `where` | Derselbe Filterdialekt, den auch das Top-Level-`where` verwendet |
| `logical` | Eine `or`/`and`/`not`-Gruppe über die verknüpften Zeilen |
| `orderBy` | Dieselbe Sortierschreibweise, einschließlich der NULL-Platzierung |
| `fields` | Spalten der *verknüpften* Zeile; ihr Schlüssel bleibt immer erhalten |
| `include` | Relationen der verknüpften Zeile, wiederum verschachtelt |

`true` bedeutet „vollständig laden“, daher sind `{"author":true}` und `author` dieselbe Anfrage. Beide Schreibweisen funktionieren auf der Listen-Route, der Get-by-ID-Route und den verschachtelten Subcollection-Routen.

Jede Verknüpfungsebene ist eine einzige gebündelte Abfrage für die gesamte Seite, niemals eine pro Zeile.

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

Idempotenz-Schlüssel, bedingte Schreibvorgänge (`ETag` / `If-Match`), Feldoperationen (`$inc`, `$push`, `$pull`, `$merge`), Upserts auf einem natürlichen Schlüssel, `Prefer: return=minimal` und der collection-übergreifende Endpunkt `POST /api/data/_batch` werden auf einer eigenen Seite behandelt: **[Schreiboperationen über REST](/docs/backend/writes/)**.

## Lifecycle-Hook-Pipeline

Jede REST-Mutationsoperation (`POST`, `PATCH`, `DELETE`) durchläuft eine strikte, sequentielle Hook-Ausführungspipeline:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Blockierende vs. verzögerte Hooks

1. **Blockierende Hooks (`beforeSave`, `beforeDelete`)**
   Diese Hooks werden synchron im Hauptanfragezyklus ausgeführt, *bevor* die Datenbanktransaktion committet wird. Sie können eingehende Payloads modifizieren, benutzerdefinierte Validierungen ausführen oder die Anfrage durch das Auslösen eines Fehlers vollständig abbrechen.

2. **Verzögerte Hooks (`afterSave`, `afterDelete`)**
   Diese Hooks werden asynchron ausgeführt, nachdem die Datenbanktransaktion erfolgreich committet wurde. Sie verwenden verzögerte Promises (Fire-and-Forget), was bedeutet, dass sie im Hintergrund laufen und die HTTP-Antwort an den Client nicht blockieren. Ideal für das Senden von Webhooks, das Auslösen von Push-Benachrichtigungen oder das Einreihen externer Aufgaben in Warteschlangen.

## System-Endpunkte

| Methode | Pfad | Authentifizierung | Beschreibung |
|--------|------|------|-------------|
| `GET` | `/health` and `/api/health` | keine | Liveness-/Readiness-Prüfung |
| `GET` | `/api/docs` | keine | Die OpenAPI 3.0 JSON-Spezifikation |
| `GET` | `/api/swagger` | keine | Swagger UI. In der Entwicklung aktiviert, in der Produktion deaktiviert; `REBASE_ENABLE_SWAGGER` überschreibt dies in beide Richtungen |
| `GET` | `/api/meta/schema-version` | keine | Der Schema-Hash, aus dem dieses Backend erstellt wurde – bewusst unauthentifiziert, und er gibt nur diesen Hash zurück |
| `GET` | `/api/meta/contract` | Admin, Service-Key oder Admin-API-Key | Der vollständige Collection-Vertrag für `rebase generate-sdk --from`. Fail-Closed: `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` falls gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |

## OpenAPI / Swagger

Die OpenAPI-Spezifikation wird automatisch aus Ihren Collection-Definitionen generiert: Sie beschreibt die Listen-, Lese-, Erstellungs-, Aktualisierungs-, Lösch- und Bulk-Endpunkte jeder Collection, die das Backend bereitstellt, zusammen mit deren Abfrageparametern und Antwortschemas. Sie stellt keine vollständige Übersicht der gesamten HTTP-Oberfläche dar – die Routen für Authentifizierung, Speicher, Funktionen und Cron sind ausschließlich auf dieser Website dokumentiert – und als `excludeFromApi` markierte Spalten werden darin weggelassen.

Maschinelle Aufrufer authentifizieren sich mit einem berechtigungseingeschränkten Schlüssel anstelle einer Session:
[API-Schlüssel](/docs/backend/api-keys/).

## Schema-Metadaten

Das vollständige Collection-Schema des Projekts – jede Collection, Eigenschaft und Relation – wird einem authentifizierten Administrator bereitgestellt:

```bash
GET /api/meta/contract
```

Es ist **nur für Administratoren** zugänglich, und auf einem Deployment ohne konfigurierte Authentifizierung wird es gar nicht erst bereitgestellt (404 `CONTRACT_UNAVAILABLE`), anstatt das Schema für jedermann offenzulegen. Sein Gegenstück gibt einen Versions-String zurück, der für das Schema steht, ohne es zu beschreiben, und bewusst ohne Anmeldedaten erreichbar ist – was von einem CI-Job abgefragt wird:

```bash
GET /api/meta/schema-version
```

Für die Struktur der Endpunkte statt des dahinterliegenden Schemas steht das OpenAPI-Dokument unter `GET /api/docs` bereit, mit Swagger UI unter `/api/swagger`, wenn `enableSwagger` aktiviert ist.

## Nächste Schritte

- **[Client-SDK](/docs/sdk)** — Typsicherer Client für die REST-API
- **[Collections](/docs/collections)** — Definieren Sie Ihr Datenschema
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules)** — Zugriffskontrolle auf Zeilenebene

---
