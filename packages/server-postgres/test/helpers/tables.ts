import {
    SchemaDefinitionError,
    compileTable,
    compiledTable,
    lowerTables,
    resolveCollectionRelations,
    type SchemaDefinitionProblem
} from "@rebasepro/common";
import {
    collectionsToTableDefs
} from "@rebasepro/common/migrate";
import { isTableDef, isViewDef } from "@rebasepro/types";
import type {
    AnyTableDef,
    AnyViewDef,
    CompiledTable,
    DefaultRls,
    PostgresCollectionConfig,
    SecurityRule,
    TableDescriptor,
    TableHooks
} from "@rebasepro/types";
import type {
    LegacyAnyCollectionConfig,
    LegacyCollectionConfig
} from "@rebasepro/common/migrate";
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
    collections: readonly (LegacyCollectionConfig | LegacyAnyCollectionConfig)[],
    options: { defaultSecurityRules?: readonly SecurityRule[] } = {}
): LiftedTables {
    const narrowed: LegacyCollectionConfig[] = collections.map(collection => collection);
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
    collections: readonly (LegacyCollectionConfig | LegacyAnyCollectionConfig)[],
    options: { defaultSecurityRules?: readonly SecurityRule[] } = {}
): FixtureTables {
    const { defs, defaultRls, tables } = compileFixtures(collections, options);
    const descriptors = tables.map(table => table.descriptor);
    const descriptorBySlug = new Map(descriptors.map(descriptor => [descriptor.slug, descriptor]));
    const collectionsOut = lowerTables(defs, { ...(defaultRls ? { defaultRls } : {}), describe: slug => descriptorBySlug.get(slug) });
    return { tables, descriptors, collections: collectionsOut };
}

/**
 * Lift and compile fixture collections, without lowering them again: what a
 * registry needs. (Lowering follows every relation target it meets; a fixture
 * whose targets are factories building a new object per call would never end.)
 */
function compileFixtures(
    collections: readonly (LegacyCollectionConfig | LegacyAnyCollectionConfig)[],
    options: { defaultSecurityRules?: readonly SecurityRule[] }
): { defs: (AnyTableDef | AnyViewDef)[]; defaultRls?: DefaultRls; tables: CompiledTable[] } {
    const { tables: defs, defaultRls } = tablesFrom(withCanonicalTargets(collections), options);
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
    return defaultRls ? { defs, defaultRls, tables } : { defs, tables };
}

/**
 * The collections with every relation target pointed at the one collection of
 * that slug in the set (the first given wins). Many fixtures write targets as
 * factories — `target: () => docs()` — building a new object per call, and the
 * lift converts each target object once: a factory pair would convert forever.
 */
function withCanonicalTargets(collections: readonly (LegacyCollectionConfig | LegacyAnyCollectionConfig)[]): LegacyCollectionConfig[] {
    const given: LegacyCollectionConfig[] = collections.map(collection => collection);
    const bySlug = new Map<string, LegacyCollectionConfig>();
    const canonical = (target: LegacyCollectionConfig): LegacyCollectionConfig => bySlug.get(target.slug) ?? target;
    const retarget = <R extends { target: () => LegacyCollectionConfig }>(relation: R): R => {
        const target = relation.target();
        return { ...relation, target: () => canonical(target) };
    };
    const copies = given.map(collection => {
        const copy: LegacyCollectionConfig = { ...collection };
        if (!bySlug.has(copy.slug)) bySlug.set(copy.slug, copy);
        return copy;
    });
    for (const copy of copies) {
        if ("relations" in copy && copy.relations) copy.relations = copy.relations.map(retarget);
        const properties: LegacyCollectionConfig["properties"] = {};
        for (const [key, property] of Object.entries(copy.properties ?? {})) {
            properties[key] = property.type === "relation" && property.relation
                ? { ...property, relation: retarget(property.relation) }
                : property;
        }
        copy.properties = properties;
    }
    return copies;
}

/**
 * The given collections and every collection reachable from them through
 * relation targets, the given ones first: what the lift needs to compile a
 * set whose relations point outside it. A target object whose slug one of the
 * set already has is the fixture's second copy of that table and is left out.
 */
function withRelationTargets(...roots: LegacyCollectionConfig[]): LegacyCollectionConfig[] {
    const seen = new Map<string, LegacyCollectionConfig>(roots.map(root => [root.slug, root]));
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
        if (collections && collections.length > 0) this.registerTables(compileFixtures(withRelationTargets(...collections), {}).tables);
    }

    registerMultiple(collections: LegacyCollectionConfig[]): boolean {
        const changed = super.registerMultiple(collections);
        if (this.constructed && collections.length > 0) {
            this.registerTables(compileFixtures(withRelationTargets(...collections), {}).tables);
        }
        return changed;
    }

    register(collection: LegacyCollectionConfig, rawCollection?: LegacyCollectionConfig): void {
        super.register(collection, rawCollection);
        this.registerTables(compileFixtures(withRelationTargets(collection), {}).tables);
    }

    /** Tables compiled on first ask, by the collection object they were compiled from. */
    private readonly compiledOnAsk = new WeakMap<LegacyCollectionConfig, RuntimeTable>();

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
        scratch.registerTables(compileFixtures(withRelationTargets(collection), {}).tables);
        const table = scratch.getTable(slug);
        if (table) this.compiledOnAsk.set(collection, table);
        return table;
    }

    requireTable(slug: string): RuntimeTable {
        return this.getTable(slug) ?? super.requireTable(slug);
    }

    /** Attach hooks to a table, the one compiled on first ask included (it is registered first). */
    setTableHooks(slug: string, hooks: TableHooks): boolean {
        const table = this.getTable(slug);
        if (table && !super.getTable(slug)) this.registerTables([table.compiled]);
        return super.setTableHooks(slug, hooks);
    }
}
