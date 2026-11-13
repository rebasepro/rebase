---
sourceHash: c7bebbe33f0a0611
title: Die Benutzertabelle
sidebar_label: Benutzertabelle
description: "defineAuthTable deklariert die Tabelle, in der Auth Benutzer speichert: die Spalten, die Auth benötigt, eine Richtlinie zum Selbstlesen, Berechtigungsspalten nur für Admins und das Zugriffsmodell – Rollen, App-Scopes, persönliche Schlüssel und die Benutzer-Lifecycle-Hooks."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`defineAuthTable` deklariert die Tabelle, die die Authentifizierung liest und beschreibt. Es
handelt sich um ein `defineTable` mit drei Ergänzungen:

- **Die Spalten, die Auth benötigt**, werden hinzugefügt, wenn die Tabelle sie nicht deklariert:
  die E-Mail, der Passwort-Hash, die `roles`-Spalte, der Verifizierungsstatus und
  die weiteren Felder, die für die Anmeldung verwendet werden.
- **Richtlinien, auf die sich Auth verlässt**, werden unabhängig von `rls` hinzugefügt: Ein angemeldeter
  Benutzer liest seine eigene Zeile, und nur ein Admin beschreibt die Berechtigungsspalten, sodass sich niemand
  selbst eine Rolle zuweisen kann.
- **Ein `auth`-Block** deklariert das Zugriffsmodell und die Hooks, die ausgeführt werden, wenn ein
  Admin einen Benutzer erstellt oder ein Passwort zurücksetzt.

```ts
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        email:       col.text().notNull().unique(),
        displayName: col.text(),
        roles:       col.text({ enum: ["admin", "editor", "support"] }).array(),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    rls: [
        // Editors may list users; everyone reads their own row through the injected policy.
        { operation: "select", roles: ["editor"] },
    ],
    auth: {
        roles: {
            support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] },
        },
        personalKeys: true,
    },
});
```

Ein Projekt hat höchstens eine Benutzertabelle. Ein zweites `defineAuthTable` wird bei
der Kompilierung des Schemas abgelehnt; machen Sie daraus ein `defineTable`.

`rls` ist hier wie bei jeder Tabelle erforderlich. Das injizierte Selbstlesen und die
Schreibbeschränkung für Admins werden zusätzlich zu Ihren Regeln hinzugefügt, sodass `"admin-only"` eine gültige Konfiguration ist:
Admins verwalten Benutzer, und jeder Benutzer kann weiterhin seine eigene Zeile lesen.

## Die Spalten

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Deklarieren Sie die Spalten, die Ihre App liest oder darstellt, mit den Modifikatoren, die Sie wünschen;
Auth fügt diejenigen hinzu, die es benötigt und die Sie weggelassen haben. Eine deklarierte Spalte mit dem
Schlüssel oder SQL-Namen einer Auth-Spalte (`email`, `displayName`, `roles`, `passwordHash`,
`emailVerified`, `createdAt`, …) ist genau diese Spalte.

Die Geheimnisse des Servers verlassen niemals den Server: Der Passwort-Hash und das
Verifizierungstoken sind unabhängig von der Deklaration privat, sodass ein Lesevorgang
sie niemals ausliefert und ein clientseitiger Schreibvorgang sie nicht setzen kann.

Ein Benutzer besitzt eine Rolle, wenn diese in seiner `roles`-Spalte aufgeführt ist. Wenn die Spalte als
`col.text({ enum: [...] }).array()` deklariert wird, ist sie auf die von Ihnen benannten Rollen beschränkt;
lassen Sie dies weg, bleibt sie offen, da eine Rolle existiert, sobald sie einem Benutzer zugewiesen wird.

Regeln für andere Tabellen können wie gewohnt auf die Spalten der Benutzertabelle verweisen. Eine Regel für
die Benutzertabelle selbst kann ebenfalls jede Auth-Spalte benennen, unabhängig davon, ob sie deklariert ist oder nicht.

