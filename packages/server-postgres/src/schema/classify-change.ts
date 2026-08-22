/**
 * What a collection change means for a live database.
 *
 * The live schema editor may only make changes the boot-time ensure path can
 * actually carry out, because that is the one mechanism that changes a schema
 * (see `ensure-collection-tables.ts`). Its vocabulary is small and deliberately
 * so: create a table, add a column, create an enum *type*, create an index, add
 * a foreign key, and rename a column via the legacy-name path. There is no
 * `ALTER COLUMN TYPE` and no `DROP` of anything.
 *
 * So this module answers one question per change: **can the ensure path express
 * it, and if it can, will the result actually match what the config says?**
 *
 * ## Three answers, not two
 *
 * The obvious split is safe / unsafe. It is not enough, because the most
 * dangerous case is neither: a change the ensure path *partly* applies, leaving
 * a database that does not match the configuration and says nothing about it.
 * Two of those exist today and both are documented in the code they come from:
 *
 * - **A required property added to an existing collection.** `ensure` withholds
 *   `NOT NULL` on a table that already exists, because the constraint is checked
 *   against live rows. The column arrives nullable. The config says required;
 *   the database does not enforce it.
 * - **A value added to an existing enum.** `ensure` skips an enum type it
 *   already sees — `if (existing.enums.has(name)) continue`. The new value never
 *   reaches the database, and the first insert using it fails.
 *
 * Both would read as "applied successfully" to anyone watching. Calling them
 * `diverges` is the whole point of this module: an editor that reports them as
 * safe is worse than one that refuses them.
 *
 * ## Why refusing is the right default for the rest
 *
 * Dropping a column, narrowing a type, changing a primary key: each is
 * expressible in SQL and none is expressible by `ensure`. They need a migration
 * somebody wrote and read. `needs-migration` says exactly that, and naming the
 * change is more useful than attempting it.
 */
import type { CollectionConfig, Property } from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";
import { resolveColumnName } from "./generate-postgres-ddl-logic";

/**
 * - `safe` — the ensure path expresses it, and the result matches the config.
 * - `diverges` — the ensure path applies something, but the database will not
 *   match what the config declares, and nothing reports it.
 * - `needs-migration` — the ensure path cannot express it at all.
 */
export type ChangeVerdict = "safe" | "diverges" | "needs-migration";

export type ChangeKind =
    | "add-collection"
    | "remove-collection"
    | "add-property"
    | "remove-property"
    | "change-property-type"
    | "rename-column"
    | "add-enum-value"
    | "remove-enum-value"
    | "change-required"
    | "change-primary-key";

export interface SchemaChange {
    kind: ChangeKind;
    verdict: ChangeVerdict;
    /** Collection slug. */
    collection: string;
    /** Property name, where the change is to one. */
    property?: string;
    /** One line, specific: what changed and what it will do. */
    detail: string;
    /** What the operator should do instead, when the verdict is not `safe`. */
    remedy?: string;
}

export interface ClassifiedChanges {
    changes: SchemaChange[];
    /** The worst verdict present, or `safe` for an empty diff. */
    verdict: ChangeVerdict;
    /** True when every change is `safe` — the only case an editor may apply unattended. */
    applicable: boolean;
}

const VERDICT_RANK: Record<ChangeVerdict, number> = {
    safe: 0,
    diverges: 1,
    "needs-migration": 2
};

const bySlug = (collections: CollectionConfig[]): Map<string, CollectionConfig> => {
    const map = new Map<string, CollectionConfig>();
    for (const collection of collections) {
        if (collection.slug) map.set(collection.slug, collection);
    }
    return map;
};

const propertiesOf = (collection: CollectionConfig): Record<string, Property> =>
    (collection.properties ?? {}) as Record<string, Property>;

/** Enum values a string property declares, or undefined when it is not an enum. */
const enumValuesOf = (prop: Property): string[] | undefined => {
    const values = (prop as { enum?: unknown }).enum;
    if (!Array.isArray(values)) return undefined;
    return values.map(value =>
        typeof value === "string" ? value : String((value as { id?: unknown })?.id ?? value)
    );
};

const isRequired = (prop: Property): boolean => prop.validation?.required === true;

const isIdProperty = (prop: Property): boolean => Boolean((prop as { isId?: unknown }).isId);

