/**
 * `createApiKeyStore().ensureTable()` under a simultaneous multi-instance boot.
 *
 * `rebase.api_keys` holds key hashes and an `admin` flag and carries no RLS —
 * it is not a collection — so the `REVOKE` at the end of the bootstrap is the
 * only thing keeping it off the end-user role. It used to sit at the end of one
 * long `try` block, which meant the loser of any create race above it skipped
 * the revoke and reported only that API keys were unavailable.
 *
 * The race is real: measured against Postgres 18, five instances booting
 * together put 8 of 10 `ensureTable` calls into the losing branch.
 */

import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { createApiKeyStore } from "../src/auth/api-keys/api-key-store";
import { DDL_ATTEMPTS } from "../src/boot/ddl-bootstrap";
import { logger } from "../src/utils/logger";
import type { DataDriver } from "@rebasepro/types";

// ─── Helpers ────────────────────────────────────────────────────────

/** Records every statement and lets a test fail chosen ones. */
function recordingDriver(behaviour: (sql: string) => void = () => { /* succeed */ }) {
    const statements: string[] = [];
    const driver = {
        admin: {
            executeSql: async (sql: string) => {
                statements.push(sql);
                behaviour(sql);
                return [];
            }
        }
    } as unknown as DataDriver;
    return {
        driver,
        statements
    };
}

/** An error shaped the way Drizzle surfaces one: the real one in `.cause`. */
function drizzleError(code: string, message: string): Error {
    return new Error("Failed query: …", { cause: Object.assign(new Error(message), { code }) });
}

const catalogRace = () => drizzleError(
    "23505",
    'duplicate key value violates unique constraint "pg_type_typname_nsp_index"'
);

const revokesIn = (statements: string[]) => statements.filter(s => s.includes("REVOKE ALL ON"));

afterEach(() => {
    jest.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("createApiKeyStore().ensureTable — concurrent boot", () => {
    it("creates the table, its indexes and the admin column, then revokes", async () => {
        const { driver, statements } = recordingDriver();

        await createApiKeyStore(driver)!.ensureTable();

        const all = statements.join("\n");
        expect(all).toContain("CREATE SCHEMA IF NOT EXISTS rebase");
        expect(all).toContain("CREATE TABLE IF NOT EXISTS rebase.api_keys");
        expect(all).toContain("CREATE INDEX IF NOT EXISTS idx_api_keys_hash");
        expect(all).toContain("CREATE INDEX IF NOT EXISTS idx_api_keys_prefix");
        expect(all).toContain("ADD COLUMN IF NOT EXISTS admin");
        expect(revokesIn(statements)).toHaveLength(1);
    });

    it("retries a create that lost the race to another instance", async () => {
        let attempts = 0;
        const { driver, statements } = recordingDriver((sql) => {
            if (sql.includes("CREATE TABLE IF NOT EXISTS rebase.api_keys")) {
                attempts++;
                if (attempts < 3) throw catalogRace();
            }
        });

        await createApiKeyStore(driver)!.ensureTable();

        expect(attempts).toBe(3);
        // Having retried its way through, the instance carries on to the revoke.
        expect(revokesIn(statements)).toHaveLength(1);
    });

    it("stops retrying after a bounded number of attempts", async () => {
        let attempts = 0;
        const { driver } = recordingDriver((sql) => {
            if (sql.includes("CREATE SCHEMA")) {
                attempts++;
                throw catalogRace();
            }
        });

        await createApiKeyStore(driver)!.ensureTable();

        expect(attempts).toBe(DDL_ATTEMPTS);
    });

    it("does not retry an error that is not a create race", async () => {
        let attempts = 0;
        const { driver } = recordingDriver((sql) => {
            if (sql.includes("CREATE TABLE IF NOT EXISTS rebase.api_keys")) {
                attempts++;
                throw drizzleError("42501", "permission denied for schema rebase");
            }
        });

        await createApiKeyStore(driver)!.ensureTable();

        expect(attempts).toBe(1);
    });

    it("revokes end-user access even when an earlier statement fails hard", async () => {
        // This is the one that mattered: a dead statement used to abandon
        // everything after it, and the revoke came last.
        const { driver, statements } = recordingDriver((sql) => {
            if (sql.includes("CREATE INDEX")) throw new Error("out of disk space");
        });

        await createApiKeyStore(driver)!.ensureTable();

        expect(revokesIn(statements)).toHaveLength(1);
        expect(revokesIn(statements)[0]).toContain("api_keys");
    });

    it("still revokes when the admin-column migration fails", async () => {
        const { driver, statements } = recordingDriver((sql) => {
            if (sql.includes("ADD COLUMN IF NOT EXISTS admin")) throw new Error("lock timeout");
        });

        await createApiKeyStore(driver)!.ensureTable();

        expect(revokesIn(statements)).toHaveLength(1);
    });

    it("skips the revoke and says what it costs when the table is unusable", async () => {
        const errors: string[] = [];
        jest.spyOn(logger, "error").mockImplementation((message: string) => { errors.push(message); });
        jest.spyOn(logger, "info").mockImplementation(() => { /* silence */ });
        jest.spyOn(logger, "warn").mockImplementation(() => { /* silence */ });

        const { driver, statements } = recordingDriver((sql) => {
            if (sql.includes("api_keys")) throw new Error('relation "rebase.api_keys" does not exist');
        });

        await createApiKeyStore(driver)!.ensureTable();

        // The old message — "Continuing without API keys support" — did not say
        // that the table was also left reachable by the end-user role.
        expect(errors.some(m => /every API-key authenticated request will be rejected/i.test(m))).toBe(true);
        expect(revokesIn(statements)).toHaveLength(0);
    });

    it("says nothing alarming when the bootstrap is clean", async () => {
        const errors: string[] = [];
        jest.spyOn(logger, "error").mockImplementation((message: string) => { errors.push(message); });
        jest.spyOn(logger, "info").mockImplementation(() => { /* silence */ });

        await createApiKeyStore(recordingDriver().driver)!.ensureTable();

        expect(errors).toHaveLength(0);
    });

    it("survives all instances bootstrapping at once", async () => {
        // A simulated catalog: the first caller to reach an object creates it,
        // and everyone still in flight gets the duplicate key Postgres raises.
        const created = new Set<string>();
        const objectOf = (sql: string) =>
            sql.match(/CREATE (?:TABLE|INDEX) IF NOT EXISTS ([\w.]+)/)?.[1]
            ?? (sql.includes("CREATE SCHEMA") ? "schema" : undefined);

        const revokes: string[] = [];
        const stores = Array.from({ length: 5 }, () => createApiKeyStore(recordingDriver((sql) => {
            if (sql.includes("REVOKE ALL ON")) revokes.push(sql);
            const object = objectOf(sql);
            if (object && !created.has(object)) {
                created.add(object);
                return; // this caller won
            }
            // Worst case, and deterministic: in real Postgres a caller that
            // checks the catalog after the winner commits gets a clean no-op,
            // but one that checked before it gets this. Assume every loser did.
            if (object) throw catalogRace();
        }).driver)!);

        await Promise.all(stores.map(s => s.ensureTable()));

        // Whoever won or lost, every instance ends up applying the security
        // control rather than abandoning it.
        expect(revokes).toHaveLength(5);
    });
});
