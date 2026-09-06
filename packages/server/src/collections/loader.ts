import { CollectionConfig, SecurityRule, isPostgresCollectionConfig, resolveResourceRefs } from "@rebasepro/types";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { logger } from "../utils/logger";
import { assertCollectionConfigs, type ValidateCollectionConfigOptions } from "./validate-config";

/**
 * The one definition of "the collections".
 *
 * Four copies of this scan used to exist — the runtime, the drizzle-schema
 * generator, the policy generator and the doctor — each deciding for itself
 * which files counted. They agreed only by discipline, and any drift between
 * them would silently serve one set of collections while pushing policies for
 * another. Everything that needs to know what the collections are calls this.
 */

/** Read from a directory's `index` module, or from a single-file source. */
export interface CollectionDefaults {
    /**
     * Applied to every collection that declares no `securityRules` of its own.
     *
     * This lives with the collections rather than in the server config because
     * `db push` generates the actual Postgres policies from these files and
     * never sees the running server — a default declared on the server could
     * never reach the database, and would look like an authorization setting
     * while enforcing nothing.
     */
    defaultSecurityRules?: SecurityRule[];
}

function isCollectionFile(file: string): boolean {
    return (file.endsWith(".ts") || file.endsWith(".js")) &&
        // Dotfiles are never collections. In particular macOS bsdtar puts
        // AppleDouble sidecars (`._foo.ts`) into build contexts — binary blobs
        // whose names end in .ts and whose first byte is \x00, so importing
        // them kills the whole load.
        !file.startsWith(".") &&
        !file.includes(".test.") &&
        !file.endsWith(".d.ts") &&
        // index is the directory's own module: defaults live there, not a collection.
        file !== "index.ts" && file !== "index.js";
}

async function importModule(filePath: string): Promise<Record<string, unknown>> {
    // Plain import() so tsx/loader hooks resolve .ts and workspace specifiers.
    return await import(pathToFileURL(filePath).href);
}

/**
 * Read `defaultSecurityRules` from a collections directory's index module.
 *
 * An index that is not there at all is the ordinary case and means "no
 * defaults". An index that IS there and cannot be imported is fatal, because
 * the one thing it declares is the access rules every collection without its
 * own inherits: swallowing the failure returned `{}`, every collection fell
 * back to locked-by-default, and the boot went on to announce success while
 * applying a different set of policies than the project asked for. A syntax
 * error in this file changed the security posture of the whole API and the
 * only trace was one warning line.
 */
async function readDefaults(directory: string): Promise<CollectionDefaults> {
    for (const name of ["index.ts", "index.js"]) {
        const indexPath = path.join(directory, name);
        if (!fs.existsSync(indexPath)) continue;
        try {
            const mod = await importModule(indexPath);
            return { defaultSecurityRules: mod.defaultSecurityRules as SecurityRule[] | undefined };
        } catch (err) {
            throw new Error(
                `Could not load ${indexPath}.\n\n` +
                `${err instanceof Error ? err.message : String(err)}\n\n` +
                "This file declares `defaultSecurityRules` — the access rules every collection " +
                "that declares none of its own inherits. Loading the collections without it would " +
                "serve them under a different authorization model than the project declares, so " +
                "this is fatal. Fix the file, or delete it if the project has no defaults.",
                { cause: err }
            );
        }
    }
    return {};
}

/**
 * Apply directory-level defaults. A collection declaring its own rules is left
 * alone; one declaring none inherits these. Declaring neither leaves
 * `securityRules` unset, which the policy generator treats as locked-by-default.
 */
export function applyCollectionDefaults(
    collections: CollectionConfig[],
    defaults: CollectionDefaults
): CollectionConfig[] {
    if (!defaults.defaultSecurityRules?.length) return collections;
    for (const collection of collections) {
        if (isPostgresCollectionConfig(collection) && !collection.securityRules?.length) {
            collection.securityRules = defaults.defaultSecurityRules;
        }
    }
    return collections;
}

/**
 * Load collections from a directory of collection files, or from a single
 * module exporting `backendCollections` / `collections`.
 *
 * Throws if any file fails to import. A collection that cannot be loaded is a
 * configuration error, and continuing produces the worst outcome available: an
 * API missing a route, or a policy file missing a table, with a successful exit
 * code. Both read as "no data" rather than as a failure.
 *
 * Every collection is strict-parsed on the way out — see `validate-config` for
 * why a key that moved is fatal and a key nobody recognises only warns. It
 * happens here, at the one definition of "the collections", so the runtime, the
 * schema generator, the policy generator and the doctor all see the same
 * verdict rather than three of them silently accepting a config the fourth
 * rejects.
 */
export async function loadCollectionsFromDirectory(
    source: string,
    options: { validate?: false | ValidateCollectionConfigOptions } = {}
): Promise<CollectionConfig[]> {
    const resolved = path.resolve(source);
    // The file each collection came from, in the order they were pushed. Only
    // the checks that compare two collections use it — "two collections declare
    // `slug: "posts"`" is unactionable without saying which two files.
    const validate = (loaded: CollectionConfig[], sources?: string[]): CollectionConfig[] => {
        // A resource handle written where a key belongs — `dataSource:
        // analytics` — becomes its key here, for a collection authored as a
        // plain object rather than through `defineCollection`, which already
        // did this. Past this point a collection is data.
        const collections = loaded.map(c => resolveResourceRefs(c));
        if (options.validate !== false) {
            assertCollectionConfigs(collections, { ...(options.validate ?? {}), sources });
        }
        return collections;
    };

    if (!fs.existsSync(resolved)) {
        logger.warn(`[collections] Not found: ${resolved}`);
        return [];
    }

    // A single module exports the collections, and may export the defaults.
    if (!fs.statSync(resolved).isDirectory()) {
        const mod = await importModule(resolved);
        const collections = (mod.backendCollections || mod.collections || []) as CollectionConfig[];
        return validate(applyCollectionDefaults([...collections], {
            defaultSecurityRules: mod.defaultSecurityRules as SecurityRule[] | undefined
        }));
    }

    const collections: CollectionConfig[] = [];
    const sources: string[] = [];
    const failures: string[] = [];

    for (const file of fs.readdirSync(resolved).filter(isCollectionFile)) {
        try {
            const mod = await importModule(path.join(resolved, file));
            if (mod?.default) {
                collections.push(mod.default as CollectionConfig);
                sources.push(file);
            } else {
                failures.push(`${file}: no default export`);
            }
        } catch (err) {
            failures.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    if (failures.length > 0) {
        throw new Error(
            `Could not load ${failures.length} collection file(s) from ${resolved}:\n` +
            failures.map((f) => `  • ${f}`).join("\n") +
            "\n\nEvery collection file must import cleanly and default-export a collection."
        );
    }

    return validate(applyCollectionDefaults(collections, await readDefaults(resolved)), sources);
}
