/**
 * The questions about a property that the schema planner asks first.
 *
 * What is the primary key, what is this column called, what does an id default
 * to, what labels does this enum have. `schema/plan/plan-schema.ts` is the only
 * caller — it is the only reader of a `Property` — and these live beside it
 * rather than inside it because they are also where the *refusals* are, and a
 * refusal wants to be reachable and testable on its own.
 *
 * They were extracted while there were still three emitters, each carrying its
 * own verbatim copy of all four rules until one of them was edited: the audit
 * that produced this module counted twelve open disagreements and found that a
 * third of the commits touching those files were re-synchronisations. The
 * emitters are renderers now and there is nothing left to keep in step, but the
 * questions are still questions about a property rather than about a plan, so
 * this is where they belong.
 *
 * Everything here is pure and synchronous, and it throws rather than guesses:
 * an enum with no values, a `cuid` id on Postgres and a foreign key into a
 * composite key are all configurations that produce a broken database in
 * silence, so they are refused where every path passes.
 */
import type {
    CollectionConfig,
    ColumnDef,
    Property
} from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

const isColumnDef = (value: unknown): value is ColumnDef =>
    typeof value === "object" && value !== null
    && "type" in value && typeof value.type === "object" && value.type !== null
    && "kind" in value.type && typeof value.type.kind === "string"
    && "notNull" in value && typeof value.notNull === "boolean"
    && "primaryKey" in value && typeof value.primaryKey === "boolean";

/**
 * TRANSITIONAL (Postgres-first Stage B): the column definition `lowerTables`
 * attached to a lowered property (`tableColumn`), or `undefined` for a legacy
 * property. Read only by the collection-reading consumers outside the planner
 * (the doctor, `classify-change`, the CLI helpers); deleted with `lowerTables`.
 */
export const tableColumnOf = (prop: Property | undefined): ColumnDef | undefined => {
    if (!prop || !("tableColumn" in prop)) return undefined;
    return isColumnDef(prop.tableColumn) ? prop.tableColumn : undefined;
};

/**
 * Resolve the SQL column name for a property.
 *
 * Uses the explicit `columnName` when set (e.g. from introspection), falling
 * back to `toSnakeCase(propName)` for manually-authored collections.
 */
export const resolveColumnName = (propName: string, prop?: Property | null): string => {
    // A column lowered from a table states its name, or takes its key's.
    const definition = prop && prop.type !== "relation" ? tableColumnOf(prop) : undefined;
    if (definition) return definition.column ?? toSnakeCase(propName);
    if (prop && "columnName" in prop && typeof prop.columnName === "string") {
        return prop.columnName;
    }
    return toSnakeCase(propName);
};

/**
 * Every key property, in declaration order: one lowered from a `.primaryKey()`
 * column, or a legacy one carrying a truthy `isId`. A relation property is
 * never one — the column it may have absorbed is a foreign key, not a key.
 */
const idPropertyEntries = (collection: CollectionConfig): [string, Property][] =>
    Object.entries(collection.properties ?? {}).filter(
        ([, prop]) => {
            if (!prop || typeof prop !== "object") return false;
            const definition = prop.type === "relation" ? undefined : tableColumnOf(prop);
            if (definition) return definition.primaryKey;
            return "isId" in prop && Boolean((prop as { isId?: unknown }).isId);
        }
    ) as [string, Property][];

/**
 * A collection's primary key, by both of its names.
 *
 * `name` is the property key — what the generated Drizzle table is keyed by,
 * so it is what a relation's `references` names. `column` is the SQL
 * identifier, so it is what a foreign key's `REFERENCES` names. They differ
 * whenever the key is camelCase or carries a `columnName` (`authorId` is
 * `author_id`, and every table `rebase schema introspect` adopts is spelled
 * that way), and a constraint written with the key named a column that does
 * not exist: `db push` could not build its desired state, and boot failed the
 * constraint on every start.
 */
export interface PrimaryKey {
    /** Property key: the Drizzle object key and the JSON field. */
    name: string;
    /** SQL column. */
    column: string;
    /** The declaring property; absent for the implicit `id TEXT` of a collection that declares none. */
    prop?: Property;
}

