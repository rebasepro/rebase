import { PgTable, AnyPgColumn, getTableConfig } from "drizzle-orm/pg-core";
import { and, eq, getTableColumns, type SQL } from "drizzle-orm";
import { CollectionConfig, ResolvedHasMany, ResolvedHasOne } from "@rebasepro/types";
import { PostgresTableRegistry } from "../model/PostgresTableRegistry";
import type { RuntimeTable } from "../model/runtime-table";
import { fieldKeyForColumn, getTableName, keyAddressInfoOf } from "@rebasepro/common";
import { ApiError } from "@rebasepro/server";

// Row identity is derived on both sides of the wire — the driver parses an
// incoming address into key columns, the admin derives one from a served row —
// so the implementation lives in `common` and both agree by construction.
export { buildCompositeId, parseIdValues, isAddressableId, COMPOSITE_ID_SEPARATOR } from "@rebasepro/common";
export type { PrimaryKeyInfo } from "@rebasepro/common";
import { buildCompositeId, COMPOSITE_ID_SEPARATOR, isAddressableId, parseIdValues } from "@rebasepro/common";
import type { PrimaryKeyInfo } from "@rebasepro/common";

/**
 * Shared helper functions for row operations.
 * These are used by FetchService, PersistService, and RelationService.
 *
 * All functions that need collection/table lookups require an explicit
 * `PostgresTableRegistry` instance — there is no global singleton.
 */

/**
 * Interface for Drizzle column metadata introspection.
 * Replaces unsafe `as Record<string, unknown>` double-cast chains.
 */
export interface DrizzleColumnMeta {
    columnType?: string;
    dataType?: string;
    primary?: boolean;
}

/** Safely extract Drizzle column metadata from a column object. */
export function getColumnMeta(col: AnyPgColumn): DrizzleColumnMeta {
    // `columnType`, `dataType` and `primary` are declared members of drizzle's
    // `Column`, so there is nothing to convert. The `typeof` checks stay: this
    // is called on columns from runtime-introspected tables as well as declared
    // ones, and the generic parameters those carry are not always resolved.
    return {
        columnType: typeof col.columnType === "string" ? col.columnType : undefined,
        dataType: typeof col.dataType === "string" ? col.dataType : undefined,
        primary: typeof col.primary === "boolean" ? col.primary : undefined
    };
}

/**
 * Whether an address could name a row in this table, judged by the columns.
 *
 * The descriptor's key type is the declaration — right for deriving
 * addresses, a claim when it comes to refusing a query. Here the Drizzle
 * column type decides, because it is what Postgres will enforce: a `uuid` column meets `/c/products/new` with
 * `22P02`, which aborts the surrounding transaction and turns every later
 * statement into an unrelated-looking `25P02`.
 */
export function idCanAddressTable(
    id: string | number,
    table: PgTable,
    idInfoArray: PrimaryKeyInfo[]
): boolean {
    const columnBacked = idInfoArray.map(info => {
        const col = table[info.fieldName as keyof typeof table] as AnyPgColumn | undefined;
        const meta = col ? getColumnMeta(col) : undefined;
        // No column to ask (a key the schema does not carry) leaves the id
        // addressable: refusing on a guess would 404 rows that do exist.
        if (!meta?.columnType) return info;
        return { ...info,
            isUUID: meta.columnType === "PgUUID" };
    });
    return isAddressableId(id, columnBacked);
}

/**
 * The condition that names one row: every key column equal to its part of the
 * address.
 *
 * Every key column, not the first. A composite-key read that matched only the
 * leading column answered `p1:::bob` with whichever `p1` row Postgres reached
 * first, and a delete then judged that row's `beforeDelete` while deleting bob —
 * the writes have always matched the whole key, so the reads must too.
 */
