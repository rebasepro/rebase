---
title: REST-API
sidebar_label: REST-API
description: Automatisch generierte REST-API-Endpunkte für jede Collection, mit Filterung, Sortierung, Paginierung und Einbindung von Relationen.
---

## Überblick

Rebase generiert automatisch eine vollständige API aus Ihren Collection-Definitionen:

- **REST-API** — CRUD-Endpunkte für jede Collection unter `/api/data/:slug`
- **OpenAPI-Spezifikation** — Maschinenlesbare Spezifikation unter `/api/docs`
- **Swagger UI** — Interaktiver API-Explorer unter `/api/swagger` (nur im Entwicklungsmodus)

Es ist kein Code erforderlich — definieren Sie Ihre Collections und die API erscheint automatisch.

## REST-Endpunkte

Für jede Collection werden die folgenden Endpunkte generiert:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Entitäten auflisten |
| `GET` | `/api/data/:slug/count` | Entitäten zählen |
| `GET` | `/api/data/:slug/:id` | Eine einzelne Entität abrufen |
| `POST` | `/api/data/:slug` | Eine Entität erstellen |
| `PATCH` | `/api/data/:slug/:id` | Eine Entität aktualisieren |
| `PUT` | `/api/data/:slug/:id` | Eine Entität aktualisieren |
| `DELETE` | `/api/data/:slug/:id` | Eine Entität löschen |
| `POST` | `/api/data/:slug/bulk` | Create many entities in one transaction |
| `PATCH` | `/api/data/:slug/bulk` | Update many entities in one transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Delete many entities in one transaction |

### Subcollection-Routen

Verschachtelte Relationen sind über URL-Pfade zugänglich:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post (PUT also accepted)
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Routing-Mechanik & Segment-Parsing

Um beliebige Verschachtelungstiefen von Subcollections zu handhaben, routet Rebase eingehende Anfragen mit der Hono-Parameter-Regex `:rest{.+}`. Die interne Segment-Parsing-Engine analysiert Pfade durch Zählen der durch Schrägstriche getrennten Segmente:
- **Ungerade Segmentanzahl** (z. B. `authors/42/posts` -> 3 Segmente) steht für eine Collection-Listenanfrage.
- **Gerade Segmentanzahl** (z. B. `authors/42/posts/7` -> 4 Segmente) steht für eine Operation auf einer bestimmten Entitäts-ID. Das letzte Segment wird als Ziel-`entityId` entnommen.

Die Engine filtert reservierte System-Namespaces (z. B. `history`) aus der Pfadsegmentanalyse heraus, um Kollisionen mit integrierten Endpunkten zu verhindern.

## Authentifizierung

Alle Datenendpunkte erfordern standardmäßig eine Authentifizierung. Fügen Sie ein Bearer-Token im `Authorization`-Header hinzu:

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

### Filteroperatoren

| Operator | Bedeutung | Beispiel |
|----------|---------|---------|
| `eq` | Gleich (`==`) | `?active=eq.true` |
| `neq` | Ungleich (`!=`) | `?status=neq.draft` |
| `gt` | Größer als (`>`) | `?price=gt.100` |
| `gte` | Größer oder gleich (`>=`) | `?price=gte.100` |
| `lt` | Kleiner als (`<`) | `?price=lt.50` |
| `lte` | Kleiner oder gleich (`<=`) | `?price=lte.50` |
| `in` | In Array | `?status=in.(a,b,c)` |
| `nin` | Nicht in Array | `?status=nin.(a,b)` |
| `cs` | Array enthält | `?tags=cs.value` |
| `csa` | Array enthält eines | `?tags=csa.(a,b)` |

### Logische Operatoren

Verwenden Sie `or` und `and` für komplexe Bedingungen:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)
```

## Sortierung

Verwenden Sie `orderBy` mit dem Format `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

## Paginierung

Verwenden Sie `limit` und `offset` oder `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses default limit of 20)
GET /api/data/products?page=3
```

