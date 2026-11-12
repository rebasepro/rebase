import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { collectionsToTableDefs } from "@rebasepro/common";
import type {
    AnyCollectionConfig,
    AnyTableDef,
    AnyViewDef,
    CollectionConfig,
    DefaultRls,
    SecurityRule
} from "@rebasepro/types";

/**
 * The temporary lift for test fixtures.
 *
 * `defineTable` is the backend's only front door, but most fixtures in this
 * suite are still written as legacy collection literals. This turns them into
 * table definitions with `collectionsToTableDefs` (the bridge the codemod
 * uses), so every test boots through the real `tables` option and the real
 * compiler and lowering. A later slice converts the fixtures themselves to
 * `defineTable` source and deletes this file.
 */

/** What to spread into `createRebaseBackend` options: `tables`, and `defaultRls` when there is one. */
export interface LiftedTables {
    tables: (AnyTableDef | AnyViewDef)[];
    defaultRls?: DefaultRls;
}

/**
 * Lift legacy fixture collections into the backend's `tables` option.
 *
 * ```ts
 * await createRebaseBackend({ ...tablesFrom([posts, authors]), provision: false, … });
 * ```
 */
export function tablesFrom(
    collections: readonly (CollectionConfig | AnyCollectionConfig)[],
    options: { defaultSecurityRules?: readonly SecurityRule[] } = {}
): LiftedTables {
    const narrowed: CollectionConfig[] = collections.map(collection => collection);
    const { tables, defaultRls } = collectionsToTableDefs(narrowed, options);
    return defaultRls ? { tables, defaultRls } : { tables };
}

/**
 * Import a directory of legacy collection files (`config/collections`) the way
 * the retired loader did — every module's default export, and the index's
 * `defaultSecurityRules` — and lift them. For the tests that still read the
 * shipped templates or a fixture directory written in the legacy layout.
 */
export async function tablesFromLegacyDirectory(dir: string): Promise<LiftedTables> {
    const files = fs.readdirSync(dir)
        .filter(file => (file.endsWith(".ts") || file.endsWith(".js")) && !file.startsWith(".")
            && !file.includes(".test.") && !file.endsWith(".d.ts") && file !== "index.ts" && file !== "index.js")
        .sort();
    const collections: CollectionConfig[] = [];
    for (const file of files) {
        const mod: { default?: CollectionConfig } = await import(pathToFileURL(path.join(dir, file)).href);
        if (mod.default) collections.push(mod.default);
    }
    let defaultSecurityRules: SecurityRule[] | undefined;
    for (const index of ["index.ts", "index.js"]) {
        const indexPath = path.join(dir, index);
        if (!fs.existsSync(indexPath)) continue;
        const mod: { defaultSecurityRules?: SecurityRule[] } = await import(pathToFileURL(indexPath).href);
        defaultSecurityRules = mod.defaultSecurityRules;
        break;
    }
    return tablesFrom(collections, defaultSecurityRules ? { defaultSecurityRules } : {});
}
