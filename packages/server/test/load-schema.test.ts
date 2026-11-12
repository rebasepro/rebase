import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

import { isSchemaDefinitionError, type SchemaDefinitionError } from "@rebasepro/common";
import { LEGACY_LAYOUT_REMEDY } from "@rebasepro/types";
import {
    compileLoadedSchema,
    isSchemaLoadError,
    loadBackendSchema,
    type SchemaLoadError
} from "../src/schema/load-schema";

/**
 * `loadBackendSchema` is the one definition of "the tables": boot, the stock
 * runtime, `db generate` and the doctor all read backend/schema through it. If
 * it skipped a module, or accepted a table without a posture, one of them would
 * serve a route the others never protected.
 */

let root: string;
let dir: string;

const write = (file: string, source: string): void => {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
};

const table = (name: string, rls = `"admin-only"`, extra = ""): string => `
import { defineTable, col } from "@rebasepro/types";
export const ${name} = defineTable("${name}", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
    rls: ${rls},${extra}
});
`;

async function loadError(): Promise<unknown> {
    try {
        await loadBackendSchema(dir);
    } catch (error) {
        return error;
    }
    throw new Error("expected loadBackendSchema to fail");
}

async function definitionError(): Promise<SchemaDefinitionError> {
    const error = await loadError();
    if (!isSchemaDefinitionError(error)) throw error;
    return error;
}

