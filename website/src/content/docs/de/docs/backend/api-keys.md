---
sourceHash: 87d15c9eb4314422
title: API-Schlüssel
sidebar_label: API-Schlüssel
description:"\"Geltungsbereichsbezogene, widerrufbare Schlüssel für maschinelle Aufrufer: Worauf ein Schlüssel zugreifen kann, wie Scopes mit Row-Level Security interagieren und die Admin-Endpunkte zu deren Verwaltung.\""
---

## API-Schlüssel

API-Schlüssel bieten Machine-to-Machine-Authentifizierung für Agents, MCP-Server, CI-Pipelines und externe Integrationen. Sie unterstützen berechtigungsspezifische Scopes pro Collection und optionalen vollständigen Admin-Zugriff.

### Erstellen eines API-Schlüssels

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

Die Antwort enthält den vollständigen Klartext-Schlüssel (`rk_live_...`) **genau einmal** – speichern Sie ihn sofort.

### Verwenden eines API-Schlüssels

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Berechtigungen und RLS: zwei unabhängige Prüfungen

Die Anfrage eines API-Schlüssels durchläuft **zwei** Autorisierungsprüfungen, und beide müssen sie erlauben:

1. **Die Berechtigungsliste des Schlüssels** – Collection × Operation, geprüft auf der Route-Ebene.
2. **Row-Level Security** – API-Schlüssel umgehen RLS *nicht*. Ein Schlüssel wird als
   `uid: "api-key:<id>"` mit der Rolle `service` ausgeführt (plus `admin`, wenn
   `admin: true`). Admin-Schlüssel passieren über die integrierten Admin-Policies; ein
   Nicht-Admin-Schlüssel sieht nur Zeilen, die eine Sicherheitsregel explizit der
   Rolle `service` oder der Öffentlichkeit gewährt. Regeln im Eigentümer-Stil
   (`owner_id = rebase.uid()`) stimmen niemals mit einem API-Schlüssel überein.

Ein Nicht-Admin-Schlüssel mit `"*"`-Berechtigungen kann daher trotzdem leere Ergebnisse erhalten – das
ist die Funktionsweise von RLS, kein Fehler. Gewähren Sie der Rolle `service` entweder
Zugriff in den Sicherheitsregeln der jeweiligen Collections oder verwenden Sie einen Admin-Schlüssel.

### Benutzerdefinierte Funktionen

Funktionsaufrufe sind ähnlich wie Collections im Namespace `functions` geschützt:
`{"collection": "functions", "operations": ["write"]}` gewährt Zugriff auf jede
Funktion, `"functions/<name>"` auf eine bestimmte und der globale Wildcard `"*"` auf
alle. Ein Schlüssel ohne einen solchen Eintrag kann Funktionen überhaupt nicht aufrufen.

### Storage

Storage funktioniert auf dieselbe Weise unter dem Namespace `storage`:
`{"collection": "storage", "operations": ["read", "write"]}` ermöglicht es dem Schlüssel
herunterzuladen/aufzulisten (`read`), hochzuladen und Ordner zu erstellen (`write`) sowie
Dateien zu löschen (`delete`). Der globale Wildcard `"*"` gewährt ebenfalls Zugriff auf
Storage. Ein Schlüssel ohne einen solchen Eintrag kann nicht auf Storage zugreifen.
TUS-Resumable-Upload-Routen zählen bei jedem Schritt als `write` (einschließlich Offset-Prüfung
und Abbruch), sodass ein Schlüssel mit Schreibberechtigung einen Upload eigenständig
abschließen kann.

### Agents und MCP-Server

Ein Agent benötigt den *am stärksten eingeschränkten* Schlüssel, der für seine Aufgabe
ausreicht, keinen Admin-Schlüssel. Beginnen Sie mit spezifischen Scopes und versehen
Sie ihn mit einem Ablaufdatum:

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Operationen sind `read`, `write` und `delete`, abgeleitet von der HTTP-Methode:
`GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` →
`delete`.

#### Ein scoped Schlüssel liest null Zeilen, bis eine Regel `service` gewährt

