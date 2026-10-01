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
 * ## Read from the plan, not from the properties
 *
 * Whether an edit changes the database is decided by comparing what
 * `planSchema` — the one reading of a `Property` every emitter renders — makes
 * of the collections before and after it: each table's columns, their types,
 * nullability, defaults, uniqueness and foreign keys, the junction tables,
 * indexes and triggers. It used to be decided by a hand-picked list of property
 * fields, which knew nothing of `validation.integer`, of a string becoming an
 * enum, of an array's element type or of anything about a relation beyond its
 * name — and every one of those was reported "safe, no change", committed, and
 * never applied. A difference in the plan cannot be missed that way: a new kind
 * of edit either changes the plan, and is classified here from the difference,
 * or it does not change the database.
 *
 * The property-level reading is still here, for the parts only it can name: a
 * property added or removed, a required flag, an enum's values, a key renamed.
 *
 * ## Why refusing is the right default for the rest
 *
 * Dropping a column, narrowing a type, changing a primary key: each is
 * expressible in SQL and none is expressible by `ensure`. They need a migration
 * somebody wrote and read. `needs-migration` says exactly that, and naming the
 * change is more useful than attempting it.
 */
import {
    hasForeignKeyOnTarget,
    isManyToMany,
    type CollectionConfig,
    type Property,
    type RelationProperty,
    type ResolvedRelation,
    type SchemaChange,
    type SchemaChangeKind,
    type SchemaChangeVerdict,
    type ClassifiedSchemaChanges
} from "@rebasepro/types";
import { findRelation, getTableName, resolveCollectionRelations } from "@rebasepro/common";
import { resolveColumnName } from "./column-plan-helpers";
import { planSchema } from "./plan/plan-schema";
import { renderPgType } from "./plan/render-ddl";
import { typesAgree } from "./column-type-drift";
import type { ColumnPlan, ForeignKeyPlan, SchemaPlan, TablePlan } from "./plan/types";

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
    /** `schema.table.column` → the type Postgres reports for it (`udt_name`). */
    columnTypes?: Map<string, string>;
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

/** The two plans a change is read from. `before` is absent when it cannot be planned. */
interface Plans {
    before?: SchemaPlan;
    after: SchemaPlan;
}

const collectionTableOf = (plan: SchemaPlan | undefined, collection: CollectionConfig): TablePlan | undefined =>
    plan?.tables.find(table => table.kind === "collection" && table.slug === collection.slug);

/** The resolved relation behind a relation property, when it resolves. */
const relationOf = (collection: CollectionConfig, propName: string, prop: Property): ResolvedRelation | undefined => {
    if (prop.type !== "relation") return undefined;
    const name = (prop as RelationProperty).relation?.relationName ?? propName;
    try {
        return findRelation(resolveCollectionRelations(collection), name);
    } catch {
        return undefined;
    }
};

/** What one property puts in the database: its columns, and the junction tables it implies. */
interface Footprint {
    columns: ColumnPlan[];
    junctions: TablePlan[];
}

const PROPERTY_SOURCES = new Set(["property", "relation", "reference"]);

function footprintOf(plan: SchemaPlan | undefined, collection: CollectionConfig, propName: string, prop: Property): Footprint {
    const table = collectionTableOf(plan, collection);
    const columns = table?.columns.filter(column =>
        column.source.propName === propName && PROPERTY_SOURCES.has(column.source.kind)) ?? [];
    const junctions: TablePlan[] = [];
    const relation = relationOf(collection, propName, prop);
    if (plan && relation && isManyToMany(relation)) {
        const junction = plan.tables.find(t => t.kind === "junction" && t.table === relation.through.table);
        if (junction) junctions.push(junction);
    }
    return { columns, junctions };
}

/** "column "x"", "columns "x", "y"", "junction table "a_b"" — what a footprint is, in words. */
function describeFootprint(footprint: Footprint): string {
    const parts: string[] = [];
    if (footprint.columns.length > 0) {
        const names = footprint.columns.map(c => `"${c.column}"`).join(", ");
        parts.push(`${footprint.columns.length === 1 ? "column" : "columns"} ${names}`);
    }
    for (const junction of footprint.junctions) parts.push(`junction table "${junction.qualified}"`);
    return parts.join(" and ");
}

