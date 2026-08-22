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
import type {
    CollectionConfig,
    Property,
    SchemaChange,
    SchemaChangeKind,
    SchemaChangeVerdict,
    ClassifiedSchemaChanges
} from "@rebasepro/types";
import { getTableName } from "@rebasepro/common";
import { resolveColumnName } from "./generate-postgres-ddl-logic";

/**
 * The vocabulary lives in `@rebasepro/types` so that `@rebasepro/server`, which
 * cannot import this package, can still describe a change. Re-exported here
 * under the names this module has always used.
 */
export type ChangeVerdict = SchemaChangeVerdict;
export type ChangeKind = SchemaChangeKind;
export type { SchemaChange };
export type ClassifiedChanges = ClassifiedSchemaChanges;

const VERDICT_RANK: Record<SchemaChangeVerdict, number> = {
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
 * Facts about the database a change is destined for.
 *
 * Three of the verdicts below cannot be reached from the collections alone:
 * whether a NOT NULL can be added comes down to whether the table holds rows,
 * and whether an enum value will land comes down to which values the type
 * already has. Without these, the classifier answers conservatively — the
 * change *may* diverge — which is the right answer for a caller that has no
 * database to look at, and the wrong one to show somebody staring at theirs.
 */
export interface SchemaFacts {
    /** `schema.table` → columns. */
    tables: Map<string, Set<string>>;
    /** Tables known to hold at least one row. */
    populatedTables?: Set<string>;
    /** `schema.table.column` for every column the database marks NOT NULL. */
    notNullColumns?: Set<string>;
    /** `schema.typename` → the values that type currently holds. */
    enumValues?: Map<string, string[]>;
}

/** Whether the table behind a collection exists and is empty. */
const tableIsEmpty = (collection: CollectionConfig, facts?: SchemaFacts): boolean => {
    if (!facts?.populatedTables) return false;
    const key = qualifiedTable(collection);
    // A table the database does not have yet is one this change creates, and a
    // table being created has no rows to check a constraint against.
    if (!facts.tables.has(key)) return true;
    return !facts.populatedTables.has(key);
};

const qualifiedTable = (collection: CollectionConfig): string => {
    const schema = (collection as { schema?: string }).schema ?? "public";
    return `${schema}.${getTableName(collection)}`;
};

/**
 * Classify the difference between two collection sets.
 *
 * `before` is what the running database was built from; `after` is what the
 * editor is proposing. Order within each array is irrelevant.
 *
 * `facts` is what the database actually looks like. Supplied by the live
 * editor; omitted by callers reasoning about collections in the abstract, who
 * get the conservative reading.
 */
export function classifyCollectionChanges(
    before: CollectionConfig[],
    after: CollectionConfig[],
    facts?: SchemaFacts
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
        classifyProperties(previous.get(slug)!, collection, changes, facts);
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
    changes: SchemaChange[],
    facts?: SchemaFacts
): void {
    const slug = after.slug ?? "";
    const previous = propertiesOf(before);
    const next = propertiesOf(after);
    const empty = tableIsEmpty(after, facts);

    for (const [name, prop] of Object.entries(next)) {
        const old = previous[name];

        if (!old) {
            // A NOT NULL is checked against rows that are already there, so
            // whether this is safe is a question about the data, not about the
            // configuration. On an empty table the constraint cannot fail and
            // the ensure path applies it; on a populated one it is withheld and
            // the column arrives nullable, which is a database that disagrees
            // with its own config — still worth refusing, now for a reason the
            // reader can act on.
            if (isRequired(prop) && !empty) {
                changes.push({
                    kind: "add-property",
                    verdict: "diverges",
                    collection: slug,
                    property: name,
                    detail:
                        `"${name}" is required, but "${getTableName(after)}" already holds rows, so ` +
                        "NOT NULL would be checked against data that has no value for it yet. The " +
                        "column would arrive nullable.",
                    remedy:
                        "Add it optional, backfill every row, then make it required — the editor " +
                        "will apply the constraint once no row violates it."
                });
            } else {
                const column = resolveColumnName(name, prop);
                changes.push({
                    kind: "add-property",
                    verdict: "safe",
                    collection: slug,
                    property: name,
                    detail: isRequired(prop)
                        ? `New required property "${name}" — adds column "${column}" NOT NULL, ` +
                          `which "${getTableName(after)}" can take because it holds no rows.`
                        : `New optional property "${name}" — adds column "${column}".`
                });
            }
            continue;
        }

        classifyProperty(slug, after, name, old, prop, changes, facts);
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
    changes: SchemaChange[],
    facts?: SchemaFacts
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
        // Tightening. `SET NOT NULL` scans the table, so this comes down to
        // whether anything in it is null — which on an empty table is nothing.
        const empty = tableIsEmpty(collection, facts);
        changes.push(empty
            ? {
                kind: "change-required",
                verdict: "safe",
                collection: slug,
                property: name,
                detail:
                    `"${name}" became required — sets NOT NULL on "${afterColumn}", which ` +
                    `"${getTableName(collection)}" can take because it holds no rows.`
            }
            : {
                kind: "change-required",
                verdict: "diverges",
                collection: slug,
                property: name,
                detail:
                    `"${name}" became required, but "${getTableName(collection)}" holds rows and ` +
                    "SET NOT NULL is checked against every one of them. The database would keep " +
                    "accepting nulls.",
                remedy:
                    `Backfill first — UPDATE the rows where "${afterColumn}" IS NULL — then apply ` +
                    "this again."
            });
    }

    if (isRequired(before) && !isRequired(after)) {
        // Relaxing. `DROP NOT NULL` cannot fail and cannot lose data, so this is
        // safe on any table; the editor plans it because a reviewed change is
        // the one context in which touching an existing column's constraints is
        // something somebody asked for.
        changes.push({
            kind: "change-required",
            verdict: "safe",
            collection: slug,
            property: name,
            detail: `"${name}" is no longer required — drops NOT NULL from "${afterColumn}".`
        });
    }

    classifyEnum(slug, collection, name, before, after, changes, facts);
}

function classifyEnum(
    slug: string,
    collection: CollectionConfig,
    name: string,
    before: Property,
    after: Property,
    changes: SchemaChange[],
    facts?: SchemaFacts
): void {
    const oldValues = enumValuesOf(before);
    const newValues = enumValuesOf(after);
    if (!oldValues || !newValues) return;

    const added = newValues.filter(value => !oldValues.includes(value));
    const removed = oldValues.filter(value => !newValues.includes(value));

    if (added.length > 0) {
        // `ADD VALUE` is additive, idempotent with IF NOT EXISTS, and needs no
        // table scan, so the ensure path now carries it — but only when it can
        // see which values the type already has. A caller with no database
        // cannot know that, and for them this is still the change that silently
        // does not land.
        const seesTheType = facts?.enumValues !== undefined;
        changes.push(seesTheType
            ? {
                kind: "add-enum-value",
                verdict: "safe",
                collection: slug,
                property: name,
                detail: `"${name}" gains ${added.map(v => `"${v}"`).join(", ")} — ALTER TYPE … ADD VALUE.`
            }
            : {
                kind: "add-enum-value",
                verdict: "diverges",
                collection: slug,
                property: name,
                detail:
                    `"${name}" gains ${added.map(v => `"${v}"`).join(", ")}, and the values this ` +
                    "type already has are not known here, so whether they would land cannot be said.",
                remedy: "Plan this against the database it is destined for."
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
