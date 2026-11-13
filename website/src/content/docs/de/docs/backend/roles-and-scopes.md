---
sourceHash: 3b3d8ad69537b827
title: Rollen und Scopes
sidebar_label: Rollen und Scopes
description: "Was ein Aufrufer tun darf: die Datenebene, die jede Person besitzt, die Admin-Ebene, die Rollen gewähren, die Scopes, die eine App für sich selbst deklariert, und wie jedes Credential sie trägt."
---

Jede Anfrage an ein Rebase-Backend stellt eine Frage: Darf dieser Aufrufer dies tun?
Die Antwort ist ein **Scope**, ein String im Format `resource:action`: `data:read`,
`users:write`, `cron:read`. Die Sitzung einer Person, ein API-Schlüssel, ein MCP-Token und eine
Rolle besitzen alle Scopes, und sie alle verwenden dieselben Strings. Eine Berechtigung liest sich
auf einem Schlüssel, auf einer Rolle und auf einem Zustimmungsbildschirm genau gleich.

## Zwei Ebenen

Scopes sind in zwei Ebenen unterteilt, und eine Person besitzt sie auf unterschiedliche Weise.

**Die Datenebene (Data Plane)** umfasst `data:*`, `storage:*` und `functions:invoke`. Jede
angemeldete Person besitzt sie vollständig. Was eine Person mit einer Zeile tun darf, entscheidet
die [Row-Level-Security](/docs/collections/security-rules/) der Tabelle, Zeile für Zeile,
und was sie mit einer Datei tun darf, die [Speicherrichtlinien](/docs/backend/storage-authorization/).
Ein Scope entscheidet das niemals für eine Person. Auf einem Schlüssel oder einem Token schränken
Scopes der Datenebene ein: Ein Schlüssel, der nur `data:read:posts` besitzt, liest `posts` und nichts anderes,
unabhängig davon, was die Regeln erlauben würden.

**Die Admin-Ebene (Admin Plane)** ist alles andere: Benutzer, Schema, die Datenbank, Backups,
Cron, Logs und Schlüssel. Niemand besitzt sie implizit. Die integrierte Rolle `admin` besitzt
sie vollständig. Jede andere Rolle besitzt das, was die App für sie deklariert.

## Die Scopes

| Scope | Ebene | Ziel | Was er erlaubt |
|---|---|---|---|
| `data:read` | Data | Collection | Zeilen lesen, unter Berücksichtigung der Row-Level-Security des Aufrufers |
| `data:write` | Data | Collection | Zeilen erstellen und aktualisieren, unter Berücksichtigung der Row-Level-Security des Aufrufers |
| `data:delete` | Data | Collection | Zeilen löschen, unter Berücksichtigung der Row-Level-Security des Aufrufers |
| `storage:read` | Data | Speicherquelle | Dateien auflisten und herunterladen |
| `storage:write` | Data | Speicherquelle | Dateien hochladen und Ordner erstellen |
| `storage:delete` | Data | Speicherquelle | Dateien löschen |
| `functions:invoke` | Data | Funktion | Benutzerdefinierte Funktionen aufrufen. Eine Funktion kann alles tun, was ihr Code vorsieht |
| `users:read` | Admin | — | Accounts und deren Rollen auflisten |
| `users:write` | Admin | — | Accounts erstellen, bearbeiten und löschen, Passwörter und zweite Faktoren zurücksetzen, Rollen bis zu den eigenen des Inhabers zuweisen |
| `schema:read` | Admin | — | Das Schema lesen, Schemaänderungen planen, das RLS-Audit ausführen, die privaten API-Docs lesen |
| `schema:write` | Admin | — | Schemaänderungen anwenden: bearbeitet die Schemadateien und ändert die Datenbank |
| `database:read` | Admin | — | Datenbanken, Tabellen, Postgres-Rollen und Branches auflisten |
| `database:write` | Admin | — | SQL als Datenbankbesitzer ausführen, außerhalb der Row-Level-Security, und Branches erstellen oder löschen |
| `backups:read` | Admin | — | Backups auflisten und herunterladen: jede Zeile, außerhalb der Row-Level-Security |
| `cron:read` | Admin | — | Cron-Jobs auflisten und deren Ausführungshistorie einsehen |
| `cron:write` | Admin | — | Cron-Jobs auslösen und sie ein- oder ausschalten |
| `logs:read` | Admin | — | Server-Logs lesen |
| `keys:read` | Admin | — | Serviceschlüssel des Projekts auflisten. Kann niemals einem Schlüssel gewährt werden |
| `keys:write` | Admin | — | Serviceschlüssel erstellen, ändern und widerrufen. Kann niemals einem Schlüssel gewährt werden |