/** A column's type as one comparable string. An enum is its type, not its labels. */
function typeKey(column: ColumnPlan): string {
    if (column.generated) return `generated:${renderPgType(column.type)}:${column.generated.expression}`;
    if (column.sqlDefinition) return `sql:${column.sqlDefinition}`;
    if (column.type.kind === "enum") return `enum:${column.type.schema}.${column.type.name}`;
    const identity = column.default?.kind === "identity" ? " IDENTITY" : "";
    return `${renderPgType(column.type)}${identity}`;
}

/** A column's type, for a sentence. */
function typeText(column: ColumnPlan): string {
    if (column.type.kind === "enum") return `the enum ${column.type.name}`;
    return renderPgType(column.type);
}

function defaultText(column: ColumnPlan): string | undefined {
    if (!column.default || column.default.kind === "identity") return undefined;
    return column.default.kind === "sql" ? column.default.expression : column.default.sql;
}

function foreignKeyText(fk: ForeignKeyPlan | undefined): string | undefined {
    if (!fk) return undefined;
    return `"${fk.targetSchema}"."${fk.targetTable}" ("${fk.targetColumn}") ON DELETE ${fk.onDelete.toUpperCase()}` +
        (fk.onUpdate ? ` ON UPDATE ${fk.onUpdate.toUpperCase()}` : "");
}

/** Plan a collection set, or say why it cannot be planned. */
function tryPlan(collections: CollectionConfig[]): SchemaPlan | Error {
    try {
        return planSchema(collections);
    } catch (err) {
        return err instanceof Error ? err : new Error(String(err));
    }
}

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

    const beforePlan = tryPlan(before);
    const afterPlan = tryPlan(after);
    if (afterPlan instanceof Error) {
        // A proposal the planner refuses is not a change the database can
        // take, whatever else is true of it — and it is the planner's message
        // that says what to fix.
        changes.push({
            kind: "invalid-collection",
            verdict: "needs-migration",
            collection: [...next.keys()].find(slug => !previous.has(slug)) ?? [...next.keys()][0] ?? "",
            detail: `The proposed collections cannot be planned: ${afterPlan.message}`,
            remedy: "Fix the collection so its schema can be generated, then try again."
        });
    }
    const plans: Plans | undefined = afterPlan instanceof Error
        ? undefined
        : { before: beforePlan instanceof Error ? undefined : beforePlan, after: afterPlan };

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
        const was = previous.get(slug)!;
        // The slug is the identity, so a collection that kept it and changed
        // its table is the same collection *moved*. The ensure path would
        // create the new table and never touch the old one: the collection
        // would come back empty, with every row it had left behind.
        if (qualifiedTable(was) !== qualifiedTable(collection)) {
            changes.push({
                kind: "rename-table",
                verdict: "needs-migration",
                collection: slug,
                detail:
                    `"${slug}" moves from table "${qualifiedTable(was)}" to "${qualifiedTable(collection)}", ` +
                    "which would create the new table empty and leave every row in the old one.",
                remedy:
                    "The ensure path never renames or moves a table. Do it in a migration you have read " +
                    "(ALTER TABLE … RENAME TO, or SET SCHEMA), then change the collection to match."
            });
            continue;
        }
        classifyProperties(was, collection, changes, facts, plans);
        if (plans) {
            classifyTable(was, collection, collectionTableOf(plans.before, was), collectionTableOf(plans.after, collection), changes);
        }
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

    if (plans?.before) classifyJunctions(plans.before, plans.after, previous, next, changes);

    const verdict = changes.reduce<ChangeVerdict>(
        (worst, change) => (VERDICT_RANK[change.verdict] > VERDICT_RANK[worst] ? change.verdict : worst),
        "safe"
    );

    return { changes, verdict, applicable: verdict === "safe" };
}

/** A change on this property already refuses it — a second refusal would only repeat it. */
const alreadyRefused = (changes: SchemaChange[], slug: string, property: string | undefined): boolean =>
    property !== undefined &&
    changes.some(change => change.collection === slug && change.property === property && change.verdict === "needs-migration");

