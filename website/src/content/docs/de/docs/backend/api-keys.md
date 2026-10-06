---
sourceHash: 411eeede8d2eab1b
title: API-Schlüssel
sidebar_label: API-Schlüssel
description: "Langlebige Schlüssel für Skripte, CI, Agents und Integrationen: Service-Schlüssel und persönliche Schlüssel, die Scopes, die sie halten, wie sie mit Row-Level Security zusammenwirken, und die Routen, die sie verwalten."
---

## API-Schlüssel

<span class="since-badge" data-since="0.24">Seit 0.24</span> Ein API-Schlüssel ist ein langlebiges Bearer-Credential, `rk_live_…`, für einen Aufrufer, der
keine Person im Browser ist: ein Skript, ein CI-Job, ein Agent, ein MCP-Client, ein anderer
Dienst. Was ein Schlüssel darf, ist eine Liste von [Scopes](/docs/backend/roles-and-scopes/),
etwa `data:read:orders` oder `cron:write`.

Es gibt zwei Arten:

- Ein **Service-Schlüssel** ist die eigene Maschinenidentität des Projekts. Er handelt als
  `api-key:<id>`, nicht als Person. Wer `keys:write` hält, verwaltet sie unter
  `/api/admin/api-keys`.
- Ein **persönlicher Schlüssel** handelt als das Konto, das ihn erstellt hat. Jedes Konto verwaltet
  seine eigenen unter `/api/auth/keys`, wenn die App sie aktiviert.

### Einen Schlüssel verwenden

Senden Sie ihn als Bearer-Token, wie ein Access-Token. `$API_URL` ist die Adresse Ihres
Backends: das, was `rebase dev` ausgegeben hat, oder die URL Ihres Deployments.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

