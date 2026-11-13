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
import type { SchemaModuleImporter } from "@rebasepro/server";
import { isLegacyPostgresCollection, type LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { resolveResourceRefs, type SecurityRule } from "@rebasepro/types";

/** A legacy collection, with the file it came from. */
export interface LoadedCollection {
    collection: LegacyCollectionConfig;
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
    navigationOrder?: LegacyCollectionConfig[];
    /** Named exports of `<config>/index.ts`, when there is one (to find `callbacks`, `storageAuthorize`). */
    configIndexExports: string[];
    /**
     * Files of `<config>/collections` that export no collection at all — no
     * default export, and no named export shaped like one: helpers the
     * collection files import (`_predicates.ts`), absolute. A project that passed
     * its collections as an array never had its directory read, so these were
     * never collections; they are moved like any other module of `config/`.
     */
    helperFiles: string[];
    /**
     * Firestore collections the project builds in a module the loader never
     * read: a file under a subdirectory of `<config>/collections`, or a function
     * the index exports (`getAllFirestoreCollections()`), which the app spread
     * into the panel's collections. Empty when there are none.
     */
    builtFirestore: BuiltFirestoreCollection[];
    /** The zero-argument functions that returned Firestore collections, with what each returned. */
    firestoreBuilders: FirestoreBuilder[];
}

/** A Firestore collection reached outside the loader's top-level files. */
export interface BuiltFirestoreCollection {
    collection: LegacyCollectionConfig;
    /**
     * The module whose default export is this collection's object (or one with
     * its slug), absolute — absent when the collection only exists as what a
     * call returns (built per locale, say), so no literal of its own exists.
     */
    file?: string;
}

/** An exported zero-argument function that returned Firestore collections. */
export interface FirestoreBuilder {
    /** The module that exports it, absolute. */
    file: string;
    /** Its export name. */
    exportName: string;
    /** The slugs it returned, in order. */
    slugs: string[];
    /**
     * The slugs it returned as a different object than their file exports — a
     * copy the builder changed at run time (added a field, say), which a
     * conversion of the file alone does not carry.
     */
    changed: string[];
}

/** A module importer: the CLI's jiti importer (`createSchemaModuleImporter`), or a stand-in in tests. */
export type ModuleImporter = SchemaModuleImporter;

/** The loader's file filter (`isCollectionFile` in `@rebasepro/server`). */
export function isLegacyCollectionFile(file: string): boolean {
    return (file.endsWith(".ts") || file.endsWith(".js") || file.endsWith(".tsx")) &&
        !file.startsWith(".") &&
        !file.includes(".test.") &&
        !file.endsWith(".d.ts") &&
        file !== "index.ts" && file !== "index.js" && file !== "index.tsx";
}

function isFirestoreCollection(value: unknown): value is LegacyCollectionConfig {
    return isCollection(value) && "engine" in value && value.engine === "firestore";
}

/** Every module under the subdirectories of `dir`, absolute, sorted. */
function nestedModules(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const walk = (current: string): void => {
            for (const child of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                const full = path.join(current, child.name);
                if (child.isDirectory()) {
                    if (!child.name.startsWith(".") && child.name !== "node_modules") walk(full);
                } else if (/\.(ts|tsx|js)$/.test(child.name) && !child.name.endsWith(".d.ts") && !child.name.includes(".test.")) {
                    out.push(full);
                }
            }
        };
        walk(path.join(dir, entry.name));
    }
    return out;
}

/**
 * Firestore collections the project serves from modules the loader did not
 * read: the default exports of files in subdirectories of the collections
 * directory, and what the exported zero-argument functions of those modules
 * and of the index return (`getAllFirestoreCollections()`). A module that does
 * not load is skipped: nothing proves it served a collection.
 */
