/**
 * The facts about a property that every emitter has to read the same way.
 *
 * Three modules compile a `Property` into a column — the Drizzle generator
 * (`schema.generated.ts`), the DDL generator (`schema.sql`, what `db push`
 * applies) and the boot-time ensure (what a managed tenant gets, where no `db
 * push` ever runs). They must produce the same database from the same
 * collection, and for a long time each carried its own copy of "what is the
 * primary key", "what is this column called", "what does an id default to" and
 * "what labels does this enum have". Verbatim copies, until one of them was
 * edited: the audit that produced this module counted twelve open
 * disagreements and found that a third of the commits touching those files were
 * re-synchronisations.
 *
 * So the questions live here, once, and the emitters render the answers. A
 * disagreement now needs someone to write a second copy of a rule on purpose.
 *
 * Everything here is pure and synchronous, and it throws rather than guesses:
 * an enum with no values, a `cuid` id on Postgres and a second `isId` are all
 * configurations that produce a broken database in silence, so they are refused
 * where every path passes.
 */
import type {
    CollectionConfig,
    NumberProperty,
    Property,
    StringProperty
} from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

/**
 * Resolve the SQL column name for a property.
 *
 * Uses the explicit `columnName` when set (e.g. from introspection), falling
 * back to `toSnakeCase(propName)` for manually-authored collections.
 */
export const resolveColumnName = (propName: string, prop?: Property | null): string => {
    if (prop && "columnName" in prop && typeof prop.columnName === "string") {
        return prop.columnName;
    }
    return toSnakeCase(propName);
};

/** Every property that carries a truthy `isId`, in declaration order. */
const idPropertyEntries = (collection: CollectionConfig): [string, Property][] =>
    Object.entries(collection.properties ?? {}).filter(
        ([, prop]) => prop && typeof prop === "object" && "isId" in prop && Boolean((prop as { isId?: unknown }).isId)
    ) as [string, Property][];

/**
 * Refuse a collection that declares two primary keys.
 *
 * Postgres allows a composite primary key; Rebase does not model one, and the
 * three emitters each invented a different wrong answer for it. The Drizzle
 * generator appended `.primaryKey()` to both columns (two primary keys, which
 * drizzle-kit turns into an error at push time), the DDL generator wrote two
 * inline `PRIMARY KEY` clauses in one `CREATE TABLE` (Postgres: "multiple
 * primary keys for table are not allowed"), and boot-ensure created the table
 * with the *first* id column and silently never added the second — so a managed
 * tenant got a table missing a column its own collection reads.
 *
 * None of those is recoverable at runtime, and two of them fail long after the
 * config was written. Refused here instead, where the collection has a name.
 */
export const assertSinglePrimaryKey = (collection: CollectionConfig): void => {
    const ids = idPropertyEntries(collection);
    if (ids.length < 2) return;
    throw new Error(
        `Collection "${collection.slug ?? collection.name ?? "(unnamed)"}" marks ${ids.length} properties ` +
        `with \`isId\` (${ids.map(([name]) => `"${name}"`).join(", ")}). ` +
        "Composite primary keys are not supported: give exactly one property `isId`, and express the " +
        "second key with `indexes: [{ on: [...], unique: true, reason: \"…\" }]`."
    );
};

export const getPrimaryKeyProp = (collection: CollectionConfig): { name: string, type: "string" | "number", isUuid: boolean } => {
    if (collection.properties) {
        const idPropEntry = idPropertyEntries(collection)[0];
        if (idPropEntry) {
            const prop = idPropEntry[1];
            const isUuid = prop.type === "string" && "isId" in prop && (prop as unknown as StringProperty).isId === "uuid";
            return { name: idPropEntry[0], type: prop.type === "number" ? "number" : "string", isUuid };
        }
    }
    // Fallback: a collection that declares no `isId` gets an implicit `id`.
    const idProp = collection.properties?.["id"] as unknown as Property | undefined;
    if (idProp?.type === "number") {
        return { name: "id", type: "number", isUuid: false };
    }
    const isUuid = idProp?.type === "string" && "isId" in idProp && (idProp as unknown as StringProperty).isId === "uuid";
    return { name: "id", type: "string", isUuid: isUuid ?? false };
};

export const isNumericId = (collection: CollectionConfig): boolean =>
    getPrimaryKeyProp(collection).type === "number";

export const getPrimaryKeyName = (collection: CollectionConfig): string =>
    getPrimaryKeyProp(collection).name;

/**
 * The Postgres type a column pointing at this collection's primary key must
 * have — a junction endpoint, a `belongsTo` foreign key, a `reference`.
 *
 * One function because it was three: the junction key type was derived inline
 * in `generatePostgresDdl`, again in `planJunctionTables` and a third time in
 * the Drizzle generator, each spelling the same `number → INTEGER, uuid → UUID,
 * else TEXT` ladder.
 */
export const primaryKeyColumnType = (collection: CollectionConfig): "INTEGER" | "UUID" | "TEXT" => {
    const pk = getPrimaryKeyProp(collection);
    if (pk.type === "number") return "INTEGER";
    return pk.isUuid ? "UUID" : "TEXT";
};

