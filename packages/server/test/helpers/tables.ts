import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { collectionsToTableDefs } from "@rebasepro/common/migrate";
import { col, defineTable } from "@rebasepro/types";
import type {
    AnyTableDef,
    AnyViewDef,
    CompiledTable,
    DefaultRls,
    PostgresCollectionConfig,
    SecurityRule,
    TableDescriptor
} from "@rebasepro/types";
import type {
    LegacyAnyCollectionConfig,
    LegacyCollectionConfig
} from "@rebasepro/common/migrate";
import { compileSchemaDefs } from "../../src/schema/load-schema";
import type { DriverCollectionOf } from "../../src/schema/driver-seam";
import type { ServedTable } from "../../src/api/rest/served-table";

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
    collections: readonly (LegacyCollectionConfig | LegacyAnyCollectionConfig)[],
    options: { defaultSecurityRules?: readonly SecurityRule[] } = {}
): LiftedTables {
    const narrowed: LegacyCollectionConfig[] = collections.map(collection => collection);
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
    /** The definitions lowered back into collections (the kernel's runtime input; gone with the lowering). */
    collections: PostgresCollectionConfig[];
}

/**
 * Lift legacy fixture collections, compile them and lower them — the boot's
 * own path (`compileSchemaDefs`) — for a test that builds routes, a validator
 * or a document from them rather than booting a backend.
 */
export function tablesFromCollections(
    collections: readonly (LegacyCollectionConfig | LegacyAnyCollectionConfig)[],
    options: { defaultSecurityRules?: readonly SecurityRule[] } = {}
): FixtureTables {
    const { tables, defaultRls } = tablesFrom(withRelationTargets(collections), options);
    return compileTables(tables, defaultRls);
}

/** The target of a legacy relation thunk, or `undefined` when it throws or is not a collection. */
function relationTargetOf(target: unknown): LegacyCollectionConfig | undefined {
    if (typeof target !== "function") return undefined;
    try {
        const resolved: unknown = target();
        return isFixtureCollection(resolved) ? resolved : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The fixtures, followed by every collection their relations point at that
 * they do not list (transitively): a table compiles only beside the tables
 * its relations target, and a fixture usually names just the one under test.
 */
function withRelationTargets(collections: readonly (LegacyCollectionConfig | LegacyAnyCollectionConfig)[]): (LegacyCollectionConfig | LegacyAnyCollectionConfig)[] {
    const out = [...collections];
    const seen = new Set(out.map(collection => collection.slug));
    for (let index = 0; index < out.length; index++) {
        const collection = out[index];
        const thunks: unknown[] = [];
        if ("relations" in collection && Array.isArray(collection.relations)) {
            for (const relation of collection.relations) thunks.push(relation?.target);
        }
        for (const property of Object.values(collection.properties ?? {})) {
            if (typeof property === "object" && property !== null && "relation" in property) {
                const relation: unknown = property.relation;
                if (typeof relation === "object" && relation !== null && "target" in relation) thunks.push(relation.target);
            }
        }
        for (const thunk of thunks) {
            const target = relationTargetOf(thunk);
            if (target && !seen.has(target.slug)) {
                seen.add(target.slug);
                out.push(target);
            }
        }
    }
    return out;
}

/** Compile and lower table definitions, as the boot does. */
export function compileTables(defs: readonly (AnyTableDef | AnyViewDef)[], defaultRls?: DefaultRls): FixtureTables {
    return compileSchemaDefs(defs, defaultRls);
}

/**
 * What `parseQueryOptions` / `parseWriteFilter` take to check a query's field
 * access: the table being read (the first fixture) and every table's
 * descriptor by slug, for its relations' targets.
 */
export function queryAccessFor(
    collections: readonly (LegacyCollectionConfig | LegacyAnyCollectionConfig)[]
): { table: TableDescriptor; lookup: (slug: string) => TableDescriptor | undefined } {
    const fixture = tablesFromCollections(collections);
    return { table: descriptorOf(fixture, collections[0].slug), lookup: slug => fixture.descriptors.find(table => table.slug === slug) };
}

/** The descriptor of the table with this slug, from a fixture; throws when there is none. */
export function descriptorOf(fixture: Pick<FixtureTables, "descriptors">, slug: string): TableDescriptor {
    const found = fixture.descriptors.find(descriptor => descriptor.slug === slug);
    if (!found) throw new Error(`The fixture has no table "${slug}".`);
    return found;
}

/**
 * One legacy fixture collection as the REST layer's seam holds a served table:
 * its descriptor, and the collection it was lowered into for the driver.
 */
export function servedTableFrom(collection: LegacyCollectionConfig | LegacyAnyCollectionConfig): ServedTable {
    const fixture = tablesFromCollections([collection]);
    const driverCollection = fixture.collections.find(candidate => candidate.slug === collection.slug);
    if (!driverCollection) throw new Error(`The fixture has no table "${collection.slug}".`);
    return { table: descriptorOf(fixture, collection.slug), driverCollection };
}

/** The descriptor one legacy fixture collection compiles to. */
export function tableFrom(collection: LegacyCollectionConfig | LegacyAnyCollectionConfig): TableDescriptor {
    return descriptorOf(tablesFromCollections([collection]), collection.slug);
}

/**
 * Whether an untyped object (a panel template, a parsed file) has the shape of
 * a legacy collection: a slug and a `properties` map. The lift checks the
 * rest, property by property, and refuses what it cannot convert.
 */
export function isFixtureCollection(value: unknown): value is LegacyCollectionConfig {
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
    const collections: LegacyCollectionConfig[] = [];
    for (const file of files) {
        const mod: { default?: LegacyCollectionConfig } = await import(pathToFileURL(path.join(dir, file)).href);
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
    const bySlug = new Map<string, LegacyCollectionConfig>(collections.map(collection => [collection.slug, collection]));
    return { tables, driverCollection: slug => bySlug.get(slug) };
}

/** A table with a text key and nothing else, named `slug`: a fixture whose rows a fake driver supplies. */
export function plainTable(slug: string): AnyTableDef {
    return defineTable(slug, { columns: { id: col.text().primaryKey() }, rls: "admin-only" });
}
