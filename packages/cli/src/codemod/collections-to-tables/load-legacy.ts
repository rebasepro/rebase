/**
 * Evaluating a legacy project the way its loader does.
 *
 * The legacy loader (`loadCollectionsFromDirectory`) was the one definition
 * of "the collections": every top-level file of `<config>/collections` but the
 * index, each default-exporting one collection; the index's
 * `defaultSecurityRules` applied to every collection without rules of its own;
 * resource handles resolved to their keys; the strict parse. This reads the
 * same files in the same order with the same rules, so directory defaults,
 * spreads, shared fragments, computed keys, imported constants and
 * assignments after a declaration (`x.securityRules = [...]`) are all values
 * by the time the codemod sees them — exactly the values the server served.
 *
 * The legacy loader is gone from `@rebasepro/server` (the backend boots from
 * `backend/schema`), so its rule is restated here — the same rule the
 * plan-golden corpus reads legacy directories with. Modules are imported
 * through jiti, because a CLI run has no TypeScript loader installed and a
 * project's imports are extensionless.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { isPostgresCollectionConfig, resolveResourceRefs, type CollectionConfig, type SecurityRule } from "@rebasepro/types";

/** A legacy collection, with the file it came from. */
export interface LoadedCollection {
    collection: CollectionConfig;
    /** The file, absolute. */
    file: string;
}

/** A legacy project, evaluated. */
export interface LegacyProject {
    /** The config directory (`config/`), absolute. */
    configDir: string;
    /** `<config>/collections`, absolute. */
    collectionsDir: string;
    /** Every collection, in the loader's order (file name order). */
    collections: LoadedCollection[];
    /** The index's `defaultSecurityRules`, when it exports any. */
    defaultSecurityRules?: SecurityRule[];
    /** The index's `collections` array, when it exports one: the panel's navigation order. */
    navigationOrder?: CollectionConfig[];
    /** Named exports of `<config>/index.ts`, when there is one (to find `callbacks`, `storageAuthorize`). */
    configIndexExports: string[];
}

/** A module importer: what jiti gives, or a stand-in in tests. */
export type ModuleImporter = (file: string) => Promise<Record<string, unknown>>;

/**
 * An importer for a project's modules, through jiti. `aliases` maps
 * specifiers to files (tests and in-repo corpora point `@rebasepro/*` at
 * source); a user's project resolves through its own `node_modules`.
 */
export async function createImporter(root: string, aliases: Record<string, string> = {}): Promise<ModuleImporter> {
    // jiti keeps what it evaluated in Node's shared module cache. One importer
    // evaluates a module once (so collections that import each other are the
    // same objects); a new importer must see the files as they are now — the
    // codemod reads the tree, writes it, and reads it back in one process.
    const cache = createRequire(import.meta.url).cache;
    const prefix = path.resolve(root) + path.sep;
    for (const key of Object.keys(cache)) if (key.startsWith(prefix)) delete cache[key];
    const { createJiti } = await import("jiti");
    const jiti = createJiti(pathToFileURL(path.join(root, "__rebase_migrate__.ts")).href, {
        alias: aliases,
        interopDefault: true,
        moduleCache: true,
        fsCache: false,
        jsx: true
    });
    return async (file: string) => {
        const loaded: unknown = await jiti.import(file);
        if (typeof loaded !== "object" || loaded === null) return { default: loaded };
        return Object.fromEntries(Object.entries(loaded));
    };
}

/** The loader's file filter (`isCollectionFile` in `@rebasepro/server`). */
export function isLegacyCollectionFile(file: string): boolean {
    return (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".tsx")) &&
        !file.startsWith(".") &&
        !file.includes(".test.") &&
        !file.endsWith(".d.ts") &&
        file !== "index.ts" && file !== "index.js" && file !== "index.tsx";
}

function isSecurityRuleList(value: unknown): value is SecurityRule[] {
    return Array.isArray(value) && value.every(rule => typeof rule === "object" && rule !== null);
}

