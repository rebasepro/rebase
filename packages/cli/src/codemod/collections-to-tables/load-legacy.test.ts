/**
 * Which files of `config/collections` are collections, which are helpers, and
 * which are refused — with a stand-in importer, so each case is one module.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { LegacyLoadError, loadLegacyProject } from "./load-legacy";

const scratch: string[] = [];
afterAll(() => {
    for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** A config directory whose collection files are the given modules' names; the importer answers with the modules. */
function project(modules: Record<string, Record<string, unknown>>): { configDir: string; importModule: (file: string) => Promise<Record<string, unknown>> } {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemod-load-"));
    scratch.push(configDir);
    fs.mkdirSync(path.join(configDir, "collections"));
    for (const name of Object.keys(modules)) fs.writeFileSync(path.join(configDir, "collections", name), "");
    return {
        configDir,
        importModule: async file => {
            const mod = modules[path.basename(file)];
            if (!mod) throw new Error(`unexpected import of ${file}`);
            return mod;
        }
    };
}

const posts = { slug: "posts", name: "Posts", properties: {} };

describe("loadLegacyProject", () => {
    it("reads a file that exports no collection as a helper, not a refusal", async () => {
        const { configDir, importModule } = project({
            "posts.ts": { default: posts },
            "_predicates.ts": { IS_REAL_USER: "auth.uid() IS NOT NULL", worksAt: () => "true" }
        });
        const legacy = await loadLegacyProject(configDir, importModule);
        expect(legacy.collections.map(entry => entry.collection.slug)).toEqual(["posts"]);
        expect(legacy.helperFiles.map(file => path.basename(file))).toEqual(["_predicates.ts"]);
    });

    it("still refuses a collection exported by name: dropping it would drop the table", async () => {
        const { configDir, importModule } = project({
            "posts.ts": { default: posts },
            "tags.ts": { tags: { slug: "tags", name: "Tags", properties: {} } }
        });
        await expect(loadLegacyProject(configDir, importModule)).rejects.toThrow(LegacyLoadError);
        await expect(loadLegacyProject(configDir, importModule)).rejects.toThrow("tags.ts: no default export of a collection");
    });

    it("still refuses a default export that is not a collection", async () => {
        const { configDir, importModule } = project({ "posts.ts": { default: { name: "Posts" } } });
        await expect(loadLegacyProject(configDir, importModule)).rejects.toThrow("posts.ts: no default export of a collection");
    });
});