/**
 * The one column a link into this collection points at.
 *
 * A foreign key column references a single column, and Postgres only accepts
 * that column when it is unique on its own — `REFERENCES t (a)` against a
 * composite key `(a, b)` fails with "there is no unique constraint matching
 * given keys for referenced table". So a link into a collection whose key
 * spans several columns has no column to point at, and it is refused here,
 * naming the link, rather than emitted as a constraint `db push` or boot would
 * then fail to create.
 *
 * @param via the link that needs the column, for the refusal: `relation "posts.author"`.
 */
export const getPrimaryKeyProp = (collection: CollectionConfig, via: string): PrimaryKey => {
    const ids = idPropertyEntries(collection);
    if (ids.length > 1) {
        throw new Error(
            `${via} points at collection "${collection.slug ?? collection.name ?? "(unnamed)"}", whose primary ` +
            `key spans ${ids.length} columns (${ids.map(([name]) => `"${name}"`).join(", ")}). A foreign key is ` +
            "one column and cannot reference a composite key. Point the link at a collection with a " +
            "single-column key, or reach these rows with a `via` relation, whose `joinPath` compares every " +
            "key column."
        );
    }
    const idPropEntry = ids[0];
    if (idPropEntry) {
        const [name, prop] = idPropEntry;
        return { name, column: resolveColumnName(name, prop), prop };
    }
    // Fallback: a collection that declares no `isId` gets an implicit `id`.
    const idProp = collection.properties?.["id"] as Property | undefined;
    return { name: "id", column: resolveColumnName("id", idProp), prop: idProp };
};

export const isIdProperty = (propName: string, prop: Property, collection: CollectionConfig): boolean => {
    const definition = prop.type === "relation" ? undefined : tableColumnOf(prop);
    if (definition) return definition.primaryKey;
    if ("isId" in prop && Boolean(prop.isId)) return true;

    // Only fall back to "id" when NO property is explicitly marked.
    return idPropertyEntries(collection).length === 0 && propName === "id";
};

/**
 * The labels an `enum` declares, in order, whichever form it was written in.
 *
 * `EnumValues` is `EnumValueConfig[] | Record<id, label>` and the docs recommend
 * the record. Boot-ensure read only the array form — `(p.enum as unknown[]).map`
 * — so a record-form enum threw `p.enum.map is not a function` on a managed
 * tenant, at boot, with no developer in the loop. The other two emitters each
 * carried their own copy of the both-forms walk.
 *
 * An empty list throws rather than returning `[]`. `CREATE TYPE … AS ENUM ()`
 * is not valid SQL, so every emitter "handled" it by skipping the type and then
 * typing the column with it anyway: Drizzle referenced an enum variable it never
 * declared (the generated file does not compile), the DDL named a type nothing
 * creates, and boot-ensure's `ADD COLUMN` failed — and add-column is not a
 * survivable action, so the boot died. There is no useful column at the end of
 * any of those paths.
 */
export const enumLabelsOf = (propName: string, prop: Property, collection: CollectionConfig): string[] => {
    const values = (prop as { enum?: unknown }).enum;
    if (values === undefined || values === null) return [];

    const labels = Array.isArray(values)
        ? values.map((entry: unknown) =>
            String(entry !== null && typeof entry === "object" && "id" in (entry as Record<string, unknown>)
                ? (entry as Record<string, unknown>).id
                : entry))
        : Object.keys(values as Record<string, unknown>).map(String);

    const usable = labels.filter(label => label.length > 0);
    if (usable.length === 0) {
        throw new Error(
            `Property "${propName}" of collection "${collection.slug ?? collection.name ?? "(unnamed)"}" ` +
            "declares an empty `enum`. A Postgres enum type needs at least one label — " +
            "`CREATE TYPE … AS ENUM ()` is not valid SQL — so the column would reference a type " +
            "nothing creates. List the values, or drop the `enum` for a plain column."
        );
    }
    return usable;
};