function classifyProperties(
    before: CollectionConfig,
    after: CollectionConfig,
    changes: SchemaChange[],
    facts: SchemaFacts | undefined,
    plans: Plans | undefined
): void {
    const slug = after.slug ?? "";
    const previous = propertiesOf(before);
    const next = propertiesOf(after);
    const empty = tableIsEmpty(after, facts);

    // A key renamed with its column kept — the editor sets `columnName` to the
    // old column — moves no data: the database sees the same column, and the
    // plans agree. It used to read as a removal plus an addition, and was
    // refused as dropping a column nothing dropped.
    const renamed = new Map<string, string>();
    if (plans?.before) {
        const removedKeys = Object.keys(previous).filter(key => !next[key]);
        const addedKeys = Object.keys(next).filter(key => !previous[key]);
        for (const oldKey of removedKeys) {
            const was = footprintOf(plans.before, before, oldKey, previous[oldKey]).columns.map(c => c.column).sort();
            if (was.length === 0) continue;
            const newKey = addedKeys.find(key => !renamed.has(key) &&
                JSON.stringify(footprintOf(plans.after, after, key, next[key]).columns.map(c => c.column).sort()) === JSON.stringify(was));
            if (newKey) renamed.set(newKey, oldKey);
        }
    }
    const renamedFrom = new Set(renamed.values());

    for (const [name, prop] of Object.entries(next)) {
        const oldKey = renamed.get(name);
        if (oldKey) {
            const columns = footprintOf(plans?.after, after, name, prop).columns.map(c => `"${c.column}"`).join(", ");
            changes.push({
                kind: "rename-property",
                verdict: "safe",
                collection: slug,
                property: name,
                detail:
                    `"${oldKey}" is now "${name}" and keeps column ${columns} — no data moves. ` +
                    `API clients reading "${oldKey}" read "${name}" from now on.`
            });
            classifyProperty(slug, after, name, previous[oldKey], prop, changes, facts, plans, oldKey);
            continue;
        }
        const old = previous[name];
        if (!old) {
            classifyAddedProperty(slug, after, name, prop, changes, empty, plans, facts);
            continue;
        }
        classifyProperty(slug, after, name, old, prop, changes, facts, plans);
    }

    for (const [name, prop] of Object.entries(previous)) {
        if (next[name] || renamedFrom.has(name)) continue;
        classifyRemovedProperty(slug, before, after, name, prop, changes, plans);
    }
}

function classifyAddedProperty(
    slug: string,
    collection: CollectionConfig,
    name: string,
    prop: Property,
    changes: SchemaChange[],
    empty: boolean,
    plans: Plans | undefined,
    facts: SchemaFacts | undefined
): void {
    const footprint = footprintOf(plans?.after, collection, name, prop);
    const physical = footprint.columns.length > 0;
    if (refuseUnbackedRelation(slug, collection, name, prop, changes, plans)) return;
    if (reusesLeftoverColumn(slug, collection, name, prop, footprint, changes, empty, facts)) return;

    // A NOT NULL is checked against rows that are already there, so whether
    // this is safe is a question about the data, not about the configuration.
    // On an empty table the constraint cannot fail and the ensure path applies
    // it; on a populated one it is withheld and the column arrives nullable,
    // which is a database that disagrees with its own config — still worth
    // refusing, now for a reason the reader can act on.
    if (isRequired(prop) && physical && !empty) {
        changes.push({
            kind: "add-property",
            verdict: "diverges",
            collection: slug,
            property: name,
            detail:
                `"${name}" is required, but "${getTableName(collection)}" already holds rows, so ` +
                "NOT NULL would be checked against data that has no value for it yet. The " +
                "column would arrive nullable.",
            remedy:
                "Add it optional, backfill every row, then make it required — the editor " +
                "will apply the constraint once no row violates it."
        });
        return;
    }

    const what = describeFootprint(footprint);
    const relation = relationOf(collection, name, prop);
    const adds = what
        ? `adds ${what}`
        : relation && hasForeignKeyOnTarget(relation)
            ? `adds no column — its links are read from "${relation.foreignKeyOnTarget}" on the collection it points at`
            : "adds nothing to the database";
    changes.push({
        kind: "add-property",
        verdict: "safe",
        collection: slug,
        property: name,
        detail: isRequired(prop) && physical
            ? `New required property "${name}" — ${adds} NOT NULL, which "${getTableName(collection)}" ` +
              "can take because it holds no rows."
            : `New ${isRequired(prop) ? "required" : "optional"} property "${name}" — ${adds}.`
    });
}