export function rowIdentityCondition(
    table: PgTable,
    idInfoArray: PrimaryKeyInfo[],
    id: string | number,
    collectionPath: string
): SQL {
    // Throws on a collection with no key: no condition at all is a WHERE that
    // matches every row, which is the opposite of naming one.
    const columns = primaryKeyColumns(table, idInfoArray, collectionPath);
    const parsed = parseIdValues(id, idInfoArray);
    const conditions = columns.map((column, i) => eq(column, parsed[idInfoArray[i].fieldName]));
    return conditions.length === 1 ? conditions[0] : and(...conditions) as SQL;
}

/**
 * The columns of a table's composite primary-key constraint, or `[]`.
 *
 * Fails open for anything that is not a real Drizzle table — a test double, a
 * hand-built registry entry — because "no key" is a legitimate answer here and
 * throwing would take out every caller that only wanted to ask.
 */
function compositePrimaryKeyColumns(table: PgTable): AnyPgColumn[] {
    try {
        const config = getTableConfig(table);
        return (config.primaryKeys?.[0]?.columns ?? []) as AnyPgColumn[];
    } catch {
        return [];
    }
}

/**
 * The Drizzle key a column is registered under, falling back to its name.
 *
 * Matched on the SQL name, which is unique within a table, as well as on object
 * identity: the columns a `primaryKey({ columns })` constraint holds are the
 * copies drizzle builds for a table's extra config, never the objects
 * `getTableColumns` returns, so identity alone never finds them. The fallback
 * is not the field either on a table keyed by wire name — `payment_id` is
 * served as `paymentId` — and a key resolved to a field the table does not
 * have is a key no read or write can build a condition on.
 */
function columnFieldName(table: PgTable, column: AnyPgColumn): string {
    for (const [key, candidate] of Object.entries(getTableColumns(table))) {
        if (candidate === column || candidate.name === column.name) return key;
    }
    return column.name;
}

export function getCollectionByPath(collectionPath: string, registry: PostgresTableRegistry): CollectionConfig {
    const collection = registry.getCollectionByPath(collectionPath);
    if (!collection) {
        const registered = registry.getCollections().map(c => c.slug).join(", ");
        throw new Error(`Collection not found: ${collectionPath}. Registered collections: [${registered}]`);
    }
    return collection;
}

/**
 * Reject a write naming something that is not a column of the table.
 *
 * "The table" is the one read back from `information_schema` at boot — see
 * `catalogue-schema.ts` — so this asks the database, not a file. It used to ask
 * the generated module, which made the commonest cause of this error a stale
 * `schema.generated.ts`: a property added to a collection was created in the
 * database by boot-ensure and still answered `400` on its first save, because
 * the module had not been regenerated. That cause no longer exists, and the
 * remedy below no longer names it.
 *
 * Drizzle builds INSERT from `Object.entries(table[Symbol.Columns])` and UPDATE
 * from `Object.keys(tableColumns)`, so a key the table does not carry is not
 * rejected by anything — it is *left out of the statement*. The insert answers
 * 201 having stored nothing under that name; the update, if the key was the
 * only one, builds `update "posts" set  where …` and Postgres raises a syntax
 * error (SQLSTATE 42601), which is neither class 22 nor 23 and so surfaces as a
 * 500 for what is a caller's typo.
 *
 * That makes this the last honest place to check, and the only one every write
 * passes through. `assertKnownWriteFields` in the REST layer checks the same
 * thing against the *config* and is skipped on four paths — `strictWrites:
 * false`, a collection declaring no properties, an auth adapter that owns the
 * body's shape, and a nested route whose target cannot be walked — and it never
 * sees an in-process `rebase.dataAsAdmin` write at all.
 *
 * It also gives `strictWrites: false` a truthful implementation. The flag is
 * documented for "a column that really does exist which the config never
 * declared", and skipping the config check alone could not deliver that: the
 * value was dropped a layer later regardless. Skipping the config check and
 * keeping this one does exactly what the flag says — the column must exist,
 * the property need not.
 */