/**
 * A change to any of these alters the physical column, which the ensure path
 * cannot do. Compared as a tuple so a change to *any* of them is caught without
 * this module having to re-derive the SQL type — which is the DDL generator's
 * job, and duplicating it here is how the two would drift.
 */
const physicalShapeOf = (prop: Property): string => JSON.stringify([
    prop.type,
    (prop as { columnType?: unknown }).columnType ?? null,
    (prop as { dimensions?: unknown }).dimensions ?? null,
    (prop as { isId?: unknown }).isId ?? null,
    (prop.validation as { max?: unknown } | undefined)?.max ?? null
]);

/**
 * Classify the difference between two collection sets.
 *
 * `before` is what the running database was built from; `after` is what the
 * editor is proposing. Order within each array is irrelevant.
 */
export function classifyCollectionChanges(
    before: CollectionConfig[],
    after: CollectionConfig[]
): ClassifiedChanges {
    const previous = bySlug(before);
    const next = bySlug(after);
    const changes: SchemaChange[] = [];

    for (const [slug, collection] of next) {
        if (!previous.has(slug)) {
            changes.push({
                kind: "add-collection",
                verdict: "safe",
                collection: slug,
                detail: `New collection "${slug}" — creates table "${getTableName(collection)}".`
            });
            continue;
        }
        classifyProperties(previous.get(slug)!, collection, changes);
    }

    for (const [slug, collection] of previous) {
        if (next.has(slug)) continue;
        changes.push({
            kind: "remove-collection",
            verdict: "needs-migration",
            collection: slug,
            detail:
                `Collection "${slug}" was removed, which would drop table ` +
                `"${getTableName(collection)}" and everything in it.`,
            remedy:
                "The ensure path never drops anything, so this cannot be applied here. Remove the " +
                "collection in a migration you have read, or keep it and stop serving it."
        });
    }

    const verdict = changes.reduce<ChangeVerdict>(
        (worst, change) => (VERDICT_RANK[change.verdict] > VERDICT_RANK[worst] ? change.verdict : worst),
        "safe"
    );

    return { changes, verdict, applicable: verdict === "safe" };
}

function classifyProperties(
    before: CollectionConfig,
    after: CollectionConfig,
    changes: SchemaChange[]
): void {
    const slug = after.slug ?? "";
    const previous = propertiesOf(before);
    const next = propertiesOf(after);

    for (const [name, prop] of Object.entries(next)) {
        const old = previous[name];

        if (!old) {
            // The collection already exists, so the table does too. `ensure`
            // withholds constraints on an existing table — see its own comment
            // about `SET NOT NULL` being checked against live rows.
            if (isRequired(prop)) {
                changes.push({
                    kind: "add-property",
                    verdict: "diverges",
                    collection: slug,
                    property: name,
                    detail:
                        `"${name}" is required, but adding a column to the existing table ` +
                        `"${getTableName(after)}" withholds NOT NULL — it is checked against rows ` +
                        "that are already there. The column will be nullable.",
                    remedy:
                        "Add it optional, backfill every row, then add NOT NULL in a migration. " +
                        "Or accept a nullable column and enforce the requirement in validation only."
                });
            } else {
                changes.push({
                    kind: "add-property",
                    verdict: "safe",
                    collection: slug,
                    property: name,
                    detail: `New optional property "${name}" — adds column "${resolveColumnName(name, prop)}".`
                });
            }
            continue;
        }

        classifyProperty(slug, after, name, old, prop, changes);
    }

    for (const [name, prop] of Object.entries(previous)) {
        if (next[name]) continue;
        changes.push({
            kind: "remove-property",
            verdict: "needs-migration",
            collection: slug,
            property: name,
            detail:
                `"${name}" was removed, which would drop column ` +
                `"${resolveColumnName(name, prop)}" and its data.`,
            remedy:
                "The ensure path never drops a column. Remove it in a migration you have read, or " +
                "leave the column and stop exposing the property."
        });
    }
}