async function schemaLoadError(): Promise<SchemaLoadError> {
    const error = await loadError();
    if (!isSchemaLoadError(error)) throw error;
    return error;
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-schema-"));
    dir = path.join(root, "backend", "schema");
    fs.mkdirSync(dir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("loadBackendSchema — the index is authoritative", () => {
    it("returns every table and view the index exports, once each, and nothing lowered", async () => {
        write("posts.ts", table("posts"));
        write("authors.ts", table("authors"));
        write("index.ts", `
import { defineView, col } from "@rebasepro/types";
export { posts } from "./posts";
export { authors } from "./authors";
export { posts as alsoPosts } from "./posts";
export const titles = defineView("titles", {
    query: "SELECT id, title FROM posts",
    columns: { id: col.uuid().primaryKey(), title: col.text() }
});
export const notATable = 42;
`);

        const loaded = await loadBackendSchema(dir);

        expect(loaded.dir).toBe(path.resolve(dir));
        expect(loaded.indexFile).toBe(path.join(path.resolve(dir), "index.ts"));
        expect(loaded.defs.map(def => def.name).sort()).toEqual(["authors", "posts", "titles"]);
        expect(loaded.defaultRls).toBeUndefined();
        // Lowering is the caller's step: the definitions come back as authored.
        expect(loaded.defs.every(def => def.brand === "rebase.table" || def.brand === "rebase.view")).toBe(true);
    });

    it("reads defaultRls from the index, and an inherit table resolves against it", async () => {
        write("posts.ts", table("posts", `"inherit"`));
        write("index.ts", `
export { posts } from "./posts";
export const defaultRls = [{ operation: "select", access: "public" }];
`);

        const loaded = await loadBackendSchema(dir);

        expect(loaded.defaultRls).toEqual([{ operation: "select", access: "public" }]);
        const { descriptors, collections } = compileLoadedSchema(loaded);
        expect(descriptors[0].rls).toMatchObject({ posture: "rules", inherited: true });
        expect(collections[0].slug).toBe("posts");
        expect(collections[0].securityRules).toEqual([{ operation: "select", access: "public" }]);
    });

    it("refuses a sibling table the index does not export, naming the file and the fix", async () => {
        write("posts.ts", table("posts"));
        write("blog/drafts.ts", table("drafts"));
        write("index.ts", `export { posts } from "./posts";`);

        const error = await definitionError();

        expect(error.problems).toHaveLength(1);
        expect(error.problems[0].table).toBe("drafts");
        expect(error.problems[0].message).toContain(path.join("blog", "drafts.ts"));
        expect(error.problems[0].message).toContain(`export { drafts } from "./blog/drafts"`);
    });

    it("refuses every unexported definition at once", async () => {
        write("posts.ts", table("posts") + table("comments"));
        write("index.ts", `export const nothing = 1;`);

        const error = await definitionError();

        expect(error.problems.map(problem => problem.table).sort()).toEqual(["comments", "posts"]);
    });

    it("a directory without an index declares no tables — unless a sibling defines one", async () => {
        expect((await loadBackendSchema(dir)).defs).toEqual([]);
        expect((await loadBackendSchema(path.join(root, "missing"), { projectRoot: root })).defs).toEqual([]);

        write("posts.ts", table("posts"));
        const error = await definitionError();
        expect(error.problems[0].message).toContain("no index");
    });

    it("ignores tests, declarations and dotfiles", async () => {
        write("index.ts", `export { posts } from "./posts";`);
        write("posts.ts", table("posts"));
        write("posts.test.ts", "throw new Error('a test is never imported');");
        write("types.d.ts", "export {};");
        write("._posts.ts", "\u0000binary sidecar");

        expect((await loadBackendSchema(dir)).defs.map(def => def.name)).toEqual(["posts"]);
    });
});

describe("loadBackendSchema — a module that fails to import is fatal", () => {
    it("names the index when it throws", async () => {
        write("index.ts", "throw new Error('index exploded');");

        const error = await schemaLoadError();

        expect(error.file).toBe(path.join(path.resolve(dir), "index.ts"));
        expect(error.message).toContain("index exploded");
    });

    it("names a sibling when it throws — it is never skipped", async () => {
        write("index.ts", `export { posts } from "./posts";`);
        write("posts.ts", table("posts"));
        write("broken.ts", "throw new Error('sibling exploded');");

        const error = await schemaLoadError();

        expect(error.file).toBe(path.join(path.resolve(dir), "broken.ts"));
        expect(error.message).toContain("sibling exploded");
    });
});

describe("loadBackendSchema — the legacy layout is refused with the codemod", () => {
    it("refuses a project that still has config/collections", async () => {
        fs.mkdirSync(path.join(root, "config", "collections"), { recursive: true });
        write("index.ts", `export { posts } from "./posts";`);
        write("posts.ts", table("posts"));

        const error = await schemaLoadError();

        expect(error.message).toContain(LEGACY_LAYOUT_REMEDY);
        expect(error.file).toBe(path.join(root, "config", "collections"));
    });

    it("refuses being pointed at a config/collections directory", async () => {
        const legacy = path.join(root, "config", "collections");
        fs.mkdirSync(legacy, { recursive: true });

        await expect(loadBackendSchema(legacy, { projectRoot: false })).rejects.toThrow(LEGACY_LAYOUT_REMEDY);
    });

    // Each case gets its own directory: a module, once imported, is cached by path.
    it.each([
        ["a defineCollection result in the index", { "index.ts": `export const posts = { slug: "posts", properties: { id: { type: "string", isId: "uuid" } } };` }, "index.ts", "`posts`"],
        ["a collections array in the index", { "index.ts": "export const collections = [];" }, "index.ts", "`collections`"],
        ["a defineCollection result in a sibling", { "index.ts": "export const x = 1;", "posts.ts": `export default { slug: "posts", properties: {} };` }, "posts.ts", "`default`"]
    ])("refuses %s", async (_label, files, file, named) => {
        for (const [name, source] of Object.entries(files)) write(name, source);

        const error = await schemaLoadError();

        expect(error.message).toContain(LEGACY_LAYOUT_REMEDY);
        expect(error.message).toContain(named);
        expect(error.file).toBe(path.join(path.resolve(dir), file));
    });

    it("skips the config/collections check with projectRoot: false", async () => {
        fs.mkdirSync(path.join(root, "config", "collections"), { recursive: true });
        write("index.ts", `export { posts } from "./posts";`);
        write("posts.ts", table("posts"));

        expect((await loadBackendSchema(dir, { projectRoot: false })).defs).toHaveLength(1);
    });
});

describe("loadBackendSchema — fails closed, end to end", () => {
    it("refuses rls: \"inherit\" without a defaultRls", async () => {
        write("posts.ts", table("posts", `"inherit"`));
        write("index.ts", `export { posts } from "./posts";`);

        const error = await definitionError();

        expect(error.problems[0]).toMatchObject({ table: "posts" });
        expect(error.problems[0].message).toContain("defaultRls");
    });

    it.each([["\"inherit\""], ["[]"], ["\"public\""]])("refuses a defaultRls of %s", async (value) => {
        write("posts.ts", table("posts"));
        write("index.ts", `export { posts } from "./posts";\nexport const defaultRls = ${value};`);

        expect((await definitionError()).problems[0].table).toBe("defaultRls");
    });

    it("refuses a table whose rls was taken away after defineTable (no rls, empty rules)", async () => {
        // defineTable itself refuses these; a definition mutated afterwards —
        // or built by hand — must still not get past the loader.
        write("posts.ts", `${table("posts")}\n(posts.config as { rls: unknown }).rls = undefined;`);
        write("drafts.ts", `${table("drafts")}\n(drafts.config as { rls: unknown }).rls = [];`);
        write("index.ts", `export { posts } from "./posts";\nexport { drafts } from "./drafts";`);

        const error = await definitionError();

        expect(error.problems.map(problem => problem.table).sort()).toEqual(["drafts", "posts"]);
        expect(error.problems.find(problem => problem.table === "drafts")?.message).toContain("admin-only");
    });

    it("refuses admin-only beside defaultPolicies: false", async () => {
        write("posts.ts", table("posts", `"admin-only"`, "\n    defaultPolicies: false,"));
        write("index.ts", `export { posts } from "./posts";`);

        expect((await definitionError()).problems[0].message).toContain("defaultPolicies");
    });

    it("refuses a relation to a table the index does not list", async () => {
        write("authors.ts", table("authors"));
        write("posts.ts", `
import { defineTable, col, rel } from "@rebasepro/types";
import { authors } from "./authors";
export const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    relations: { author: rel.belongsTo(() => authors) },
    rls: "admin-only"
});
`);
        // authors is defined, but only reachable through the relation: the
        // sibling check reports it before compiling.
        write("index.ts", `export { posts } from "./posts";`);

        const error = await definitionError();

        expect(error.problems.map(problem => problem.table)).toContain("authors");
    });

    it("refuses two auth tables", async () => {
        const auth = (name: string): string => `
import { defineAuthTable, col } from "@rebasepro/types";
export const ${name} = defineAuthTable("${name}", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    rls: "admin-only"
});
`;
        write("users.ts", auth("users"));
        write("members.ts", auth("members"));
        write("index.ts", `export { users } from "./users";\nexport { members } from "./members";`);

        expect((await definitionError()).problems[0].message).toContain("defineAuthTable");
    });
});

describe("loadBackendSchema — a caller-supplied importModule", () => {
    // A CLI is not running under a TypeScript loader and passes jiti; here a
    // recording importer stands in, delegating to the native import().
    const recording = (calls: string[], failOn?: string) => async (file: string): Promise<Record<string, unknown>> => {
        calls.push(path.relative(dir, file));
        if (failOn !== undefined && file.endsWith(failOn)) throw new Error("the importer could not load it");
        return { ...(await import(file)) };
    };

    it("imports the index and every sibling through it, and reads the definitions off what it returns", async () => {
        write("index.ts", `export { posts } from "./posts";\nexport { tags } from "./tags";`);
        write("posts.ts", table("posts"));
        write("tags.ts", table("tags"));
        const calls: string[] = [];

        const loaded = await loadBackendSchema(dir, { projectRoot: false, importModule: recording(calls) });

        expect(calls).toEqual(["index.ts", "posts.ts", "tags.ts"]);
        expect(loaded.defs.map(def => def.name).sort()).toEqual(["posts", "tags"]);
    });

    it("still refuses a sibling definition the index does not export", async () => {
        write("index.ts", `export { posts } from "./posts";`);
        write("posts.ts", table("posts"));
        write("drafts.ts", table("drafts"));

        await expect(loadBackendSchema(dir, { projectRoot: false, importModule: recording([]) })).rejects.toThrow(/drafts/);
    });

    it("turns the importer's failure into a SchemaLoadError naming the file", async () => {
        write("index.ts", `export { posts } from "./posts";`);
        write("posts.ts", table("posts"));
        write("broken.ts", `export const x = 1;`);

        let caught: unknown;
        try {
            await loadBackendSchema(dir, { projectRoot: false, importModule: recording([], "broken.ts") });
        } catch (error) {
            caught = error;
        }
        if (!isSchemaLoadError(caught)) throw new Error(`expected a SchemaLoadError, got ${String(caught)}`);
        const error = caught;
        expect(error.file).toBe(path.join(path.resolve(dir), "broken.ts"));
        expect(error.message).toContain("the importer could not load it");
    });
});
