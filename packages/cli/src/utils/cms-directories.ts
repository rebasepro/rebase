/**
 * Where a project keeps its table customizations.
 *
 * Its own module, outside `commands/`: the bundler reads it too, and nothing
 * under `commands/` may sit on the CLI's startup import graph
 * (`cli-startup-imports.test.ts`).
 */
import fs from "fs";
import path from "path";
import { loadManifest } from "../manifest";

/**
 * The directories that hold the project's table customizations: `src/cms` of
 * each static app `rebase.json` declares, and `frontend/src/cms`, the layout
 * `rebase init` writes. Only those that exist; none for a headless project.
 */
export function cmsDirectories(projectRoot: string): string[] {
    const roots = new Set<string>(["frontend"]);
    try {
        const { manifest } = loadManifest(projectRoot);
        for (const app of Object.values(manifest.apps)) {
            if (app.type === "static" && typeof app.root === "string") roots.add(app.root);
        }
    } catch {
        // No rebase.json, or one another command reports: the conventional layout.
    }
    const out: string[] = [];
    for (const root of roots) {
        const dir = path.resolve(projectRoot, root, "src", "cms");
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && !out.includes(dir)) out.push(dir);
    }
    return out;
}