/**
 * A property added over a column the database already has.
 *
 * "Edit source only" removes a property and leaves its column — that is what
 * it is for — so the same name can come back later over a column holding the
 * old values. `ADD COLUMN IF NOT EXISTS` is then a no-op: the plan said "adds
 * column", nothing ran, and a property of another type read the old values as
 * its own. Re-using a column of the same type is fine and is said; a column of
 * another type needs converting first.
 */
function reusesLeftoverColumn(
    slug: string,
    collection: CollectionConfig,
    name: string,
    prop: Property,
    footprint: Footprint,
    changes: SchemaChange[],
    empty: boolean,
    facts: SchemaFacts | undefined
): boolean {
    const table = qualifiedTable(collection);
    const present = facts?.tables.get(table);
    const leftover = footprint.columns.filter(column => present?.has(column.column));
    if (leftover.length === 0) return false;

    for (const column of leftover) {
        const actual = facts?.columnTypes?.get(`${table}.${column.column}`);
        const declared = renderPgType(column.type);
        if (actual && !typesAgree(declared, actual)) {
            changes.push({
                kind: "add-property",
                verdict: "needs-migration",
                collection: slug,
                property: name,
                detail:
                    `"${name}" would use column "${column.column}", which is already there as ${actual} — ` +
                    `left by an earlier removal — while "${name}" declares ${declared}. The values in it ` +
                    "would be read as the wrong type.",
                remedy:
                    `Drop or convert "${column.column}" in a migration you have read, or give "${name}" ` +
                    "another `columnName`."
            });
            return true;
        }
    }
    const columns = leftover.map(c => `"${c.column}"`).join(", ");
    changes.push(isRequired(prop) && !empty
        ? {
            kind: "add-property",
            verdict: "diverges",
            collection: slug,
            property: name,
            detail:
                `"${name}" re-uses column ${columns}, which is already there with the values an earlier ` +
                "property left in it, and is required — NOT NULL would be checked against those rows.",
            remedy: "Add it optional, backfill the rows with no value, then make it required."
        }
        : {
            kind: "add-property",
            verdict: "safe",
            collection: slug,
            property: name,
            detail:
                `New ${isRequired(prop) ? "required" : "optional"} property "${name}" — re-uses column ` +
                `${columns}, which is already there and keeps the values an earlier property left in it.`
        });
    return true;
}

/**
 * A `hasMany`/`hasOne` reads its links from a column on the collection it
 * points at. When nothing creates that column, the relation is empty forever,
 * and nothing about planning it said so: the plan was "safe", the detail said
 * it added a column it did not add, and no statement ran.
 */
function refuseUnbackedRelation(
    slug: string,
    collection: CollectionConfig,
    name: string,
    prop: Property,
    changes: SchemaChange[],
    plans: Plans | undefined
): boolean {
    const relation = relationOf(collection, name, prop);
    if (!plans || !relation || !hasForeignKeyOnTarget(relation)) return false;
    let target: CollectionConfig | undefined;
    try {
        target = relation.target();
    } catch {
        return false;
    }
    const targetTable = target ? collectionTableOf(plans.after, target) : undefined;
    if (!targetTable || targetTable.columns.some(column => column.column === relation.foreignKeyOnTarget)) return false;
    changes.push({
        kind: "change-relation",
        verdict: "needs-migration",
        collection: slug,
        property: name,
        detail:
            `"${name}" reads its links from column "${relation.foreignKeyOnTarget}" of "${targetTable.qualified}", ` +
            "which nothing creates — the relation would always be empty.",
        remedy:
            `Give "${target!.slug}" a belongsTo whose column is "${relation.foreignKeyOnTarget}", or point ` +
            "`foreignKeyOnTarget` at the column that holds the link."
    });
    return true;
}

