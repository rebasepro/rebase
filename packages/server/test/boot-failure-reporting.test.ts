import { describe, expect, it } from "@jest/globals";

import { reportBootFailure } from "../src/boot/boot";
import { BundleError } from "../src/boot/bundle";
import { CollectionConfigError } from "../src/collections/validate-config";
import { logger } from "../src/utils/logger";

/**
 * What a boot that will not start prints.
 *
 * This had no test because the code it came from ended in `process.exit(1)`,
 * and what a dying process said on its way out is exactly the thing nobody
 * checks. A duplicate slug in a scaffold therefore reached its author as
 * `❌ [ERROR] Failed to start the Rebase runtime {"error":{"name":"Error",
 * "message":"1 problem(s) in the collection config.\n\n…","stack":"… at
 * assertCollectionConfigs (…/dist/index.es.js:727:8) …"}}` — the validator's
 * carefully composed multi-line answer, escaped into one field of a 3 KB blob,
 * with a stack through a bundle the author has never opened.
 */

interface Line {
    level: "error" | "debug";
    message: string;
    data?: Record<string, unknown>;
}

function capture(): { lines: Line[]; log: Parameters<typeof reportBootFailure>[1] } {
    const lines: Line[] = [];
    return {
        lines,
        log: {
            error: (message: string, data?: Record<string, unknown>) => {
                lines.push({ level: "error", message, data });
            },
            debug: (message: string, data?: Record<string, unknown>) => {
                lines.push({ level: "debug", message, data });
            }
        }
    };
}

describe("reportBootFailure", () => {
    it("prints a collection-config error as its own message, once", () => {
        const { lines, log } = capture();
        const message =
            "1 problem(s) in the collection config.\n\n" +
            "  • posts\n      2 collections declare `slug: \"posts\"`: dup.ts, posts.ts.\n";

        reportBootFailure(new CollectionConfigError(message), log);

        const errors = lines.filter(l => l.level === "error");
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toBe(message);
        // The whole point: no structured payload, so nothing escapes the
        // message into JSON.
        expect(errors[0].data).toBeUndefined();
        expect(errors.map(l => l.message).join("\n")).not.toContain("{\"error\":");
        expect(errors.map(l => l.message).join("\n")).not.toContain("Failed to start the Rebase runtime");
    });

    it("keeps the stack, at debug", () => {
        const { lines, log } = capture();

        reportBootFailure(new CollectionConfigError("nope"), log);

        const debug = lines.filter(l => l.level === "debug");
        expect(debug).toHaveLength(1);
        expect(debug[0].message).toContain("CollectionConfigError: nope");
    });

    it("prints a BundleError's hint after its message", () => {
        const { lines, log } = capture();

        reportBootFailure(new BundleError("No bundle here", "Run `rebase build` first."), log);

        expect(lines.filter(l => l.level === "error").map(l => l.message))
            .toEqual(["No bundle here", "Run `rebase build` first."]);
    });

    it("still names the cause chain for a bug", () => {
        const { lines, log } = capture();
        const cause = new Error("connect ECONNREFUSED 10.0.0.4:5432");
        const err = new Error("Driver failed to initialize", { cause });

        reportBootFailure(err, log, { NODE_ENV: "development" });

        const errors = lines.filter(l => l.level === "error").map(l => l.message);
        expect(errors[0]).toContain("Failed to start the Rebase runtime");
        expect(errors.join("\n")).toContain("connect ECONNREFUSED 10.0.0.4:5432");
    });

    // The diagnosis box the connect failure prints names the host, the port and
    // `docker compose up -d db`. In development the boot then appended the whole
    // error as one `JSON.stringify` — 3 KB with `\n`-escaped stack frames —
    // directly under it, which is enough to scroll the box out of a terminal.
    it("keeps the structured payload out of the development transcript", () => {
        const { lines, log } = capture();
        const cause = new Error("connect ECONNREFUSED 10.0.0.4:5432");

        reportBootFailure(new Error("Driver failed to initialize", { cause }), log,
            { NODE_ENV: "development" });

        for (const line of lines.filter(l => l.level === "error")) {
            expect(line.data).toBeUndefined();
        }
        // Not thrown away — moved to where the reader who wants it can ask.
        expect(lines.filter(l => l.level === "debug" && l.data?.error)).toHaveLength(1);
    });

    // Through the real logger, because the length is a property of what it
    // renders: development formats the data bag as one `JSON.stringify` glued
    // to the end of the headline, so the payload is not one long *entry*, it is
    // one long *line*.
    it("leaves no line long enough to scroll the diagnosis box away", () => {
        const written: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => { written.push(String(args[0])); };
        try {
            const cause = Object.assign(
                new Error("connect ECONNREFUSED 10.0.0.4:5432"),
                { code: "ECONNREFUSED", address: "10.0.0.4", port: 5432 }
            );
            reportBootFailure(
                new Error(
                    "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                    "  ❌  Cannot connect to PostgreSQL at 10.0.0.4:5432\n" +
                    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                    "  The driver said: connect ECONNREFUSED 10.0.0.4:5432\n",
                    { cause }
                ),
                logger,
                { NODE_ENV: "development" }
            );
        } finally {
            console.error = original;
        }

        const longest = written.flatMap(entry => entry.split("\n"))
            .reduce((max, line) => Math.max(max, line.length), 0);
        expect(longest).toBeLessThan(500);
        expect(written.join("\n")).toContain("caused by: connect ECONNREFUSED 10.0.0.4:5432");
    });

    it("keeps the structured payload in production, where a machine reads it", () => {
        const { lines, log } = capture();
        const cause = new Error("connect ECONNREFUSED 10.0.0.4:5432");

        reportBootFailure(new Error("Driver failed to initialize", { cause }), log,
            { NODE_ENV: "production" });

        // `troubleshooting.md` tells operators the chain is under `error.cause`
        // in JSON logs, so it has to be on the line there.
        const headline = lines.find(l => l.message === "Failed to start the Rebase runtime");
        expect(headline?.level).toBe("error");
        expect((headline?.data?.error as Error).cause).toBe(cause);
    });

    it("names the failure in development when there is no cause to name it", () => {
        const { lines, log } = capture();

        reportBootFailure(new Error("Cannot find package 'drizzle-orm'"), log,
            { NODE_ENV: "development" });

        const errors = lines.filter(l => l.level === "error").map(l => l.message);
        expect(errors.join("\n")).toContain("Cannot find package 'drizzle-orm'");
    });
});
