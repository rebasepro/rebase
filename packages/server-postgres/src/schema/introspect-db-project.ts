/**
 * Where the project being introspected into keeps what introspection writes.
 *
 * The generator is pure — `introspect-db-logic.ts` reads no files — so the one
 * question it cannot answer for itself lives here: does the project have a
 * frontend that a `customizeTable` file can be written into.
 */
import fs from "fs";
import path from "path";

import { CMS_PACKAGE } from "./introspect-db-customization";

/** How far up to look before giving up, if no project root announces itself. */
const MAX_LEVELS = 8;

/** Every dependency name a manifest declares, in any of the three fields. */
function declaredDependencies(manifestPath: string): Set<string> {
    const names = new Set<string>();
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
        // A malformed or unreadable package.json is not this function's problem
        // to report — it answers "can this import resolve", and the answer is no.
        return names;
    }
    if (typeof parsed !== "object" || parsed === null) return names;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        const block: unknown = Reflect.get(parsed, field);
        if (typeof block === "object" && block !== null) {
            for (const name of Object.keys(block)) names.add(name);
        }
    }
    return names;
}

/**
 * The project root above a directory: the first ancestor holding a
 * `rebase.json`, or `undefined` when none does within reach.
 */
export function findProjectRoot(from: string): string | undefined {
    let dir = path.resolve(from);
    for (let level = 0; level < MAX_LEVELS; level++) {
        if (fs.existsSync(path.join(dir, "rebase.json"))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
    return undefined;
}

/**
 * The `frontend/src/cms` directory introspection writes `customizeTable`
 * files into, or `undefined` when the project has no frontend that can import
 * `@rebasepro/cms`.
 *
 * The project root is the one above the schema directory (`rebase.json`), or —
 * in a layout without one — the parent of `backend/`. The frontend is
 * `<root>/frontend`, and it counts only when a manifest on the path a
 * `frontend/src/cms/<table>.tsx` resolves bare specifiers along (the frontend's
 * own `package.json`, then the root's) declares `@rebasepro/cms`: that is the
 * import the file opens with, and a headless project could not resolve it.
 */
export function detectCmsDir(schemaDir: string): string | undefined {
    const resolved = path.resolve(schemaDir);
    const root = findProjectRoot(resolved) ?? path.dirname(path.dirname(resolved));
    const frontend = path.join(root, "frontend");
    if (!fs.existsSync(frontend)) return undefined;
    for (const manifest of [path.join(frontend, "package.json"), path.join(root, "package.json")]) {
        if (fs.existsSync(manifest) && declaredDependencies(manifest).has(CMS_PACKAGE)) {
            return path.join(frontend, "src", "cms");
        }
    }
    return undefined;
}