async function findBuiltFirestore(collectionsDir: string, indexFile: string | undefined, importModule: ModuleImporter): Promise<{ built: BuiltFirestoreCollection[]; builders: FirestoreBuilder[] }> {
    const modules = [...(indexFile ? [indexFile] : []), ...nestedModules(collectionsDir)];
    const byFile = new Map<string, LegacyCollectionConfig>();
    const loaded: { file: string; mod: Record<string, unknown> }[] = [];
    for (const file of modules) {
        try {
            const mod = await importModule(file);
            loaded.push({ file, mod });
            if (file !== indexFile && isFirestoreCollection(mod.default)) byFile.set(file, mod.default);
        } catch {
            // Not loadable on its own (a React module, say): nothing it builds can be attributed to it.
        }
    }
    const builders: FirestoreBuilder[] = [];
    const reached = new Map<string, LegacyCollectionConfig>();
    const exported = new Map<string, LegacyCollectionConfig>();
    for (const collection of byFile.values()) {
        reached.set(collection.slug, collection);
        if (!exported.has(collection.slug)) exported.set(collection.slug, collection);
    }
    // A builder re-exported by an index is the same function: reported once, where it was met first.
    const called = new Set<unknown>();
    for (const { file, mod } of loaded) {
        for (const [exportName, value] of Object.entries(mod)) {
            if (called.has(value)) continue;
            // Only what names itself a collection builder is called: a module of config/ may export anything.
            if (typeof value !== "function" || value.length !== 0 || !/collection/i.test(exportName) || /^[A-Z]/.test(exportName)) continue;
            called.add(value);
            let returned: unknown;
            try {
                returned = value();
            } catch {
                continue;
            }
            const list = Array.isArray(returned) ? returned : [returned];
            const collections = list.filter(isFirestoreCollection);
            if (collections.length === 0) continue;
            builders.push({
                file,
                exportName,
                slugs: collections.map(collection => collection.slug),
                changed: collections.filter(collection => exported.has(collection.slug) && exported.get(collection.slug) !== collection).map(collection => collection.slug)
            });
            for (const collection of collections) if (!reached.has(collection.slug)) reached.set(collection.slug, collection);
        }
    }
    // A builder whose collections another builder returns too (`buildContent()` inside `getAll()`) is part of that one's step.
    const outer = builders.filter(builder => !builders.some(other => other !== builder && other.slugs.length > builder.slugs.length && builder.slugs.every(slug => other.slugs.includes(slug))));
    builders.splice(0, builders.length, ...outer);
    const fileOf = new Map<string, string>();
    for (const [file, collection] of byFile) if (!fileOf.has(collection.slug)) fileOf.set(collection.slug, file);
    const built = [...reached.values()].map(collection => {
        const file = fileOf.get(collection.slug);
        return { collection, ...(file ? { file } : {}) };
    });
    return { built, builders };
}

function isSecurityRuleList(value: unknown): value is SecurityRule[] {
    return Array.isArray(value) && value.every(rule => typeof rule === "object" && rule !== null);
}

function isCollection(value: unknown): value is LegacyCollectionConfig {
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
    const helperFiles: string[] = [];
    const failures: string[] = [];
    for (const file of files) {
        const full = path.join(collectionsDir, file);
        try {
            const mod = await importModule(full);
            const exported = mod.default;
            if (isCollection(exported)) collections.push({ collection: exported, file: full });
            // Nothing in it is a collection: a helper. A collection exported by
            // name, or a default export that is something else, may be a table
            // the project serves — dropping it would drop the table — so those
            // still refuse.
            else if (exported === undefined && !Object.values(mod).some(isCollection)) helperFiles.push(full);
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
    let navigationOrder: LegacyCollectionConfig[] | undefined;
    const collectionsIndex = ["index.ts", "index.js", "index.tsx"].map(name => path.join(collectionsDir, name)).find(file => fs.existsSync(file));
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
            if (isLegacyPostgresCollection(collection) && !collection.securityRules?.length) {
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

    const { built: builtFirestore, builders: firestoreBuilders } = await findBuiltFirestore(collectionsDir, collectionsIndex, importModule);
    const topLevel = new Set(collections.map(entry => entry.collection.slug));

    return {
        configDir,
        collectionsDir,
        collections,
        builtFirestore: builtFirestore.filter(entry => !topLevel.has(entry.collection.slug)),
        firestoreBuilders,
        ...(defaultSecurityRules ? { defaultSecurityRules } : {}),
        ...(navigationOrder ? { navigationOrder } : {}),
        configIndexExports,
        helperFiles
    };
}
