/**
 * Planner fixtures the plan oracles share: how a frozen legacy corpus set is
 * lifted into table definitions (the input adjustments a set needs first, the
 * directory defaults it carried), compiled, and lowered.
 *
 * `test/helpers/tables.ts` is the package's fixture helper for driver tests;
 * this file holds only what the planner's oracles add on top of it.
 */
import {
    collectionsToTableDefs,
    compileSchema,
    lowerTables
} from "@rebasepro/common";
import {
    isPostgresCollectionConfig,
    type AnyTableDef,
    type AnyViewDef,
    type CollectionConfig,
    type CompiledTable,
    type DefaultRls,
    type PostgresCollectionConfig,
    type SecurityRule
} from "@rebasepro/types";

/**
 * A legacy field stripped from a set before it is converted, because the table
 * model cannot say it and the conversion refuses it — with why no golden
 * depends on it. Applied once, in place, before anything is planned (the
 * relation cache is per collection object).
 */
export const INPUT_ADJUSTMENTS: { set: string; reason: string; apply: (collections: CollectionConfig[]) => void }[] = [
    {
        set: "property-matrix",
        reason: "`arrs.ofTuple` declares a tuple (`of: [string, number]`), which no JSON shape of the table model can say. " +
            "The planner reads no `of` from a tuple — the column is `jsonb` either way — so dropping it changes no planned byte; " +
            "only the OpenAPI document described the tuple.",
        apply: collections => {
            const property = collections.find(c => c.slug === "arrs")?.properties.ofTuple;
            if (property?.type === "array") delete property.of;
        }
    },
    {
        set: "property-matrix",
        reason: "`authors.commentsVia` is a `via` relation written with `path` instead of `joinPath`, so it has no join path " +
            "and nothing can traverse it; the conversion refuses it. A `via` relation plans no column, constraint, junction " +
            "or Drizzle relation, so removing it (and the property addressing it) changes no planned byte.",
        apply: collections => {
            const authors = collections.find(c => c.slug === "authors");
            if (!authors || !isPostgresCollectionConfig(authors)) return;
            delete authors.properties.commentsVia;
            authors.relations = authors.relations?.filter(relation => relation.relationName !== "commentsVia");
        }
    }
];

/**
 * The directory's `defaultSecurityRules`, as the loader leaves them: the one
 * rules array several collections share by reference (the loader assigns the
 * same array to every collection that declares none).
 */
export function sharedDefaultRules(collections: readonly CollectionConfig[]): readonly SecurityRule[] | undefined {
    // Where the loader applied defaults, no collection is left without rules;
    // an in-memory fixture sharing a constant between some collections is not
    // a directory with defaults.
    if (collections.some(collection => !collection.securityRules?.length)) return undefined;
    const counts = new Map<readonly SecurityRule[], number>();
    for (const collection of collections) {
        const rules = collection.securityRules;
        if (rules && rules.length > 0) counts.set(rules, (counts.get(rules) ?? 0) + 1);
    }
    for (const [rules, count] of counts) if (count > 1) return rules;
    return undefined;
}

/** A legacy set as table definitions, with the `defaultRls` its directory defaults lift to. */
export function liftSet(collections: readonly CollectionConfig[]): { defs: (AnyTableDef | AnyViewDef)[]; defaultRls?: DefaultRls } {
    const defaultSecurityRules = sharedDefaultRules(collections);
    const { tables, defaultRls } = collectionsToTableDefs(collections, defaultSecurityRules ? { defaultSecurityRules } : {});
    return defaultRls ? { defs: tables, defaultRls } : { defs: tables };
}

/** A legacy set lifted and compiled: what the backend runs on. */
export function compileSet(collections: readonly CollectionConfig[]): CompiledTable[] {
    const { defs, defaultRls } = liftSet(collections);
    return compileSchema(defs, defaultRls ? { defaultRls } : {});
}

/** A legacy set lifted and lowered back: the collections the legacy planner input was. */
export function lowerSet(collections: readonly CollectionConfig[]): PostgresCollectionConfig[] {
    const { defs, defaultRls } = liftSet(collections);
    return lowerTables(defs, defaultRls ? { defaultRls } : {});
}