export function assertWritableColumns(
    values: Record<string, unknown>,
    table: PgTable,
    collectionPath: string
): void {
    // Only a real Drizzle table carries a column list. A stand-in that does not
    // (a test double, a registry entry built by hand) has nothing to check
    // against, and inventing an answer from its own keys would reject writes
    // over the shape of the double rather than the shape of the table.
    const columns = getTableColumns(table) as Record<string, unknown> | undefined;
    if (!columns || Object.keys(columns).length === 0) return;

    // A column the database computes (`GENERATED ALWAYS AS … STORED`) is never
    // in a statement's column list: Postgres refuses any value but DEFAULT, and
    // an INSERT would leave it out without a word while an UPDATE failed.
    // Refused here for every caller, the trusted plane included, the way the
    // search column is (it is never a field at all).
    const generated = Object.keys(values).filter(key => {
        const column = columns[key];
        return typeof column === "object" && column !== null && "generated" in column
            && typeof column.generated === "object" && column.generated !== null
            && "type" in column.generated && column.generated.type === "always";
    });
    if (generated.length > 0) {
        throw ApiError.badRequest(
            `'${collectionPath}' computes ${generated.map(key => `'${key}'`).join(", ")} itself ` +
            "(a generated column), so a write cannot set " + (generated.length > 1 ? "them" : "it") +
            ". Leave " + (generated.length > 1 ? "them" : "it") + " out of the values.",
            "FIELD_NOT_WRITABLE"
        );
    }

    const unknown = Object.keys(values).filter(key => !(key in columns));
    if (unknown.length === 0) return;

    // One key is worth naming precisely: the *column* of a field whose wire name
    // differs from it. A table is keyed by the wire name — `authorId` for
    // `author_id` — so writing the column reaches here as "no such column",
    // which is the least helpful true statement available about it. Says the
    // name to use instead.
    const byColumnName = new Map<string, string>();
    for (const [key, column] of Object.entries(columns)) {
        const name = (column as { name?: unknown } | undefined)?.name;
        if (typeof name === "string" && name !== key) byColumnName.set(name, key);
    }
    const misspelled = unknown.filter(key => byColumnName.has(key));
    if (misspelled.length === unknown.length) {
        throw ApiError.badRequest(
            `'${collectionPath}' has no field ${misspelled.map(key => `'${key}'`).join(", ")} — ` +
            `${misspelled.length > 1 ? "those are column names" : "that is a column name"}. ` +
            `Write ${misspelled.map(key => `'${byColumnName.get(key)}'`).join(", ")} instead: a field is ` +
            "addressed by its property key, and the column behind it is an implementation detail.",
            "VALIDATION_UNKNOWN_FIELDS"
        );
    }

    // The offending keys, and deliberately not the list of real ones: this
    // error is reachable on paths where the REST field check was skipped, and
    // an `excludeFromApi` column is documented to never be served to a
    // caller. Naming what was sent is the actionable half anyway.
    //
    // The remedy names the schema, not the schema *file*: the columns here were
    // read from the database this request is about to write to, so a key that is
    // not among them is a key no column exists for — either a typo, or a
    // property whose column was never created because nothing has applied the
    // collection schema to this database yet.
    throw ApiError.badRequest(
        `'${collectionPath}' has no column${unknown.length > 1 ? "s" : ""} ` +
        `${unknown.map(key => `'${key}'`).join(", ")}, so the value${unknown.length > 1 ? "s" : ""} ` +
        "would have been dropped before the statement was built. " +
        "If you just added the propert" + (unknown.length > 1 ? "ies" : "y") +
        ", the database does not have the column yet: apply the schema " +
        "(`rebase db push`, or redeploy so boot creates it).",
        "VALIDATION_UNKNOWN_FIELDS"
    );
}