Derselbe Schlüssel funktioniert mit der REST-API, Storage, benutzerdefinierten Funktionen, den
Admin-Oberflächen, die seine Scopes erreichen, dem Realtime-WebSocket und dem [`/mcp`-Endpunkt](/docs/ai/mcp/#the-remote-endpoint).

## Service-Schlüssel

### Einen erstellen

<span class="since-badge" data-since="0.24">Seit 0.24</span> Ein Service-Key braucht einen Namen und mindestens einen Scope.

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
| `scopes` | `string[]` | Was der Schlüssel darf. Mindestens einer |
| `roles` | `string[]` | RLS-Rollen, als die der Schlüssel neben `service` ausgeführt wird. Optional |
| `rate_limit` | `number \| null` | Anfragen pro 15-Minuten-Fenster. `null` oder fehlend nutzt den API-Schlüssel-Standard des Servers, 1000. Siehe [Ratenbegrenzung](#ratenbegrenzung) |
| `expires_at` | `string \| null` | ISO-8601-Ablaufdatum. Fehlt es, läuft der Schlüssel nie ab |

### Scopes und RLS: zwei unabhängige Prüfungen

Eine mit einem Schlüssel gestellte Anfrage durchläuft zwei Prüfungen, und beide müssen sie erlauben:

1. **Die Scopes des Schlüssels**, geprüft von der Route: `data:write:orders` lässt den Schlüssel
   in `orders` schreiben und sonst nirgends.
2. **Row-Level Security**, geprüft von der Datenbank. Ein Schlüssel umgeht sie nie. Ein
   Service-Schlüssel wird als `uid: "api-key:<id>"` mit der Rolle `service` ausgeführt, plus allen
   `roles`, die er bekommen hat. Regeln im Eigentümer-Stil (`owner_id = rebase.uid()`) passen nie
   auf ihn.

Ein Schlüssel mit `data:read` kann daher trotzdem leere Ergebnisse bekommen. Das ist RLS bei der Arbeit,
kein Fehler. Gewähren Sie die Rolle `service` in den Sicherheitsregeln der Collection, oder geben Sie
dem Schlüssel die Rolle `admin`.

#### Ein Service-Schlüssel liest null Zeilen, bis eine Regel `service` gewährt

Das ist der Schritt, der einen korrekt mit Scopes versehenen Schlüssel defekt wirken lässt. Die RLS-Policy,
die Rebase standardmäßig jeder Collection hinzufügt, kompiliert zu:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

Das ist der Serverkontext oder ein Admin. Ein Service-Schlüssel ohne die Rolle `admin` erfüllt
keinen der beiden Zweige. Bei einer Collection ohne `securityRules` ist die Anfrage erfolgreich,
mit einem leeren Ergebnis und ohne Fehler, der den Grund erklärt. Gewähren Sie die Rolle explizit:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Da `rebase.uid()` die ID des Schlüssels trägt, kann eine Regel Zeilen auch auf einen
Schlüssel beschränken:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Die Rolle `admin`

`roles: ["admin"]` (`--roles admin` in der CLI) lässt den Schlüssel auch als RLS-Rolle `admin`
laufen. Er passiert damit die Standard-Admin-Policies jeder Collection, die sie
behält. Diese Policies decken `SELECT`, `INSERT`, `UPDATE` und `DELETE` ab, Row-Level
Security begrenzt also weder, was der Schlüssel liest, noch, was er schreibt oder löscht: Er kann
jede Zeile lesen, ändern und löschen, die seine Scopes erreichen. Die Rolle besteht auch die
Admin-Prüfungen außerhalb der Datenbank: `requireAdmin` in
[benutzerdefinierten Funktionen](/docs/backend/custom-functions/) und die Schreibvorgänge, die
Storage Admins vorbehält. Sie gewährt keinen Scope: Der Schlüssel erreicht weiterhin nur, was seine
`scopes` auflisten.

Ein Ersteller kann einem Schlüssel nur Rollen geben, die er selbst hält, es sei denn, er ist
Admin.

### Vollzugriff, für CI und Migrationen

<span class="since-badge" data-since="0.24">Seit 0.24</span> `--full-access` gibt dem Schlüssel jeden Scope, den sein Ersteller hält, abzüglich `keys:read` und
`keys:write`, die kein Schlüssel halten darf. Über die CLI, die den Service-Key nutzt,
ist das jeder Scope der Datenebene und der Admin-Ebene. Fügen Sie `--roles admin` hinzu, und
Row-Level Security begrenzt nicht mehr, welche Zeilen er liest, ändert oder löscht:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

Das ist das richtige Profil für CI, Migrationen und vertrauenswürdige First-Party-Tools. Es ist
nicht das richtige Profil für einen Agent.

### Ratenbegrenzung

<span class="since-badge" data-since="0.24">Seit 0.24</span> Das `rate_limit` eines Schlüssels gibt an, wie viele Anfragen er in einem 15-Minuten-Fenster
stellen darf, und jeder Zugangsweg zählt in einem gemeinsamen Bucket dagegen, `api-key:<id>`:

- seine HTTP-Anfragen an die Daten-, Storage- und Funktions-APIs;
- seine Daten-Frames auf dem Realtime-Socket: Abrufe, Zählungen, Speichervorgänge und Löschungen;
- seine Anfragen an [`/mcp`](/docs/ai/mcp/#the-remote-endpoint).

Ohne `rate_limit` fasst der Bucket den API-Schlüssel-Standard des Servers, 1000. Ein
persönlicher Schlüssel hat kein eigenes `rate_limit` und zählt in seinem eigenen Bucket mit diesem
Standard. Über dem Limit antwortet eine HTTP-Anfrage mit `429` und ein Socket-Frame mit
`RATE_LIMITED`.

Die Admin-Routen unter `/api/admin` und die Admin-Nachrichten des Sockets, etwa die des
SQL-Editors, unterliegen keiner Ratenbegrenzung.

## Persönliche Schlüssel

<span class="since-badge" data-since="0.24">Seit 0.24</span> Ein persönlicher Schlüssel handelt **als sein Eigentümer**: mit dessen uid und dessen Rollen, so wie sie bei
jeder Anfrage sind. Regeln im Eigentümer-Stil passen auf ihn, er liest also genau das, was sein Eigentümer
lesen würde, eingeschränkt durch seine Scopes. Er eignet sich für die eigenen Skripte einer Person, eine CLI auf ihrem
Laptop oder ein Tool, das sie mit ihrem eigenen Konto verbindet.

Sie sind standardmäßig aus, denn jeder ist ein langlebiges Credential für ein
Konto. Aktivieren Sie sie im Auth-Block der Users-Collection:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: { enabled: true, personalKeys: true },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Dann verwaltet ein angemeldetes Konto seine eigenen Schlüssel:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

Dasselbe über REST. `$ACCESS_TOKEN` ist das eigene Access-Token des Kontos, aus der
Anmeldung:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Ein persönlicher Schlüssel nimmt `name`, `scopes` und `expires_at`. Er trägt keine `roles`,
weil er mit denen seines Eigentümers läuft, und kein `rate_limit`. Wird eines davon gesendet, ist das ein
`400 INVALID_INPUT`.

Was ein persönlicher Schlüssel hält, sind seine Scopes, beschnitten auf das, was sein Eigentümer **jetzt** hält.
Entziehen Sie dem Eigentümer eine Rolle, und jeder Schlüssel, den er erstellt hat, schrumpft mit. Löschen Sie das
Konto, und seine Schlüssel funktionieren nicht mehr. Schalten Sie `personalKeys` aus, und jeder persönliche Schlüssel
funktioniert ebenfalls nicht mehr.

Nur ein Konto kann persönliche Schlüssel haben. Ein API-Schlüssel, der Service-Key und eine Gast-Sitzung
werden abgelehnt: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` für einen Schlüssel,
`403 PERSONAL_KEY_NEEDS_ACCOUNT` für die anderen beiden. Ist die Funktion aus, antwortet jede
Route mit `403 PERSONAL_KEYS_DISABLED`.

## Was jeder Scope erreicht

### Daten

`data:read`, `data:write` und `data:delete`, einfach oder auf eine Collection eingeschränkt
(`data:read:posts`). Die Operation ergibt sich aus der HTTP-Methode: `GET`, `HEAD`
und `OPTIONS` lesen, `POST`, `PUT` und `PATCH` schreiben, `DELETE` löscht.
`POST /api/data/:slug/bulk/delete` zählt als Löschen, obwohl es ein `POST` ist.

Auf einem verschachtelten Pfad wird die Operation gegen die Collection geprüft, bei der der Pfad
endet, und jede Collection, die er durchläuft, braucht `data:read`. Ein Schlüssel, der nur
`data:read:posts` hält, wird bei `/api/data/authors/1/posts` abgelehnt, bis er auch
`authors` lesen kann.

### Storage

`storage:read` listet auf und lädt herunter. `storage:write` lädt hoch und erstellt Ordner,
und deckt jeden Schritt eines fortsetzbaren (TUS-)Uploads ab, einschließlich der Offset-Prüfung
und des Abbruchs. `storage:delete` löscht. Das Ziel ist die ID einer Storage-Quelle. Die
ID der Standardquelle ist `(default)`, also liest `storage:read:(default)` nur die
Standardquelle, und `storage:write:avatars` schreibt in eine Quelle namens `avatars`.
Nach der Scope-Prüfung läuft [`storageAuthorize`](/docs/backend/storage/#per-object-authorization)
weiterhin, mit der Identität des Schlüssels.

### Funktionen

`functions:invoke` ruft jede benutzerdefinierte Funktion auf. `functions:invoke:<name>` ruft
eine auf. Das Auflisten der Funktionen unter `GET /api/functions` braucht den einfachen Scope.

Geben Sie `functions:invoke` keinem Schlüssel, der nur lesen soll. Eine Funktion ist
Code, und sie kann schreiben. Innerhalb einer Funktion lesen `getScopes(c)` und `hasScope(c, …)`,
was der Schlüssel hält, und eine App kann eigene Scopes deklarieren, die eine Funktion
prüft. Siehe [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Admin-Oberflächen

Ein Scope der Admin-Ebene auf einem Schlüssel erreicht diese Oberfläche. Ein Scheduler, der
Cron-Jobs auslöst, braucht `cron:write`. Ein Log-Shipper braucht `logs:read`. Ein Backup-Job braucht
`backups:read`. Der [Endpunkt-Index](/docs/backend/endpoints/#admin) listet den
Scope, den jede Route braucht.

`keys:read` und `keys:write` können nie auf einen Schlüssel. Ein Schlüssel, der Schlüssel verwalten könnte,
könnte seinen eigenen Nachfolger erzeugen oder sich selbst erweitern. Jede Anfrage an die Schlüssel-Routen,
die mit einem Schlüssel gestellt wird, wird mit `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` abgelehnt. Verwalten Sie
Schlüssel als Person, die `keys:write` hält, oder mit dem Service-Key.

### Realtime

Ein Schlüssel authentifiziert auch den WebSocket: Senden Sie ihn in der `AUTHENTICATE`-Nachricht.
Abrufe und Subscriptions brauchen `data:read` auf ihrer Collection, Speichern
`data:write`, Löschen `data:delete`. Eine Subscription auf einen verschachtelten Pfad braucht den
einfachen Scope. Channels (Broadcast und Presence) werden für Schlüssel abgelehnt. Der
SQL-Editor und Branch-Nachrichten brauchen `database:read` oder `database:write`.

## Agents und MCP-Server

<span class="since-badge" data-since="0.24">Seit 0.24</span> Ein Agent braucht den *am engsten gefassten* Schlüssel, der seine Aufgabe erledigt. Beginnen Sie mit Scopes, und geben Sie ihm
ein Ablaufdatum:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Lassen Sie `data:delete` weg, wenn der Agent bearbeiten, aber nicht entfernen soll.
`delete` ist genau aus diesem Grund von `write` getrennt.

## Regeln beim Erstellen

Jeder Schlüssel wird gegen den geprüft, der ihn erstellt, auf beiden Routen gleich:

| Ablehnung | Wann |
|---|---|
| `400 INVALID_SCOPES` | Ein Scope ist fehlerhaft, unbekannt oder trägt ein Ziel, das er nicht annimmt. `details.validScopes` listet jeden gültigen |
| `400 UNKNOWN_SCOPE_TARGET` | Ein Ziel nennt eine Collection, Storage-Quelle oder Funktion, die dieses Backend nicht bereitstellt |
| `400 KEY_MANAGEMENT_SCOPE` | `keys:read` oder `keys:write` wurde angefordert |
| `403 SCOPE_EXCEEDS_CREATOR` | Ein Scope, den der Ersteller nicht hält. Ein Schlüssel hält nie mehr als das Konto, das ihn erstellt hat |
| `403 ROLE_EXCEEDS_CREATOR` | Eine Service-Schlüssel-Rolle, die der Ersteller nicht hält, wenn der Ersteller kein Admin ist |

Eine Anfrage, für die dem Schlüssel selbst ein Scope fehlt, antwortet mit `403 SCOPE_MISSING`, mit dem
Scope in `details.requiredScope`. Siehe [Fehlercodes](/docs/backend/errors/#authentication-and-accounts).

## Schlüssel verwalten

| Methode | Pfad | Braucht |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Ändert `name`, `scopes`, `roles`, `rate_limit` oder `expires_at`, nach denselben Regeln wie beim Erstellen |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Widerruft |
| `GET` | `/api/auth/keys` | Ein Konto: seine eigenen persönlichen Schlüssel |
| `POST` | `/api/auth/keys` | Ein Konto, mit aktiviertem `personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Ein Konto: widerruft einen seiner eigenen |

Jede Route gibt Schlüssel maskiert zurück: `key_prefix`, nie den Hash. Jeder Schlüssel meldet
seine `kind` (`service` oder `personal`), seine `scopes`, seine `roles` und, bei einem
persönlichen Schlüssel, seine `owner_uid`.

Die CLI deckt Service-Schlüssel ab: `rebase api-keys list`, `get`, `create`, `revoke`,
und `scopes`, das jeden Scope auflistet, den das Backend kennt. Siehe die
[CLI-Referenz](/docs/cli/#rebase-api-keys).

## Schlüssel aus der Zeit vor Scopes

Schlüssel, die erstellt wurden, bevor es Scopes gab, tragen eine `permissions`-Liste und ein
`admin`-Flag. Beim Boot gibt der Store jedem davon die Scopes, die er nun hält. Nichts wird erweitert;
wo eine alte Berechtigung keine exakte Entsprechung hat, wird sie eingeschränkt:

| Alte Berechtigung | Scopes jetzt |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` und `storage:<op>` für jede Operation, plus `functions:invoke`, wenn sie `write` hatte |
| `"storage"` | `storage:<op>` für jede Operation |
| `"functions"` | `functions:invoke`, nur wenn sie `write` hatte |
| `"functions/<name>"` | `functions:invoke:<name>`, nur wenn sie `write` hatte |
| `admin: true` | die Rolle `admin`, plus `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

Das Secret ändert sich nicht, eine Integration funktioniert also weiter. Zwei Berechtigungen werden eingeschränkt:

- Eine Funktionsberechtigung ohne `write` wird zu nichts. Ein `GET` zählte früher als
  Lesen, aber eine Funktion ist Code, und sie aufzurufen ist kein Lesen.
- Ein Admin-Schlüssel bekommt kein `database:*`, das er vorher nie erreichen konnte, und kein
  `keys:*`, das kein Schlüssel halten darf.

Die alten Spalten `permissions` und `admin` bleiben bestehen, damit ein Rollback auf eine
ältere Runtime ihre Schlüssel weiterhin liest. Eine Anfrage, die `permissions` oder
`admin` statt `scopes` sendet, wird mit `400 INVALID_INPUT` abgelehnt.

## Nächste Schritte

- [Rollen und Scopes](/docs/backend/roles-and-scopes/): jeder Scope und wie Rollen ihn halten
- [Endpunkt-Index](/docs/backend/endpoints/): der Scope, den jede Route braucht
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/): was die Datenbank zusätzlich zu den Scopes eines Schlüssels erzwingt
