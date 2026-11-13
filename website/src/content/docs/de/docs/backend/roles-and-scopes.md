---
sourceHash: 1610ca294114442e
title: Rollen und Scopes
sidebar_label: Rollen und Scopes
description: "Was ein Aufrufer tun darf: die Datenebene, die jede Person besitzt, die Admin-Ebene, die durch Rollen gewährt wird, die Scopes, die eine App für sich selbst deklariert, und wie jedes Credential sie trägt."
---

Jede Anfrage an ein Rebase-Backend stellt eine Frage: Darf dieser Aufrufer dies tun?
Die Antwort ist ein **Scope**, ein String im Format `resource:action`: `data:read`,
`users:write`, `cron:read`. Die Session einer Person, ein API-Schlüssel, ein
MCP-Token und eine Rolle besitzen alle Scopes, und sie verwenden alle dieselben
Strings. Eine Berechtigung liest sich auf einem Schlüssel, auf einer Rolle und
auf einem Consent-Screen gleich.

## Zwei Ebenen

Scopes sind in zwei Ebenen unterteilt, und eine Person besitzt sie auf unterschiedliche Weise.

**Die Datenebene (Data Plane)** umfasst `data:*`, `storage:*` und `functions:invoke`. Jede
angemeldete Person besitzt sie vollständig. Was eine Person mit einer Zeile tun darf,
wird durch die [Row-Level Security](/docs/collections/security-rules/) der Tabelle
Zeile für Zeile entschieden, und was sie mit einer Datei tun darf, durch die
[Storage-Policies](/docs/backend/storage-authorization/). Ein Scope entscheidet das
für eine Person niemals. Bei einem Schlüssel oder einem Token schränken Scopes der
Datenebene ein: Ein Schlüssel, der nur `data:read:posts` besitzt, liest `posts`
und nichts anderes, unabhängig davon, was die Regeln erlauben würden.

**Die Admin-Ebene (Admin Plane)** ist alles andere: Benutzer, Schema, die Datenbank,
Backups, Cron, Logs und Schlüssel. Niemand besitzt sie implizit. Die integrierte
`admin`-Rolle besitzt sie vollständig. Jede andere Rolle besitzt das, was die App
für sie deklariert.

## Die Scopes

| Scope | Ebene | Ziel (Target) | Was es erlaubt |
|---|---|---|---|
| `data:read` | data | Collection | Zeilen lesen, unter Berücksichtigung der Row-Level Security des Aufrufers |
| `data:write` | data | Collection | Zeilen erstellen und aktualisieren, unter Berücksichtigung der Row-Level Security des Aufrufers |
| `data:delete` | data | Collection | Zeilen löschen, unter Berücksichtigung der Row-Level Security des Aufrufers |
| `storage:read` | data | Storage-Quelle | Dateien auflisten und herunterladen |
| `storage:write` | data | Storage-Quelle | Dateien hochladen und Ordner erstellen |
| `storage:delete` | data | Storage-Quelle | Dateien löschen |
| `functions:invoke` | data | Funktion | Benutzerdefinierte Funktionen aufrufen. Eine Funktion kann alles tun, was ihr Code tut |
| `users:read` | admin | — | Accounts und ihre Rollen auflisten |
| `users:write` | admin | — | Accounts erstellen, bearbeiten und löschen, Passwörter und zweite Faktoren zurücksetzen, Rollen bis zur eigenen Stufe des Inhabers zuweisen |
| `schema:read` | admin | — | Das Schema lesen, Schema-Änderungen planen, das RLS-Audit ausführen, die privaten API-Docs lesen |
| `schema:write` | admin | — | Schema-Änderungen anwenden: bearbeitet die Schema-Dateien und ändert die Datenbank |
| `database:read` | admin | — | Datenbanken, Tabellen, Postgres-Rollen und Branches auflisten |
| `database:write` | admin | — | SQL als Datenbank-Owner ausführen, außerhalb der Row-Level Security, und Branches erstellen oder löschen |
| `backups:read` | admin | — | Backups auflisten und herunterladen: jede Zeile, außerhalb der Row-Level Security |
| `cron:read` | admin | — | Cron-Jobs auflisten und deren Ausführungshistorie lesen |
| `cron:write` | admin | — | Cron-Jobs auslösen und sie ein- oder ausschalten |
| `logs:read` | admin | — | Die Server-Logs lesen |
| `keys:read` | admin | — | Die Service-Schlüssel des Projekts auflisten. Kann niemals einem Schlüssel gewährt werden |
| `keys:write` | admin | — | Service-Schlüssel erstellen, ändern und widerrufen. Kann niemals einem Schlüssel gewährt werden |

