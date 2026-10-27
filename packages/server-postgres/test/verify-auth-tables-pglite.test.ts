/**
 * The boot check a backend with provisioning off runs instead of creating the
 * auth tables, asked of a real Postgres (PGlite).
 *
 * `findUnusableAuthTables` reads each table with a `SELECT <columns> WHERE
 * false`, so a missing table, a missing column and an unreadable table each
 * come back in the database's own words. Only a database can say whether that
 * statement does what it claims: tables made by `ensureAuthTablesExist`, the
 * DDL every provisioning run applies, must pass, and each way of being wrong
 * must be named.
 */
import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ensureAuthTablesExist } from "../src/auth/ensure-tables";
import { createAuthSchema } from "../src/schema/auth-schema";
import {
    expectationOf,
    findUnusableAuthTables,
    unusableAuthTablesError,
    usersExpectation
} from "../src/auth/verify-auth-tables";

let pglite: PGlite;
let db: NodePgDatabase;

const schema = createAuthSchema("rebase");
const authTables = [
    schema.refreshTokens, schema.passwordResetTokens, schema.appConfig,
    schema.userIdentities, schema.mfaFactors, schema.mfaChallenges,
    schema.recoveryCodes, schema.magicLinkTokens
].map(expectationOf);

beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    db = drizzle(pglite) as unknown as NodePgDatabase;
    await ensureAuthTablesExist(db);
}, 60_000);

afterAll(async () => {
    await pglite.close();
});

describe("findUnusableAuthTables, on a real database", () => {
    it("finds nothing wrong with the tables a provisioning run creates", async () => {
        expect(await findUnusableAuthTables(db, [usersExpectation("\"rebase\".\"users\""), ...authTables])).toEqual([]);
    });

    it("names a table that is not there", async () => {
        const problems = await findUnusableAuthTables(db, [{ table: "\"rebase\".\"no_such_table\"", columns: ["id"] }]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/^"rebase"\."no_such_table": .*no_such_table/);
    });

    it("names a table from an older release that lacks a column auth reads", async () => {
        await pglite.exec("CREATE TABLE public.old_users (id uuid PRIMARY KEY, email text)");
        const problems = await findUnusableAuthTables(db, [usersExpectation("\"old_users\"")]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/^"old_users": .*column/);
    });

    it("reads no rows, so a populated table costs nothing to check", async () => {
        await pglite.exec("INSERT INTO rebase.users (email) VALUES ('verify@example.test')");
        expect(await findUnusableAuthTables(db, [usersExpectation("\"rebase\".\"users\"")])).toEqual([]);
    });

    it("phrases every problem into one refusal that says how to create the tables", () => {
        const error = unusableAuthTablesError(["\"rebase\".\"a\": missing", "\"rebase\".\"b\": missing"]);
        expect(error.message).toContain("  - \"rebase\".\"a\": missing\n  - \"rebase\".\"b\": missing");
        expect(error.message).toContain("REBASE_PROVISION_ONLY=true");
    });
});