Das Standardlimit ist **20**, das Maximum ist **100**.

### Antwortformat

Listenantworten enthalten Paginierungs-Metadaten:

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
        "hasMore": true
    }
}
```

Antworten für eine einzelne Entität geben ein flaches Objekt zurück:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Textsuche

Verwenden Sie `searchString` für die Volltextsuche über String-Felder:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Vektorsuche

Wenn eine Collection eine Property vom Typ `vector` definiert, können Sie Hochgeschwindigkeits-Ähnlichkeitssuchen mit pgvector-Distanzoperationen durchführen, die direkt in die Datenbankabfrage kompiliert werden.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Vektor-Query-Parameter

| Parameter | Typ | Beschreibung |
|-----------|------|-------------|
| `vector_search` | `string` | Der Name der abzufragenden Vektor-Property. |
| `vector` | `string` | Ein JSON-serialisiertes Array von Floats, das den Abfragevektor darstellt. |
| `vector_distance` | `string` | Die auszuwertende Distanzmetrik. Unterstützte Werte: `cosine` (Standard, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Maximaler Distanzschwellenwert. Nur Datensätze mit einer Distanz unter diesem Schwellenwert werden zurückgegeben. |

## Einbindung von Relationen

Verwenden Sie den Parameter `include`, um verwandte Entitäten einzubetten:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations
GET /api/data/articles?include=*
```

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

## Feldauswahl

Verwenden Sie `fields`, um bestimmte Spalten auszuwählen:

```bash
GET /api/data/products?fields=id,name,price
```

## Lifecycle-Hook-Pipeline

Jede REST-Mutationsoperation (`POST`, `PUT`, `DELETE`) durchläuft eine strikte, sequenzielle Hook-Ausführungspipeline:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Blockierende vs. verzögerte Hooks

1. **Blockierende Hooks (`beforeSave`, `beforeDelete`)**
   Diese Hooks werden synchron im Hauptanfragezyklus ausgeführt, *bevor* die Datenbanktransaktion committet wird. Sie können eingehende Payloads modifizieren, benutzerdefinierte Validierungen ausführen oder die Anfrage vollständig abbrechen, indem sie einen Fehler werfen.

2. **Verzögerte Hooks (`afterSave`, `afterDelete`)**
   Diese Hooks werden asynchron ausgeführt, nachdem die Datenbanktransaktion erfolgreich committet wurde. Sie verwenden verzögerte Promises (Fire-and-Forget), das heißt, sie laufen im Hintergrund und blockieren die HTTP-Antwort des Clients nicht. Ideal zum Senden von Webhooks, Auslösen von Push-Benachrichtigungen oder Einreihen externer Aufgaben.


## OpenAPI / Swagger

- **OpenAPI-Spezifikation**: `GET /api/docs` — Gibt die vollständige OpenAPI-3.0-JSON-Spezifikation zurück
- **Swagger UI**: `GET /api/swagger` — Interaktiver API-Explorer (nur im Entwicklungsmodus)

Die OpenAPI-Spezifikation wird automatisch aus Ihren Collection-Definitionen generiert: Sie beschreibt die Listen-, Lese-, Erstellungs-, Aktualisierungs-, Lösch- und Bulk-Endpunkte jeder Collection, die das Backend ausliefert, samt Query-Parametern und Antwortschemata. Sie ist keine vollständige Karte der HTTP-Oberfläche — die Auth-, Storage-, Functions- und Cron-Routen sind nur auf dieser Website dokumentiert — und Spalten mit `excludeFromApi` bleiben darin ausgespart.

## API-Schlüssel

API-Schlüssel bieten Machine-to-Machine-Authentifizierung für Agenten, MCP-Server, CI-Pipelines und externe Integrationen. Sie unterstützen Berechtigungsbereiche pro Collection und optionalen vollständigen Admin-Zugriff.

### Einen API-Schlüssel erstellen