`GET /api/auth/scopes` gibt diese Liste für das laufende Backend zurück, ergänzt
um die anwendungseigenen Scopes sowie die Scopes, die der Aufrufer besitzt. Jeder
angemeldete Aufrufer kann dies lesen:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Targets

Ein Scope der Datenebene kann nach einem zweiten Doppelpunkt auf ein einzelnes Target eingegrenzt werden:

- `data:read:posts` liest nur die Tabelle `posts`. Das Target ist der Slug einer Tabelle.
- `storage:write:avatars` lädt nur in die Storage-Quelle `avatars` hoch. Die ID der
  Standardquelle ist `(default)`: `storage:read:(default)`.
- `functions:invoke:export` ruft nur die Funktion `export` auf.

Der einfache Scope deckt jedes Target ab. Ein eingegrenzter Scope deckt nur sein
eigenes Target ab und nichts anderes. Er beantwortet niemals eine Abfrage über alle
Targets: Ein Schlüssel, der `data:read:posts` besitzt, kann nicht alle Tabellen auflisten.

Scopes der Admin-Ebene akzeptieren kein Target. Ein App-Scope akzeptiert eines, wenn
er ein `target` deklariert, wie unten beschrieben.

## Rollen deklarieren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Rollen werden in der [Benutzertabelle](/docs/schema/auth-table/) unter `auth.roles`
deklariert. Eine Rolle ist ein Name, den die Datenbank sieht und auf den
Row-Level-Security-Policies abgestimmt werden können, zuzüglich einer Liste von
Admin-Ebenen- und App-Scopes.

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        roles: col.text({ enum: ["admin", "support", "developer", "editor"] }).array(),
    },
    rls: "admin-only",
    auth: {
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"],
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"],
            },
        },
    },
});
```

Eine Person besitzt eine Rolle, wenn deren `roles`-Spalte sie aufführt. Weisen Sie sie
im Admin-Panel zu oder mit `PUT /api/admin/users/:uid`.

Der Boot-Vorgang verweigert Deklarationen, die den Eindruck einer Berechtigung erwecken
würden, die sie nicht sind:

- **`admin` kann nicht deklariert werden.** Sie ist integriert und besitzt jeden Scope.
- **Eine Rolle darf keinen Scope der Datenebene auflisten.** Jede Person besitzt bereits
  die Datenebene. `data:write` auf einer Rolle würde nichts gewähren, aber so aussehen,
  als ob es etwas gewährt. Was eine Rolle mit Zeilen tun darf, gehört in das
  [`rls`](/docs/collections/security-rules/) der Tabelle.
- **Jeder Scope muss existieren.** Ein unbekannter Name führt zum Fehlschlagen des
  Boot-Vorgangs und listet die gültigen Scopes auf.

Eine Rolle, die Sie nicht deklarieren, ist dennoch eine Rolle. `editor` oben hat
keinen Eintrag, besitzt also keinen Scope der Admin-Ebene, und eine RLS-Policy kann
dennoch darauf matchen.

`defaultRole`, die Rolle, die jeder neu Registrierte erhält, darf weder `admin`
noch eine deklarierte Rolle sein, die irgendeinen Scope der Admin-Ebene besitzt. Ein
Fremder, der sich registriert, sollte nichts besitzen, was das Projekt verwaltet.
Der Boot-Vorgang verweigert dies.

:::note[`schema-admin` wurde entfernt]
Ältere Versionen behandelten eine Rolle namens `schema-admin` als zweiten Administrator.
Sie hat für sich allein keine Bedeutung mehr. Wenn Ihr Projekt sie verwendet hat,
deklarieren Sie sie mit den beabsichtigten Scopes, zum Beispiel
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` listet `admin` und jede deklarierte Rolle mit ihren Scopes auf.
Dies erfordert `users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## App-Scopes

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine App kann ihre eigenen Operationen als Scopes unter `auth.scopes` definieren:

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project",
            },
        },
    },
});
```