`GET /api/auth/scopes` gibt diese Liste für das laufende Backend zurück, ergänzt um die
eigenen Scopes der App sowie die Scopes, die der Aufrufer besitzt. Jeder angemeldete Aufrufer darf
sie lesen:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Ziele (Targets)

Ein Scope der Datenebene kann nach einem zweiten Doppelpunkt auf ein Ziel eingegrenzt werden:

- `data:read:posts` liest nur die Tabelle `posts`. Das Ziel ist der Slug einer Tabelle.
- `storage:write:avatars` lädt nur in die Speicherquelle `avatars` hoch. Die
  ID der Standardquelle ist `(default)`: `storage:read:(default)`.
- `functions:invoke:export` ruft nur die Funktion `export` auf.

Der einfache Scope deckt jedes Ziel ab. Ein eingegrenzter Scope deckt nur sein eigenes Ziel und
nichts anderes ab. Er beantwortet niemals eine Frage über alle Ziele: Ein Schlüssel mit
`data:read:posts` kann nicht alle Tabellen auflisten.

Scopes der Admin-Ebene haben kein Ziel. Ein App-Scope erhält eines, wenn er wie unten beschrieben
ein `target` deklariert.

## Rollen deklarieren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Rollen werden in der [Benutzertabelle](/docs/schema/auth-table/) unter
`auth.roles` deklariert. Eine Rolle ist ein Name, den die Datenbank sieht, auf den
Row-Level-Security-Richtlinien abgestimmt werden können, plus eine Liste von Scopes der Admin-Ebene und App-Scopes.

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

Eine Person besitzt eine Rolle, wenn deren Spalte `roles` sie auflistet. Die Zuweisung erfolgt im
Admin-Panel oder mit `PUT /api/admin/users/:uid`.

Der Boot-Vorgang verweigert Deklarationen, die wie eine Berechtigung wirken würden, die sie in Wahrheit nicht sind:

- **`admin` kann nicht deklariert werden.** Sie ist integriert und besitzt jeden Scope.
- **Eine Rolle darf keinen Scope der Datenebene auflisten.** Jede Person besitzt bereits
  die Datenebene. `data:write` auf einer Rolle würde nichts gewähren, aber so aussehen, als ob es
  etwas gewährte. Was eine Rolle mit Zeilen tun darf, gehört in das [`rls`](/docs/collections/security-rules/) der Tabelle.
- **Jeder Scope muss existieren.** Ein unbekannter Name führt zum Abbruch des Boot-Vorgangs und listet die gültigen Scopes auf.

Eine Rolle, die Sie nicht deklarieren, ist dennoch eine Rolle. `editor` oben hat keinen Eintrag, besitzt
also keinen Scope der Admin-Ebene, und eine RLS-Richtlinie kann sie dennoch abgleichen.

`defaultRole`, die Rolle, die jeder neu Registrierte erhält, darf nicht `admin` oder eine
deklarierte Rolle sein, die einen Scope der Admin-Ebene besitzt. Ein Fremder, der sich registriert,
sollte nichts besitzen, womit sich das Projekt verwalten lässt. Der Boot-Vorgang verweigert dies.