```bash
# Via CLI
rebase api-keys create --name "My Integration" \
  --permissions '[{"collection":"orders","operations":["read","write"]}]'

# Via REST (requires admin auth)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "permissions": [{ "collection": "orders", "operations": ["read", "write"] }]
  }'
```

Die Antwort enthält den vollständigen Klartextschlüssel (`rk_live_...`) **genau einmal** — speichern Sie ihn sofort.

### Einen API-Schlüssel verwenden

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Berechtigungen und RLS: zwei unabhängige Tore

Die Anfrage eines API-Schlüssels durchläuft **zwei** Autorisierungsprüfungen, und beide müssen sie zulassen:

1. **Die Berechtigungsliste des Schlüssels** — Collection × Operation, geprüft auf der Routing-Ebene.
2. **Row-Level Security** — API-Schlüssel umgehen die RLS *nicht*. Ein Schlüssel läuft als
   `uid: "api-key:<id>"` mit der Rolle `service` (plus `admin`, wenn
   `admin: true`). Admin-Schlüssel passieren über die integrierten Admin-Richtlinien; ein
   Nicht-Admin-Schlüssel sieht nur Zeilen, die eine Sicherheitsregel explizit der
   Rolle `service` oder der Öffentlichkeit gewährt. Owner-artige Regeln
   (`owner_id = rebase.uid()`) treffen niemals auf einen API-Schlüssel zu.

Ein Nicht-Admin-Schlüssel mit `"*"`-Berechtigungen kann also trotzdem leere Ergebnisse liefern — das ist
die RLS bei der Arbeit, kein Fehler. Gewähren Sie entweder die Rolle `service` in den Sicherheitsregeln der
relevanten Collections oder verwenden Sie einen Admin-Schlüssel.

### Benutzerdefinierte Funktionen

Funktionsaufrufe sind wie Collections abgegrenzt, unter dem Namespace `functions`:
`{"collection": "functions", "operations": ["write"]}` gewährt jede
Funktion, `"functions/<name>"` gewährt eine, und der globale `"*"`-Platzhalter gewährt
alle. Ein Schlüssel ohne einen solchen Eintrag kann überhaupt keine Funktionen aufrufen.

### Speicher

Speicher funktioniert genauso, unter dem Namespace `storage`:
`{"collection": "storage", "operations": ["read", "write"]}` lässt den Schlüssel
herunterladen/auflisten (`read`), hochladen und Ordner erstellen (`write`) und Dateien löschen
(`delete`). Der globale `"*"`-Platzhalter gewährt ebenfalls Speicher. Ein Schlüssel ohne einen solchen
Eintrag kann den Speicher nicht berühren. TUS-Routen für fortsetzbare Uploads zählen bei jedem Schritt als `write`
(einschließlich der Offset-Prüfung und des Abbruchs), sodass ein Schlüssel mit Schreibbereich
einen Upload eigenständig abschließen kann.

### Agenten und MCP-Server

Ein Agent braucht den *engsten* Schlüssel, der seine Aufgabe erfüllt, keinen
Admin-Schlüssel. Beginnen Sie eingegrenzt und geben Sie ihm ein Ablaufdatum:

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Die Operationen sind `read`, `write` und `delete`, abgeleitet aus der
HTTP-Methode: `GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`,
`DELETE` → `delete`.

#### Ein eingegrenzter Schlüssel liest null Zeilen, bis eine Regel `service` gewährt

Das ist der Schritt, der einen korrekt eingegrenzten Schlüssel kaputt aussehen
lässt. Ein Nicht-Admin-Schlüssel läuft als `uid: "api-key:<id>"` mit den Rollen
`["service"]`, und die RLS-Richtlinie, die standardmäßig in jede Collection
injiziert wird, kompiliert zu:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

