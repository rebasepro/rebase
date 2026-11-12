---
title: The users table
sidebar_label: Users table
description: "defineAuthTable declares the table auth stores users in: the columns auth needs, a self-read policy, admin-only privilege columns, and the access model — roles, app scopes, personal keys and the user-lifecycle hooks."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

`defineAuthTable` declares the table that authentication reads and writes. It
is a `defineTable` with three things added:

- **The columns auth needs** are added when the table does not declare them:
  the email, the password hash, the `roles` column, the verification state and
  the other fields sign-in uses.
- **Policies auth relies on** are added whatever `rls` says: a signed-in user
  reads their own row, and only an admin writes the privilege columns, so nobody
  can grant themselves a role.
- **An `auth` block** declares the access model and the hooks that run when an
  admin creates a user or resets a password.

```ts
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        email:       col.text().notNull().unique(),
        displayName: col.text(),
        roles:       col.array(col.text().oneOf(["admin", "editor", "support"])),
        createdAt:   col.timestamptz().notNull().onCreateNow(),
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

A project has at most one users table. A second `defineAuthTable` is refused
when the schema is compiled; make it a `defineTable`.

`rls` is required here as on every table. The injected self-read and the admin
write gate are added beside your rules, so `"admin-only"` is a valid posture:
admins manage users, and each user still reads their own row.

## The columns

<span class="since-badge" data-since="0.31">Since 0.31</span>

Declare the columns your app reads or presents, with the modifiers you want;
auth adds the ones it needs and you left out. A declared column with an auth
column's key or SQL name (`email`, `displayName`, `roles`, `passwordHash`,
`emailVerified`, `createdAt`, …) is that column.

The server's secrets never leave the server: the password hash and the
verification token are private whatever the declaration says, so a read never
serves them and a client write cannot set them.

A user holds a role when their `roles` column lists it. Declaring the column as
`col.array(col.text().oneOf([...]))` closes it to the roles you name; leaving
it out keeps it open, since a role exists as soon as a user is given it.

Rules on other tables may name the users table's columns as usual. A rule on
the users table itself may also name every auth column, declared or not.

## The `auth` block

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Key | What it does |
|---|---|
| `roles` | The roles a user can hold, each with a `name`, an optional `description` and the admin-plane and app `scopes` it grants. `admin` is built in and cannot be declared. |
| `scopes` | The app's own scopes, by `resource:action` name, each with a `label`, an optional `description` and an optional `target`. |
| `personalKeys` | `true` lets each user create [personal API keys](/docs/backend/api-keys/#personal-keys). |
| `onCreateUser` | Runs when an admin creates a user through the API: return the values to store and, optionally, a temporary password to show the admin. |
| `onResetPassword` | Runs when an admin resets a user's password: return a temporary password, or send your own reset link. |

`roles`, `scopes` and `personalKeys` are served with the table's descriptor;
the two hooks stay on the server. [Roles and scopes](/docs/backend/roles-and-scopes/)
covers what each scope grants and how keys and tokens narrow it.

### `onCreateUser` and `onResetPassword`

<span class="since-badge" data-since="0.31">Since 0.31</span>

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

A `temporaryPassword` returned from `onResetPassword` becomes the account's
password: Rebase hashes it, saves it, signs the user out of every session and
shows it to the admin to pass on. Return none when the hook sends its own reset
link; the password then stays as it is until the user sets a new one, and their
sessions still end.

Both hooks receive a context with:

- `hashPassword(password)`: hash with the configured algorithm;
- `sendEmail(options)`: send an e-mail, present only when e-mail is configured.
  It resolves with what the provider reported (`messageId`, `accepted`,
  `rejected`);
- `emailConfigured`, `appName` and `resetPasswordUrl`.

## What does not run for auth writes

<span class="since-badge" data-since="0.31">Since 0.31</span>

Registration, OAuth sign-in and an admin's user management write the users table
directly. The table's [hooks](/docs/collections/callbacks/) do not run for those
writes, so a welcome e-mail in `afterSave` never fires on sign-up. Put it in the
auth lifecycle hooks (`beforeUserCreate`, `afterUserCreate`, `afterUserDelete`,
…) configured on the backend. See [Authentication](/docs/backend/authentication/).

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Authentication](/docs/backend/authentication/): sign-in methods, tokens and the auth hooks
- [Roles and scopes](/docs/backend/roles-and-scopes/): declaring roles and app scopes
- [Row-level security](/docs/collections/security-rules/): the policies beside the injected ones