/**
 * A relation whose names do not resolve against the registered schema.
 *
 * Every one of these used to be a `logger.warn` followed by `continue`, so a
 * save reported success for a relation it had not written and a read answered
 * `[]` for one it could not resolve. `assertRelationsResolve` (validate-relations)
 * fails boot on the same defects, which is where they belong — a server that
 * refuses to start is recoverable in a minute. This is the second line, for the
 * paths that assemble a registry by hand, and it exists so that "cannot resolve"
 * is never again reported as "done".
 *
 * @param label  `<collection>.<relation>`
 * @param detail what does not resolve, in terms of the schema
 */
export function relationMisconfigured(label: string, detail: string): ApiError {
    return ApiError.internal(
        `Relation '${label}' does not resolve against the registered schema: ${detail}. ` +
        "The operation was refused rather than skipped — silently dropping it would report " +
        "success for a write that never happened, or emptiness for rows that exist. Run " +
        "`rebase schema generate` if the generated schema is older than the database.",
        "RELATION_MISCONFIGURED"
    );
}

export function getTableForCollection(collection: CollectionConfig, registry: PostgresTableRegistry): PgTable<any> {
    const tableName = getTableName(collection);
    const table = registry.getPgTable(tableName);
    if (!table) {
        throw new Error(`Table not found for '${collection.slug}' (table: ${tableName})`);
    }
    return table;
}

/**
 * The key columns a table's rows are addressed by, in key order, in the shape
 * the address helpers read (`buildCompositeId`, `parseIdValues`).
 *
 * The descriptor's answer (`RuntimeTable.keys`, from `.primaryKey()` and the
 * column types): a compiled table always states its key, so nothing is
 * inferred — the declared `isId` tier always won over the catalogue, and the
 * declaration still does. The catalogue is consulted where it is the truth:
 * {@link idCanAddressTable} judges an address against the column Postgres
 * will compare it with.
 *
 * Only a table introspected from a database whose table declares no primary
 * key has no keys in its descriptor. Its address is then read from the
 * catalogue as it always was: the columns marked primary, the columns of a
 * composite constraint, or a column literally named `id`. Returns `[]` when
 * none of those exists — "this table has no address", which a caller that
 * needs one turns into its own error ({@link requireTableKeys}).
 *
 * @param pg The catalogue table a keyless table's address is read from; the
 *   runtime table's own by default.
 */
export function tableKeys(table: RuntimeTable, pg: PgTable | undefined = table.pg): PrimaryKeyInfo[] {
    if (table.keys.length > 0) return table.keys.map(keyAddressInfoOf);
    return pg ? catalogueKeys(pg) : [];
}

/**
 * The key columns of the table a lowered collection was lowered from: the
 * lookup for a call site that still holds the collection. Reads the runtime
 * table ({@link tableKeys}); throws when the driver serves no table of that
 * slug.
 */
export function getPrimaryKeys(collection: CollectionConfig, registry: PostgresTableRegistry): PrimaryKeyInfo[] {
    const table = registry.requireTable(collection.slug);
    return tableKeys(table, registry.getPgTable(table.descriptor.table) ?? table.pg);
}

/** One catalogue column as a key part: what its drizzle type says the value is. */
function keyInfoOfColumn(fieldName: string, column: AnyPgColumn): PrimaryKeyInfo {
    const meta = getColumnMeta(column);
    const info: PrimaryKeyInfo = {
        fieldName,
        type: column.dataType === "number" || meta.columnType === "PgSerial" || meta.columnType === "PgInteger" ? "number" : "string",
        isUUID: meta.columnType === "PgUUID"
    };
    if (meta.columnType === "PgDateString" || meta.columnType === "PgDate") info.isDay = true;
    return info;
}

/**
 * The key of a catalogue table whose descriptor states none: an introspected
 * keyless table. The columns marked primary, else the columns of a composite
 * primary-key constraint, else a column named `id`.
 */
