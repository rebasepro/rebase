import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { logger, redactSensitiveText } from "../src/utils/logger";

/**
 * The logger is the last thing between a caught error and the platform's log
 * sink, and Drizzle hands it `Failed query: <sql>\nparams: <values>` as the
 * *message* of every query failure. These tests assert on what is actually
 * written to stdout/stderr/console rather than on a spy over `logger.error`:
 * a spy replaces the method that does the redacting, so it can only ever show
 * the unredacted input.
 */

/** The real Drizzle error, not a look-alike — the message format is the bug. */
function failingQuery(): DrizzleQueryError {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
        code: "23505",
        constraint: "users_email_key",
        table: "users"
    });
    return new DrizzleQueryError(
        'insert into "users" ("email", "password_hash") values ($1, $2) returning "id"',
        ["alice@acme.com", "$2b$12$abcdefghijklmnopqrstuv"],
        pgError
    );
}

/** Every string the emitted line must never contain. */
const SECRETS = ["alice@acme.com", "$2b$12$abcdefghijklmnopqrstuv", "password_hash", "insert into"];

describe("logger redaction", () => {
    let written: string[];
    const originalEnv = { ...process.env };

    beforeEach(() => {
        written = [];
        jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => { written.push(args.join(" ")); });
        jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { written.push(args.join(" ")); });
        jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => { written.push(args.join(" ")); });
        jest.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => { written.push(String(chunk)); return true; }) as never);
        jest.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { written.push(String(chunk)); return true; }) as never);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        process.env = { ...originalEnv };
    });

    const output = () => written.join("\n");

    it("keeps the drizzle message format this redaction is written against", () => {
        // If drizzle ever stops prefixing with `Failed query:` the strip below
        // silently stops working — this is the canary for that upgrade.
        const err = failingQuery();
        expect(err.message.startsWith("Failed query:")).toBe(true);
        expect(err.message).toContain("params:");
    });

    it("strips the SQL and bound params out of a logged error", () => {
        logger.error("Insert failed", { error: failingQuery() });

        for (const secret of SECRETS) expect(output()).not.toContain(secret);
        expect(output()).toContain("Failed query: [redacted]");
    });

    it("strips them from the message as well as the data", () => {
        // errors.ts interpolates `error.message` straight into its log line.
        logger.error(`❌ [API] POST /api/users → 500 INTERNAL_ERROR: ${failingQuery().message}`);

        for (const secret of SECRETS) expect(output()).not.toContain(secret);
    });

    it("strips them from the production JSON envelope too", () => {
        process.env.NODE_ENV = "production";
        logger.error("Insert failed", { error: failingQuery() });

        expect(written.length).toBeGreaterThan(0);
        for (const secret of SECRETS) expect(output()).not.toContain(secret);
        // Still a parseable Cloud Logging entry, not a mangled string.
        const entry = JSON.parse(written[0]);
        expect(entry.severity).toBe("ERROR");
        expect(entry.error.name).toBe("Error");
    });

    it("keeps the stack frames that follow the redacted span", () => {
        const err = failingQuery();
        logger.error("Insert failed", { error: err });

        expect(output()).toContain("logger-redaction.test");
        for (const secret of SECRETS) expect(output()).not.toContain(secret);
    });

    it("does not copy DrizzleQueryError's query/params own-properties", () => {
        // They sit beside the message and would otherwise be a second copy of
        // the same leak for anyone serialising the error object.
        logger.error("Insert failed", { error: failingQuery() });

        const entry = output();
        expect(entry).not.toContain("returning");
        expect(entry).not.toContain("acme.com");
    });

    it("keeps the diagnosis: SQLSTATE, constraint and table survive", () => {
        // Redaction that also removes the signal is not a fix. These are the
        // fields `extractPgError` surfaces and the [PG …] line logs.
        logger.error("[PG 23505] Error in \"users\"", {
            code: "23505",
            constraint: "users_email_key",
            table: "users",
            column: "email"
        });

        expect(output()).toContain("23505");
        expect(output()).toContain("users_email_key");
        expect(output()).toContain("users");
    });

    it("redacts values of secret-looking keys, at any depth", () => {
        logger.info("Auth attempt", {
            password: "hunter2",
            api_key: "sk-live-123",
            nested: { refreshToken: "rt-abc", authorization: "Bearer xyz", safe: "keep-me" },
            list: [{ SESSION_ID: "sid-9" }]
        });

        const entry = output();
        for (const secret of ["hunter2", "sk-live-123", "rt-abc", "Bearer xyz", "sid-9"]) {
            expect(entry).not.toContain(secret);
        }
        expect(entry).toContain("keep-me");
        expect(entry).toContain("[redacted]");
    });

    it("redacts a child logger's default fields too", () => {
        // They are merged into every line the child emits, so raw defaults
        // would be a hole that reopens the moment `child()` gets a caller.
        logger.child({ apiKey: "sk-live-child", surface: "cron" }).info("Job started");

        expect(output()).not.toContain("sk-live-child");
        expect(output()).toContain("cron");
    });

    it("survives a cycle rather than throwing", () => {
        const cyclic: Record<string, unknown> = { name: "loop" };
        cyclic.self = cyclic;

        expect(() => logger.info("Cyclic", { cyclic })).not.toThrow();
        expect(output()).toContain("[circular]");
    });

    describe("redactSensitiveText", () => {
        it("leaves text without the marker untouched", () => {
            expect(redactSensitiveText("nothing to see")).toBe("nothing to see");
        });

        it("drops everything after the marker when no params line follows", () => {
            // Fail closed: a statement of unknown extent is treated as
            // sensitive rather than guessed at.
            expect(redactSensitiveText("Failed query: select * from users where email = 'a@b.c'"))
                .toBe("Failed query: [redacted]");
        });

        it("redacts every occurrence, not just the first", () => {
            const doubled = `Failed query: select 1\nparams: a\nwrapped by\nFailed query: select 2\nparams: b\ntail`;
            const out = redactSensitiveText(doubled);
            expect(out).not.toContain("select 1");
            expect(out).not.toContain("select 2");
            expect(out).toContain("wrapped by");
            expect(out).toContain("tail");
        });

        it("is idempotent — a second pass keeps the stack frames", () => {
            // The redacted span still starts with the marker but has no
            // `params:` line, so a naive second pass drops everything behind
            // it. The cron scheduler redacts before persisting and then logs
            // the result, so this runs twice for real.
            const stack = `Error: Failed query: select 1\nparams: a\n    at Object.<anonymous> (/app/x.ts:1:1)`;
            const once = redactSensitiveText(stack);
            expect(once).toContain("/app/x.ts");
            expect(redactSensitiveText(once)).toBe(once);
        });

        it("honours REBASE_LOG_RAW_QUERIES only outside production", () => {
            process.env.REBASE_LOG_RAW_QUERIES = "true";
            process.env.NODE_ENV = "development";
            expect(redactSensitiveText("Failed query: select 1\nparams: a")).toContain("select 1");

            process.env.NODE_ENV = "production";
            expect(redactSensitiveText("Failed query: select 1\nparams: a")).not.toContain("select 1");
        });
    });
});
