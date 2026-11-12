import type { PostgresCollectionConfig, PostgresProperties, RlsDescriptor, TableDescriptor } from "@rebasepro/types";
import { collectionsToTableDefs, compileTables, getTableName, isSchemaDefinitionError } from "@rebasepro/common";

/**
 * Descriptors for the tables a backend introspected from its database.
 *
 * A backend with no `backend/schema` serves whatever tables the database
 * holds (those with row-level security on), and the driver hands back the
 * collections it built from the catalogue. They have no descriptors of their
 * own — nothing was declared — so `GET /api/schema/tables`, the schema version
 * and global hooks had nothing to read. This lifts them with the same bridge
 * the codemod uses (`collectionsToTableDefs`) and compiles them with the same
 * compiler a declared table goes through.
 *
 * @module
 */

/**
 * The row-level security of an introspected table.
 *
 * The database's own policies decide every row, and the runtime does not read
 * them: introspection notes only that RLS is enabled. So the rules are one
 * `redacted: true` marker (`RedactedSecurityRule`) covering every operation —
 * the honest "there are policies, and they are not stated here". A client
 * evaluates it as *unknown* (the panel offers the action and lets Postgres
 * answer; an enforcement caller refuses), and no policies are listed for it:
 * Rebase did not generate them. `defaultPolicies: false`, because Rebase
 * injected no admin baseline either.
 *
 * @group Schema
 */
export function introspectedRls(): RlsDescriptor {
    return { posture: "rules", rules: [{ operations: ["all"], redacted: true }], defaultPolicies: false };
}

/**
 * What {@link describeIntrospectedTables} returns.
 *
 * @group Schema
 */
export interface IntrospectedTables {
    /** One descriptor per table that could be described, in the order given. */
    descriptors: TableDescriptor[];
    /** The tables that could not be, each with why. They are still served by the data API. */
    skipped: { table: string; reason: string }[];
}

/** A collection's relation properties, re-pointed at the copies and without the ones into `removed`. */
function rewire(collections: readonly PostgresCollectionConfig[], removed: ReadonlySet<PostgresCollectionConfig>): PostgresCollectionConfig[] {
    const copies = new Map<PostgresCollectionConfig, PostgresCollectionConfig>();
    for (const collection of collections) copies.set(collection, { ...collection });
    for (const collection of collections) {
        const properties: PostgresProperties = {};
        for (const [key, property] of Object.entries(collection.properties ?? {})) {
            if (property.type !== "relation" || !property.relation) {
                properties[key] = property;
                continue;
            }
            let original: unknown;
            try {
                original = property.relation.target();
            } catch {
                original = undefined;
            }
            const target = collections.find(candidate => candidate === original);
            if (!target) {
                if (![...removed].some(candidate => candidate === original)) properties[key] = property;
                continue;
            }
            const copy = copies.get(target);
            if (copy) properties[key] = { ...property, relation: { ...property.relation, target: () => copy } };
        }
        const copy = copies.get(collection);
        if (copy) copy.properties = properties;
    }
    return collections.map(collection => copies.get(collection) ?? collection);
}

/**
 * Describe introspected collections as table descriptors, with
 * {@link introspectedRls} as their row-level security.
 *
 * A table that cannot be described faithfully is left out (and so are its
 * relations from the others), the rest are described, and the caller logs
 * {@link IntrospectedTables.skipped}. Never throws: an introspected database
 * boots whatever this makes of it.
 *
 * @group Schema
 */
export function describeIntrospectedTables(collections: readonly PostgresCollectionConfig[]): IntrospectedTables {
    const skipped: IntrospectedTables["skipped"] = [];
    const removed = new Set<PostgresCollectionConfig>();
    let remaining: PostgresCollectionConfig[] = [...collections];
    let input: PostgresCollectionConfig[] = remaining;

    while (remaining.length > 0) {
        try {
            const { tables } = collectionsToTableDefs(input);
            const descriptors = compileTables(tables).map(descriptor => ({ ...descriptor, rls: introspectedRls() }));
            return { descriptors, skipped };
        } catch (error) {
            const reasons = new Map<PostgresCollectionConfig, string[]>();
            if (isSchemaDefinitionError(error)) {
                for (const problem of error.problems) {
                    const collection = remaining.find(candidate =>
                        candidate.slug === problem.table || getTableName(candidate) === problem.table);
                    if (!collection) continue;
                    const list = reasons.get(collection) ?? [];
                    list.push(problem.key ? `${problem.key}: ${problem.message}` : problem.message);
                    reasons.set(collection, list);
                }
            }
            if (reasons.size === 0) {
                // Nothing to single out: describe none rather than guess.
                const reason = error instanceof Error ? error.message : String(error);
                for (const collection of remaining) skipped.push({ table: collection.slug, reason });
                return { descriptors: [], skipped };
            }
            for (const [collection, list] of reasons) {
                removed.add(collection);
                skipped.push({ table: collection.slug, reason: list.join("; ") });
            }
            remaining = remaining.filter(collection => !removed.has(collection));
            input = rewire(remaining, removed);
        }
    }
    return { descriptors: [], skipped };
}
