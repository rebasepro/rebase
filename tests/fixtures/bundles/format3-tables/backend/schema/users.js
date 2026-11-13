import { defineAuthTable, col, json } from "@rebasepro/server/schema";
import { maskValues, maskEmail, maskName } from "../lib/masking.js";
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
        createdAt: col.timestamp({ withTimezone: true }),
        updatedAt: col.timestamp({ withTimezone: true }).onUpdateNow()
    },
    rls: [
        {
            name: "users_read_policy",
            operation: "select",
            using: "rebase.uid() IS NULL OR id = rebase.uid()::uuid OR string_to_array(rebase.roles(), ',') && ARRAY['admin']"
        },
        {
            name: "users_write_policy",
            operations: ["insert", "update", "delete"],
            using: "rebase.uid() IS NULL OR string_to_array(rebase.roles(), ',') && ARRAY['admin']",
            withCheck: "rebase.uid() IS NULL OR string_to_array(rebase.roles(), ',') && ARRAY['admin']"
        }
    ],
    hooks: {
        afterRead: ({ values: row }) => maskValues(row, {
            email: maskEmail,
            displayName: maskName,
            photoURL: null
        })
    }
});
