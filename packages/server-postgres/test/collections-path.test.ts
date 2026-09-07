/**
 * A `--collections` path that does not exist stops the command, once.
 *
 * It used to warn and continue. Four times over — `schemaCommand`,
 * `generatePostgresDdlCommand` and the Atlas argv assembly each re-enter the
 * loader with the same line — and then both generators wrote an *empty*
 * schema: `drizzle/schema.sql` truncated to `CREATE SCHEMA IF NOT EXISTS
 * "rebase";` and `src/schema.generated.ts` to ten lines. Both are committed
 * artifacts. The push that followed planned a `DROP TABLE` for every table in
 * the database; only the destructive gate stood between a typo and that.
 */
import fs from "fs";
import os from "os";
import path from "path";

import {
    assertCollectionsPathExists,
    CollectionsPathMissing,
    describeMissingCollectionsPath
} from "../src/cli-collections-path";
import { collectionsPathIn } from "../src/cli-flags";
import { reportCommandFailure } from "../src/cli-errors";

describe("collectionsPathIn", () => {
    it("reads the flag off a `db push` line", () => {
        expect(collectionsPathIn(["db", "push", "--collections", "./nope", "--allow-destructive"]))
            .toBe("./nope");
    });

    it("reads the `=` form and the short one", () => {
        expect(collectionsPathIn(["db", "push", "--collections=./nope"])).toBe("./nope");
        expect(collectionsPathIn(["schema", "generate", "-c", "./nope"])).toBe("./nope");
    });

    it("answers null when the flag is not there — the default is the loader's business", () => {
        expect(collectionsPathIn(["db", "push"])).toBeNull();
        expect(collectionsPathIn(["db", "push", "--yes"])).toBeNull();
    });
});

describe("assertCollectionsPathExists", () => {
    let printed: string[];
    let spy: jest.SpyInstance;

    beforeEach(() => {
        printed = [];
        spy = jest.spyOn(console, "error").mockImplementation((line?: unknown) => {
            printed.push(String(line ?? ""));
        });
    });

    afterEach(() => spy.mockRestore());

    it("throws on a path that is not there", () => {
        expect(() => assertCollectionsPathExists("./does-not-exist-anywhere"))
            .toThrow(CollectionsPathMissing);
    });

    it("prints the path, what it resolved to, and the cwd it resolved against", () => {
        try {
            assertCollectionsPathExists("./does-not-exist-anywhere");
        } catch { /* asserted above */ }

        const text = printed.join("\n");
        expect(text).toContain("./does-not-exist-anywhere");
        expect(text).toContain(path.resolve(process.cwd(), "./does-not-exist-anywhere"));
        expect(text).toContain(process.cwd());
    });

    it("says nothing was generated and nothing applied", () => {
        // The reader's next question is whether their committed schema files
        // survived. They did, and only because this refuses before the writes.
        expect(describeMissingCollectionsPath("./nope", "/abs/nope"))
            .toContain("Nothing was generated and nothing was applied");
    });

    it("accepts a path that exists", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-collections-"));
        try {
            expect(() => assertCollectionsPathExists(dir)).not.toThrow();
            expect(printed).toHaveLength(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("says nothing when no --collections was typed", () => {
        // A headless scaffold has no collections directory at all, and the
        // default path is the loader's forgiving business, not this one's.
        expect(() => assertCollectionsPathExists(null)).not.toThrow();
        expect(printed).toHaveLength(0);
    });
});

describe("the diagnosis is printed once", () => {
    it("reportCommandFailure stays quiet for an error that already spoke", () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            reportCommandFailure(new CollectionsPathMissing("./nope", "/abs/nope"));
            expect(spy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });
});