function isCollection(value: unknown): value is CollectionConfig {
    return typeof value === "object" && value !== null && "slug" in value && typeof value.slug === "string";
}

/** Thrown when the legacy project cannot be evaluated: its own loader would refuse it too. */
export class LegacyLoadError extends Error {
    constructor(message: string, readonly file?: string) {
        super(message);
    }
}

/**
 * Evaluate `<config>/collections` of a project.
 *
 * @param configDir the config directory, absolute
 */
export async function loadLegacyProject(configDir: string, importModule: ModuleImporter): Promise<LegacyProject> {
    const collectionsDir = path.join(configDir, "collections");
    if (!fs.existsSync(collectionsDir) || !fs.statSync(collectionsDir).isDirectory()) {
        throw new LegacyLoadError(`There is no ${collectionsDir} directory: nothing to migrate.`, collectionsDir);
    }
    const files = fs.readdirSync(collectionsDir)
        .filter(file => isLegacyCollectionFile(file) && fs.statSync(path.join(collectionsDir, file)).isFile())
        .sort();
    const collections: LoadedCollection[] = [];
    const failures: string[] = [];
    for (const file of files) {
        const full = path.join(collectionsDir, file);
        try {
            const mod = await importModule(full);
            const exported = mod.default;
            if (isCollection(exported)) collections.push({ collection: exported, file: full });
            else failures.push(`${file}: no default export of a collection`);
        } catch (error) {
            failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (failures.length > 0) {
        throw new LegacyLoadError(
            `Could not load ${failures.length} collection file(s) from ${collectionsDir}:\n` +
            failures.map(failure => `  • ${failure}`).join("\n") +
            "\n\nThe codemod reads the collections exactly as the server does; fix these files first (the server refuses them too)."
        );
    }

    let defaultSecurityRules: SecurityRule[] | undefined;
    let navigationOrder: CollectionConfig[] | undefined;
    for (const name of ["index.ts", "index.js", "index.tsx"]) {
        const indexFile = path.join(collectionsDir, name);
        if (!fs.existsSync(indexFile)) continue;
        let mod: Record<string, unknown>;
        try {
            mod = await importModule(indexFile);
        } catch (error) {
            throw new LegacyLoadError(
                `Could not load ${indexFile}: ${error instanceof Error ? error.message : String(error)}. ` +
                "It may declare `defaultSecurityRules`, which decide the policies of every collection without rules; the codemod will not guess them.",
                indexFile
            );
        }
        const rules = mod.defaultSecurityRules;
        // The array itself, not a copy: an index that applies its defaults in a
        // loop put this very array on each collection, and the lift reads that
        // identity as "inherits".
        if (isSecurityRuleList(rules)) defaultSecurityRules = rules;
        const listed = mod.collections;
        if (Array.isArray(listed)) navigationOrder = listed.filter(isCollection);
        break;
    }

    // The loader's rule: references resolved, then the defaults given to every
    // Postgres collection that declares no rules of its own — the same array,
    // so the lift can tell an inherited posture from a declared one.
    for (const entry of collections) entry.collection = resolveResourceRefs(entry.collection);
    if (defaultSecurityRules && defaultSecurityRules.length > 0) {
        for (const { collection } of collections) {
            if (isPostgresCollectionConfig(collection) && !collection.securityRules?.length) {
                collection.securityRules = defaultSecurityRules;
            }
        }
    }

    const configIndexExports: string[] = [];
    for (const name of ["index.ts", "index.js"]) {
        const indexFile = path.join(configDir, name);
        if (!fs.existsSync(indexFile)) continue;
        try {
            configIndexExports.push(...Object.keys(await importModule(indexFile)));
        } catch {
            // The config index only re-exports; the collections were read above.
        }
        break;
    }

    return {
        configDir,
        collectionsDir,
        collections,
        ...(defaultSecurityRules ? { defaultSecurityRules } : {}),
        ...(navigationOrder ? { navigationOrder } : {}),
        configIndexExports
    };
}