## Der `auth`-Block

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Schlüssel | Beschreibung |
|---|---|
| `roles` | Die Rollen, die ein Benutzer innehaben kann, jeweils mit einem `name`, einer optionalen `description` und den Admin-Ebenen- und App-`scopes`, die sie gewährt. `admin` ist integriert und kann nicht deklariert werden. |
| `scopes` | Die anwendungseigenen Scopes nach `resource:action`-Name, jeweils mit einem `label`, einer optionalen `description` und einem optionalen `target`. |
| `personalKeys` | `true` ermöglicht es jedem Benutzer, [persönliche API-Schlüssel](/docs/backend/api-keys/#personal-keys) zu erstellen. |
| `onCreateUser` | Wird ausgeführt, wenn ein Admin einen Benutzer über die API erstellt: Gibt die zu speichernden Werte und optional ein temporäres Passwort zurück, das dem Admin angezeigt wird. |
| `onResetPassword` | Wird ausgeführt, wenn ein Admin das Passwort eines Benutzers zurücksetzt: Gibt ein temporäres Passwort zurück oder sendet einen eigenen Reset-Link. |

`roles`, `scopes` und `personalKeys` werden mit dem Deskriptor der Tabelle bereitgestellt.
Die beiden Hooks verbleiben auf dem Server; der Deskriptor gibt lediglich an, welche davon existieren. [Rollen und Scopes](/docs/backend/roles-and-scopes/)
beschreibt, was die einzelnen Scopes gewähren und wie Schlüssel und Tokens diese einschränken.

### `onCreateUser` und `onResetPassword`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```ts
import { randomBytes } from "node:crypto";
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const members = defineAuthTable("members", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        onCreateUser: async (values, ctx) => {
            const temporaryPassword = randomBytes(12).toString("base64url");
            return {
                values: { ...values, passwordHash: await ctx.hashPassword(temporaryPassword), emailVerified: true },
                temporaryPassword,
            };
        },
        onResetPassword: async (_userId, ctx) => {
            if (ctx.emailConfigured && ctx.sendEmail) {
                // Send your own reset link here and return no temporary password.
                return { invitationSent: true };
            }
            return { temporaryPassword: randomBytes(12).toString("base64url"), invitationSent: false };
        },
    },
});
```

Ein von `onResetPassword` zurückgegebenes `temporaryPassword` wird zum Passwort
des Kontos: Rebase hasht es, speichert es, meldet den Benutzer von jeder Sitzung ab und
zeigt es dem Admin zur Weitergabe an. Geben Sie keines zurück, wenn der Hook seinen eigenen
Reset-Link sendet; das Passwort bleibt dann unverändert, bis der Benutzer ein neues festlegt, und
die Sitzungen werden dennoch beendet.

Beide Hooks erhalten einen Kontext mit:

- `hashPassword(password)`: Hashen mit dem konfigurierten Algorithmus;
- `sendEmail(options)`: Eine E-Mail senden; nur vorhanden, wenn E-Mail konfiguriert ist.
  Löst mit den Rückmeldungen des Anbieters auf (`messageId`, `accepted`,
  `rejected`);
- `emailConfigured`, `appName` und `resetPasswordUrl`.

## Was bei Auth-Schreibvorgängen nicht ausgeführt wird

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Registrierung, OAuth-Anmeldung und die Benutzerverwaltung durch Admins schreiben die Benutzertabelle
direkt. Die [Hooks](/docs/collections/callbacks/) der Tabelle werden bei diesen Schreibvorgängen
nicht ausgeführt, sodass eine Willkommens-E-Mail in `afterSave` bei der Registrierung niemals ausgelöst wird.
Platzieren Sie diese stattdessen in den im Backend konfigurierten Auth-Lifecycle-Hooks (`beforeUserCreate`,
`afterUserCreate`, `afterUserDelete`, …). Siehe [Authentifizierung](/docs/backend/authentication/).

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [Authentifizierung](/docs/backend/authentication/): Anmeldemethoden, Tokens und die Auth-Hooks
- [Rollen und Scopes](/docs/backend/roles-and-scopes/): Deklarieren von Rollen und App-Scopes
- [Row-Level Security](/docs/collections/security-rules/): Richtlinien neben den injizierten
