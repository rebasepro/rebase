import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { compileSchema, restrictedKeys } from "@rebasepro/common";
import { col, defineAuthTable, defineTable } from "@rebasepro/types";

import { warnOnImplicitAuthSecrets } from "../src/auth/implicit-auth-secrets";

/**
 * The users table a project redeclares REPLACES the framework's default rather
 * than merging with it, so every protection the default carried has to survive
 * the copy. "Never on the wire" is the one that fails silently when it does
 * not. The compiler makes the auth table's secret columns private in the
 * descriptor whatever the declaration says (common's compile-tables tests);
 * every reader reads the descriptor; the server says so, once per column, so
 * the declaration can be made to say it too.
 */

afterEach(() => {
    jest.restoreAllMocks();
});

/** The shape that leaked: a redeclared users table whose secrets are not `.private()`. */
function redeclaredUsers() {
    return defineAuthTable("users", {
        columns: {
            id: col.uuid().primaryKey(),
            email: col.text(),
            password_hash: col.text(),
            email_verification_token: col.text(),
            email_change_token: col.text(),
            tokens_valid_after: col.timestamp({ withTimezone: true })
        },
        rls: "admin-only"
    });
}

describe("warnOnImplicitAuthSecrets", () => {
    it("names the secrets the compiler made private, and only those", () => {
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const tables = compileSchema([redeclaredUsers()], {});

        const users = tables[0].descriptor;
        expect(users.columns.find(column => column.key === "password_hash")?.private).toBe(true);
        expect(users.columns.find(column => column.key === "email_verification_token")?.private).toBe(true);
        expect(users.columns.find(column => column.key === "email_change_token")?.private).toBe(true);
        expect(users.columns.find(column => column.key === "email")?.private).toBeUndefined();
        // A bookkeeping stamp, not a secret.
        expect(users.columns.find(column => column.key === "tokens_valid_after")?.private).toBeUndefined();
        expect(warnOnImplicitAuthSecrets(tables)).toEqual([
            { slug: "users", columns: ["password_hash", "email_verification_token", "email_change_token"] }
        ]);
    });

    /** Keys differ between the default and a redeclaration; the column does not. */
    it("matches on the column name when the key is spelled differently", () => {
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const people = defineAuthTable("people", {
            columns: { id: col.uuid().primaryKey(), secret: col.text("password_hash") },
            rls: "admin-only"
        });

        expect(warnOnImplicitAuthSecrets(compileSchema([people], {}))).toEqual([{ slug: "people", columns: ["secret"] }]);
    });

    it("says nothing about a table that already marks them private", () => {
        const users = defineAuthTable("users", {
            columns: { id: col.uuid().primaryKey(), passwordHash: col.text("password_hash").private() },
            rls: "admin-only"
        });

        expect(warnOnImplicitAuthSecrets(compileSchema([users], {}))).toEqual([]);
    });

    /**
     * A `password_hash` column on a table that is not the user store is
     * someone else's data — a CRM importing hashes, say — and not this rule's
     * business.
     */
    it("only looks at the auth table", () => {
        const legacyImport = defineTable("legacy_import", {
            columns: { id: col.uuid().primaryKey(), password_hash: col.text() },
            rls: "admin-only"
        });
        const tables = compileSchema([legacyImport], {});

        expect(warnOnImplicitAuthSecrets(tables)).toEqual([]);
        expect(tables[0].descriptor.columns.find(column => column.key === "password_hash")?.private).toBeUndefined();
    });

    /**
     * Auth creates its columns on any auth table, and the runtime reads every
     * physical column, so a secret the table never declares is closed by name:
     * to a write and a read, for the admin too.
     */
    it("closes an undeclared secret to every caller, and leaves an undeclared stamp alone", () => {
        const users = defineAuthTable("users", {
            columns: { id: col.uuid().primaryKey(), email: col.text() },
            rls: "admin-only"
        });
        const [{ descriptor }] = compileSchema([users], {});
        for (const kind of ["read", "write"] as const) {
            const { refused } = restrictedKeys(descriptor, { roles: ["admin"] }, kind);
            for (const name of ["passwordHash", "password_hash", "emailVerificationToken", "email_verification_token", "emailChangeToken", "email_change_token"]) {
                expect({ kind, name, refused: refused.has(name) }).toEqual({ kind, name, refused: true });
            }
            expect(refused.has("tokensValidAfter")).toBe(false);
            expect(refused.has("pendingEmail")).toBe(false);
        }
    });
});