function classifyRemovedProperty(
    slug: string,
    before: CollectionConfig,
    after: CollectionConfig,
    name: string,
    prop: Property,
    changes: SchemaChange[],
    plans: Plans | undefined
): void {
    const footprint = footprintOf(plans?.before, before, name, prop);
    // Only what the proposal no longer has is dropped. A column another
    // property still produces, or a junction the far side still declares,
    // stays where it is.
    const afterTable = collectionTableOf(plans?.after, after);
    const dropped: Footprint = plans?.before
        ? {
            columns: footprint.columns.filter(c => !afterTable?.columns.some(a => a.column === c.column)),
            junctions: footprint.junctions.filter(j => !plans.after.tables.some(t => t.qualified === j.qualified))
        }
        : { columns: [{ column: resolveColumnName(name, prop) } as ColumnPlan], junctions: [] };

    if (dropped.columns.length === 0 && dropped.junctions.length === 0) {
        changes.push({
            kind: "remove-property",
            verdict: "safe",
            collection: slug,
            property: name,
            detail: footprint.columns.length + footprint.junctions.length > 0
                ? `"${name}" was removed; ${describeFootprint(footprint)} stays, because the collections still use it.`
                : `"${name}" was removed — it had nothing in the database of its own, so nothing there changes.`
        });
        return;
    }
    changes.push({
        kind: "remove-property",
        verdict: "needs-migration",
        collection: slug,
        property: name,
        detail:
            `"${name}" was removed, which would drop ${describeFootprint(dropped)} and the data in it.`,
        remedy:
            "The ensure path never drops anything. Remove it in a migration you have read, or " +
            "leave the column and stop exposing the property."
    });
}

