---
sourceHash: 4fc45b4d1d08afde
title: REST API
sidebar_label: REST API
description: Automatisch generierte REST-API-Endpunkte für jede Tabelle mit Filterung, Sortierung, Paginierung und Einbindung von Relationen.
---

## Übersicht

Rebase generiert automatisch eine vollständige API aus Ihren Tabellen:

- **REST API** — CRUD-Endpunkte für jede Tabelle unter `/api/data/:slug`
- **OpenAPI-Spezifikation** — Maschinenlesbare Spezifikation unter `/api/docs`, die für jeden angemeldeten Aufrufer für die Tabellen bereitgestellt wird, die er sehen darf
- **Swagger UI** — Interaktiver API-Explorer unter `/api/swagger`, wenn Sie das Dokument veröffentlichen (`REBASE_ENABLE_SWAGGER=true`, außerhalb der Produktion)

Kein Code erforderlich — [deklarieren Sie Ihre Tabellen](/docs/schema/) und die API wird automatisch bereitgestellt.

## REST-Endpunkte

Für jede Tabelle werden die folgenden Endpunkte generiert. Jede andere Route, die das Backend bereitstellt — Auth, Storage, Admin, Meta — befindet sich im [Endpunkt-Index](/docs/backend/endpoints/).

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| `GET` | `/api/data/:slug` | Entitäten auflisten |
| `POST` | `/api/data/:slug/query` | Dieselbe Auflistung mit Query-Parametern in einem JSON-Body — für Abfragen, die zu lang für eine URL sind. Siehe [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | Entitäten zählen |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, optional gruppiert. Akzeptiert dieselben Filter wie der Listen-Endpunkt, und RLS gilt für die aggregierten Zeilen — siehe [Querying](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Eine einzelne Entität abrufen |
| `POST` | `/api/data/:slug` | Einen Datensatz erstellen |
| `PATCH` | `/api/data/:slug/:id` | Einen Datensatz aktualisieren (partiell — es werden nur die gesendeten Eigenschaften geschrieben) |
| `DELETE` | `/api/data/:slug/:id` | Einen Datensatz löschen |
| `POST` | `/api/data/:slug/bulk` | Mehrere Entitäten in einer Transaktion erstellen |
| `PATCH` | `/api/data/:slug/bulk` | Mehrere Entitäten in einer Transaktion aktualisieren |
| `POST` | `/api/data/:slug/bulk/delete` | Mehrere Entitäten in einer Transaktion löschen |
| `POST` | `/api/data/_batch` | Tabellen**übergreifend** in einer Transaktion schreiben |

### Verschachtelte Routen

Relationen sind über URL-Pfade zugänglich:

```
GET    /api/data/authors/42/posts         → list author's posts
POST   /api/data/authors/42/posts/query   → the same listing, parameters in the body (0.24+)
POST   /api/data/authors/42/posts/count   → the same count, parameters in the body (0.24+)
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Routing-Mechanik & Segment-Parsing

Um beliebige Verschachtelungstiefen zu handhaben, routet Rebase eingehende Anfragen mithilfe von Honos Regex-Parameter `:rest{.+}`. Die interne Segment-Parsing-Engine analysiert Pfade durch Zählen der durch Schrägstriche getrennten Segmente:
- **Ungerade Segmentanzahl** (z. B. `authors/42/posts` -> 3 Segmente) stellt eine Listenabfrage auf der verknüpften Tabelle dar.
- **Gerade Segmentanzahl** (z. B. `authors/42/posts/7` -> 4 Segmente) stellt eine Operation auf einer bestimmten Zeilen-ID dar. Das letzte Segment wird als Ziel-ID extrahiert.

Die Engine filtert reservierte System-Namespaces (z. B. `history`) aus der Pfadsegmentanalyse heraus, um Kollisionen mit integrierten Endpunkten zu verhindern.

## Authentifizierung

Alle Daten-Endpunkte erfordern standardmäßig eine Authentifizierung. Fügen Sie ein Bearer-Token im `Authorization`-Header ein:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Verwenden Sie für Server-zu-Server-Aufrufe den Service-Schlüssel:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

Das Filtern einer Liste — `?field=op.value`-Operatoren, `or`/`and`-Gruppen, der `where`-JSON-Dialekt und wie sie kombiniert werden — hat [eine eigene Seite](/docs/backend/filtering).

## Sortierung

Verwenden Sie `orderBy` mit dem Format `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Eine fehlende Richtung ist standardmäßig `asc`. Eine Richtung, die weder `asc` noch `desc` ist, oder ein Feld, das die Tabelle nicht besitzt, führt zu einem **400**-Fehler — nicht zu einem 200 mit Zeilen in beliebiger Reihenfolge der Datenbank, was von einer funktionierenden Sortierung nicht zu unterscheiden wäre.

### Mehrere Schlüssel

Die Kurzschreibweise unterstützt einen Schlüssel. Für mehrere übergeben Sie ein JSON-Array — der zweite Schlüssel entscheidet zwischen Zeilen, die nach dem ersten gleich sind:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Beide Schreibweisen funktionieren auf jeder Route, die Zeilen auflistet, einschließlich verschachtelter Routen (`/api/data/authors/:id/posts`). Jede Sortierung endet mit der Zeilen-ID absteigend, unabhängig davon, ob dies angefordert wurde: Dies sorgt für eine totale Ordnung, und das Paginieren über eine nicht-totale Ordnung würde Zeilen wiederholen oder überspringen.

Ein wiederholter `?orderBy=`-Parameter ist keine Sortierung nach mehreren Schlüsseln — der letzte gewinnt, wie bei jedem anderen Query-Parameter auch. Verwenden Sie das Array.

### Positionierung von NULL-Werten

Standardmäßig werden NULL-Werte **aufsteigend zuletzt und absteigend zuerst** sortiert, was der Konvention von Postgres entspricht. Ein drittes Doppelpunkt-Segment ändert dies:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

Die JSON-Array-Form akzeptiert einen `"nulls"`-Schlüssel für denselben Zweck:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Alles andere als `first` oder `last` führt zu einem 400-Fehler, nicht zu einer stillschweigend anderen Reihenfolge. Der nachfolgend beschriebene Cursor berücksichtigt die deklarierte Sortierung, sodass die Paginierung über nullable Schlüssel bei beiden Platzierungen korrekt bleibt.

## Paginierung

Verwenden Sie `limit` und `offset` oder `page` — entweder das eine oder das andere:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

Das Standardlimit ist **50**, das Maximum **1000**. Beide stammen aus `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, was auch in der generierten OpenAPI-Spezifikation angegeben ist — ein `limit` über dem Maximum wird abgelehnt statt begrenzt.

Alle drei Fenster-Parameter werden abgelehnt statt korrigiert, und jeder benennt sich selbst: `INVALID_LIMIT`, `INVALID_OFFSET` (eine ganze Zahl von 0 oder mehr) und `INVALID_PAGE` (eine ganze Zahl von 1 oder mehr). Ein Fenster, das stillschweigend von dem angeforderten abweicht, lässt sich nicht vom Erreichen des Tabellenendes unterscheiden, weshalb keiner von ihnen begrenzt oder ignoriert wird.

Aus demselben Grund führen `page` und `offset` zusammen zu einem 400 `PAGE_WITH_OFFSET`, anstatt dass einer von ihnen stillschweigend gewinnt.

### Zählung überspringen

`meta.total` ist ein `COUNT(*)` über jede passende Zeile — bei einer großen Tabelle der Hauptaufwand einer Listenanfrage. `?count=none` (`GET /api/data/orders?count=none`) überspringt dies: kein `meta.total`, während `meta.hasMore` exakt bleibt (der Lesevorgang fordert eine Zeile mehr als die Seite an). `?count=exact` ist der Standardwert; jeder andere Wert führt zu einem 400 `INVALID_COUNT`. Ein Lesevorgang mit `?distinct=true` wird nie gezählt, ebenso wenig wie eine Vektorsuche mit einem `vector_threshold` (siehe [Vektorsuche](/docs/backend/vector-search/)).

### Cursor-Paginierung

`offset` zählt Zeilen bei jeder Anfrage neu, sodass eine Zeile, die zwischen zwei Seiten eingefügt oder gelöscht wird, das Fenster verschiebt und der Durchlauf stillschweigend Zeilen überspringt oder wiederholt. `?after=` sucht stattdessen direkt: Die nächste Seite beginnt strikt nach der zuletzt ausgelieferten Zeile.

Jede Listen-Antwort enthält `meta.nextCursor`, solange eine weitere Seite vorhanden ist. Senden Sie ihn unverändert zurück:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

Der Cursor ist **opak** — er codiert die Sortierschlüssel *und* die Werte der letzten Zeile dafür — woraus drei Regeln folgen, die jeweils zu einem 400-Fehler statt zu einer falschen Seite führen:

| Situation | Code |
|-----------|------|
| `after` mit `offset` oder `page` | `CURSOR_WITH_OFFSET` — beide definieren, wo die Seite beginnt |
| `after` mit einem anderen `orderBy` als bei der Ausstellung | `CURSOR_ORDER_MISMATCH` |
| Ein Cursor, der nicht von dieser API ausgestellt wurde | `INVALID_CURSOR` |

Eine Anfrage, die kein `orderBy` angibt, **übernimmt das des Cursors**, sodass das Zurücksenden von `meta.nextCursor` ohne erneute Angabe der Sortierung funktioniert.

Sortierungen nach mehreren Schlüsseln und Nullable-Schlüssel paginieren beide korrekt: Der Vergleich wird über jeden Schlüssel der Reihe nach aufgebaut, mit der von der Sortierung deklarierten NULL-Platzierung. Die einzige Reihenfolge, die kein Cursor beschreiben kann, ist Relevanz (`_score`) — die pro Abfrage berechnet und nirgends gespeichert wird — und eine solche Auflistung enthält schlicht keinen `nextCursor`.

## Spalten auswählen

`?fields=` schränkt einen Lesevorgang auf die von Ihnen angegebenen Spalten ein. Es handelt sich um eine Projektion, die in die Abfrage übergeben wird, nicht um ein nachträgliches Kürzen der Antwort:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

Der Primärschlüssel wird immer zurückgegeben (eine Zeile, die nicht adressiert werden kann, kann nicht aktualisiert, gelöscht oder weiterpaginiert werden — und der Cursor wird daraus abgeleitet), und `.private()`-Spalten bleiben verborgen, unabhängig davon, ob sie angegeben sind oder nicht. Eine unbekannte Spalte führt zu einem 400 `UNKNOWN_FIELD` statt zu einer Zeile, in der stillschweigend ein Feld fehlt.

Eine in `?include=` angegebene Relation wird unabhängig davon zurückgegeben, ob `?fields=` sie benennt: `?include=author&fields=title` gibt `title`, den Primärschlüssel und `author` zurück. Die Angabe der Relation auch in `?fields=` ist erlaubt und ändert nichts.

`?distinct=true` fasst Zeilen zusammen, die in diesen Spalten identisch sind:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Es wird zusammen mit einem gerankten `searchString` oder einer Vektorsuche abgelehnt (400), da diese einen zeilenweisen Score anhängen, der jede Zeile konstruktionsbedingt eindeutig macht, sowie wenn `orderBy` eine Spalte benennt, die `fields` nicht zurückgibt (`DISTINCT_ORDER_BY_NOT_SELECTED`) — Postgres kann einen DISTINCT-Lesevorgang nicht nach einem Ausdruck außerhalb seiner Select-Liste sortieren.

`?fields=` und `?distinct=` funktionieren auch auf der Get-by-ID-Route und den verschachtelten Routen.

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

`nextCursor` ist vorhanden, solange `hasMore` wahr (true) ist und die Seite mindestens eine Zeile zurückgegeben hat; er fehlt auf der letzten Seite und bei einer Sortierung, die kein Cursor beschreiben kann.

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

`message` und `code` sind immer vorhanden. `details` erscheint, wenn sich die Ablehnung auf etwas Konkretes bezieht — das fehlerhafte Feld, die Pfade, die fehlgeschlagen sind. `requestId` erscheint, wenn die Anfrage einen `X-Request-ID`-Header enthielt oder ihr einer zugewiesen wurde; sie wird auch im Response-Header zurückgegeben und sollte in Fehlerberichten angegeben werden.

**Verzweigen Sie nach `code`, niemals nach `message` oder dem Status allein.** Codes sind in `SCREAMING_SNAKE_CASE` und stabil; Meldungen sind für Personen geschrieben, die eine Konsole lesen, und können sich ändern. Der HTTP-Status befindet sich auf der Response, nicht im Body.

| Status | Typischer Code | Bedeutung |
|--------|----------------|-----------|
| 400 | `BAD_REQUEST`, `INVALID_INPUT`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | Die Anfrage ist fehlerhaft oder fordert etwas Unmögliches an |
| 401 | `UNAUTHORIZED` | Keine Anmeldedaten oder solche, die niemanden identifizieren |
| 403 | `FORBIDDEN`, `SCOPE_MISSING`, `WRITE_DENIED` | Anmeldedaten, die jemanden ohne entsprechende Berechtigung identifizieren |
| 404 | `NOT_FOUND` | Die adressierte Ressource existiert nicht |
| 409 | `CONFLICT` | Der Zustand steht in Konflikt — ein doppelter Schlüssel, ein veralteter Baum (dirty tree) |
| 501 | variiert | Die Schnittstelle existiert, ist auf diesem Deployment jedoch **nicht konfiguriert** |
| 503 | `SERVICE_UNAVAILABLE` | Eine Abhängigkeit ist nicht verfügbar; die Anfrage hat sie nie erreicht |

Eine Schnittstelle, die fehlt, weil dieses Deployment sie nicht aktiviert hat, antwortet mit 501 samt Code und Grund, nicht mit 404 — ein unerklärter 404 auf einer Route, die das UI gerade aufgerufen hat, wirkt wie ein fehlerhaftes Deployment.

Routen fügen darüber hinaus ihre eigenen, spezifischeren Codes hinzu (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), betrachten Sie die Liste der Codes daher als offen. Das typisierte SDK wandelt sie alle in einen einzigen `RebaseApiError` um, der `status`, `code` und `details` enthält — siehe [Fehlerbehandlung](/docs/backend#error-handling).

## Textsuche

Verwenden Sie `searchString` für die Volltextsuche über String-Felder:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Vektorsuche

Eine Tabelle mit einer `col.vector()`-Spalte unterstützt eine Nearest-Neighbour-Suche bei der Auflistung: `?vector_search=embedding&vector=[0.15,0.22,-0.05]`, mit optionalem `vector_distance` und `vector_threshold`. Die Parameter, Schwellenwerte und wie sich Filter auf dem Index verhalten, finden Sie unter [Vektorsuche](/docs/backend/vector-search/).

## Abfragen, die zu lang für eine URL sind

`POST /api/data/:slug/query` (diese Auflistung) und `POST /api/data/:slug/count` akzeptieren die Query-Parameter in einem JSON-Body für Abfragen, deren URL zu lang wäre — ein Embedding, eine lange `in`-Liste.
Siehe [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url).

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

Ein Name, der keine Relation der Tabelle ist, führt auf jeder Ebene zu einem **400 `UNKNOWN_RELATION`**. Früher wurde dies ignoriert, was mit 200 antwortete, wobei das Feld einfach fehlte — nicht zu unterscheiden von einer Zeile, die tatsächlich keine verknüpfte Zeile hat, sodass ein Tippfehler genau wie leere Daten aussah. Ein Pfad, der tiefer als drei Hops geht, führt zu `INCLUDE_TOO_DEEP`. Ein Name ist der exakte Schlüssel der Relation in den `relations` der Tabelle; die Schreibweisen als Slug oder snake_case, die ältere Versionen ebenfalls versuchten, sind es nicht. Verknüpfte Zeilen werden im deklarierten [`orderBy`](/docs/collections/relations/) der Relation zurückgegeben, wenn die Anfrage keines angibt, und ein Fremdschlüssel, den eine Relation auf einer `bigint`- oder `numeric`-Spalte generiert, wird als Zahl bereitgestellt.

### Eine Relation eingrenzen

Die kommagetrennte Form bietet keinen Platz für ein `limit` pro Relation, daher akzeptiert `include` auch JSON — erkennbar an einer führenden geschweiften Klammer:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Schlüssel | Bedeutung |
|-----------|-----------|
| `limit` | Zeilen **pro übergeordneter Zeile (Parent-Zeile)**, nicht über die gesamte Seite. Wird durch die Abfrage angewendet, sodass darüber hinausgehende Zeilen gar nicht erst aus der Datenbank gelesen werden |
| `where` | Derselbe Filterdialekt, den das Top-Level-`where` verwendet |
| `logical` | Eine `or`/`and`/`not`-Gruppe über die verknüpften Zeilen |
| `orderBy` | Dieselbe Sortierschreibweise, einschließlich der NULL-Platzierung. Gleichstände und ein `limit` ohne `orderBy` richten sich aufsteigend nach dem Schlüssel der verknüpften Zeile |
| `fields` | Spalten der *verknüpften* Zeile; ihr Primärschlüssel bleibt immer erhalten |
| `include` | Relationen der verknüpften Zeile, wiederum verschachtelt |
| `count` | `true` gibt auch die Gesamtzahl jedes übergeordneten Elements unter `_count` zurück (`"_count":{"comments":37}`), gezählt durch dasselbe Statement. Nur für To-Many-Relationen. Siehe [Zählen, was ein Limit auslässt](/docs/sdk/relations#counting-what-a-limit-leaves-out) |

`true` bedeutet „vollständig laden“, daher sind `{"author":true}` und `author` dieselbe Anfrage.
Beide Schreibweisen funktionieren auf der Listen-Route, der Get-by-ID-Route und den verschachtelten Routen.

Jeder Hop ist eine gebatchte Abfrage für die gesamte Seite, niemals eine Abfrage pro Zeile.

Eingebundene Relationen werden direkt in die Antwort eingebettet:

```json
{
    "id": 1,
    "title": "Getting Started",
    "authorId": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com",
        "companyId": 7
    }
}
```

Eine eingebundene Zeile entspricht dem, was die eigene Route des Ziels (`GET /api/data/authors/42`) liefert: dieselben Spalten und Encodings, Fremdschlüssel als Spalten, keine Referenzobjekte.

## Schreiben

Idempotenzschlüssel, bedingte Schreibvorgänge (`ETag` / `If-Match`), Feldoperationen (`$inc`, `$push`, `$pull`, `$merge`), Upserting auf einem natürlichen Schlüssel, `Prefer: return=minimal` und der tabellenübergreifende Endpunkt `POST /api/data/_batch` befinden sich alle auf einer eigenen Seite: **[Schreiben über REST](/docs/backend/writes/)**.

## Lifecycle-Hook-Pipeline

Unter Postgres führt jede REST-Mutation (`POST`, `PATCH`, `DELETE`) die Hooks ihrer Tabelle der Reihe nach innerhalb derjenigen Transaktion aus, die den Schreibvorgang kapselt:

```
Request ──► BEGIN ──► beforeSave/beforeDelete ──► DB operation ──► afterSave/afterDelete ──► COMMIT ──► Response
```

Auf jeden Hook wird gewartet (awaited), und ein Fehler (throw) in einem von ihnen macht den gesamten Schreibvorgang rückgängig:

1. **`beforeSave`, `beforeDelete`** werden vor dem Schreiben ausgeführt. Sie können die eingehenden Werte ändern, validieren oder die Anfrage durch Werfen einer Exception ablehnen — der Aufrufer erhält **400 `CALLBACK_REJECTED`** und es wird nichts geschrieben.
2. **`afterSave`, `afterDelete`** werden nach dem Schreiben, aber *vor* dem Commit ausgeführt. Ein Throw führt zum Rollback der Zeile und antwortet mit demselben 400-Fehler, wobei `details.stage` den Hook benennt. Sie halten die Transaktion während ihrer Ausführung offen, weshalb sie der falsche Ort für einen Webhook oder einen anderen Netzwerkaufruf sind — [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) beschreibt, wohin diese Aufgaben gehören.

## System-Endpunkte

| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|--------------|
| `GET` | `/health` und `/api/health` | keine | Liveness-/Readiness-Prüfung |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Seit 0.31</span> standardmäßig die Aufrufer, für die `GET /api/schema/tables` Tabellen beschreibt (401 für anonyme Aufrufer, außer `schemaTables.public`); keine, wenn `enableSwagger` `true` ist; das Admin-Gate, wenn es `false` ist | Die OpenAPI 3.0 JSON-Spezifikation — standardmäßig nur die Tabellen, Spalten und Relationen, die der Schema-Endpunkt für diesen Aufrufer beschreibt. `404 DOCS_UNAVAILABLE`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/api/swagger` | keine | Swagger UI. Wird nur bereitgestellt, wenn `enableSwagger` `true` ist (`REBASE_ENABLE_SWAGGER=true`), und niemals in der Produktion |
| `GET` | `/api/meta/schema-version` | keine | Der Schema-Hash, aus dem dieses Backend erstellt wurde, und die Runtime-Version — bewusst unauthentifiziert und enthält nichts, was das Schema beschreibt |
| `GET` | `/api/meta/contract` | `schema:read`: ein Administrator, der Service-Schlüssel oder ein API-Schlüssel, der diese Berechtigung hält | Die Schema-Version, die Runtime und jede Tabelle, wie ein Administrator sie sieht, für `rebase generate-sdk --from`. Fail-closed: `404`, wenn keine Authentifizierung konfiguriert ist |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN`, falls gesetzt | Prometheus-Metriken, wenn `REBASE_METRICS=true` |

## OpenAPI / Swagger

Die OpenAPI-Spezifikation wird automatisch aus Ihren Tabellen generiert: Sie beschreibt die Endpunkte für List, Query, Count, Aggregate, Read, Create, Update, Delete und Bulk jeder vom Backend bereitgestellten Tabelle, deren verschachtelte Routen sowie `_batch` samt ihren Query-Parametern und Antwortschemata. Sie ist keine vollständige Abbildung der gesamten HTTP-Oberfläche — die Routen für Auth, Storage, Functions und Cron sind ausschließlich auf dieser Website dokumentiert — und Spalten, die als `.private()` markiert sind, werden darin ausgelassen. Die `description` einer Tabelle und das `.describe()` einer Spalte dienen als deren Beschreibungen.

Für eine [`softDelete`](/docs/collections/soft-delete/)-Tabelle gibt die Spezifikation an, dass ein Löschvorgang (einzeln oder per Bulk) die Zeile in den Papierkorb verschiebt, und dokumentiert `?hard=true` für beide Löschvorgänge sowie `?deleted=include|only` für die Liste, das einzelne Lesen, das Zählen und das Aggregieren. Der API-Explorer des Studios sendet nur die in der Spezifikation genannten Parameter; dies ermöglicht es ihm, Zeilen endgültig zu löschen (purge) oder den Papierkorb aufzulisten.

Maschinelle Aufrufer authentifizieren sich mit einem Key mit Scopes statt mit einer Session:
[API-Schlüssel](/docs/backend/api-keys/).

## Schema-Metadaten

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die vom Backend bereitgestellten Tabellen werden pro Aufrufer unter `GET /api/schema/tables` beschrieben — die Deskriptoren, aus denen das CMS und das Studio rendern. Jedem angemeldeten Aufrufer werden die Tabellen bereitgestellt, die er sehen darf, bereinigt um das, was er lesen darf; [Endpunkte](/docs/backend/endpoints/#schema) enthält die Matrix.

Das gesamte Schema, wie ein Administrator es sieht, wird bereitgestellt unter:

```bash
GET /api/meta/contract
```

```json
{ "schemaVersion": "v2:…", "runtime": { "version": "0.30.1", "contract": 2 }, "tables": [ … ] }
```

Es erfordert den Scope **`schema:read`**, den ein Administrator besitzt, und auf einem Deployment ohne konfigurierte Authentifizierung wird es gar nicht bereitgestellt (404 `CONTRACT_UNAVAILABLE`), anstatt das Schema für jedermann offenzulegen. Schema-Versionen beginnen seit 0.31 mit `v2:`: Sie werden aus den kompilierten Tabellen berechnet, sodass sich die Version jedes Projekts einmalig geändert hat. Der Geschwister-Endpunkt gibt einen Versions-String zurück, der für das Schema steht, ohne es zu beschreiben, und ist bewusst ohne Anmeldedaten erreichbar — was von CI-Jobs gepollt wird:

```bash
GET /api/meta/schema-version
```

Für die Struktur der Endpunkte statt des dahinterliegenden Schemas befindet sich das OpenAPI-Dokument unter `GET /api/docs`: Angemeldet erhalten Sie das Dokument für die Tabellen, die Sie sehen dürfen. Swagger UI unter `/api/swagger` wird nur bereitgestellt, wenn das Dokument mit `REBASE_ENABLE_SWAGGER=true` veröffentlicht wird, außerhalb der Produktion.

## Nächste Schritte

- **[Typed SDK](/docs/sdk)** — Typsicherer Client für die REST-API
- **[Tabellen](/docs/schema/)** — Definieren Sie Ihr Datenschema
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules)** — Zugriff pro Zeile steuern
