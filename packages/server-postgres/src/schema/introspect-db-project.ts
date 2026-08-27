/**
 * What the project being introspected into can actually import.
 *
 * The generator is pure — `introspect-db-logic.ts` reads no files — so the one
 * question it cannot answer for itself lives here: which `defineCollection`, if
 * any, will resolve from the directory the collections are written to.
 */
import fs from "fs";
import path from "path";

import { ADMIN_TYPES_PACKAGE, COMMON_PACKAGE, type CollectionBuilder } from "./introspect-db-logic";

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
    const manifest = parsed as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        const block = manifest[field];
        if (typeof block === "object" && block !== null) {
            for (const name of Object.keys(block)) names.add(name);
        }
    }
    return names;
}

/**
 * Which `defineCollection` to generate against, for collections written to `outDir`.
 *
 * **The detection is the package manifests above the output directory**, unioned from
 * `outDir` up to and including the project root — the first ancestor holding a
 * `rebase.json`, or `MAX_LEVELS` up if there is none.
 *
 * That is the rule Node itself applies: a file in `config/collections` resolves a bare
 * specifier through `config/node_modules`, then `<project>/node_modules`, and so on up.
 * Reading the manifests along that same path answers the only question that matters —
 * *will this import resolve in the project I am writing into* — from the state on disk
 * at the moment of generation. The alternatives are all proxies for it: `rebase.json`'s
 * `apps` block says a CMS scaffold declared an admin app, and a `frontend/` directory
 * says one was scaffolded, but neither is what the compiler consults, and either can be
 * true of a project whose `config` package does not depend on `@rebasepro/cms-types`.
 *
 * Ambiguity resolves towards the admin panel: a project that declares both packages has
 * a panel, and `@rebasepro/cms-types` is the flavour that keeps the `admin` block.
 */
export function detectCollectionBuilder(outDir: string): CollectionBuilder {
    let dir = path.resolve(outDir);
    const declared = new Set<string>();

    for (let level = 0; level < MAX_LEVELS; level++) {
        const manifest = path.join(dir, "package.json");
        if (fs.existsSync(manifest)) {
            for (const name of declaredDependencies(manifest)) declared.add(name);
        }
        // The project root, and the last level worth reading: anything above it
        // belongs to whatever the project happens to be checked out inside.
        if (fs.existsSync(path.join(dir, "rebase.json"))) break;

        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    if (declared.has(ADMIN_TYPES_PACKAGE)) return "admin-types";
    if (declared.has(COMMON_PACKAGE)) return "common";
    return "annotation";
}