:::note[`schema-admin` gibt es nicht mehr]
Ältere Versionen behandelten eine Rolle namens `schema-admin` als zweiten Admin. Sie bedeutet
für sich allein genommen nun nichts mehr. Falls Ihr Projekt sie verwendet hat, deklarieren Sie sie
mit den beabsichtigten Scopes, zum Beispiel
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` listet `admin` und jede deklarierte Rolle mit ihren Scopes auf. Dies
erfordert `users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## App-Scopes

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine App kann ihre eigenen Operationen als Scopes unter `auth.scopes` benennen:

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

Der Name lautet `resource:action`, in Kleinbuchstaben, ohne Ziel. Eine integrierte Ressource
darf nicht wiederverwendet werden: `data`, `storage`, `functions`, `users`, `schema`,
`database`, `backups`, `cron`, `logs` und `keys` sind belegt. `label` ist erforderlich,
da es der Text ist, den eine Person liest, wenn sie den Scope gewährt. `target` benennt, was
ein Ziel bedeutet, sodass ein Schlüssel `project:deploy:p1` besitzen kann.

Jede angemeldete Person besitzt jeden App-Scope. Wie bei der Datenebene entscheidet der Code
hinter dem Scope, ob diese Person handeln darf. Der Scope existiert, damit ein
Schlüssel auf diese eine Aktion eingegrenzt werden kann. Eine Rolle kann ebenfalls App-Scopes auflisten.

Prüfen Sie einen Scope in einer [benutzerdefinierten Funktion](/docs/backend/custom-functions/) mit `requireScope`:

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

Ein Schlüssel, der `project:deploy:p1` besitzt, besteht die Prüfung für `p1` und erhält `403 SCOPE_MISSING`
für jedes andere Projekt. Er benötigt außerdem `functions:invoke` oder
`functions:invoke:<name>` für diese Funktion, um die Funktion überhaupt zu erreichen.
`hasScope(c, scope, target)` und `getScopes(c)` beantworten dieselbe Frage innerhalb eines
Handlers.

`requireScope`
lehnt einen Scope ab, den niemand besitzen könnte. Ein Name, der kein Scope ist, oder ein falsch geschriebener
integrierter Scope wie `data:raed`, wirft beim Laden der Funktion einen Fehler. Ein App-Scope, den
das Backend nicht unter `auth.scopes` deklariert, antwortet jedem Aufrufer, auch einem
Administrator, mit `500 SCOPE_NOT_DECLARED`.

## Was Admin bedeutet

`admin` ist die einzige integrierte Rolle, und sie ist mehr als nur eine Liste von Scopes:

- Sie besitzt jeden Scope der Admin-Ebene, einschließlich `keys:*`.
- Es ist eine Rolle, die die Datenbank sieht. Die Standardrichtlinien, die Rebase jeder
  Tabelle hinzufügt, lassen sie zu, sodass ein Admin jede Zeile einer Tabelle lesen und schreiben kann,
  die diese Richtlinien beibehält. Eine Tabelle mit `defaultPolicies: false` verwirft sie.
- Nur ein Admin kann `admin` gewähren. Eine Rolle, die jeden Scope der Admin-Ebene auflistet, ist
  dennoch nicht `admin`: Sie kann `admin` nicht vergeben, und die Standardrichtlinien
  lassen sie nicht zu.

`requireAdmin` prüft auf diese Rolle. Bevorzugen Sie `requireScope` für alles, was eine engere
Rolle oder ein Schlüssel können sollte.

## Niemand gewährt mehr, als er selbst besitzt

Eine Regel gilt für jede Tür, die Zugriff vergibt: **Nichts wird mit mehr Rechten gewährt,
als sein Zuweiser besitzt.**

Für Schlüssel:

