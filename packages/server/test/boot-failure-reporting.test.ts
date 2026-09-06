import { describe, expect, it } from "@jest/globals";

import { reportBootFailure } from "../src/boot/boot";
import { BundleError } from "../src/boot/bundle";
import { CollectionConfigError } from "../src/collections/validate-config";

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

        reportBootFailure(err, log);

        const errors = lines.filter(l => l.level === "error").map(l => l.message);
        expect(errors[0]).toBe("Failed to start the Rebase runtime");
        expect(errors.join("\n")).toContain("connect ECONNREFUSED 10.0.0.4:5432");
    });
});