function catalogueKeys(table: PgTable): PrimaryKeyInfo[] {
    const keys: PrimaryKeyInfo[] = [];
    for (const [key, column] of Object.entries(getTableColumns(table))) {
        if (column.primary) keys.push(keyInfoOfColumn(key, column));
    }
    if (keys.length === 0) {
        for (const column of compositePrimaryKeyColumns(table)) keys.push(keyInfoOfColumn(columnFieldName(table, column), column));
    }
    if (keys.length === 0) {
        const id = columnAtKey(table, "id");
        if (id) keys.push(keyInfoOfColumn("id", id));
    }
    return keys;
}

/**
 * The key columns, for callers that cannot do their job without one: throws,
 * naming the table, when it has none.
 */
export function requireTableKeys(table: RuntimeTable, pg: PgTable | undefined = table.pg): PrimaryKeyInfo[] {
    const keys = tableKeys(table, pg);
    if (keys.length === 0) {
        throw new Error(
            `The table '${table.slug}' has no primary key, so its rows cannot be addressed. ` +
            "Declare one with `.primaryKey()`; a table introspected from the database needs a primary key there."
        );
    }
    return keys;
}

/**
 * {@link requireTableKeys} for a call site that still holds the lowered
 * collection.
 *
 * {@link getPrimaryKeys} answers "what keys, if any" and returns `[]` for a
 * table with no address. Most of this driver, though, is building a WHERE
 * clause and has no meaning without a key — for those, an empty array is not an
 * answer, and indexing `[0]` into it produces `Cannot read properties of
 * undefined` three frames from where the real problem is. This says what is
 * wrong and which collection it is wrong about.
 */
export function requirePrimaryKeys(collection: CollectionConfig, registry: PostgresTableRegistry): PrimaryKeyInfo[] {
    const table = registry.requireTable(collection.slug);
    return requireTableKeys(table, registry.getPgTable(table.descriptor.table) ?? table.pg);
}

/**
 * The table's key columns, in key order.
 *
 * Throws when there are none, or when the table has no column for one of them:
 * a WHERE built from fewer columns than the key matches every row that shares
 * the columns it did find, so there is no partial answer worth returning.
 *
 * @param collectionPath named in the error.
 */
export function primaryKeyColumns(
    table: PgTable,
    primaryKeys: PrimaryKeyInfo[],
    collectionPath: string
): AnyPgColumn[] {
    if (primaryKeys.length === 0) {
        throw new Error(`The table '${collectionPath}' has no primary key, so its rows cannot be addressed.`);
    }
    return primaryKeys.map(info => {
        const column = table[info.fieldName as keyof typeof table] as AnyPgColumn | undefined;
        if (!column) {
            throw new Error(`ID field '${info.fieldName}' not found in table '${collectionPath}'`);
        }
        return column;
    });
}

/**
 * The column a table holds under the property key `key`, or `undefined`.
 *
 * A Drizzle table is an object whose own properties are its columns — and
 * also everything any object answers to. `key in table` is true of
 * `constructor`, `toString` and `hasOwnProperty`, inherited from the
 * prototype, and of `enableRLS`, a method Drizzle sets on the table itself;
 * reading one of those as a column put a function into the statement as a
 * bound parameter. A filter on `constructor` then compiled to a comparison
 * between two parameters — "a filter that names nothing" without the 400 —
 * and `__proto__` crashed the builder into a 500. Only an own, object-valued
 * property is a column.
 */
export function columnAtKey(table: PgTable<any>, key: string): AnyPgColumn | undefined {
    if (!Object.prototype.hasOwnProperty.call(table, key)) return undefined;
    const value: unknown = table[key as keyof typeof table];
    return typeof value === "object" && value !== null ? value as AnyPgColumn : undefined;
}

/**
 * The column a `joinPath` step names, on a table that may key it either way.
 *
 * A `JoinStep` is written in database terms — `on: { from: "author_id" }` —
 * because there is no collection to translate through: the step names a raw
 * table. A table the boot reads back out of the catalogue is keyed by the
 * *wire* name, `authorId`, while a hand-written Drizzle schema may key it by
 * the column name. Looking the step's name up as a key therefore found
 * nothing on every booted table, and a `via` relation loaded nothing at all.
 *
 * The key first, as the step may already name one; then the column whose SQL
 * name it is. `undefined` when the table has neither, which the caller turns
 * into an error naming the step.
 */
