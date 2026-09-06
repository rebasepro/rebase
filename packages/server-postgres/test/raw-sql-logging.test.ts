import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { DataService } from "../src/services/dataService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

/**
 * A statement is never printed because of `NODE_ENV`.
 *
 * `executeSql` traced every statement with a `console.debug` gated only on
 * `NODE_ENV !== "production"`. Two things followed, and the second is the one
 * that matters:
 *
 *   - the scaffold sets `LOG_LEVEL=info`, and a 60-second idle backend still
 *     emitted 478 lines — 18 of them the job poller's
 *     `UPDATE rebase.jobs … FOR UPDATE SKIP LOCKED`;
 *   - it went to stdout through `console`, which is not the logger, and the
 *     logger is the one place redaction lives. A statement with an email or a
 *     bcrypt hash bound into it was written out verbatim.
 *
 * Both are the same fix: the same switch that lifts the `Failed query:`
 * redaction decides whether SQL may be printed at all, and it goes through the
 * logger at `debug`.
 */

function captureConsole() {
    const lines: string[] = [];
    const push = (...args: unknown[]) => {
        lines.push(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    const originals = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.debug
    };
    console.log = push;
    console.warn = push;
    console.error = push;
    console.debug = push;
    return {
        lines,
        restore: () => {
            console.log = originals.log;
            console.warn = originals.warn;
            console.error = originals.error;
            console.debug = originals.debug;
        }
    };
}

/** Enough of a drizzle handle for `executeSql` to run against. */
function fakeDb(): NodePgDatabase {
    return {
        execute: async () => ({ rows: [{ n: 1 }] })
    } as unknown as NodePgDatabase;
}

function makeService(): DataService {
    return new DataService(fakeDb(), new PostgresCollectionRegistry());
}

describe("raw SQL is only printed when asked for", () => {
    const before = {
        nodeEnv: process.env.NODE_ENV,
        raw: process.env.REBASE_LOG_RAW_QUERIES,
        level: process.env.LOG_LEVEL
    };

    beforeEach(() => {
        delete process.env.REBASE_LOG_RAW_QUERIES;
        process.env.NODE_ENV = "development";
        process.env.LOG_LEVEL = "info";
    });

    afterEach(() => {
        if (before.nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = before.nodeEnv;
        if (before.raw === undefined) delete process.env.REBASE_LOG_RAW_QUERIES;
        else process.env.REBASE_LOG_RAW_QUERIES = before.raw;
        if (before.level === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = before.level;
    });

    it("says nothing at LOG_LEVEL=info in development", async () => {
        const capture = captureConsole();
        try {
            await makeService().executeSql("UPDATE rebase.jobs SET x = 1 FOR UPDATE SKIP LOCKED");
        } finally {
            capture.restore();
        }

        expect(capture.lines.join("\n")).not.toContain("Executing raw SQL");
        expect(capture.lines.join("\n")).not.toContain("SQL executed successfully");
    });

    it("stays quiet with the switch on but the level above debug", async () => {
        // Two independent gates, and both have to be open: the switch says the
        // statement may be shown at all, the level says debug lines are wanted.
        process.env.REBASE_LOG_RAW_QUERIES = "true";
        const capture = captureConsole();
        try {
            await makeService().executeSql("SELECT 1");
        } finally {
            capture.restore();
        }

        expect(capture.lines.join("\n")).not.toContain("Executing raw SQL");
    });

    it("prints the statement when the switch and the level are both set", async () => {
        process.env.REBASE_LOG_RAW_QUERIES = "true";
        process.env.LOG_LEVEL = "debug";
        const capture = captureConsole();
        try {
            await makeService().executeSql("SELECT 1");
        } finally {
            capture.restore();
        }

        expect(capture.lines.join("\n")).toContain("Executing raw SQL: SELECT 1");
    });

    it("never prints in production, whatever the switch says", async () => {
        process.env.NODE_ENV = "production";
        process.env.REBASE_LOG_RAW_QUERIES = "true";
        process.env.LOG_LEVEL = "debug";
        const capture = captureConsole();
        try {
            await makeService().executeSql("SELECT 1");
        } finally {
            capture.restore();
        }

        expect(capture.lines.join("\n")).not.toContain("Executing raw SQL");
    });
});
