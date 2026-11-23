---
sourceHash: a7b5b5daa103ef94
title: Die Benutzertabelle
sidebar_label: Benutzertabelle
description: "defineAuthTable deklariert die Tabelle, in der die Authentifizierung Benutzer speichert: die Spalten, die Auth benötigt, eine Self-Read-Policy, Admin-exklusive Berechtigungsspalten und das Zugriffsmodell – Rollen, App-Scopes, persönliche Schlüssel und die Benutzer-Lifecycle-Hooks."
---

`defineAuthTable` deklariert die Tabelle, die von der Authentifizierung gelesen und beschrieben wird. Es handelt sich um ein `defineTable`, das um drei Dinge erweitert wurde:

- **Die von Auth benötigten Spalten** werden hinzugefügt, wenn die Tabelle sie nicht deklariert: die E-Mail, der Passwort-Hash, die Spalte `roles`, der Verifizierungsstatus und die weiteren Felder, die für die Anmeldung verwendet werden.
- **Policies, auf die sich Auth stützt**, werden unabhängig davon hinzugefügt, was `rls` festlegt: Ein angemeldeter Benutzer liest seine eigene Zeile und nur ein Admin beschreibt die Berechtigungsspalten, sodass sich niemand selbst eine Rolle zuweisen kann.
- **Ein `auth`-Block** deklariert das Zugriffsmodell und die Hooks, die ausgeführt werden, wenn ein Admin einen Benutzer erstellt oder ein Passwort zurücksetzt.

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

Ein Projekt hat höchstens eine Benutzertabelle. Ein zweites `defineAuthTable` wird abgelehnt, wenn das Schema kompiliert wird; verwenden Sie stattdessen `defineTable`.

`rls` ist hier wie bei jeder Tabelle erforderlich. Das injizierte Self-Read und das Admin-Schreib-Gate werden neben Ihren Regeln hinzugefügt, sodass `"admin-only"` eine gültige Konfiguration ist: Admins verwalten Benutzer, und jeder Benutzer kann weiterhin seine eigene Zeile lesen.

## Die Spalten

Deklarieren Sie die Spalten, die Ihre App liest oder darstellt, mit den gewünschten Modifikatoren; Auth fügt diejenigen hinzu, die es benötigt und die Sie weggelassen haben. Eine deklarierte Spalte mit dem Schlüssel oder SQL-Namen einer Auth-Spalte (`email`, `displayName`, `roles`, `passwordHash`, `emailVerified`, `createdAt`, …) entspricht dieser Spalte.

Die Secrets des Servers verlassen niemals den Server: Der Passwort-Hash und das Verifizierungs-Token sind privat, unabhängig von der Deklaration, sodass ein Lesezugriff sie niemals ausliefert und ein Client-Schreibzugriff sie nicht setzen kann.

Ein Benutzer besitzt eine Rolle, wenn seine Spalte `roles` diese auflistet. Wenn Sie die Spalte als `col.text({ enum: [...] }).array()` deklarieren, wird sie auf die von Ihnen genannten Rollen beschränkt; lassen Sie dies weg, bleibt sie offen, da eine Rolle existiert, sobald sie einem Benutzer zugewiesen wird.

Regeln für andere Tabellen können wie gewohnt Spalten der Benutzertabelle referenzieren. Eine Regel für die Benutzertabelle selbst kann ebenfalls jede Auth-Spalte referenzieren, unabhängig davon, ob sie deklariert ist oder nicht.

## Ohne eine Benutzertabelle

Die Deklaration einer solchen Tabelle ist optional. Auth funktioniert in beiden Fällen: Ohne `defineAuthTable` werden die Benutzer in `rebase.users` gespeichert, und Konten sowie Rollen werden im Studio unter **Users & Roles** verwaltet. Das Admin-Panel zeigt Benutzer nur dann als Tabelle an, wenn das Projekt eine deklariert; das Weglassen der Datei hält sie also aus dem Admin-Panel heraus.

