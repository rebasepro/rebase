import { PgTable, AnyPgColumn } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";
import { CollectionConfig, Property, ResolvedHasMany, ResolvedHasOne } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { fieldKeyForColumn, getTableName } from "@rebasepro/common";
import { ApiError, logger } from "@rebasepro/server";

// Row identity is derived on both sides of the wire — the driver parses an
// incoming address into key columns, the admin derives one from a served row —
// so the implementation lives in `common` and both agree by construction.
export { buildCompositeId, parseIdValues, isAddressableId, COMPOSITE_ID_SEPARATOR } from "@rebasepro/common";
export type { PrimaryKeyInfo } from "@rebasepro/common";
import { buildCompositeId, COMPOSITE_ID_SEPARATOR, getDeclaredPrimaryKeys, isAddressableId } from "@rebasepro/common";
import type { PrimaryKeyInfo } from "@rebasepro/common";

/**
 * Shared helper functions for row operations.
 * These are used by FetchService, PersistService, and RelationService.
 *
 * All functions that need collection/table lookups require an explicit
 * `PostgresCollectionRegistry` instance — there is no global singleton.
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
    const raw = col as unknown as Record<string | symbol, unknown>;
    return {
        columnType: typeof raw.columnType === "string" ? raw.columnType : undefined,
        dataType: typeof raw.dataType === "string" ? raw.dataType : undefined,
        primary: typeof raw.primary === "boolean" ? raw.primary : undefined
    };
}

/**
 * Whether an address could name a row in this table, judged by the columns.
 *
 * {@link getPrimaryKeys} lets a config's `isId: "uuid"` win over the schema, so
 * its `isUUID` is a claim rather than a fact — right for deriving addresses,
 * wrong for refusing a query. Here the Drizzle column type decides, because it
 * is what Postgres will enforce: a `uuid` column meets `/c/products/new` with
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

export function getCollectionByPath(collectionPath: string, registry: PostgresCollectionRegistry): CollectionConfig {
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

    const unknown = Object.keys(values).filter(key => !(key in columns));
    if (unknown.length === 0) return;

    // The offending keys, and deliberately not the list of real ones: this
    // error is reachable on paths where the REST field check was skipped, and
    // an `excludeFromApi` column is documented as never being served to a
    // caller. Naming what was sent is the actionable half anyway.
    throw ApiError.badRequest(
        `'${collectionPath}' has no column${unknown.length > 1 ? "s" : ""} ` +
        `${unknown.map(key => `'${key}'`).join(", ")}, so the value${unknown.length > 1 ? "s" : ""} ` +
        "would have been dropped before the statement was built.",
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

export function getTableForCollection(collection: CollectionConfig, registry: PostgresCollectionRegistry): PgTable<any> {
    const tableName = getTableName(collection);
    const table = registry.getTable(tableName);
    if (!table) {
        throw new Error(`Table not found for collection '${collection.slug}' (table: ${tableName})`);
    }
    return table;
}

/**
 * The key columns a collection's rows are addressed by.
 *
 * Three tiers, in order: properties marked `isId`, the primary keys of the
 * drizzle schema, and finally a column literally named `id`. Only the first is
 * visible to the browser, which is why a key known only to drizzle is reported
 * at boot — see {@link warnOnKeysTheAdminCannotResolve}.
 *
 * Returns `[]` when nothing resolves, rather than throwing. It used to open by
 * resolving the table, which throws when there is none — so the `isId` tier,
 * which needs no table at all, was unreachable for exactly the collections
 * most likely to have no table registered. Every caller that wanted "no keys"
 * to mean "no keys" had to spell that out in a try/catch.
 *
 * Callers that cannot proceed without a key must say so themselves, naming the
 * collection: an empty array here means "this collection has no address", which
 * is a different answer in a notification (broadcast a wildcard) than in a save
 * (fail).
 */