/** The Drizzle builder for {@link primaryKeyColumnType}. */
export const primaryKeyColumnBuilder = (collection: CollectionConfig): "integer" | "uuid" | "text" => {
    switch (primaryKeyColumnType(collection)) {
        case "INTEGER": return "integer";
        case "UUID": return "uuid";
        default: return "text";
    }
};

export const isIdProperty = (propName: string, prop: Property, collection: CollectionConfig): boolean => {
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

/**
 * Does this property compile to a Postgres enum *type*?
 *
 * Strings only. A `number` property with an `enum` used to create a type on all
 * three paths and then declare the column `NUMERIC`/`INTEGER`, so the type was
 * orphaned the moment it was created and the values it listed were enforced by
 * nothing. The dropdown in the panel is driven by the config, not the column, so
 * nothing is lost by not creating it — and a type no column uses is one more
 * object `db push` has to plan a DROP for.
 */
export const declaresEnumType = (prop: Property): boolean =>
    prop.type === "string" && Boolean((prop as StringProperty).enum);

/**
 * The `DEFAULT` an id column carries, as the thing itself rather than a
 * rendered string — each emitter spells it differently.
 *
 * The three of them disagreed on all four strategies. The DDL generator wrote
 * `DEFAULT ${prop.isId}` verbatim, so the documented `` isId: "sql`gen_id()`" ``
 * reached Postgres with the template wrapper still on it — a syntax error in
 * `schema.sql`. Boot-ensure gave a default to `uuid` and to nothing else, so on
 * a managed tenant every other strategy produced a column with no default at
 * all, and the first insert that trusted the config failed on a NULL primary
 * key. Only the Drizzle generator stripped the wrapper.
 */
export type IdColumnDefault =
    /** `gen_random_uuid()` / `.defaultRandom()`. */
    | { kind: "uuid" }
    /** `GENERATED BY DEFAULT AS IDENTITY` / `.generatedByDefaultAsIdentity()` — part of the type, not a DEFAULT. */
    | { kind: "identity" }
    /** A raw SQL expression, wrapper already stripped. */
    | { kind: "sql"; expression: string };

/**
 * Refuses `isId: "cuid"`.
 *
 * `DEFAULT cuid()` has been emitted since the option existed and no `cuid()`
 * function has ever been created — not by the generators, not by boot, not by
 * any migration. So the column has never had a working default on Postgres: the
 * first insert that relied on it failed with `function cuid() does not exist`.
 * There is nothing to keep compatible.
 *
 * It is refused rather than implemented. Shipping a real `rebase.cuid()` means a
 * new SQL function in the same carved-out class as the search helpers — excluded
 * from Atlas by pattern, applied by boot, re-applied by push, checked by the
 * doctor, and versioned across the fleet forever — to reproduce a monotonic id
 * that `uuid` already provides and that a project wanting cuid's exact shape can
 * write itself in one line of SQL.
 */
export const idColumnDefault = (propName: string, prop: Property, collection: CollectionConfig): IdColumnDefault | undefined => {
    if (!("isId" in prop)) return undefined;
    const isId = (prop as { isId?: unknown }).isId;
    // `true` and `"manual"` both mean "the application supplies it".
    if (isId === undefined || isId === null || isId === true || isId === "manual" || isId === false) return undefined;
    if (typeof isId !== "string") return undefined;

    if (prop.type === "string" && (isId as StringProperty["isId"]) === "uuid") return { kind: "uuid" };
    if (prop.type === "number" && (isId as NumberProperty["isId"]) === "increment") return { kind: "identity" };

    if (isId === "cuid") {
        throw new Error(
            `Property "${propName}" of collection "${collection.slug ?? collection.name ?? "(unnamed)"}" ` +
            "uses `isId: \"cuid\"`, which Postgres cannot honour: the generated default calls a `cuid()` " +
            "function that Rebase has never created, so every insert relying on it fails. " +
            "Use `isId: \"uuid\"`, or give the strategy as SQL — ``isId: \"sql`my_id()`\"`` — and create that " +
            "function in a migration."
        );
    }

    // Any other string is a raw SQL default. Written either bare
    // (`gen_random_uuid()::text`) or in the documented template form
    // (``sql`gen_random_uuid()::text` ``); the wrapper is markup, not SQL.
    const expression = isId.startsWith("sql`") && isId.endsWith("`")
        ? isId.substring(4, isId.length - 1)
        : isId;
    return { kind: "sql", expression };
};

/**
 * The `DEFAULT …` clause an id column gets in SQL, or `""`.
 *
 * `identity` renders as nothing: it is part of the column type
 * (`INTEGER GENERATED BY DEFAULT AS IDENTITY`), which is where both SQL emitters
 * put it.
 */
export const idColumnDefaultSql = (propName: string, prop: Property, collection: CollectionConfig): string => {
    const value = idColumnDefault(propName, prop, collection);
    if (!value) return "";
    switch (value.kind) {
        case "uuid": return " DEFAULT gen_random_uuid()";
        case "identity": return "";
        case "sql": return ` DEFAULT ${value.expression}`;
    }
};
