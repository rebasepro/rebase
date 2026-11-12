import {
    SchemaDefinitionError,
    collectionsToTableDefs,
    compileTable,
    compiledTable,
    lowerTables,
    resolveCollectionRelations,
    type SchemaDefinitionProblem
} from "@rebasepro/common";
import { isTableDef, isViewDef } from "@rebasepro/types";
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
import { PostgresTableRegistry } from "../../src/model/PostgresTableRegistry";
import type { RuntimeTable } from "../../src/model/runtime-table";

/**
 * The temporary lift for test fixtures — the driver's twin of
 * `packages/server/test/helpers/tables.ts`.
 *
 * `defineTable` is the backend's only front door, but many fixtures in this
 * suite are still legacy collection literals. This turns them into table
 * definitions with `collectionsToTableDefs` (the bridge the codemod uses) and
 * compiles them, so every test reaches the driver through the real compiler.
 * A later slice converts the fixtures themselves to `defineTable` source and
 * deletes this file.
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

/** What {@link tablesFromCollections} returns: what a driver is opened with. */
export interface FixtureTables {
    /** The compiled tables: the driver's `tables` input. */
    tables: CompiledTable[];
    /** Their descriptors, in the same order. */
    descriptors: TableDescriptor[];
    /** The definitions lowered back into collections. Removed with the lowering (slice K8). */
    collections: PostgresCollectionConfig[];
}

/**
 * Lift legacy fixture collections, compile them, and lower them again: the
 * `tables` a driver (or `openRebase`) takes beside its `collections`.
 *
 * A collection the lift refuses throws with the lift's reason; rewrite that
 * fixture as `defineTable`.
 */
export function tablesFromCollections(
    collections: readonly (CollectionConfig | AnyCollectionConfig)[],
    options: { defaultSecurityRules?: readonly SecurityRule[] } = {}
): FixtureTables {
    const { tables: defs, defaultRls } = tablesFrom(collections, options);
    // `compileSchemaDefs` (`@rebasepro/server`) composed the same way, without
    // the server (several suites mock `@rebasepro/server` wholesale), and with
    // relation targets resolved by slug: a fixture often holds two copies of
    // one collection, and the lift gives each its own definition.
    const bySlug = new Map(defs.map(def => [def.config.slug ?? def.name, def]));
    const problems: SchemaDefinitionProblem[] = [];
    const tables = defs.map(def => {
        const { descriptor, problems: found } = compileTable(def, thunk => {
            const target: unknown = thunk();
            if (!isTableDef(target) && !isViewDef(target)) return { ok: false, message: "its target is not a table definition." };
            const canonical = bySlug.get(target.config.slug ?? target.name) ?? target;
            return { ok: true, target: canonical };
        }, defaultRls ? { defaultRls } : {});
        problems.push(...found);
        if (!descriptor) throw new SchemaDefinitionError(found);
        return compiledTable(def, descriptor);
    });
    if (problems.length > 0) throw new SchemaDefinitionError(problems);
    const descriptors = tables.map(table => table.descriptor);
    const descriptorBySlug = new Map(descriptors.map(descriptor => [descriptor.slug, descriptor]));
    const collectionsOut = lowerTables(defs, { ...(defaultRls ? { defaultRls } : {}), describe: slug => descriptorBySlug.get(slug) });
    return { tables, descriptors, collections: collectionsOut };
}

/**
 * The given collections and every collection reachable from them through
 * relation targets, the given ones first: what the lift needs to compile a
 * set whose relations point outside it. A target object whose slug one of the
 * set already has is the fixture's second copy of that table and is left out.
 */
function withRelationTargets(...roots: CollectionConfig[]): CollectionConfig[] {
    const seen = new Map<string, CollectionConfig>(roots.map(root => [root.slug, root]));
    const queue = [...roots];
    while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        for (const relation of Object.values(resolveCollectionRelations(next))) {
            const target = relation.target();
            if (seen.has(target.slug)) continue;
            seen.set(target.slug, target);
            queue.push(target);
        }
    }
    return [...seen.values()];
}

/**
 * A registry whose collection registration also registers the table each
 * fixture collection compiles to — the one way a test builds a registry from
 * legacy collection literals. The collections are registered as given, so the
 * subsystems still reading them see exactly the fixture; the subsystems moved
 * onto runtime tables read what the fixture compiles to.
 *
 * A suite that never registers its fixtures — it stubs `getCollectionByPath`
 * and hands collections straight to the services — gets the table compiled on
 * first ask, from the collection that lookup answers (with its relation
 * targets). The production registry has no such path: there a table that was
 * not handed over is an error.
 */
export class FixtureTableRegistry extends PostgresTableRegistry {
    /** Unset while the base constructor runs — it registers what it is handed before this class's fields exist. */
    private readonly constructed: boolean = true;

    constructor(...args: ConstructorParameters<typeof PostgresTableRegistry>) {
        super(...args);
        const [collections] = args;
        if (collections && collections.length > 0) this.registerTables(tablesFromCollections(withRelationTargets(...collections)).tables);
    }

    registerMultiple(collections: CollectionConfig[]): boolean {
        const changed = super.registerMultiple(collections);
        if (this.constructed && collections.length > 0) {
            this.registerTables(tablesFromCollections(withRelationTargets(...collections)).tables);
        }
        return changed;
    }

    register(collection: CollectionConfig, rawCollection?: CollectionConfig): void {
        super.register(collection, rawCollection);
        this.registerTables(tablesFromCollections(withRelationTargets(collection)).tables);
    }

    /** Tables compiled on first ask, by the collection object they were compiled from. */
    private readonly compiledOnAsk = new WeakMap<CollectionConfig, RuntimeTable>();

    getTable(slug: string): RuntimeTable | undefined {
        const registered = super.getTable(slug);
        if (registered) return registered;
        const collection = this.getCollectionByPath(slug);
        if (!collection) return undefined;
        const cached = this.compiledOnAsk.get(collection);
        if (cached) return cached;
        // Compiled into a scratch registry, so a suite that stubs a different
        // collection under the same slug later gets that one's table.
        const scratch = new PostgresTableRegistry();
        for (const name of this.getPgTableNames()) {
            const pg = this.getPgTable(name);
            if (pg) scratch.registerPgTable(pg, name);
        }
        scratch.registerTables(tablesFromCollections(withRelationTargets(collection)).tables);
        const table = scratch.getTable(slug);
        if (table) this.compiledOnAsk.set(collection, table);
        return table;
    }

    requireTable(slug: string): RuntimeTable {
        return this.getTable(slug) ?? super.requireTable(slug);
    }
}