- Die Scopes eines Schlüssels müssen innerhalb der Scopes seines Erstellers liegen. Andernfalls: `403 SCOPE_EXCEEDS_CREATOR`.
- Die RLS-Rollen eines Serviceschlüssels müssen Rollen sein, die sein Ersteller besitzt, es sei denn, der Ersteller
  ist ein Admin. Andernfalls: `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` und `keys:write` kommen niemals auf einen Schlüssel. Ein Schlüssel, der Schlüssel verwaltet,
  könnte seinen eigenen Nachfolger erzeugen: `400 KEY_MANAGEMENT_SCOPE`.
- Ein Inhaber von `keys:write` kann keinen Schlüssel ändern oder widerrufen, der eine Rolle oder
  einen Scope besitzt, die er selbst nicht besitzt, es sei denn, er ist ein Admin: `403 KEY_OUTRANKS_CALLER`.
  Ohne dies könnte er einen Schlüssel mit Admin-Rolle auf jeden Datenscope erweitern.

Für Accounts gilt, dass ein Inhaber von `users:write`:

- keinen Account bearbeiten, zurücksetzen oder löschen kann, dessen Rollen einen Scope enthalten, den er selbst nicht besitzt,
  oder `admin`, wenn er kein Admin ist:
  `403 ACCOUNT_OUTRANKS_CALLER`. Ohne dies könnte eine Support-Rolle das Passwort eines
  Admins zurücksetzen und sich als dieser anmelden.
- keine Rollen vergeben kann, die mehr Rechte enthalten als seine eigenen, einschließlich `admin`: `403 ROLE_EXCEEDS_CALLER`.

Ein Rollenname kann beliebig sein, außer ein Name, der als andere Rollen fehlinterpretiert
werden könnte: Ein leerer Name oder einer, der `,` `{` `}` `"` `\` oder ein Steuerzeichen
enthält, wird überall dort, wo eine Rolle geschrieben wird (Benutzer, Benutzertabelle, Serviceschlüssel),
mit `400 INVALID_ROLE` abgelehnt.

## Wie jedes Credential Scopes hält

| Credential | Agiert als | Hält |
|---|---|---|
| Die Sitzung einer Person | die Person | die Datenebene, jeden App-Scope und die Scopes ihrer Rollen. Ein Admin besitzt alles |
| [Serviceschlüssel](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, mit den RLS-Rollen `service` plus den eigenen `roles` | exakt seine Scopes |
| [Persönlicher Schlüssel](/docs/backend/api-keys/#personal-keys) `rk_live_…` | sein Eigentümer, mit den Rollen des Eigentümers, wie sie bei jeder Anfrage aktuell sind | seine Scopes, reduziert auf das, was der Eigentümer aktuell besitzt |
| [MCP-Token](/docs/ai/remote-mcp/) | die Person, die es verbunden hat | `data:read`, `data:write`, `data:delete` wie gewährt, optional pro Collection |
| `REBASE_SERVICE_KEY` | `service`, mit der Rolle `admin` | alles |

Ein Schlüssel oder Token umgeht niemals die Row-Level-Security. Seine Scopes bilden eine Obergrenze,
und die Richtlinien der Datenbank für die Identität, als die er agiert, bilden eine weitere.

## Wenn ein Scope fehlt

Die Antwort lautet `403 SCOPE_MISSING`, und `details.requiredScope` nennt den Scope,
gegebenenfalls mit seinem Ziel:

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Für eine Person besteht die Lösung in einer Rolle, die den Scope auflistet. Für einen Schlüssel ist es ein neuer Schlüssel,
der ihn besitzt.

## Nächste Schritte

- [API-Schlüssel](/docs/backend/api-keys/): Serviceschlüssel, persönliche Schlüssel und die Regeln für deren Erstellung
- [Row-Level-Security](/docs/collections/security-rules/): Was eine Person mit jeder Zeile tun darf
- [Endpunkt-Index](/docs/backend/endpoints/): Der Scope, den jede Route benötigt
- [Fehlercodes](/docs/backend/errors/#authentication-and-accounts): Jede oben genannte Ablehnung
