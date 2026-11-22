import { col, defineAuthTable, json, sql } from "@rebasepro/types";

/**
 * `rebase.users` as auth creates it, as a `defineAuthTable`.
 *
 * When a project declares no table with `defineAuthTable`,
 * `ensureAuthTablesExist` creates `rebase.users` with a `text` key and the
 * columns in `AUTH_USERS_COLUMNS`. This is that table written as a
 * definition: the same columns, types, nullability and defaults, so a project
 * that declares it plans no change against a database auth has provisioned.
 *
 * Nothing serves it. A project shows Users in the admin by declaring its own
 * auth table, and accounts are managed in the Studio's Users & Roles whether
 * or not it does. This is what that declaration has to match:
 * `schema introspect --users` writes it out for an existing `rebase.users`,
 * and the scaffold's `users.ts` is held to it
 * (`test/default-auth-table.test.ts`). An old scaffold that declared a `uuid`
 * key planned an `ALTER COLUMN id TYPE uuid` against the column every auth
 * foreign key points at.
 *
 * The secret columns (`passwordHash`, `emailVerificationToken`,
 * `emailChangeToken`) are `.private()`, as the compiler forces on any auth
 * table (`AUTH_SECRET_NAMES`).
 */
export const defaultAuthTable = defineAuthTable("users", {
    schema: "rebase",
    columns: {
        id: col.text().primaryKey().default(sql`gen_random_uuid()::text`),
        email: col.text().notNull(),
        displayName: col.text(),
        photoURL: col.text(),
        roles: col.text().array().notNull().default([]),
        passwordHash: col.text().private(),
        emailVerified: col.boolean().notNull().default(false),
        emailVerificationToken: col.text().private(),
        emailVerificationSentAt: col.timestamp({ withTimezone: true }),
        isAnonymous: col.boolean().notNull().default(false),
        metadata: col.jsonb(json.object({}, { additional: true })).notNull().default({}),
        tokensValidAfter: col.timestamp({ withTimezone: true }),
        disabledAt: col.timestamp({ withTimezone: true }),
        pendingEmail: col.text(),
        emailChangeToken: col.text().private(),
        emailChangeSentAt: col.timestamp({ withTimezone: true }),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        updatedAt: col.timestamp({ withTimezone: true }).notNull().onUpdateNow()
    },
    rls: [
        { operation: "select", roles: ["admin"] },
        { operations: ["insert", "update", "delete"], roles: ["admin"] }
    ]
});
