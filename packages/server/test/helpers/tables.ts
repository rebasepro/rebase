import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { collectionsToTableDefs } from "@rebasepro/common";
import { col, defineTable } from "@rebasepro/types";
import type {
    AnyCollectionConfig,
    AnyTableDef,
    AnyViewDef,
    CollectionConfig,
    CompiledTable,
    DefaultRls,
    PostgresCollectionConfig,
    SecurityRule,
    TableDescriptor
} from "@rebasepro/types";
import { compileSchemaDefs } from "../../src/schema/load-schema";
import type { DriverCollectionOf } from "../../src/schema/driver-seam";

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
 * What a fixture compiles to: the compiled tables, their descriptors, and the
 * collections they were lowered into (what the data driver is handed until
 * slice B-R7; removed with K8). `{ descriptors, collections }` is exactly what
 * `new RestApiGenerator(...)` takes.
 */
export interface FixtureTables {
    tables: CompiledTable[];
    descriptors: TableDescriptor[];
    collections: PostgresCollectionConfig[];
}

/**
 * Lift legacy fixture collections, compile them and lower them — the boot's
 * own path (`compileSchemaDefs`) — for a test that builds routes, a validator
 * or a document from them rather than booting a backend.
 */
export function tablesFromCollections(
    collections: readonly (CollectionConfig | AnyCollectionConfig)[],
    options: { defaultSecurityRules?: readonly SecurityRule[] } = {}
): FixtureTables {
    const { tables, defaultRls } = tablesFrom(collections, options);
    return compileTables(tables, defaultRls);
}

/** Compile and lower table definitions, as the boot does. */
export function compileTables(defs: readonly (AnyTableDef | AnyViewDef)[], defaultRls?: DefaultRls): FixtureTables {
    return compileSchemaDefs(defs, defaultRls);
}

/** The descriptor of the table with this slug, from a fixture; throws when there is none. */
export function descriptorOf(fixture: Pick<FixtureTables, "descriptors">, slug: string): TableDescriptor {
    const found = fixture.descriptors.find(descriptor => descriptor.slug === slug);
    if (!found) throw new Error(`The fixture has no table "${slug}".`);
    return found;
}

/** The descriptor one legacy fixture collection compiles to. */
export function tableFrom(collection: CollectionConfig | AnyCollectionConfig): TableDescriptor {
    return descriptorOf(tablesFromCollections([collection]), collection.slug);
}

/**
 * Whether an untyped object (a panel template, a parsed file) has the shape of
 * a legacy collection: a slug and a `properties` map. The lift checks the
 * rest, property by property, and refuses what it cannot convert.
 */
export function isFixtureCollection(value: unknown): value is CollectionConfig {
    return typeof value === "object" && value !== null
        && "slug" in value && typeof value.slug === "string"
        && "properties" in value && typeof value.properties === "object" && value.properties !== null;
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

/**
 * Tables as the server's table-model code receives them: compiled (with their
 * hooks and transforms) and paired with the B-R7 driver seam, which answers a
 * slug with the collection the table was lowered into for the data driver.
 *
 * ```ts
 * const { tables, driverCollection } = servedTablesFor([posts, authors]);
 * ```
 */
export function servedTablesFor(
    defs: readonly (AnyTableDef | AnyViewDef)[],
    defaultRls?: DefaultRls
): { tables: CompiledTable[]; driverCollection: DriverCollectionOf } {
    const { tables, collections } = compileSchemaDefs(defs, defaultRls);
    const bySlug = new Map<string, CollectionConfig>(collections.map(collection => [collection.slug, collection]));
    return { tables, driverCollection: slug => bySlug.get(slug) };
}

/** A table with a text key and nothing else, named `slug`: a fixture whose rows a fake driver supplies. */
export function plainTable(slug: string): AnyTableDef {
    return defineTable(slug, { columns: { id: col.text().primaryKey() }, rls: "admin-only" });
}
