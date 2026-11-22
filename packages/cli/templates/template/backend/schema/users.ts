import { defineAuthTable, col, json, sql } from "@rebasepro/server/schema";

/**
 * The accounts table: sign-up, sign-in and password reset write here, and every
 * other table's policies read the caller from it. `defineAuthTable` adds what an
 * auth table needs on top of these rules: a user reads their own row, and only
 * an admin may change `roles`.
 *
 * Optional. This file is what shows Users in the admin as a table; delete it
 * (and its line in index.ts) and accounts are still managed in the Studio's
 * Users & Roles. Keep it to add your own columns or to list your roles. The
 * columns below are `rebase.users` exactly as auth creates it (a `text` key
 * included), so `db push` changes nothing in an existing database.
 *
 * `roles` lists the roles this project knows. `backend/storage.ts` and the
 * policies in the other tables name them; add yours here first.
 */
export const users = defineAuthTable("users", {
    schema: "rebase",
    columns: {
        id: col.text().primaryKey().default(sql`gen_random_uuid()::text`),
        email: col.text().notNull(),
        displayName: col.text(),
        photoURL: col.text().validate({ url: true }),
        roles: col.text({ enum: ["admin", "editor", "viewer"] }).array().notNull().default([]),
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