Um sie zu deklarieren, beginnen Sie mit der Datei `backend/schema/users.ts` des Scaffolds oder führen Sie `rebase schema introspect --users` für eine Datenbank aus, die `rebase.users` bereits enthält. Beide stimmen mit der Tabelle überein, die Auth erstellt (ein `text`-Schlüssel und jede Auth-Spalte), sodass `db push` daran nichts ändert und eine Migration von `db generate` sie mit `IF NOT EXISTS` erstellt. Fügen Sie anschließend Ihre eigenen Spalten hinzu.

## Der `auth`-Block

| Schlüssel | Funktion |
|---|---|
| `roles` | Die Rollen, die ein Benutzer innehaben kann, jeweils mit einem `name`, einer optionalen `description` und den Admin-Ebenen- und App-`scopes`, die sie gewährt. `admin` ist integriert und kann nicht deklariert werden. |
| `scopes` | Die anwendungseigenen Scopes nach `resource:action`-Name, jeweils mit einem `label`, einer optionalen `description` und einem optionalen `target`. |
| `personalKeys` | `true` erlaubt es jedem Benutzer, [persönliche API-Schlüssel](/docs/backend/api-keys/#personal-keys) zu erstellen. |
| `onCreateUser` | Wird ausgeführt, wenn ein Admin einen Benutzer über die API erstellt: Gibt die zu speichernden Werte und optional ein temporäres Passwort zurück, das dem Admin angezeigt wird. |
| `onResetPassword` | Wird ausgeführt, wenn ein Admin das Passwort eines Benutzers zurücksetzt: Gibt ein temporäres Passwort zurück oder sendet einen eigenen Reset-Link. |

`roles`, `scopes` und `personalKeys` werden mit dem Deskriptor der Tabelle bereitgestellt. Die beiden Hooks verbleiben auf dem Server; der Deskriptor gibt lediglich an, welche davon existieren. [Rollen und Scopes](/docs/backend/roles-and-scopes/) beschreibt, was jeder Scope gewährt und wie Schlüssel und Tokens ihn einschränken.

### `onCreateUser` und `onResetPassword`

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

Ein von `onResetPassword` zurückgegebenes `temporaryPassword` wird zum Passwort des Kontos: Rebase hasht es, speichert es, meldet den Benutzer von allen Sitzungen ab und zeigt es dem Admin zur Weitergabe an. Geben Sie keines zurück, wenn der Hook einen eigenen Reset-Link versendet; das Passwort bleibt dann unverändert, bis der Benutzer ein neues festlegt, und die Sitzungen werden dennoch beendet.

Beide Hooks erhalten einen Kontext mit:

- `hashPassword(password)`: Hashen mit dem konfigurierten Algorithmus;
- `sendEmail(options)`: Versenden einer E-Mail, nur vorhanden, wenn E-Mail konfiguriert ist. Löst mit den Rückmeldungen des Providers auf (`messageId`, `accepted`, `rejected`);
- `emailConfigured`, `appName` und `resetPasswordUrl`.

## Was bei Auth-Schreibvorgängen nicht ausgeführt wird

Registrierung, OAuth-Anmeldung und die Benutzerverwaltung durch Admins schreiben direkt in die Benutzertabelle. Die [Hooks](/docs/collections/callbacks/) der Tabelle werden bei diesen Schreibvorgängen nicht ausgeführt, sodass eine Willkommens-E-Mail in `afterSave` bei der Registrierung niemals ausgelöst wird. Platzieren Sie diese stattdessen in den Auth-Lifecycle-Hooks (`beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, …), die im Backend konfiguriert sind. Siehe [Authentifizierung](/docs/backend/authentication/).

## Nächste Schritte

- [Authentifizierung](/docs/backend/authentication/): Anmeldemethoden, Tokens und die Auth-Hooks
- [Rollen und Scopes](/docs/backend/roles-and-scopes/): Rollen und App-Scopes deklarieren
- [Row-Level-Security](/docs/collections/security-rules/): Die Policies neben den injizierten Regeln
