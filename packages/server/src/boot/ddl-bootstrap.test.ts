import { describe, it, expect, jest, afterEach } from "@jest/globals";
import {
    createDdlBootstrapper,
    isConcurrentDdlRace,
    isDuplicateObjectRace,
    hasInCauseChain,
    DDL_ATTEMPTS,
    type SqlExec
} from "./ddl-bootstrap";
import { logger } from "../utils/logger";

// ─── Helpers ────────────────────────────────────────────────────────

/** An error shaped the way Drizzle surfaces one: the real one in `.cause`. */
function drizzleError(code: string, message: string): Error {
    return new Error("Failed query: …", { cause: Object.assign(new Error(message), { code }) });
}

/** The duplicate key a losing `CREATE … IF NOT EXISTS` actually raises. */
const catalogRace = () => drizzleError(
    "23505",
    'duplicate key value violates unique constraint "pg_type_typname_nsp_index"'
);

function recordingExec(behaviour: (sql: string) => void = () => { /* succeed */ }) {
    const statements: string[] = [];
    const exec: SqlExec = async (sql) => {
        statements.push(sql);
        behaviour(sql);
        return [];
    };
    return {
        exec,
        statements
    };
}

afterEach(() => {
    jest.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("isConcurrentDdlRace", () => {
    it("recognises the catalog duplicate key a losing CREATE raises", () => {
        expect(isConcurrentDdlRace(catalogRace())).toBe(true);
    });

    it("recognises the dedicated duplicate-object SQLSTATEs", () => {
        for (const code of ["42P06", "42P07", "42710", "40P01"]) {
            expect(isConcurrentDdlRace(drizzleError(code, "duplicate"))).toBe(true);
        }
    });

    it("recognises dialects that say it in words", () => {
        // SQLite and MySQL have no shared SQLSTATE for this.
        expect(isConcurrentDdlRace(new Error("table api_keys already exists"))).toBe(true);
    });

    it("does not claim ordinary failures are races", () => {
        expect(isConcurrentDdlRace(drizzleError("42501", "permission denied for schema rebase"))).toBe(false);
        expect(isConcurrentDdlRace(new Error("connection refused"))).toBe(false);
        expect(isConcurrentDdlRace(undefined)).toBe(false);
        expect(isConcurrentDdlRace("not an error")).toBe(false);
    });

    it("finds the code however deeply the driver buried it", () => {
        const wrapped = new Error("outer", { cause: new Error("middle", { cause: catalogRace() }) });
        expect(isConcurrentDdlRace(wrapped)).toBe(true);
    });

    it("does not hang on a self-referential cause chain", () => {
        const looping: { message: string; cause?: unknown } = { message: "nope" };
        looping.cause = looping;
        expect(isConcurrentDdlRace(looping)).toBe(false);
    });
});

describe("hasInCauseChain", () => {
    it("stops at the first link the predicate accepts", () => {
        const seen: unknown[] = [];
        hasInCauseChain(new Error("a", { cause: new Error("b") }), (e) => {
            seen.push(e.message);
            return e.message === "a";
        });
        expect(seen).toEqual(["a"]);
    });
});

describe("createDdlBootstrapper", () => {
    describe("ensureObject", () => {
        it("runs the statement once when nothing goes wrong", async () => {
            const { exec, statements } = recordingExec();
            await createDdlBootstrapper(exec, "test").ensureObject("thing", "CREATE TABLE IF NOT EXISTS t ()");
            expect(statements).toHaveLength(1);
        });

        it("retries a create that lost the race, then succeeds", async () => {
            let attempts = 0;
            const { exec } = recordingExec(() => {
                attempts++;
                if (attempts < 3) throw catalogRace();
            });

            await createDdlBootstrapper(exec, "test").ensureObject("thing", "CREATE TABLE IF NOT EXISTS t ()");

            expect(attempts).toBe(3);
        });

        it("stops retrying after a bounded number of attempts", async () => {
            let attempts = 0;
            const { exec } = recordingExec(() => {
                attempts++;
                throw catalogRace();
            });

            await createDdlBootstrapper(exec, "test").ensureObject("thing", "CREATE TABLE IF NOT EXISTS t ()");

            // Bounded — a permanently failing statement must not spin forever.
            expect(attempts).toBe(DDL_ATTEMPTS);
        });

        it("does not retry an error that is not a create race", async () => {
            let attempts = 0;
            const { exec } = recordingExec(() => {
                attempts++;
                throw drizzleError("42501", "permission denied for schema rebase");
            });

            await createDdlBootstrapper(exec, "test").ensureObject("thing", "CREATE TABLE IF NOT EXISTS t ()");

            // A real failure surfaces at once rather than being reported four
            // attempts later as a race it never was.
            expect(attempts).toBe(1);
        });

        it("never throws, so the caller's next statement still runs", async () => {
            const { exec } = recordingExec(() => { throw new Error("out of disk space"); });
            const ddl = createDdlBootstrapper(exec, "test");
            await expect(ddl.ensureObject("thing", "CREATE TABLE IF NOT EXISTS t ()")).resolves.toBeUndefined();
        });

        it("reports the failure under the caller's scope", async () => {
            const errors: string[] = [];
            jest.spyOn(logger, "error").mockImplementation((message: string) => { errors.push(message); });

            const { exec } = recordingExec(() => { throw new Error("out of disk space"); });
            await createDdlBootstrapper(exec, "api-key-store").ensureObject("Creating rebase.api_keys", "CREATE …");

            expect(errors).toEqual(["[api-key-store] Creating rebase.api_keys failed"]);
        });
    });

    describe("step", () => {
        it("contains a failure and returns", async () => {
            jest.spyOn(logger, "error").mockImplementation(() => { /* silence */ });
            const ddl = createDdlBootstrapper(recordingExec().exec, "test");
            await expect(ddl.step("sweep", async () => { throw new Error("boom"); })).resolves.toBeUndefined();
        });

        it("accepts a runner that resolves to something other than void", async () => {
            // Call sites hand it `exec(...)` directly, which resolves to rows.
            const ddl = createDdlBootstrapper(recordingExec().exec, "test");
            await expect(ddl.step("revoke", async () => [{ ok: true }])).resolves.toBeUndefined();
        });
    });

    describe("isReadable", () => {
        it("asks in a dialect-neutral way", async () => {
            const { exec, statements } = recordingExec();
            await createDdlBootstrapper(exec, "test").isReadable("rebase.api_keys");
            // Not `to_regclass` — a future non-Postgres SQL driver would answer
            // that with a syntax error, which reads as "the table is missing".
            expect(statements[0]).toBe("SELECT 1 FROM rebase.api_keys WHERE false");
        });

        it("is true when the probe succeeds and false when it does not", async () => {
            const ok = createDdlBootstrapper(recordingExec().exec, "test");
            await expect(ok.isReadable("rebase.api_keys")).resolves.toBe(true);

            const missing = createDdlBootstrapper(
                recordingExec(() => { throw new Error('relation "rebase.api_keys" does not exist'); }).exec,
                "test"
            );
            await expect(missing.isReadable("rebase.api_keys")).resolves.toBe(false);
        });
    });
});

/**
 * The narrow classifier: "someone beat me to it" versus "this genuinely failed".
 *
 * `isConcurrentDdlRace` answers "should I try again", and a caller that only
 * retries can afford to be generous. `isDuplicateObjectRace` answers "may I
 * carry on as though this had worked", which is a claim about the end state —
 * and the caller that asks it is a loop applying a schema plan, where a
 * generous answer swallows the one `23505` that matters: a unique constraint
 * the customer's existing rows already violate.
 */
describe("isDuplicateObjectRace", () => {
    const wrapped = (code: string, extra: Record<string, unknown> = {}) =>
        new Error("Failed query: …", { cause: Object.assign(new Error(code), { code, ...extra }) });

    it.each(["42P06", "42P07", "42710"])("accepts %s — the object is unambiguously there", (code) => {
        expect(isDuplicateObjectRace(wrapped(code))).toBe(true);
    });

    it("accepts a 23505 on a pg_catalog index — a lost CREATE TYPE race", () => {
        expect(isDuplicateObjectRace(wrapped("23505", { constraint: "pg_type_typname_nsp_index" }))).toBe(true);
    });

    it("accepts a 23505 whose catalog index is only named in the detail text", () => {
        expect(isDuplicateObjectRace(wrapped("23505", {
            detail: 'Key (typname, typnamespace)=(posts_status, 2200) already exists in pg_type_typname_nsp_index.'
        }))).toBe(true);
    });

    it("REFUSES a 23505 on the customer's own constraint", () => {
        // The whole reason this function is separate from isConcurrentDdlRace.
        // Treating this as a race would let a schema step that genuinely cannot
        // be applied report success.
        expect(isDuplicateObjectRace(wrapped("23505", { constraint: "posts_slug_key" }))).toBe(false);
    });

    it("REFUSES a deadlock, which the broad check retries", () => {
        // 40P01 means the statement did nothing at all. Skipping it would leave
        // the object uncreated while the caller believed a peer had made it.
        expect(isDuplicateObjectRace(wrapped("40P01"))).toBe(false);
        expect(isConcurrentDdlRace(wrapped("40P01"))).toBe(true);
    });

    it("refuses an unrelated failure", () => {
        expect(isDuplicateObjectRace(wrapped("42501"))).toBe(false);
    });
});
