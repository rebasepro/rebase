import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

import { findCollectionConfigProblems } from "../src/collections/validate-config";

/**
 * The framework's own templates, through the framework's own validator.
 *
 * A template is the first code every new project runs. If the boot-time strict
 * parse rejects one of them, the validator is wrong — an error here means the
 * key list has drifted from the types, not that the template has.
 *
 * `tooling/scripts/check-templates.mjs` already typechecks these, which catches the same
 * renames for a TypeScript project. It does not catch them for a JavaScript one,
 * or for a project whose installed `@rebasepro/types` is older than the code
 * reading its collections. That is what this covers.
 */

const templateRoot = path.resolve(__dirname, "../../cli/templates/template/config/collections");

async function loadAll(dir: string): Promise<{ file: string; collection: unknown }[]> {
    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith(".ts") && f !== "index.ts")
        .sort();
    const loaded: { file: string; collection: unknown }[] = [];
    for (const file of files) {
        const mod = await import(path.join(dir, file));
        if (mod?.default) loaded.push({ file, collection: mod.default });
    }
    return loaded;
}

describe("the shipped templates", () => {
    it("has templates to check", () => {
        expect(fs.existsSync(templateRoot)).toBe(true);
    });

    it("validates the blog scaffold clean, warnings included", async () => {
        const loaded = await loadAll(templateRoot);

        expect(loaded.map(l => l.file)).toEqual(["authors.ts", "posts.ts", "tags.ts", "users.ts"]);
        expect(findCollectionConfigProblems(loaded.map(l => l.collection))).toEqual([]);
    });

    it("validates every preset clean", async () => {
        const presetsRoot = path.join(templateRoot, "presets");
        const presets = fs.readdirSync(presetsRoot).filter(p =>
            fs.statSync(path.join(presetsRoot, p)).isDirectory());

        expect(presets.length).toBeGreaterThan(0);

        for (const preset of presets) {
            const loaded = await loadAll(path.join(presetsRoot, preset));
            expect(findCollectionConfigProblems(loaded.map(l => l.collection))).toEqual([]);
        }
    });
});