function classifyProperty(
    slug: string,
    collection: CollectionConfig,
    name: string,
    before: Property,
    after: Property,
    changes: SchemaChange[],
    facts: SchemaFacts | undefined,
    plans: Plans | undefined,
    /** The key `before` had, when the key itself was renamed. */
    beforeName = name
): void {
    // A relation's column is its `localKey`, which the plan comparison reads;
    // `columnName` names the column of every other property.
    if (before.type !== "relation" && after.type !== "relation") {
        const beforeColumn = resolveColumnName(beforeName, before);
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

    if (before.type === "relation" && after.type === "relation") {
        const was = relationOf(collection, name, before);
        const is = relationOf(collection, name, after);
        if (was && is && was.kind !== is.kind) {
            changes.push({
                kind: "change-relation",
                verdict: "needs-migration",
                collection: slug,
                property: name,
                detail:
                    `"${name}" changes from a ${was.kind} to a ${is.kind} relation. Its links are stored in a ` +
                    "different place for each, and the ones already stored are not moved.",
                remedy:
                    "Move the links in a migration you have read — copy them into the new place — then change " +
                    "the relation to match."
            });
            return;
        }
        if (refuseUnbackedRelation(slug, collection, name, after, changes, plans)) return;
    }

    const afterColumn = resolveColumnName(name, after);
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

    classifyEnum(slug, name, before, after, changes, facts);
}

/**
 * Everything the plans say changed about a table that already exists — the
 * part no reading of the properties can be trusted to find.
 *
 * Each difference is something the ensure path either does (a new index, a
 * new trigger, a default) or does not (a column's type, its uniqueness, its
 * foreign key, a column the plan no longer has). A difference already refused
 * by the property-level reading — a removed property, a renamed column — is not
 * refused twice.
 */
function classifyTable(
    wasCollection: CollectionConfig,
    collection: CollectionConfig,
    before: TablePlan | undefined,
    after: TablePlan | undefined,
    changes: SchemaChange[]
): void {
    if (!before || !after) return;
    const slug = collection.slug ?? "";
    /** "string to number — " when the property's own type changed too. */
    const propertyTypes = (property: string | undefined): string => {
        if (!property) return "";
        const was = propertiesOf(wasCollection)[property]?.type;
        const is = propertiesOf(collection)[property]?.type;
        return was && is && was !== is ? `from ${was} to ${is} — ` : "";
    };
    const push = (change: Omit<SchemaChange, "collection">) => {
        if (alreadyRefused(changes, slug, change.property)) return;
        changes.push({ ...change, collection: slug });
    };
    const label = (column: ColumnPlan) => column.source.propName ?? column.column;

    for (const column of after.columns) {
        const was = before.columns.find(c => c.column === column.column);
        if (!was) continue;
        const property = column.source.propName ?? was.source.propName;
        const where = `"${label(column)}"`;

        if (typeKey(was) !== typeKey(column)) {
            push({
                kind: "change-property-type",
                verdict: "needs-migration",
                property,
                detail: `${where} changes ${propertyTypes(property)}column "${column.column}" goes from ` +
                    `${typeText(was)} to ${typeText(column)}.`,
                remedy:
                    "There is no ALTER COLUMN TYPE in the ensure path, and a cast can fail on data that " +
                    "is already there. Change it in a migration."
            });
            continue;
        }
        if (was.primaryKey !== column.primaryKey) {
            push({
                kind: "change-primary-key",
                verdict: "needs-migration",
                property,
                detail: `${where} changes whether "${column.column}" is the primary key.`,
                remedy: "A primary key change rewrites the table and every foreign key into it. Migration only."
            });
            continue;
        }
        if (was.unique !== column.unique) {
            push({
                kind: "change-constraint",
                verdict: "needs-migration",
                property,
                detail: column.unique
                    ? `${where} becomes unique — a UNIQUE constraint on "${column.column}", checked against every existing row.`
                    : `${where} is no longer unique — the UNIQUE constraint on "${column.column}" stays until it is dropped.`,
                remedy: column.unique
                    ? `The ensure path never constrains an existing column. Check for duplicates, then ALTER TABLE ` +
                      `"${after.schema}"."${after.table}" ADD UNIQUE ("${column.column}") in a migration.`
                    : `Drop it in a migration: ALTER TABLE "${after.schema}"."${after.table}" DROP CONSTRAINT …`
            });
        }
        const fkWas = foreignKeyText(was.foreignKey);
        const fkIs = foreignKeyText(column.foreignKey);
        if (fkWas !== fkIs) {
            if (!fkWas) {
                push({
                    kind: "change-relation",
                    verdict: "safe",
                    property,
                    detail:
                        `${where} gains a foreign key — "${column.column}" REFERENCES ${fkIs}. It is checked ` +
                        "against every existing row, and a value pointing at nothing makes it fail."
                });
            } else {
                push({
                    kind: "change-relation",
                    verdict: "needs-migration",
                    property,
                    detail: fkIs
                        ? `${where} changes its foreign key from ${fkWas} to ${fkIs}. The constraint already ` +
                          "exists under its name, so the ensure path would leave the old one in place."
                        : `${where} no longer declares its foreign key, but the constraint on "${column.column}" ` +
                          `(${fkWas}) stays and keeps refusing values.`,
                    remedy:
                        "Drop and re-create the constraint in a migration you have read — ALTER TABLE … DROP " +
                        "CONSTRAINT, then ADD CONSTRAINT."
                });
            }
        }
        const defaultWas = defaultText(was);
        const defaultIs = defaultText(column);
        if (defaultWas !== defaultIs) {
            // A DEFAULT binds future writes only: setting, changing or dropping
            // it cannot fail and touches no row. `generateSchemaCommit` adds the
            // statement the additive ensure would not.
            push({
                kind: "change-default",
                verdict: "safe",
                property,
                detail: defaultIs
                    ? `${where} defaults to ${defaultIs} — SET DEFAULT on "${column.column}"; rows already there keep their values.`
                    : `${where} no longer has a default — DROP DEFAULT on "${column.column}"; rows already there keep their values.`
            });
        }
    }

    for (const column of before.columns) {
        if (after.columns.some(c => c.column === column.column)) continue;
        const property = column.source.propName;
        // A removed property, a column renamed through `columnName`, a
        // relation whose kind changed: already refused, naming the property.
        if (alreadyRefused(changes, slug, property)) continue;
        push({
            kind: column.source.kind === "relation" ? "change-relation" : "remove-property",
            verdict: "needs-migration",
            property,
            detail: column.source.kind === "relation"
                ? `"${label(column)}" no longer keeps its links in column "${column.column}", and the links ` +
                  "already there would not be moved — the new place starts empty."
                : `Column "${column.column}" is no longer part of "${slug}", which would drop it and its data.`,
            remedy:
                "Move the data in a migration you have read, or keep the relation's column where it is " +
                "(`localKey`)."
        });
    }

    for (const index of after.indexes) {
        if (before.indexes.some(i => i.indexName === index.indexName)) continue;
        push({
            kind: "change-constraint",
            verdict: "safe",
            detail: `Creates ${index.unique ? "unique " : ""}index "${index.indexName}" on "${after.qualified}".`
        });
    }
    for (const index of before.indexes) {
        if (after.indexes.some(i => i.indexName === index.indexName)) continue;
        push({
            kind: "change-constraint",
            verdict: index.unique ? "needs-migration" : "safe",
            detail: index.unique
                ? `Unique index "${index.indexName}" is no longer declared, but it stays and keeps refusing duplicates.`
                : `Index "${index.indexName}" is no longer declared; it stays in the database until it is dropped.`,
            remedy: index.unique ? `Drop it in a migration: DROP INDEX "${after.schema}"."${index.indexName}".` : undefined
        });
    }
    for (const trigger of before.triggers) {
        if (after.triggers.some(t => t.name === trigger.name)) continue;
        push({
            kind: "change-constraint",
            verdict: "needs-migration",
            property: before.columns.find(c => c.column === trigger.column)?.source.propName,
            detail:
                `"${trigger.column}" is no longer stamped on update, but trigger "${trigger.name}" stays and ` +
                "keeps stamping it.",
            remedy: `Drop it in a migration: DROP TRIGGER "${trigger.name}" ON "${after.schema}"."${after.table}".`
        });
    }
    for (const trigger of after.triggers) {
        if (before.triggers.some(t => t.name === trigger.name)) continue;
        push({
            kind: "change-constraint",
            verdict: "safe",
            property: after.columns.find(c => c.column === trigger.column)?.source.propName,
            detail: `"${trigger.column}" is stamped with now() on every update — creates trigger "${trigger.name}".`
        });
    }
}

/**
 * Junction tables that appear or disappear without a collection or a property
 * being added or removed — a relation that changed kind, or the far side of a
 * many-to-many dropping out.
 */
function classifyJunctions(
    before: SchemaPlan,
    after: SchemaPlan,
    previous: Map<string, CollectionConfig>,
    next: Map<string, CollectionConfig>,
    changes: SchemaChange[]
): void {
    const mentioned = (table: string) => changes.some(change => change.detail.includes(`"${table}"`));
    for (const table of before.tables) {
        if (table.kind !== "junction" || after.tables.some(t => t.qualified === table.qualified)) continue;
        const slugs = table.declaringSlugs ?? [];
        // A removed collection already says it takes everything with it.
        if (slugs.length > 0 && slugs.every(slug => !next.has(slug))) continue;
        if (mentioned(table.qualified)) continue;
        changes.push({
            kind: "change-relation",
            verdict: "needs-migration",
            collection: slugs[0] ?? "",
            detail: `Junction table "${table.qualified}" is no longer declared, which would drop it and every link in it.`,
            remedy: "The ensure path never drops a table. Drop it in a migration you have read, or keep the relation."
        });
    }
    for (const table of after.tables) {
        if (table.kind !== "junction" || before.tables.some(t => t.qualified === table.qualified)) continue;
        const slugs = table.declaringSlugs ?? [];
        if (slugs.length > 0 && slugs.every(slug => !previous.has(slug))) continue;
        if (mentioned(table.qualified)) continue;
        changes.push({
            kind: "change-relation",
            verdict: "safe",
            collection: slugs[0] ?? "",
            detail: `Creates junction table "${table.qualified}", empty.`
        });
    }
}

function classifyEnum(
    slug: string,
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

/**
 * The statements a default change needs that the additive ensure does not
 * plan: it sets a DEFAULT only on a column that has none, and never changes or
 * drops one. Both are metadata-only — a DEFAULT binds future writes and touches
 * no row — so a reviewed change may make them.
 */
export function defaultChangeStatements(
    before: CollectionConfig[],
    after: CollectionConfig[],
    existingTables: Map<string, Set<string>>
): string[] {
    const beforePlan = tryPlan(before);
    const afterPlan = tryPlan(after);
    if (beforePlan instanceof Error || afterPlan instanceof Error) return [];
    const statements: string[] = [];
    for (const table of afterPlan.tables) {
        const was = beforePlan.tables.find(t => t.qualified === table.qualified);
        if (!was) continue;
        for (const column of table.columns) {
            const old = was.columns.find(c => c.column === column.column);
            if (!old || !existingTables.get(table.qualified)?.has(column.column)) continue;
            if (old.default?.kind === "identity" || column.default?.kind === "identity" || column.generated) continue;
            const from = defaultText(old);
            const to = defaultText(column);
            if (from === to) continue;
            const target = `ALTER TABLE "${table.schema}"."${table.table}" ALTER COLUMN "${column.column}"`;
            statements.push(to ? `${target} SET DEFAULT ${to};` : `${target} DROP DEFAULT;`);
        }
    }
    return statements;
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