— dem Serverkontext oder einem Admin. Ein Nicht-Admin-Schlüssel trifft auf
keinen der beiden Zweige zu, sodass die Anfrage bei einer Collection ohne
`securityRules` mit einem leeren Ergebnis erfolgreich ist — ohne Fehler, der das
erklärt. Gewähren Sie die Rolle explizit:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Da `rebase.uid()` die ID des Schlüssels trägt, kann eine Regel die Zeilen auch auf
einen bestimmten Schlüssel eingrenzen:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Verwenden Sie `"*"` nicht für einen Nur-Lese-Schlüssel

Der `"*"`-Platzhalter umfasst nicht nur Collections — er trifft auch auf den
Namespace `functions` und auf `storage` zu. Ein `GET` zählt als `read`, und der
Handler einer benutzerdefinierten Funktion ist beliebiger Code, der schreiben
kann: ein vermeintlich nur lesender Platzhalter-Schlüssel kann also über eine
Funktion Daten verändern. Werden die Collections explizit benannt, hat der Schlüssel überhaupt
keinen Funktionszugriff.

#### `--admin --full-access`: CI, Migrationen, vertrauenswürdiges eigenes Tooling

`"admin": true` gewährt dem Schlüssel die Admin-Rolle — `/api/admin/*`-Routen
für Schemaverwaltung, Benutzerverwaltung und mehr, plus Cron, Backups und Logs.
Kombiniert mit `--full-access` (`{"collection": "*", "operations": ["read",
"write", "delete"]}`) hält der Schlüssel jede Collection sowie den gesamten
Speicher und jede benutzerdefinierte Funktion. Das ist die richtige Form für CI,
Migrationen und vertrauenswürdiges eigenes Tooling — nicht für Agenten.

```bash
# CLI
rebase api-keys create -n "CI" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

#### Kein Realtime über API-Schlüssel

Der Realtime-WebSocket verarbeitet keine `rk_`-Tokens — er akzeptiert nur
Benutzer-JWTs und den Service-Schlüssel. Ein mit einem API-Schlüssel
authentifizierter Agent pollt die REST-Endpunkte, statt zu abonnieren.

### Schlüsseloptionen

| Feld | Typ | Beschreibung |
|---|---|---|
| `name` | `string` | Menschenlesbares Label |
| `permissions` | `ApiKeyPermission[]` | Zugriff pro Collection (`"*"` = alles; `"functions/<name>"` = eine Funktion; `"storage"` = Dateispeicher) |
| `admin` | `boolean` | Admin-Rolle gewähren — Admin-Routen + RLS-Admin-Richtlinien |
| `rate_limit` | `number \| null` | Anfragen pro 15-Minuten-Fenster (`null` = der Server-Standard, 1000) |
| `expiresAt` | `string \| null` | ISO-8601-Ablaufzeitstempel |

Die CLI erfordert einen expliziten Bereich: Übergeben Sie `--permissions '<json>'` oder entscheiden Sie sich für
`--full-access` — es gibt keinen stillen Standard für vollen Zugriff.

Schlüssel können über `/api/admin/api-keys` oder die CLI-Befehle
`rebase api-keys` aufgelistet, aktualisiert und widerrufen werden — aber nicht
von einem API-Schlüssel. Jede Anfrage an `/api/admin/api-keys`, die mit einem
`rk_`-Schlüssel authentifiziert ist, wird mit `403
API_KEY_SELF_MANAGEMENT_FORBIDDEN` abgelehnt, unabhängig von ihrem
`admin`-Flag. Die Schlüsselverwaltung erfordert die Sitzung eines
Admin-Benutzers oder den Service-Schlüssel.

## Metadaten-Endpunkt

Rufen Sie eine Liste aller verfügbaren Collections und ihrer Struktur ab:

```bash
GET /api/collections
```

## Nächste Schritte

- **[Client-SDK](/docs/sdk)** — Typsicherer Client für die REST-API
- **[Collections](/docs/collections)** — Definieren Sie Ihr Datenschema
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules)** — Zugriff pro Zeile steuern