export function columnNamed(table: PgTable, name: string): AnyPgColumn | undefined {
    const columns: Record<string, AnyPgColumn> | undefined = getTableColumns(table);
    if (!columns) {
        // A stand-in without Drizzle's column map — a test double. Its keys
        // are all there is to go by.
        return (table[name as keyof typeof table] as AnyPgColumn | undefined) || undefined;
    }
    if (Object.prototype.hasOwnProperty.call(columns, name)) return columns[name];
    return Object.values(columns).find(column => column.name === name);
}

/**
 * The column on the *source* table that a `hasOne`/`hasMany` link points at.
 *
 * `sourceKey` is authored when the two sides join on a natural key — an
 * external identity id, a SKU — and left off when they join on the row id,
 * which is the overwhelming majority. That makes `undefined` the only optional
 * field on a resolved relation, so it gets exactly one reader: this function.
 * Every consumer that needs the column asks here, and none of them re-derives
 * "or else the primary key" for itself. That is the whole point — the fallback
 * chains this codebase removed from relation resolution were dangerous because
 * they were *duplicated* and could disagree, not because they existed.
 */
export function sourceKeyField(
    relation: ResolvedHasOne | ResolvedHasMany,
    sourceCollection: CollectionConfig,
    registry: PostgresTableRegistry
): string {
    // A **field**, as the name says: callers index the Drizzle table and the
    // rows it returns with what comes back from here, and both are keyed by the
    // wire name. `sourceKey` is authored in *column* terms, like every other
    // link on a relation, so it is translated here rather than at each of the
    // call sites — where it used to be `tenant_id` looked up on a table whose
    // key is `tenantId`, finding nothing.
    if (relation.sourceKey) return fieldKeyForColumn(sourceCollection, relation.sourceKey);
    return requirePrimaryKeys(sourceCollection, registry)[0].fieldName;
}

/**
 * Whether this link joins on something other than the source's primary key.
 *
 * Callers that hold a parent *id* — which is most of them, since an id is what
 * a URL carries — must translate it to the source key's value before it can be
 * compared with the target's foreign key. Those that hold the parent *row*, or
 * that build a correlated subquery over the source table, can read the column
 * directly and skip the lookup.
 */
export function joinsOnNaturalKey(
    relation: ResolvedHasOne | ResolvedHasMany,
    sourceCollection: CollectionConfig,
    registry: PostgresTableRegistry
): boolean {
    if (!relation.sourceKey) return false;
    // Compared as fields, because the right-hand side is one.
    return fieldKeyForColumn(sourceCollection, relation.sourceKey)
        !== requirePrimaryKeys(sourceCollection, registry)[0].fieldName;
}

/**
 * The address of a row: derived from the collection's primary keys, because a
 * row does not carry one — it is exactly its columns.
 *
 * Falls back to a literal `id` column, for a row that reached us from somewhere
 * other than this driver. Returns `""` when there is no key and no `id` —
 * callers decide what that means, since "unaddressable" is a different answer
 * in a notification (broadcast a wildcard) than in a save (fail).
 */
export function deriveRowAddress(
    row: Record<string, unknown>,
    collection: CollectionConfig,
    registry: PostgresTableRegistry,
    /** The collection's keys, when the caller already has them — a batch derives one address per row. */
    primaryKeys: PrimaryKeyInfo[] = getPrimaryKeys(collection, registry)
): string {
    const composite = buildCompositeId(row, primaryKeys);
    // An all-empty composite is indistinguishable from a missing key, and
    // `buildCompositeId` returns "" for no keys at all.
    if (composite && composite.split(COMPOSITE_ID_SEPARATOR).some(part => part !== "")) {
        return composite;
    }
    if (row.id !== undefined && row.id !== null) return String(row.id);
    return "";
}