Dies ist der Schritt, der einen korrekt konfigurierten Schlüssel defekt wirken lässt. Ein
Nicht-Admin-Schlüssel wird als `uid: "api-key:<id>"` mit den Rollen `["service"]`
ausgeführt, und die standardmäßig in jede Collection eingefügte RLS-Policy kompiliert zu:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

– der Serverkontext oder ein Admin. Ein Nicht-Admin-Schlüssel erfüllt keine der beiden
Bedingungen. Bei einer Collection ohne `securityRules` ist die Anfrage daher erfolgreich,
liefert jedoch eine leere Ergebnismenge ohne erklärende Fehlermeldung zurück. Gewähren
Sie die Rolle explizit:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Da `rebase.uid()` die ID des Schlüssels enthält, kann eine Regel Zeilen auch auf einen
bestimmten Schlüssel beschränken:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Verwenden Sie `"*"` nicht für einen Read-Only-Schlüssel

Der Wildcard `"*"` steht nicht nur für „jede Collection“ – er deckt auch den
`functions`-Namespace und `storage` ab. Ein `GET` zählt als `read`, und der Handler
einer benutzerdefinierten Funktion ist beliebiger Code, der Schreiboperationen
durchführen kann. Somit kann ein als „read-only“ gedachter Wildcard-Schlüssel Daten
über eine Funktion verändern. Wenn Collections explizit benannt werden, erhält der
Schlüssel keinerlei Zugriff auf Funktionen.

#### `--admin --full-access`: CI, Migrationen, First-Party-Tools

`"admin": true` gewährt dem Schlüssel die Admin-Rolle – `/api/admin/*`-Routen für
Schemaverwaltung, Benutzerverwaltung und mehr sowie Cron-Jobs, Backups und Logs.
In Kombination mit `--full-access` (`{"collection": "*", "operations": ["read", "write",
"delete"]}`) umfasst der Schlüssel jede Collection sowie den gesamten Storage und jede
benutzerdefinierte Funktion. Das ist das passende Profil für CI, Migrationen und
vertrauenswürdige First-Party-Tools – nicht jedoch für Agents.

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

Der Realtime-WebSocket verarbeitet keine `rk_`-Tokens – er akzeptiert ausschließlich
Benutzer-JWTs und den Service-Key. Ein mit einem API-Schlüssel authentifizierter Agent
fragt stattdessen die REST-Endpunkte ab (Polling), anstatt Subscriptions zu nutzen.

### Schlüsseloptionen

| Feld | Typ | Beschreibung |
|---|---|---|
| `name` | `string` | Menschenlesbare Bezeichnung |
| `permissions` | `ApiKeyPermission[]` | Zugriff pro Collection (`"*"` = alles; `"functions/<name>"` = eine Funktion; `"storage"` = Datei-Storage) |
| `admin` | `boolean` | Gewährt Admin-Rolle – Admin-Routen + RLS-Admin-Policies |
| `rate_limit` | `number \| null` | Anfragen pro 15-Minuten-Fenster (`null` = Server-Standardwert, 1000) |
| `expires_at` | `string \| null` | ISO-8601-Ablaufzeitstempel |

Die CLI erfordert einen expliziten Geltungsbereich (Scope): Übergeben Sie `--permissions '<json>'`
oder wählen Sie explizit `--full-access` – es gibt keinen stillschweigenden Standard für Vollzugriff.

Schlüssel können über `/api/admin/api-keys` oder die CLI-Befehle von `rebase api-keys`
aufgelistet, aktualisiert und widerrufen werden – jedoch nicht durch einen API-Schlüssel
selbst. Jede Anfrage an `/api/admin/api-keys`, die mit einem `rk_`-Schlüssel authentifiziert
wird, wird mit `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` abgelehnt, unabhängig von dessen
`admin`-Flag. Die Schlüsselverwaltung erfordert die Sitzung eines Admin-Benutzers oder
den Service-Key.

## Nächste Schritte

- [REST-API](/docs/backend/api/) – die Endpunkte, die ein Schlüssel aufruft
- [Endpunkt-Index](/docs/backend/endpoints/) – die Zugangskontrolle auf jeder Route, einschließlich Schlüsseln
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/) – was die Datenbank zusätzlich zu den Scopes eines Schlüssels erzwingt

---