Der Name lautet `resource:action`, in Kleinbuchstaben, ohne Target. Er darf keine
integrierte Ressource wiederverwenden: `data`, `storage`, `functions`, `users`,
`schema`, `database`, `backups`, `cron`, `logs` und `keys` sind vergeben. `label` ist
erforderlich, da dies der Text ist, den eine Person liest, wenn sie den Scope gewährt.
`target` benennt die Bedeutung eines Targets, sodass ein Schlüssel `project:deploy:p1`
besitzen kann.

Jede angemeldete Person besitzt jeden App-Scope. Wie bei der Datenebene entscheidet
der Code hinter dem Scope, ob diese Person handeln darf. Der Scope existiert, damit
ein Schlüssel auf diese eine Aktion eingeschränkt werden kann. Eine Rolle kann
ebenfalls App-Scopes auflisten.

Prüfen Sie einen Scope in einer [benutzerdefinierten Funktion](/docs/backend/custom-functions/)
mit `requireScope`:

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

Ein Schlüssel mit `project:deploy:p1` ist für `p1` gültig und erhält bei jedem
anderen Projekt `403 SCOPE_MISSING`. Er benötigt außerdem `functions:invoke` bzw.
`functions:invoke:<name>` für diese Funktion, um die Funktion überhaupt zu erreichen.
`hasScope(c, scope, target)` und `getScopes(c)` beantworten dieselbe Frage innerhalb
eines Handlers.

`requireScope` weist einen Scope ab, den niemand besitzen könnte. Ein Name, der kein
Scope ist, oder ein falsch geschriebener integrierter Scope wie `data:raed` löst beim
Laden der Funktion einen Fehler aus. Ein App-Scope, den das Backend nicht unter
`auth.scopes` deklariert, antwortet jedem Aufrufer – auch einem Administrator – mit
`500 SCOPE_NOT_DECLARED`.

## Was admin bedeutet

`admin` ist die einzige integrierte Rolle und sie ist mehr als nur eine Liste von Scopes:

- Sie besitzt jeden Scope der Admin-Ebene, einschließlich `keys:*`.
- Es ist eine Rolle, die die Datenbank erkennt. Die Standard-Policies, die Rebase zu
  jeder Tabelle hinzufügt, lassen sie zu, sodass ein Admin jede Zeile einer Tabelle
  lesen und schreiben kann, die diese beibehält. Eine Tabelle mit
  `defaultPolicies: false` verwirft sie.
- Nur ein Admin kann `admin` vergeben. Eine Rolle, die jeden Scope der Admin-Ebene
  auflistet, ist dennoch nicht `admin`: Sie kann `admin` nicht weitergeben, und die
  Standard-Policies lassen sie nicht zu.

`requireAdmin` prüft auf diese Rolle. Bevorzugen Sie `requireScope` für alles, was eine
spezifischere Rolle oder ein Schlüssel tun können sollte.

## Niemand gewährt mehr, als er selbst besitzt

Eine Regel gilt für jede Stelle, die Zugriff gewährt: **Nichts wird mit mehr Rechten
gewährt, als derjenige besitzt, der es vergibt.**

Für Schlüssel:

- Die Scopes eines Schlüssels müssen innerhalb der Scopes seines Erstellers liegen.
  Andernfalls erfolgt `403 SCOPE_EXCEEDS_CREATOR`.