export function getPrimaryKeys(collection: CollectionConfig, registry: PostgresCollectionRegistry): PrimaryKeyInfo[] {
    // Explicitly declared `isId` properties win, and need no table.
    if (collection.properties) {
        const idProps = Object.entries(collection.properties)
            .filter(([_, prop]) => "isId" in (prop as object) && Boolean((prop as { isId?: unknown }).isId))
            .map(([key, prop]) => ({
                fieldName: key,
                type: prop.type === "number" ? "number" as const : "string" as const,
                isUUID: (prop as { isId?: unknown }).isId === "uuid"
            }));

        if (idProps.length > 0) {
            return idProps;
        }
    }

    // The remaining tiers read the drizzle schema, so they need the table. A
    // collection without one — another engine's, or simply unregistered — has
    // nothing more to offer.
    const table = registry.getTable(getTableName(collection));
    if (!table) return [];

    // Otherwise infer from Drizzle schema
    const keys: PrimaryKeyInfo[] = [];
    for (const [key, colRaw] of Object.entries(table)) {
        const col = colRaw as AnyPgColumn;
        if (col && typeof col === "object" && "primary" in col && col.primary) {
            const meta = getColumnMeta(col);
            const type = col.dataType === "number" || meta.columnType === "PgSerial" || meta.columnType === "PgInteger" ? "number" : "string";
            const isUUID = meta.columnType === "PgUUID";
            keys.push({ fieldName: key,
type,
isUUID });
        }
    }

    // A collection that declares no primary key gets the implicit `id` column,
    // which is what the schema generators emit for it — so read it back the
    // same way rather than reporting the table as keyless.
    if (keys.length === 0 && "id" in table) {
        const idCol = table["id" as keyof typeof table] as AnyPgColumn;
        const idMeta = getColumnMeta(idCol);
        const type = idCol.dataType === "number" || idMeta.columnType === "PgSerial" || idMeta.columnType === "PgInteger" ? "number" : "string";
        const isUUID = idMeta.columnType === "PgUUID";
        keys.push({ fieldName: "id",
type,
isUUID });
    }

    return keys;
}

/**
 * The key columns, for callers that cannot do their job without one.
 *
 * {@link getPrimaryKeys} answers "what keys, if any" and returns `[]` for a
 * collection with no address. Most of this driver, though, is building a WHERE
 * clause and has no meaning without a key — for those, an empty array is not an
 * answer, and indexing `[0]` into it produces `Cannot read properties of
 * undefined` three frames from where the real problem is. This says what is
 * wrong and which collection it is wrong about.
 */
export function requirePrimaryKeys(collection: CollectionConfig, registry: PostgresCollectionRegistry): PrimaryKeyInfo[] {
    const keys = getPrimaryKeys(collection, registry);
    if (keys.length === 0) {
        throw new Error(
            `Collection '${collection.slug}' has no primary key, so its rows cannot be addressed. ` +
            `Mark the key property with \`isId\` in its config, or register a table whose schema declares one.`
        );
    }
    return keys;
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
    registry: PostgresCollectionRegistry
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
    registry: PostgresCollectionRegistry
): boolean {
    if (!relation.sourceKey) return false;
    // Compared as fields, because the right-hand side is one.
    return fieldKeyForColumn(sourceCollection, relation.sourceKey)
        !== requirePrimaryKeys(sourceCollection, registry)[0].fieldName;
}

/**
 * Collections whose key the *browser* cannot resolve, and what it will do
 * instead.
 *
 * The two sides resolve keys from different evidence. This driver reads, in
 * order: properties marked `isId`, the primary keys of the Drizzle schema, then
 * a column literally named `id`. The admin shares the `CollectionConfig` — it
 * compiles the same collection files into its bundle — but never the Drizzle
 * schema, so the middle tier is invisible to it.
 *
 * Nothing can normalize this at runtime: the server does not serve the admin
 * its collections, so a key resolved here cannot be handed over there. The
 * config files are the only thing both sides read, so the fix is an edit to
 * them, and the most this can do is say exactly which edit.
 *
 * Two shapes, and the second is the dangerous one:
 *
 * - No `isId`, no `id` property → the admin resolves no address, warns in the
 *   console, and rows cannot be opened or linked.
 * - No `isId`, but an `id` property that is *not* the key → the admin addresses
 *   rows by `id` while this driver reads the address as the real key. Nothing
 *   errors: the addresses look right and route wrong.
 */
