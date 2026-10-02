---
sourceHash: fe0da2499f512a69
title: Rollen und Scopes
sidebar_label: Rollen und Scopes
description: "Was ein Aufrufer darf: die Datenebene, die jede Person hält, die Admin-Ebene, die Rollen gewähren, die Scopes, die eine App für sich selbst deklariert, und wie jedes Credential sie trägt."
---

<span class="since-badge" data-since="0.24">Seit 0.24</span> Jede Anfrage an ein Rebase-Backend stellt eine Frage: Darf dieser Aufrufer das tun?
Die Antwort ist ein **Scope**, ein String der Form `resource:action`: `data:read`,
`users:write`, `cron:read`. Die Sitzung einer Person, ein API-Schlüssel, ein MCP-Token und eine
Rolle halten alle Scopes, und alle verwenden dieselben Strings. Eine Berechtigung liest sich gleich,
ob auf einem Schlüssel, einer Rolle oder einem Zustimmungsbildschirm.

## Zwei Ebenen

Scopes gibt es auf zwei Ebenen, und eine Person hält sie unterschiedlich.

**Die Datenebene** ist `data:*`, `storage:*` und `functions:invoke`. Jede
angemeldete Person hält sie vollständig. Was eine Person mit einer Zeile tun darf, entscheiden die
[Sicherheitsregeln](/docs/collections/security-rules/) der Collection, Zeile für Zeile,
und was sie mit einer Datei tun darf, die [Storage-Policies](/docs/backend/storage/#per-object-authorization).
Ein Scope entscheidet das für eine Person nie. Auf einem Schlüssel oder einem Token schränken Scopes der Datenebene
ein: Ein Schlüssel, der nur `data:read:posts` hält, liest `posts` und sonst nichts,
egal was die Regeln erlauben würden.

**Die Admin-Ebene** ist alles andere: Benutzer, Schema, die Datenbank, Backups,
Cron, Logs und Schlüssel. Niemand hält sie implizit. Die integrierte Rolle `admin` hält
sie vollständig. Jede andere Rolle hält, was die App für sie deklariert.

## Die Scopes

| Scope | Ebene | Ziel | Was er erlaubt |
|---|---|---|---|
| `data:read` | Daten | Collection | Zeilen lesen, durch die Row-Level Security des Aufrufers |
| `data:write` | Daten | Collection | Zeilen erstellen und aktualisieren, durch die Row-Level Security des Aufrufers |
| `data:delete` | Daten | Collection | Zeilen löschen, durch die Row-Level Security des Aufrufers |
| `storage:read` | Daten | Storage-Quelle | Dateien auflisten und herunterladen |
| `storage:write` | Daten | Storage-Quelle | Dateien hochladen und Ordner erstellen |
| `storage:delete` | Daten | Storage-Quelle | Dateien löschen |
| `functions:invoke` | Daten | Funktion | Benutzerdefinierte Funktionen aufrufen. Eine Funktion kann alles tun, was ihr Code tut |
| `users:read` | Admin | — | Konten und ihre Rollen auflisten |
| `users:write` | Admin | — | Konten erstellen, bearbeiten und löschen, Passwörter und zweite Faktoren zurücksetzen, Rollen bis zu den eigenen des Inhabers zuweisen |
| `schema:read` | Admin | — | Das Collection-Schema lesen, Schemaänderungen planen, das RLS-Audit ausführen, die privaten API-Docs lesen |
| `schema:write` | Admin | — | Schemaänderungen anwenden: bearbeitet Collection-Dateien und ändert die Datenbank |
| `database:read` | Admin | — | Datenbanken, Tabellen, Postgres-Rollen und Branches auflisten |
| `database:write` | Admin | — | SQL als Datenbankeigentümer ausführen, außerhalb der Row-Level Security, und Branches erstellen oder löschen |
| `backups:read` | Admin | — | Backups auflisten und herunterladen: jede Zeile, außerhalb der Row-Level Security |
| `cron:read` | Admin | — | Cron-Jobs auflisten und ihren Ausführungsverlauf lesen |
| `cron:write` | Admin | — | Cron-Jobs auslösen und sie ein- oder ausschalten |
| `logs:read` | Admin | — | Die Logs des Servers lesen |
| `keys:read` | Admin | — | Die Service-Schlüssel des Projekts auflisten. Nie an einen Schlüssel vergebbar |
| `keys:write` | Admin | — | Service-Schlüssel erstellen, ändern und widerrufen. Nie an einen Schlüssel vergebbar |

`GET /api/auth/scopes` gibt diese Liste für das laufende Backend zurück, ergänzt um die eigenen
Scopes der App, plus die Scopes, die der Aufrufer hält. Jeder angemeldete Aufrufer darf sie
lesen:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Ziele

Ein Scope der Datenebene lässt sich nach einem zweiten Doppelpunkt auf ein Ziel einschränken:

- `data:read:posts` liest nur die Collection `posts`. Das Ziel ist ein Collection-Slug.
- `storage:write:avatars` lädt nur in die Storage-Quelle `avatars` hoch. Die
  ID der Standardquelle ist `(default)`: `storage:read:(default)`.
- `functions:invoke:export` ruft nur die Funktion `export` auf.

Der einfache Scope deckt jedes Ziel ab. Ein eingeschränkter Scope deckt sein eigenes Ziel ab und
sonst nichts. Er beantwortet nie eine Frage über alle Ziele: Ein Schlüssel, der
`data:read:posts` hält, kann nicht jede Collection auflisten.

Scopes der Admin-Ebene nehmen kein Ziel. Ein App-Scope nimmt eines, wenn er ein
`target` deklariert, wie unten.

## Rollen deklarieren

<span class="since-badge" data-since="0.24">Seit 0.24</span> Rollen werden in der Users-Collection unter `auth.roles` deklariert. Eine Rolle ist ein Name,
den die Datenbank sieht und auf den RLS-Policies passen können, plus eine Liste von Scopes der Admin-Ebene
und App-Scopes.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"]
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"]
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" },
        roles: {
            name: "Roles",
            type: "array",
            columnType: "text[]",
            of: {
                name: "Role",
                type: "string",
                enum: { admin: "Admin", support: "Support", developer: "Developer", editor: "Editor" }
            }
        }
    }
});
```

Eine Person hält eine Rolle, wenn ihre Spalte `roles` sie auflistet. Weisen Sie sie im Admin-Panel
zu, oder mit `PUT /api/admin/users/:uid`.

Der Boot lehnt eine Deklaration ab, die sich wie eine Berechtigung liest, die sie nicht ist:

- **`admin` kann nicht deklariert werden.** Die Rolle ist integriert und hält jeden Scope.
- **Eine Rolle darf keinen Scope der Datenebene auflisten.** Jede Person hält die Datenebene
  bereits. `data:write` auf einer Rolle würde nichts gewähren und so aussehen, als gewähre es
  etwas. Was eine Rolle mit Zeilen tun darf, gehört in die `securityRules` der Collection.
- **Jeder Scope muss existieren.** Ein unbekannter Name lässt den Boot scheitern und listet die gültigen auf.

Eine Rolle, die Sie nicht deklarieren, ist trotzdem eine Rolle. `editor` oben hat keinen Eintrag, hält also
keinen Scope der Admin-Ebene, und eine RLS-Policy kann trotzdem auf sie passen.

`defaultRole`, die Rolle, die jede neu registrierte Person bekommt, darf weder `admin` noch eine
deklarierte Rolle sein, die einen Scope der Admin-Ebene hält. Ein Fremder, der sich registriert, sollte
nichts halten, was das Projekt verwaltet. Der Boot lehnt das ab.

:::note[`schema-admin` gibt es nicht mehr]
Ältere Versionen behandelten eine Rolle namens `schema-admin` als zweiten Admin. Für sich allein
bedeutet sie nun nichts mehr. Wenn Ihr Projekt sie verwendet hat, deklarieren Sie sie mit den Scopes,
die Sie gemeint haben, zum Beispiel
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` listet `admin` und jede deklarierte Rolle mit ihren Scopes auf. Dafür
braucht es `users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## App-Scopes

Eine App kann ihre eigenen Operationen als Scopes benennen, unter `auth.scopes`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project"
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Der Name ist `resource:action`, in Kleinbuchstaben, ohne Ziel. Er darf keine
integrierte Ressource wiederverwenden: `data`, `storage`, `functions`, `users`, `schema`,
`database`, `backups`, `cron`, `logs` und `keys` sind vergeben. `label` ist Pflicht,
denn das liest eine Person, wenn sie den Scope gewährt. `target` benennt, was
ein Ziel bedeutet, sodass ein Schlüssel `project:deploy:p1` halten kann.

Jede angemeldete Person hält jeden App-Scope. Wie bei der Datenebene entscheidet der Code
hinter dem Scope, ob diese Person handeln darf. Der Scope existiert, damit
ein Schlüssel auf genau diese eine Aktion eingeschränkt werden kann. Auch eine Rolle darf App-Scopes auflisten.

Prüfen Sie einen in einer [benutzerdefinierten Funktion](/docs/backend/custom-functions/) mit `requireScope`:

```typescript
import { defineFunction, requireAuth, requireScope, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post(
        "/:project",
        requireAuth,
        requireScope("project:deploy", c => c.req.param("project")),
        async (c) => {
            // A person always passes requireScope. Decide here whether
            // this person may deploy this project.
            return c.json({ project: c.req.param("project"), by: getUserId(c) });
        }
    );
});
```

Ein Schlüssel, der `project:deploy:p1` hält, kommt für `p1` durch und bekommt `403 SCOPE_MISSING`
für jedes andere Projekt. Er braucht außerdem `functions:invoke` oder
`functions:invoke:<name>` für diese Funktion, um die Funktion überhaupt zu erreichen.
`hasScope(c, scope, target)` und `getScopes(c)` beantworten dieselbe Frage innerhalb eines
Handlers.

## Was admin bedeutet

`admin` ist die einzige integrierte Rolle, und sie ist mehr als eine Liste von Scopes:

- Sie hält jeden Scope der Admin-Ebene, `keys:*` eingeschlossen.
- Sie ist eine Rolle, die die Datenbank sieht. Die Standard-Policies, die Rebase jeder
  Collection hinzufügt, lassen sie zu, sodass ein Admin jede Zeile einer Collection liest und schreibt,
  die sie behält. Eine Collection mit `disableDefaultPolicies: true` verwirft sie.
- Nur ein Admin kann `admin` gewähren. Eine Rolle, die jeden Scope der Admin-Ebene auflistet, ist
  trotzdem nicht `admin`: Sie kann `admin` nicht vergeben, und die Standard-Policies lassen
  sie nicht zu.

`requireAdmin` prüft auf die Rolle. Bevorzugen Sie `requireScope` für alles, was eine engere
Rolle oder ein Schlüssel tun können soll.

## Niemand gewährt mehr, als er hält

Eine Regel deckt jede Tür ab, die Zugriff vergibt: **Nichts wird mit mehr gewährt,
als sein Gewährender hält.**

Für Schlüssel:

- Die Scopes eines Schlüssels müssen innerhalb der eigenen seines Erstellers liegen. Sonst `403 SCOPE_EXCEEDS_CREATOR`.
- Die RLS-Rollen eines Service-Schlüssels müssen Rollen sein, die sein Ersteller hält, es sei denn, der Ersteller
  ist Admin. Sonst `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` und `keys:write` kommen nie auf einen Schlüssel. Ein Schlüssel, der Schlüssel verwaltet, könnte
  seinen eigenen Nachfolger erzeugen. `400 KEY_MANAGEMENT_SCOPE`.

Für Konten gilt: Wer `users:write` hält,

- kann kein Konto bearbeiten, zurücksetzen oder löschen, das eine Rolle oder einen Scope hält, die er nicht hält:
  `403 ACCOUNT_OUTRANKS_CALLER`. Ohne das könnte eine Support-Rolle das Passwort eines
  Admins zurücksetzen und sich als dieser anmelden.
- kann keine Rollen gewähren, die mehr halten als er: `403 ROLE_EXCEEDS_CALLER`.

## Wie jedes Credential Scopes hält

| Credential | Handelt als | Hält |
|---|---|---|
| Die Sitzung einer Person | die Person | die Datenebene, jeden App-Scope und die Scopes ihrer Rollen. Ein Admin hält alles |
| [Service-Schlüssel](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, mit den RLS-Rollen `service` plus seinen eigenen `roles` | genau seine Scopes |
| [Persönlicher Schlüssel](/docs/backend/api-keys/#personal-keys) `rk_live_…` | sein Eigentümer, mit dessen Rollen, so wie sie bei jeder Anfrage sind | seine Scopes, beschnitten auf das, was der Eigentümer jetzt hält |
| [MCP-Token](/docs/ai/mcp/#the-remote-endpoint) | die Person, die es verbunden hat | `data:read`, `data:write`, `data:delete` wie gewährt, optional pro Collection |
| `REBASE_SERVICE_KEY` | `service`, mit der Rolle `admin` | alles |

Ein Schlüssel oder ein Token umgeht nie die Row-Level Security. Seine Scopes sind eine Obergrenze,
und die Policies der Datenbank für die Identität, als die er handelt, sind eine weitere.

## Wenn ein Scope fehlt

<span class="since-badge" data-since="0.24">Seit 0.24</span> Die Antwort ist `403 SCOPE_MISSING`, und `details.requiredScope` nennt den Scope,
mit seinem Ziel, wenn es eines gibt:

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Für eine Person ist die Lösung eine Rolle, die den Scope auflistet. Für einen Schlüssel ist es ein neuer Schlüssel,
der ihn hält.

## Nächste Schritte

- [API-Schlüssel](/docs/backend/api-keys/): Service-Schlüssel, persönliche Schlüssel und die Regeln beim Erstellen
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/): was eine Person mit jeder Zeile tun darf
- [Endpunkt-Index](/docs/backend/endpoints/): der Scope, den jede Route braucht
- [Fehlercodes](/docs/backend/errors/#authentication-and-accounts): jede Ablehnung oben
