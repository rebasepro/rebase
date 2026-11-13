---
sourceHash: 92edb85e26e286c4
title: API-Schlüssel
sidebar_label: API-Schlüssel
description: "Langlebige Schlüssel für Skripte, CI, Agenten und Integrationen: Service-Schlüssel und persönliche Schlüssel, die Scopes, die sie besitzen, wie sie mit Row-Level Security zusammenwirken und die Routen, die sie verwalten."
---

## API-Schlüssel

Ein API-Schlüssel ist ein langlebiges Bearer-Credential, `rk_live_…`, für einen
Aufrufer, der keine Person in einem Browser ist: ein Skript, ein CI-Job, ein Agent,
ein MCP-Client, ein anderer Dienst. Was ein Schlüssel tun darf, wird durch eine Liste
von [Scopes](/docs/backend/roles-and-scopes/) bestimmt, wie etwa `data:read:orders`
oder `cron:write`.

Es gibt zwei Arten:

- Ein **Service-Schlüssel** ist die projekteigene Maschinenidentität. Er agiert als
  `api-key:<id>`, nicht als Person. Jeder mit der Berechtigung `keys:write` verwaltet
  sie unter `/api/admin/api-keys`.
- Ein **persönlicher Schlüssel** agiert im Namen des Kontos, das ihn erstellt hat.
  Jedes Konto verwaltet seine eigenen unter `/api/auth/keys`, sofern die App sie
  aktiviert hat.

### Verwendung eines Schlüssels

Senden Sie ihn als Bearer-Token, genau wie ein Access-Token. `$API_URL` ist die
Adresse Ihres Backends: was auch immer `rebase dev` ausgegeben hat oder die URL
Ihres Deployments.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

Derselbe Schlüssel funktioniert für die REST-API, Storage, benutzerdefinierte
Funktionen, die Administrationsbereiche, die seine Scopes abdecken, das Realtime-WebSocket
und den [`/mcp`-Endpunkt](/docs/ai/remote-mcp/).

## Service-Schlüssel

### Erstellen eines Schlüssels

Ein Service-Schlüssel benötigt einen Namen und mindestens einen Scope.

```bash
# CLI: talks to the backend with the service key from .env
rebase api-keys create --name "Order sync" --scopes data:read:orders,data:write:orders

# REST: needs keys:write
curl -X POST "$API_URL/api/admin/api-keys" \
  -H "Authorization: Bearer $REBASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Order sync",
    "scopes": ["data:read:orders", "data:write:orders"]
  }'
```

Oder mit dem Client-SDK:

```ts
const { key } = await client.apiKeys.createKey({
    name: "Order sync",
    scopes: ["data:read:orders", "data:write:orders"],
    expires_at: "2027-01-01T00:00:00.000Z"
});
console.log(key.key); // the only time the plaintext is returned
```

Die Antwort enthält den vollständigen Klartext-Schlüssel (`rk_live_...`) **genau einmal**.
Speichern Sie ihn sofort.

