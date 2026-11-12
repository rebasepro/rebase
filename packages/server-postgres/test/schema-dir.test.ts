/**
 * `--schema-dir`: the one flag that names where the tables are, checked once.
 *
 * A directory that does not exist stops the command before anything is
 * written. The flag it replaced (`--collections`) once warned and continued,
 * four times over, and then both generators wrote an *empty* schema:
 * `drizzle/schema.sql` truncated to `CREATE SCHEMA IF NOT EXISTS "rebase";`
 * and `src/schema.generated.ts` to ten lines. The push that followed planned a
 * `DROP TABLE` for every table in the database; only the destructive gate
 * stood between a typo and that.
 *
 * And `--collections` itself is refused with one line naming its replacement
 * and the codemod, rather than ignored: reading the default directory instead
 * of the one typed would generate a different schema.
 */
import fs from "fs";
import os from "os";
import path from "path";

import {
    assertNoCollectionsFlag,
    assertSchemaDirExists,
    DEFAULT_SCHEMA_DIR,
    describeMissingSchemaDir,
    removedCollectionsFlagSentence,
    SchemaDirMissing
} from "../src/cli-schema-dir";
import { schemaDirIn } from "../src/cli-flags";
import { reportCommandFailure } from "../src/cli-errors";

describe("the default", () => {
    it("is `schema`, relative to the driver's working directory backend/", () => {
        expect(DEFAULT_SCHEMA_DIR).toBe("schema");
    });
});

describe("schemaDirIn", () => {
    it("reads the flag off a `db push` line", () => {
        expect(schemaDirIn(["db", "push", "--schema-dir", "./nope", "--allow-destructive"])).toBe("./nope");
    });

    it("reads the `=` form", () => {
        expect(schemaDirIn(["db", "push", "--schema-dir=./nope"])).toBe("./nope");
        expect(schemaDirIn(["schema", "generate", "--schema-dir=/abs/backend/schema"])).toBe("/abs/backend/schema");
    });

    it("answers null when the flag is not there — the default is the loader's business", () => {
        expect(schemaDirIn(["db", "push"])).toBeNull();
        expect(schemaDirIn(["db", "push", "--yes"])).toBeNull();
    });
});

describe("a removed --collections", () => {
    it.each([
        [["db", "push", "--collections", "../config/collections"], "--collections"],
        [["db", "generate", "--collections=../config/collections", "init"], "--collections"],
        [["schema", "generate", "-c", "../config/collections"], "-c"],
        [["schema", "stale", "--collections", "x"], "--collections"],
        [["doctor", "--collections", "x"], "--collections"],
        [["console", "-c", "x"], "-c"]
    ])("is refused on %j with its replacement and the codemod", (line, flag) => {
        const sentence = removedCollectionsFlagSentence(line);
        expect(sentence).toMatch(new RegExp(`^${flag} was removed: `));
        expect(sentence).toContain("backend/schema");
        expect(sentence).toContain("--schema-dir <dir>");
        expect(sentence).toContain("tooling/scripts/migrate-collections-to-tables.mts");
        expect(sentence).toContain("Nothing was run.");
        // One line: the CLI prints it as the whole failure.
        expect(sentence).not.toContain("\n");
        expect(() => assertNoCollectionsFlag(line)).toThrow(sentence ?? "");
    });

    it("is left alone where it still means something, and past `--`", () => {
        // `schema introspect --collections` is the introspector's output
        // directory until the introspection slice moves it.
        expect(removedCollectionsFlagSentence(["schema", "introspect", "--collections", "x"])).toBeNull();
        expect(removedCollectionsFlagSentence(["db", "migrate", "--", "-c"])).toBeNull();
        expect(removedCollectionsFlagSentence(["db", "push", "--", "--collections"])).toBeNull();
        expect(removedCollectionsFlagSentence(["db", "push", "--schema-dir", "x"])).toBeNull();
    });
});

describe("assertSchemaDirExists", () => {
    let printed: string[];
    let spy: jest.SpyInstance;

    beforeEach(() => {
        printed = [];
        spy = jest.spyOn(console, "error").mockImplementation((line?: unknown) => {
            printed.push(String(line ?? ""));
        });
    });

    afterEach(() => spy.mockRestore());

    it("throws on a directory that is not there", () => {
        expect(() => assertSchemaDirExists("./does-not-exist-anywhere")).toThrow(SchemaDirMissing);
    });

    it("prints the path, what it resolved to, and the cwd it resolved against", () => {
        try {
            assertSchemaDirExists("./does-not-exist-anywhere");
        } catch { /* asserted above */ }

        const text = printed.join("\n");
        expect(text).toContain("./does-not-exist-anywhere");
        expect(text).toContain(path.resolve(process.cwd(), "./does-not-exist-anywhere"));
        expect(text).toContain(process.cwd());
    });

    it("says nothing was generated and nothing applied", () => {
        // The reader's next question is whether their committed schema files
        // survived. They did, and only because this refuses before the writes.
        expect(describeMissingSchemaDir("./nope", "/abs/nope"))
            .toContain("Nothing was generated and nothing was applied");
    });

    it("accepts a directory that exists", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-schema-dir-"));
        try {
            expect(() => assertSchemaDirExists(dir)).not.toThrow();
            expect(printed).toHaveLength(0);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("says nothing when no --schema-dir was typed", () => {
        // A headless project has no schema directory at all, and the default
        // is the loader's business (no tables), not this one's.
        expect(() => assertSchemaDirExists(null)).not.toThrow();
        expect(printed).toHaveLength(0);
    });
});

describe("the diagnosis is printed once", () => {
    it("reportCommandFailure stays quiet for an error that already spoke", () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            reportCommandFailure(new SchemaDirMissing("./nope", "/abs/nope"));
            expect(spy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });
});
