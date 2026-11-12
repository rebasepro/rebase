import { afterAll, describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

import { compileLoadedSchema, loadBackendSchema } from "../src/schema/load-schema";

/**
 * The framework's own templates, through the framework's own loader and compiler.
 *
 * A template is the first code every new project runs: each preset's
 * `backend/schema` is read exactly as boot reads it (`loadBackendSchema`, which
 * refuses a table the index does not export, a missing `rls`, an `"inherit"`
 * with no `defaultRls`) and compiled as boot compiles it. A template that does
 * not get through here is a scaffold that does not boot.
 *
 * `tooling/scripts/check-templates.mjs` already typechecks these, which catches
 * the same mistakes for a TypeScript project. It does not catch what only the
 * compiler checks at runtime (an `rls` posture, a relation whose target is not
 * exported), and it does not run in this package's suite.
 */

const templates = path.resolve(__dirname, "../../cli/templates");
const blogSchema = path.join(templates, "template", "backend", "schema");

/** `BLOG_PRESET_FILES` in commands/init.ts, the schema half: what another preset removes. */
const BLOG_TABLES = ["posts.ts", "authors.ts", "tags.ts"];

const scratch: string[] = [];
afterAll(() => {
    for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** A preset's `backend/schema` as `rebase init` lays it out: the blog's, minus its tables, with the preset's over it. */
function presetSchema(preset: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `rebase-template-${preset}-`));
    scratch.push(root);
    const dir = path.join(root, "backend", "schema");
    fs.mkdirSync(dir, { recursive: true });
    for (const file of fs.readdirSync(blogSchema)) {
        if (!BLOG_TABLES.includes(file)) fs.copyFileSync(path.join(blogSchema, file), path.join(dir, file));
    }
    const own = path.join(templates, "presets", preset, "backend", "schema");
    for (const file of fs.readdirSync(own)) fs.copyFileSync(path.join(own, file), path.join(dir, file));
    return dir;
}

async function slugsOf(dir: string): Promise<string[]> {
    const compiled = compileLoadedSchema(await loadBackendSchema(dir));
    return compiled.descriptors.map(descriptor => descriptor.slug).sort();
}

describe("the shipped templates", () => {
    it("has templates to check", () => {
        expect(fs.existsSync(path.join(blogSchema, "index.ts"))).toBe(true);
    });

    it("loads and compiles the blog scaffold clean", async () => {
        await expect(slugsOf(blogSchema)).resolves.toEqual(["authors", "posts", "tags", "users"]);
    });

    it("loads and compiles every preset clean", async () => {
        const presets = fs.readdirSync(path.join(templates, "presets"))
            .filter(name => fs.statSync(path.join(templates, "presets", name)).isDirectory())
            .sort();
        expect(presets).toEqual(["blank", "ecommerce"]);

        await expect(slugsOf(presetSchema("ecommerce"))).resolves.toEqual(["categories", "orders", "products", "users"]);
        await expect(slugsOf(presetSchema("blank"))).resolves.toEqual(["users"]);
    });
});
