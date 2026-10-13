/**
 * A fresh `rebase init --git` project stays clean through its first `rebase dev`.
 *
 * `rebase dev` regenerates `backend/src/schema.generated.ts` from the
 * collections on every start, and the Studio's schema editor refuses to commit
 * over a dirty copy of it (`SCHEMA_EDIT_DIRTY_TREE`). The scaffold used to ship
 * that file as a stub, commit it, and let the first `dev` rewrite it — so every
 * new project's first Studio edit was refused, because of a change the project's
 * owner never made.
 *
 * So `init` writes each preset's real generated schema, and this file holds it
 * to two things, per preset:
 *
 *   - the shipped `templates/generated-schemas/<preset>.ts` is exactly what the
 *     generator writes for that preset's collections, today;
 *   - a real `init --git` followed by the regeneration `dev` runs leaves
 *     `git status` empty — not only the schema file, the whole tree.
 *
 * To refresh the shipped schemas after a deliberate generator change:
 *
 *     REBASE_WRITE_FIXTURE=1 vitest run src/commands/init-generated-schema.test.ts
 *
 * (from `packages/cli`), then review the diff: it is what every new project's
 * first commit will contain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { loadCollectionsFromDirectory } from "@rebasepro/server";
import { generateSchema } from "@rebasepro/server-postgres";
import { createRebaseApp, shippedSchemaPath, type TemplatePreset } from "./init";

// The scaffold's collection files import `defineCollection` from
// `@rebasepro/cms-types`, which the CLI does not depend on and which a scaffold
// only has once it is installed. The builder is all they import from it.
vi.mock("@rebasepro/cms-types", async () => import("../../../cms-types/src/define_collection"));

const PRESETS: TemplatePreset[] = ["blog", "ecommerce", "blank"];

/**
 * What `rebase schema generate` writes for a collections directory.
 *
 * The same two calls `writeDrizzleSchema` (server-postgres
 * `schema/generate-files.ts`) makes, in the same order: the shared loader, then
 * slug order, so the output does not depend on the directory listing.
 */
async function generatedSchemaFor(collectionsDir: string): Promise<string> {
    const collections = [...await loadCollectionsFromDirectory(collectionsDir)];
    collections.sort((a, b) => a.slug.localeCompare(b.slug));
    return String(generateSchema(collections));
}

function git(cwd: string, args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
}

let tmp: string;

beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-init-schema-")));
    // The release probe asks npm whether this version is published; the
    // scaffold under test does not need the answer.
    vi.stubEnv("REBASE_E2E", "1");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe.each(PRESETS)("the %s preset", (preset) => {
    it("ships the schema the generator writes, and init --git commits it clean", async () => {
        const project = path.join(tmp, `${preset}-app`);
        await createRebaseApp(["node", "rebase", "init", project, "--yes", "--git", "--template", preset]);

        const schemaFile = path.join(project, "backend", "src", "schema.generated.ts");
        const generated = await generatedSchemaFor(path.join(project, "config", "collections"));
        if (process.env.REBASE_WRITE_FIXTURE === "1") {
            fs.writeFileSync(shippedSchemaPath(preset), generated, "utf-8");
        }

        // The precondition: init committed, and committed everything.
        expect(git(project, ["log", "--oneline"]).trim().split("\n")).toHaveLength(1);
        expect(git(project, ["status", "--porcelain"])).toBe("");

        // The shipped copy is today's generator output, so a stale one fails
        // here with a diff rather than on somebody's first Studio edit.
        expect(fs.readFileSync(shippedSchemaPath(preset), "utf-8")).toBe(generated);

        // What `rebase dev` does before it starts anything. The tree it leaves
        // is the one the Studio's commit is judged against.
        fs.writeFileSync(schemaFile, generated, "utf-8");
        expect(git(project, ["status", "--porcelain"])).toBe("");
    }, 60_000);
});

describe("the shipped schemas", () => {
    it("are not stubs: every preset declares at least the users table", () => {
        for (const preset of PRESETS) {
            const shipped = fs.readFileSync(shippedSchemaPath(preset), "utf-8");
            expect(shipped).not.toContain("export const tables = {}");
            expect(shipped).toMatch(/pgSchema\("rebase"\)/);
        }
    });
});
