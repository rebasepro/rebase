/**
 * A fresh scaffold passes its own `rebase resources --check`.
 *
 * Every CMS preset ships `config/resources.ts` with `export const main =
 * database()` and a `backend/functions/hello.ts`, so the graph declares
 * resources from the first second — and nothing wrote `rebase.resources.json`
 * until the first `rebase build`. The documented CI gate failed with
 * `resource_graph_missing` on a project nobody had touched. So `init` writes
 * each shape's graph, and this file holds it to two things, per shape:
 *
 *   - `init` copies the shape's shipped `templates/resource-graphs/<shape>.json`;
 *   - `rebase resources --check` on the fresh scaffold passes, which is the
 *     shipped graph being exactly what the declarations derive, today.
 *
 * To refresh the shipped graphs after a deliberate template change:
 *
 *     REBASE_WRITE_FIXTURE=1 vitest run src/commands/init-resource-graph.test.ts
 *
 * (from `packages/cli`), then review the diff: it is in every new project's
 * first commit.
 *
 * The scaffolds live under the package root, as in `derive.test.ts`: under
 * `os.tmpdir()` there is no `node_modules` above them and `@rebasepro/types`
 * would not resolve from `config/resources.ts`. `@rebasepro/cms-types`, which
 * the CLI does not depend on and a scaffold only has once installed, is given
 * to each scaffold as a one-file package re-exporting the real builder from
 * source — the one thing its collection files import from it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { findBackendApp, loadManifest } from "../manifest";
import { deriveOptionsFor, deriveResourceGraph, serializeResourceGraph } from "../resources/derive";
import { createRebaseApp, shippedResourceGraphPath, type ScaffoldShape } from "./init";
import { resourcesCommand } from "./resources";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHAPES: ScaffoldShape[] = ["blog", "ecommerce", "blank", "headless"];

let tmp: string;
let cwd: string;
let printed: string[];

beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-init-graph-"));
    cwd = process.cwd();
    printed = [];
    vi.stubEnv("REBASE_E2E", "1");
    const capture = (...parts: unknown[]) => { printed.push(parts.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = 0;
    fs.rmSync(tmp, { recursive: true, force: true });
});

/** `@rebasepro/cms-types` as an installed scaffold would resolve it, for `defineCollection`. */
function giveCmsTypes(project: string): void {
    const pkg = path.join(project, "node_modules", "@rebasepro", "cms-types");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@rebasepro/cms-types", type: "module", exports: "./index.ts" }));
    const builder = path.resolve(PACKAGE_ROOT, "..", "cms-types", "src", "define_collection.ts");
    fs.writeFileSync(path.join(pkg, "index.ts"), `export { defineCollection } from ${JSON.stringify(builder)};\n`);
}

async function scaffold(shape: ScaffoldShape): Promise<string> {
    const project = path.join(tmp, `${shape}-app`);
    const flags = shape === "headless" ? ["--headless"] : ["--template", shape];
    await createRebaseApp(["node", "rebase", "init", project, "--yes", ...flags]);
    giveCmsTypes(project);
    return project;
}

describe.each(SHAPES)("the %s scaffold", (shape) => {
    it("passes `rebase resources --check` as soon as it is written", async () => {
        const project = await scaffold(shape);

        // Derived once per project, by whichever of the two runs: the derive
        // evaluates the config through `import()`, and a second evaluation of
        // the same files in one process reads the module cache, which
        // registers nothing.
        if (process.env.REBASE_WRITE_FIXTURE === "1") {
            const backend = findBackendApp(loadManifest(project).manifest);
            if (!backend) throw new Error("the scaffold declares no backend app");
            const { graph, issues } = await deriveResourceGraph(deriveOptionsFor(project, backend.app));
            expect(issues).toEqual([]);
            fs.writeFileSync(shippedResourceGraphPath(shape), serializeResourceGraph(graph));
            return;
        }

        expect(fs.readFileSync(path.join(project, "rebase.resources.json"), "utf8"))
            .toBe(fs.readFileSync(shippedResourceGraphPath(shape), "utf8"));

        process.chdir(project);
        await resourcesCommand(["node", "rebase", "resources", "--check"]);
        expect(printed.join("\n")).toContain("rebase.resources.json matches the declarations");
        expect(process.exitCode ?? 0).toBe(0);
    });
});