export function findUnresolvableKeyCollections(
    collections: CollectionConfig[],
    registry: PostgresCollectionRegistry
): { collection: CollectionConfig; keys: PrimaryKeyInfo[]; shadowedByIdProperty: boolean }[] {
    const findings: { collection: CollectionConfig; keys: PrimaryKeyInfo[]; shadowedByIdProperty: boolean }[] = [];

    for (const collection of collections) {
        // Declared `isId` is the tier both sides share: if it is there, they agree.
        if (getDeclaredPrimaryKeys(collection).length > 0) continue;

        // No registered table resolves to no keys, and a collection this cannot
        // resolve a key for is one it has nothing to say about.
        const keys = getPrimaryKeys(collection, registry);
        if (keys.length === 0) continue;

        // A single key named `id` is the last tier on both sides: they agree
        // without anything being declared.
        if (keys.length === 1 && keys[0].fieldName === "id") continue;

        findings.push({
            collection,
            keys,
            shadowedByIdProperty: Boolean(collection.properties?.id)
        });
    }

    return findings;
}

/**
 * Report the collections from {@link findUnresolvableKeyCollections} at boot,
 * with the edit that fixes each one.
 *
 * Grouped by failure, not by collection: the shadowed case is a routing bug and
 * the silent case is a missing feature, and they deserve different urgency.
 */
export function warnOnKeysTheAdminCannotResolve(
    collections: CollectionConfig[],
    registry: PostgresCollectionRegistry
): void {
    const findings = findUnresolvableKeyCollections(collections, registry);
    if (findings.length === 0) return;

    const edit = (f: { collection: CollectionConfig; keys: PrimaryKeyInfo[] }) =>
        `${f.collection.slug}: mark ${f.keys.map(k => `\`${k.fieldName}\``).join(" and ")} with ` +
        `\`isId: ${f.keys[0].isUUID ? "\"uuid\"" : f.keys[0].type === "number" ? "\"increment\"" : "true"}\``;

    const shadowed = findings.filter(f => f.shadowedByIdProperty);
    const silent = findings.filter(f => !f.shadowedByIdProperty);

    if (shadowed.length > 0) {
        logger.warn(
            `⚠️ These collections declare no \`isId\`, and their key is only in the drizzle schema — but they ` +
            `do have a property called \`id\`. The admin has no way to know \`id\` is not the key, so it will ` +
            `address rows by it while this server reads the address as the real key: the links look right and ` +
            `route wrong. Nothing will error.\n\n` +
            shadowed.map(f => `  • ${edit(f)}`).join("\n") + "\n"
        );
    }

    if (silent.length > 0) {
        logger.warn(
            `⚠️ These collections declare no \`isId\`, and their key is only in the drizzle schema, which the ` +
            `admin never sees. It will resolve no address for their rows, so detail links, caching and ` +
            `relations will not work for them:\n\n` +
            silent.map(f => `  • ${edit(f)}`).join("\n") + "\n"
        );
    }
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
    registry: PostgresCollectionRegistry
): string {
    const composite = buildCompositeId(row, getPrimaryKeys(collection, registry));
    // An all-empty composite is indistinguishable from a missing key, and
    // `buildCompositeId` returns "" for no keys at all.
    if (composite && composite.split(COMPOSITE_ID_SEPARATOR).some(part => part !== "")) {
        return composite;
    }
    if (row.id !== undefined && row.id !== null) return String(row.id);
    return "";
}