| Feld | Typ | Beschreibung |
|---|---|---|
| `name` | `string` | Eine Bezeichnung für Menschen |
| `scopes` | `string[]` | Was der Schlüssel tun darf. Mindestens einer |
| `roles` | `string[]` | RLS-Rollen, unter denen der Schlüssel neben `service` ausgeführt wird. Optional |
| `rate_limit` | `number \| null` | Anfragen pro 15-Minuten-Fenster. `null` oder nicht vorhanden verwendet den Standardwert des Servers für API-Schlüssel, 1000. Siehe [Rate-Limit](#rate-limit) |
| `expires_at` | `string \| null` | ISO-8601-Ablaufdatum. Fehlt dieser Wert, läuft er nie ab |

### Scopes und RLS: zwei unabhängige Schranken

Eine mit einem Schlüssel durchgeführte Anfrage durchläuft zwei Prüfungen, und beide
müssen sie erlauben:

1. **Die Scopes des Schlüssels**, die von der Route geprüft werden: `data:write:orders`
   erlaubt dem Schlüssel, `orders` zu schreiben, und nichts anderes.
2. **Row-Level Security**, die von der Datenbank geprüft wird. Ein Schlüssel umgeht
   diese niemals. Ein Service-Schlüssel läuft als `uid: "api-key:<id>"` mit der
   Rolle `service` sowie allen `roles`, die ihm zugewiesen wurden. Regeln im
   Eigentümer-Stil (`owner_id = rebase.uid()`) treffen niemals auf ihn zu.

Ein Schlüssel mit `data:read` kann also dennoch leere Ergebnisse erhalten. Das ist die
Funktionsweise von RLS und kein Fehler. Gewähren Sie der Rolle `service` Zugriff in den
Sicherheitsregeln der Collection oder geben Sie dem Schlüssel die Rolle `admin`.

#### Ein Service-Schlüssel liest null Zeilen, bis eine Regel `service` gewährt

Dies ist der Schritt, der einen korrekt konfigurierten Schlüssel defekt wirken lässt.
Die RLS-Richtlinie, die Rebase standardmäßig zu jeder Tabelle hinzufügt, kompiliert zu:

```sql
(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))
```

Das ist der Serverkontext oder ein Administrator. Ein Service-Schlüssel ohne
`admin`-Rolle entspricht keinem der beiden Zweige. Bei einer Tabelle, deren `rls` auf
`"admin-only"` steht, ist die Anfrage erfolgreich, liefert jedoch ein leeres Ergebnis
ohne Fehlermeldung, die den Grund erklärt. Gewähren Sie die Rolle explizit im `rls`
der Tabelle:

```ts
rls: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Da `rebase.uid()` die ID des Schlüssels enthält, kann eine Regel Zeilen auch auf einen
bestimmten Schlüssel beschränken:

```ts
rls: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Die Rolle `admin`

`roles: ["admin"]` (`--roles admin` in der CLI) bewirkt, dass der Schlüssel auch mit
der RLS-Rolle `admin` ausgeführt wird, sodass er die Standard-Admin-Richtlinien jeder
Collection erfüllt, die diese beibehält. Diese Richtlinien decken `SELECT`, `INSERT`,
`UPDATE` und `DELETE` ab, sodass Row-Level Security die Lese-, Schreib- oder Löschvorgänge
des Schlüssels nicht einschränkt: Er kann jede Zeile lesen, ändern und löschen, die seine
Scopes abdecken. Die Rolle besteht auch die Admin-Prüfungen außerhalb der Datenbank:
`requireAdmin` in [benutzerdefinierten Funktionen](/docs/backend/custom-functions/) und
die Schreibvorgänge, die Storage Administratoren vorbehält. Sie gewährt keine Scopes:
Der Schlüssel erreicht weiterhin nur das, was in seinen `scopes` aufgeführt ist.

Ein Ersteller kann einem Schlüssel nur Rollen zuweisen, die er selbst innehat, es sei
denn, er ist ein Administrator.

### Vollzugriff für CI und Migrationen

`--full-access` gibt dem Schlüssel jeden Scope, den sein Ersteller besitzt, abzüglich
`keys:read` und `keys:write`, die kein Schlüssel besitzen darf. Über die CLI, die den
Service-Schlüssel verwendet, ist dies jeder Scope der Daten- und Administrationsebene.
Fügen Sie `--roles admin` hinzu, und Row-Level Security schränkt nicht mehr ein, welche
Zeilen er liest, ändert oder löscht:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

Das ist das passende Format für CI, Migrationen und vertrauenswürdige First-Party-Tools.
Für einen Agenten ist es nicht das richtige Format.

### Rate-Limit

Das `rate_limit` eines Schlüssels gibt an, wie viele Anfragen er in einem 15-Minuten-Fenster
stellen darf, und jeder Zugang zählt in einem gemeinsamen Bucket, `api-key:<id>`, dagegen:

- seine HTTP-Anfragen an die Data-, Storage- und Functions-APIs;
- seine Daten-Frames auf dem Realtime-Socket: Abrufe, Zählungen, Speicher- und Löschvorgänge
  sowie Abonnements und Kanalverlaufsanfragen über das
  [Kontingent](/docs/backend/realtime/#what-a-write-costs-and-the-limits) jedes Sockets hinaus;
- seine Anfragen an [`/mcp`](/docs/ai/remote-mcp/).

Ohne ein `rate_limit` enthält das Bucket den Standardwert des Servers für API-Schlüssel,
1000. Ein persönlicher Schlüssel hat kein eigenes `rate_limit` und zählt in seinem eigenen
Bucket mit diesem Standardwert. Bei Überschreitung des Limits antwortet eine HTTP-Anfrage
mit `429` und ein Socket-Frame mit `RATE_LIMITED`.

Die Admin-Routen unter `/api/admin` und die Admin-Nachrichten des Sockets, wie etwa die des
SQL-Editors, unterliegen keiner Ratenbegrenzung.

Ein Administrator, der einen Schlüssel simuliert („Simulate access“, `x-rebase-simulate-api-key-id`),
verbraucht sein eigenes Kontingent, nicht das des Schlüssels: Die Integration, die mit diesem
Schlüssel läuft, behält ihr gesamtes Budget. Das Simulieren oder Nachahmen (Impersonating)
eines Benutzers wird dem Administrator auf die gleiche Weise angerechnet.

## Persönliche Schlüssel

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein persönlicher Schlüssel agiert **im Namen seines Eigentümers**: mit dessen uid und
dessen Rollen, wie sie zum Zeitpunkt der jeweiligen Anfrage bestehen. Regeln im
Eigentümer-Stil treffen auf ihn zu, sodass er genau das liest, was auch sein Eigentümer
lesen würde – eingegrenzt durch seine Scopes. Er eignet sich für eigene Skripte einer Person,
eine CLI auf deren Laptop oder ein Tool, das mit dem eigenen Konto verknüpft wird.

Sie sind standardmäßig deaktiviert, da jeder davon ein langlebiges Credential für ein
Konto darstellt. Aktivieren Sie sie im `auth`-Block der [Benutzertabelle](/docs/schema/auth-table/):

```typescript
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique()
    },
    rls: "admin-only",
    auth: { personalKeys: true }
});
```

Anschließend verwaltet ein angemeldetes Konto seine eigenen Schlüssel:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

Dasselbe über REST. `$ACCESS_TOKEN` ist das eigene Access-Token des Kontos nach der
Anmeldung:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Ein persönlicher Schlüssel akzeptiert `name`, `scopes` und `expires_at`. Er enthält keine
`roles`, da er mit denen seines Eigentümers läuft, und kein `rate_limit`. Das Senden eines
dieser beiden Felder führt zu `400 INVALID_INPUT`.

Was ein persönlicher Schlüssel enthält, sind seine Scopes, gekürzt auf das, was sein
Eigentümer **im Moment** besitzt. Wird dem Eigentümer eine Rolle entzogen, schrumpft jeder
von ihm erstellte Schlüssel entsprechend mit. Wird das Konto gelöscht, funktionieren dessen
Schlüssel nicht mehr. Wird `personalKeys` deaktiviert, funktioniert ebenfalls kein
persönlicher Schlüssel mehr.

Nur ein Konto kann persönliche Schlüssel besitzen. Ein API-Schlüssel, der Service-Schlüssel
und eine Gastsitzung werden abgewiesen: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` bei einem
Schlüssel, `403 PERSONAL_KEY_NEEDS_ACCOUNT` bei den anderen beiden. Bei deaktivierter
Funktion antwortet jede Route mit `403 PERSONAL_KEYS_DISABLED`.

## Was die einzelnen Scopes abdecken

### Daten

`data:read`, `data:write` und `data:delete`, allgemein oder auf eine einzelne Collection
eingegrenzt (`data:read:posts`). Die Operation leitet sich von der HTTP-Methode ab:
`GET`, `HEAD` und `OPTIONS` lesen, `POST`, `PUT` und `PATCH` schreiben, `DELETE` löscht.
`POST /api/data/:slug/bulk/delete` zählt als Löschvorgang, obwohl es ein `POST` ist.

Bei einem verschachtelten Pfad wird die Operation anhand der Collection geprüft, an der
der Pfad endet, und jede Collection, die er durchläuft, benötigt `data:read`. Einem
Schlüssel, der nur `data:read:posts` besitzt, wird `/api/data/authors/1/posts` verweigert,
bis er auch `authors` lesen darf.

### Storage

`storage:read` listet auf und lädt herunter. `storage:write` lädt hoch und erstellt
Ordner und deckt jeden Schritt eines fortsetzbaren Uploads (TUS) ab, einschließlich der
Offset-Prüfung und des Abbruchs. `storage:delete` löscht. Das Ziel ist eine Storage-Source-ID.
Die ID der Standardquelle ist `(default)`, sodass `storage:read:(default)` nur die
Standardquelle liest und `storage:write:avatars` in eine Quelle namens `avatars` schreibt.
Nach der Scope-Prüfung wird [`storageAuthorize`](/docs/backend/storage-authorization/)
weiterhin mit der Identität des Schlüssels ausgeführt.

### Functions

`functions:invoke` ruft jede benutzerdefinierte Funktion auf. `functions:invoke:<name>`
ruft eine bestimmte auf. Das Auflisten der Funktionen unter `GET /api/functions` erfordert
den allgemeinen Scope.

Geben Sie `functions:invoke` keinem Schlüssel, der nur lesend zugreifen soll. Eine
Funktion ist Code und kann Schreiboperationen ausführen. Innerhalb einer Funktion lesen
`getScopes(c)` und `hasScope(c, …)` aus, was der Schlüssel besitzt, und eine App kann
eigene Scopes deklarieren, die eine Funktion überprüfen kann. Siehe
[Custom Functions](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Admin-Bereiche

Ein Scope der Administrationsebene auf einem Schlüssel ermöglicht den Zugriff auf den
entsprechenden Bereich. Ein Scheduler, der Cron-Jobs auslöst, benötigt `cron:write`. Ein
Log-Shipper benötigt `logs:read`. Ein Backup-Job benötigt `backups:read`. Der
[Endpunkt-Index](/docs/backend/endpoints/#admin) führt auf, welchen Scope die jeweilige
Route erfordert.

`keys:read` und `keys:write` können niemals einem Schlüssel zugewiesen werden. Ein
Schlüssel, der Schlüssel verwalten könnte, könnte seinen eigenen Nachfolger erzeugen
oder seine eigenen Rechte erweitern. Jede Anfrage an die Schlüssel-Routen, die mit
einem Schlüssel durchgeführt wird, wird mit `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`
abgewiesen. Verwalten Sie Schlüssel als Person mit der Berechtigung `keys:write` oder
mit dem Service-Schlüssel.

### Realtime

Ein Schlüssel authentifiziert auch das WebSocket: Senden Sie ihn in der
`AUTHENTICATE`-Nachricht. Abrufe und Abonnements erfordern `data:read` für ihre Collection,
Speichern `data:write`, Löschen `data:delete`. Ein Abonnement für einen verschachtelten
Pfad erfordert den allgemeinen Scope. Kanäle (Broadcast und Presence) werden für Schlüssel
verweigert. Die Nachrichten des SQL-Editors und für Branches erfordern `database:read`
oder `database:write`.

## Agenten und MCP-Server

Ein Agent benötigt den am *engsten gefassten* Schlüssel, der seine Aufgabe erfüllt.
Beginnen Sie mit eingeschränkten Scopes und versehen Sie ihn mit einem Ablaufdatum:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Lassen Sie `data:delete` weg, wenn der Agent bearbeiten, aber nicht löschen können soll.
`delete` ist genau aus diesem Grund von `write` getrennt.

## Regeln für die Schlüsselerstellung

Jeder Schlüssel wird gegenüber demjenigen geprüft, der ihn erstellt – auf beiden Routen
auf dieselbe Weise:

| Ablehnung | Wann |
|---|---|
| `400 INVALID_SCOPES` | Ein Scope ist fehlerhaft, unbekannt oder enthält ein Ziel, das er nicht unterstützt. `details.validScopes` listet die Scopes auf, die ein Schlüssel besitzen darf. Sie schließt `keys:*` aus, da kein Schlüssel diese besitzen kann |
| `400 UNKNOWN_SCOPE_TARGET` | Ein Ziel benennt eine Collection, eine Storage-Quelle oder eine Funktion, die von diesem Backend nicht bereitgestellt wird |
| `400 KEY_MANAGEMENT_SCOPE` | `keys:read` oder `keys:write` wurde angefordert |
| `403 SCOPE_EXCEEDS_CREATOR` | Ein Scope, den der Ersteller nicht besitzt. Ein Schlüssel besitzt niemals mehr Rechte als das Konto, das ihn erstellt hat |
| `403 ROLE_EXCEEDS_CREATOR` | Eine Rolle für Service-Schlüssel, die der Ersteller nicht besitzt, sofern der Ersteller kein Administrator ist |
| `400 INVALID_ROLE` | Ein Rollenname ist leer oder enthält `,` `{` `}` `"` `\` oder ein Steuerzeichen, was RLS als andere Rollen interpretieren würde |
| `403 KEY_OUTRANKS_CALLER` | Bei einer Änderung (`PUT`) oder einem Widerruf (`DELETE`): Der Schlüssel besitzt bereits eine Rolle oder einen Scope, den der Aufrufer nicht besitzt, und der Aufrufer ist kein Administrator |

Eine Anfrage, für die dem Schlüssel selbst ein Scope fehlt, wird mit `403 SCOPE_MISSING`
beantwortet, wobei der Scope in `details.requiredScope` angegeben ist. Siehe
[Fehlercodes](/docs/backend/errors/#authentication-and-accounts).

## Schlüssel verwalten

| Methode | Pfad | Erfordert |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Ändert `name`, `scopes`, `roles`, `rate_limit` oder `expires_at` nach denselben Regeln wie bei der Erstellung |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Widerruft |
| `GET` | `/api/auth/keys` | Ein Konto: die eigenen persönlichen Schlüssel |
| `POST` | `/api/auth/keys` | Ein Konto, bei aktiviertem `personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Ein Konto: widerruft einen der eigenen Schlüssel |

Jede Route gibt Schlüssel maskiert zurück: `key_prefix`, niemals den Hash. Jeder
Schlüssel meldet seine `kind` (`service` oder `personal`), seine `scopes`, seine
`roles` und bei einem persönlichen Schlüssel seine `owner_uid`.

Die CLI deckt Service-Schlüssel ab: `rebase api-keys list`, `get`, `create`, `revoke`
und `scopes`, was alle dem Backend bekannten Scopes auflistet. Siehe die
[CLI-Referenz](/docs/cli/#rebase-api-keys). Sie authentifiziert sich mit
`REBASE_SERVICE_KEY` aus `.env` und sendet diesen nur an den Server, den `rebase dev`
für dieses Projekt ausführt; ist dieser Server gestoppt, wird nichts gesendet. Für
einen Server, der auf andere Weise ausgeführt wird, wie z. B. mit `rebase start`
oder in einem Container, setzen Sie `REBASE_BASE_URL` auf dessen Adresse
([die eigene Umgebung der CLI](/docs/getting-started/configuration/#the-clis-own-environment)).

## Vor der Einführung von Scopes erstellte Schlüssel

Schlüssel, die vor der Einführung von Scopes erstellt wurden, enthalten eine `permissions`-Liste
und ein `admin`-Flag. Beim Start weist der Store jedem die Scopes zu, die er jetzt besitzt.
Keine Berechtigung wird erweitert; wo es für eine alte Zuweisung keine exakte Entsprechung gibt,
wird sie eingeschränkt:

| Bisherige Zuweisung | Scopes jetzt |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` und `storage:<op>` für jede Operation, plus `functions:invoke`, falls `write` vorhanden war |
| `"storage"` | `storage:<op>` für jede Operation |
| `"functions"` | `functions:invoke`, nur falls `write` vorhanden war |
| `"functions/<name>"` | `functions:invoke:<name>`, nur falls `write` vorhanden war |
| `admin: true` | die `admin`-Rolle, plus `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

Das Secret ändert sich nicht, sodass bestehende Integrationen weiterhin funktionieren.
Zwei Zuweisungen werden eingeschränkt:

- Eine Function-Zuweisung ohne `write` verfällt komplett. Ein `GET` galt früher als
  Lesevorgang, aber eine Funktion ist Code, und ihr Aufruf ist kein Lesevorgang.
- Ein Admin-Schlüssel erhält kein `database:*`, worauf er zuvor nie Zugriff hatte, und kein
  `keys:*`, was kein Schlüssel besitzen darf.

Die alten Spalten `permissions` und `admin` bleiben erhalten, sodass ein Rollback auf
eine ältere Laufzeitumgebung deren Schlüssel weiterhin lesen kann. Eine Anfrage, die
`permissions` oder `admin` anstelle von `scopes` sendet, wird mit `400 INVALID_INPUT`
abgelehnt.

## Nächste Schritte

- [Rollen und Scopes](/docs/backend/roles-and-scopes/): Alle Scopes und wie Rollen sie enthalten
- [Endpunkt-Index](/docs/backend/endpoints/): Der Scope, den jede Route benötigt
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/): Was die Datenbank zusätzlich zu den Scopes eines Schlüssels durchsetzt