- Die RLS-Rollen eines Service-Schlüssels müssen Rollen sein, die sein Ersteller
  besitzt, es sei denn, der Ersteller ist ein Admin. Andernfalls erfolgt
  `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` und `keys:write` werden niemals auf einen Schlüssel angewendet. Ein
  Schlüssel, der Schlüssel verwaltet, könnte seinen eigenen Nachfolger erzeugen.
  `400 KEY_MANAGEMENT_SCOPE`.
- Ein Inhaber von `keys:write` kann keinen Schlüssel ändern oder widerrufen, der
  eine Rolle oder einen Scope besitzt, die er selbst nicht hat, es sei denn, er ist
  ein Admin: `403 KEY_OUTRANKS_CALLER`. Ohne dies könnte er einen Schlüssel mit
  Admin-Rolle auf alle Daten-Scopes erweitern.

Für Accounts gilt für einen Inhaber von `users:write`:

- kann kein Konto bearbeiten, zurücksetzen oder löschen, dessen Rollen einen Scope
  besitzen, den er selbst nicht hat, oder `admin`, wenn er selbst kein Admin ist:
  `403 ACCOUNT_OUTRANKS_CALLER`. Ohne dies könnte eine Support-Rolle das Passwort
  eines Admins zurücksetzen und sich als dieser anmelden.
- kann keine Rollen vergeben, die mehr Rechte umfassen als seine eigenen, einschließlich
  `admin`: `403 ROLE_EXCEEDS_CALLER`.

Ein Rollenname kann beliebig sein, außer ein Name, der als andere Rollen fehlinterpretiert
werden könnte: Ein leerer Name oder ein Name, der `,`, `{`, `}`, `"`, `\` oder ein
Steuerzeichen enthält, wird überall dort, wo eine Rolle geschrieben wird (Benutzer,
die Benutzertabelle, Service-Schlüssel), mit `400 INVALID_ROLE` abgelehnt.

## Wie die verschiedenen Credentials Scopes tragen

| Credential | Agiert als | Besitzt |
|---|---|---|
| Session einer Person | die Person | die Datenebene, jeden App-Scope und die Scopes ihrer Rollen. Ein Admin besitzt alles |
| [Service-Schlüssel](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, mit den RLS-Rollen `service` plus seinen eigenen `roles` | exakt seine Scopes |
| [Persönlicher Schlüssel](/docs/backend/api-keys/#personal-keys) `rk_live_…` | sein Eigentümer, mit den Rollen des Eigentümers zum Zeitpunkt jeder Anfrage | seine Scopes, begrenzt auf das, was der Eigentümer aktuell besitzt |
| [MCP-Token](/docs/ai/remote-mcp/) | die Person, die es verbunden hat | `data:read`, `data:write`, `data:delete` wie gewährt, optional pro Tabelle |
| `REBASE_SERVICE_KEY` | `service`, mit der `admin`-Rolle | alles |

Ein Schlüssel oder ein Token umgeht niemals die Row-Level Security. Seine Scopes bilden
eine Obergrenze, und die Policies der Datenbank für die Identität, als die er agiert,
eine weitere.

## Wenn ein Scope fehlt

Die Antwort lautet `403 SCOPE_MISSING`, und `details.requiredScope` nennt den Scope,
gegebenenfalls mit seinem Target:

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Für eine Person besteht die Lösung in einer Rolle, die den Scope auflistet. Für einen
Schlüssel ist es ein neuer Schlüssel, der ihn besitzt.

## Nächste Schritte

- [API-Schlüssel](/docs/backend/api-keys/): Service-Schlüssel, persönliche Schlüssel und die Erstellungsregeln
- [Row-Level Security](/docs/collections/security-rules/): Was eine Person mit jeder Zeile tun darf
- [Endpunkt-Übersicht](/docs/backend/endpoints/): Der Scope, den jede Route benötigt
- [Fehlercodes](/docs/backend/errors/#authentication-and-accounts): Jede oben genannte Ablehnung