function classifyProperty(
    slug: string,
    collection: CollectionConfig,
    name: string,
    before: Property,
    after: Property,
    changes: SchemaChange[]
): void {
    const beforeColumn = resolveColumnName(name, before);
    const afterColumn = resolveColumnName(name, after);

    if (beforeColumn !== afterColumn) {
        changes.push({
            kind: "rename-column",
            verdict: "needs-migration",
            collection: slug,
            property: name,
            detail: `"${name}" changes column from "${beforeColumn}" to "${afterColumn}".`,
            remedy:
                "The ensure path only renames a column through its legacy-name path, which this is " +
                "not. Rename it in a migration, or the old column stays and the new one is created " +
                "empty beside it."
        });
    }

    if (isIdProperty(before) !== isIdProperty(after)) {
        changes.push({
            kind: "change-primary-key",
            verdict: "needs-migration",
            collection: slug,
            property: name,
            detail: `"${name}" changes whether it is the primary key.`,
            remedy: "A primary key change rewrites the table and every foreign key into it. Migration only."
        });
        return;
    }

    if (physicalShapeOf(before) !== physicalShapeOf(after)) {
        changes.push({
            kind: "change-property-type",
            verdict: "needs-migration",
            collection: slug,
            property: name,
            detail: `"${name}" changes physical type — ${before.type} to ${after.type}.`,
            remedy:
                "There is no ALTER COLUMN TYPE in the ensure path, and a cast can fail on data that " +
                "is already there. Change it in a migration."
        });
    }

    if (!isRequired(before) && isRequired(after)) {
        changes.push({
            kind: "change-required",
            verdict: "diverges",
            collection: slug,
            property: name,
            detail:
                `"${name}" became required, but the ensure path never adds NOT NULL to an existing ` +
                "column. The database will keep accepting nulls.",
            remedy: "Backfill the column, then add NOT NULL in a migration."
        });
    }

    if (isRequired(before) && !isRequired(after)) {
        // Relaxing is safe in the config, and the database simply keeps a
        // constraint the config no longer asks for. Worth naming, since the
        // reader will wonder.
        changes.push({
            kind: "change-required",
            verdict: "diverges",
            collection: slug,
            property: name,
            detail:
                `"${name}" is no longer required, but an existing NOT NULL is not dropped. ` +
                "Writes omitting it will still fail.",
            remedy: "Drop the constraint in a migration if you want the column to accept nulls."
        });
    }

    classifyEnum(slug, collection, name, before, after, changes);
}

function classifyEnum(
    slug: string,
    collection: CollectionConfig,
    name: string,
    before: Property,
    after: Property,
    changes: SchemaChange[]
): void {
    const oldValues = enumValuesOf(before);
    const newValues = enumValuesOf(after);
    if (!oldValues || !newValues) return;

    const added = newValues.filter(value => !oldValues.includes(value));
    const removed = oldValues.filter(value => !newValues.includes(value));

    if (added.length > 0) {
        changes.push({
            kind: "add-enum-value",
            verdict: "diverges",
            collection: slug,
            property: name,
            detail:
                `"${name}" gains ${added.map(v => `"${v}"`).join(", ")}, but the ensure path skips an ` +
                "enum type it already sees. The value never reaches the database and the first row " +
                "using it is rejected.",
            remedy: "ALTER TYPE … ADD VALUE in a migration. It cannot run inside a transaction block."
        });
    }

    if (removed.length > 0) {
        changes.push({
            kind: "remove-enum-value",
            verdict: "needs-migration",
            collection: slug,
            property: name,
            detail: `"${name}" drops ${removed.map(v => `"${v}"`).join(", ")}.`,
            remedy:
                "Postgres cannot remove a value from an enum type. Recreate the type in a migration, " +
                "after rewriting every row still using the value."
        });
    }
}

/** A one-line summary, for a log or a refusal message. */
export function summarizeChanges(classified: ClassifiedChanges): string {
    if (classified.changes.length === 0) return "No schema changes.";

    const counts = classified.changes.reduce<Record<ChangeVerdict, number>>(
        (acc, change) => ({ ...acc, [change.verdict]: (acc[change.verdict] ?? 0) + 1 }),
        { safe: 0, diverges: 0, "needs-migration": 0 }
    );

    const parts = (["needs-migration", "diverges", "safe"] as ChangeVerdict[])
        .filter(verdict => counts[verdict] > 0)
        .map(verdict => `${counts[verdict]} ${verdict}`);

    return `${classified.changes.length} change(s): ${parts.join(", ")}.`;
}
