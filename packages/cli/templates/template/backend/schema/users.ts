import { defineAuthTable, col, json } from "@rebasepro/server/schema";

/**
 * The accounts table: sign-up, sign-in and password reset write here, and every
 * other table's policies read the caller from it. `defineAuthTable` adds what an
 * auth table needs on top of these rules — a user reads their own row, and only
 * an admin may change `roles`.
 *
 * `roles` lists the roles this project knows. `backend/storage.ts` and the
 * policies in the other tables name them; add yours here first.
 */
export const users = defineAuthTable("users", {
    schema: "rebase",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        displayName: col.text(),
        photoURL: col.text().validate({ url: true }),
        roles: col.text({ enum: ["admin", "editor", "viewer"] }).array(),
        passwordHash: col.text().private(),
        emailVerified: col.boolean().default(false),
        emailVerificationToken: col.text().private(),
        emailVerificationSentAt: col.timestamp({ withTimezone: true }),
        metadata: col.jsonb(json.object({}, { additional: true })).default({}),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow(),
        updatedAt: col.timestamp({ withTimezone: true }).onUpdateNow()
    },
    rls: [
        { operation: "select", roles: ["admin"] },
        { operations: ["insert", "update", "delete"], roles: ["admin"] }
    ]
});
