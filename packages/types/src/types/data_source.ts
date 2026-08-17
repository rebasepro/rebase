import { ALL_WHERE_FILTER_OPS, WhereFilterOp } from "./filter-operators";

/**
 * Describes the capabilities and features supported by a data source (driver).
 *
 * Each driver (Postgres, Firebase, MongoDB, etc.) declares which features it
 * supports. The admin uses this descriptor to:
 * - Show/hide editor tabs (e.g. Relations for SQL, Subcollections for Firebase)
 * - Filter the property type picker (e.g. `relation` for SQL, `reference` for Firebase)
 * - Toggle driver-specific form controls (e.g. `columnType` for SQL)
 *
 * @group Models
 */
export interface DataSourceCapabilities {
    /** Unique driver key (e.g. "postgres", "firestore", "mongodb") */
    key: string;

    /** Human-readable label for the UI (e.g. "PostgreSQL", "Firebase / Firestore") */
    label: string;

    // ── Feature flags ─────────────────────────────────────────────────
    /** Does this source support SQL-style relations (JOINs)? */
    supportsRelations: boolean;

    /** Does this source support nested subcollections? */
    supportsSubcollections: boolean;

    /** Does this source support Row Level Security policies? */
    supportsRLS: boolean;

    /** Does this source support document references (Firebase-style)? */
    supportsReferences: boolean;

    /** Does this source support SQL column type annotations? */
    supportsColumnTypes: boolean;

    /** Does this source support real-time listeners? */
    supportsRealtime: boolean;

    /**
     * Does this source store vectors natively?
     *
     * `VectorProperty` carries a `dimensions` and is pgvector-shaped. It was
     * the one driver-specific property kind with no flag to gate it, so unlike
     * every other field in this descriptor there was not even a runtime answer
     * to appeal to — a Firestore collection could declare an embedding column
     * and no driver would do anything with it.
     */
    supportsVectors: boolean;

    /**
     * Canonical filter operators this engine can execute.
     *
     * The admin UI intersects this set with the property-type defaults and
     * any per-property narrowing (`property.ui.filterOperators`) to decide
     * which operators to offer in filter fields — so an engine that cannot
     * run `ilike` (e.g. Firestore) never shows a "Contains" filter that
     * would throw at query time.
     */
    filterOperators: readonly WhereFilterOp[];

    /**
     * Relation kinds this engine's driver can compile into a filter.
     *
     * Only `belongsTo` puts a column on the row being filtered; the others are
     * answered with a correlated subquery over the junction or the target
     * table, which not every driver can build. An engine with no relations at
     * all declares none.
     *
     * The admin uses this to decide whether a relation column offers a filter
     * control. Offering one an engine cannot answer is not cosmetic: a driver
     * that drops the key it cannot resolve *widens* the read to every row, and
     * one that fails closed answers a control the admin itself put on screen
     * with a 400.
     *
     * Optional, so a third-party driver registered before this existed still
     * compiles. Omitted means {@link DEFAULT_FILTERABLE_RELATION_KINDS} — the
     * one kind that is a plain column comparison, which every relational
     * driver can do. The subquery kinds are a real capability and have to be
     * claimed rather than assumed: assuming them wrongly is the widening.
     */
    filterableRelationKinds?: readonly string[];

    /**
     * Can a filter address a *column of the related row* — `applications.status`
     * — rather than only the related row's id?
     *
     * A separate capability from {@link filterableRelationKinds} because it is
     * a separate subquery: the id filter stops at the junction, one of these
     * reaches the target table and compares one of its columns. A driver can
     * do the first and not the second.
     *
     * Optional and defaulting to **false**, for the reason the relation kinds
     * default narrow: an unclaimed capability that the admin assumes is there
     * produces a control whose query the driver answers by dropping the key —
     * and a dropped filter key widens the read to every row.
     *
     * Meaningless without {@link supportsRelations}; a driver with no relations
     * has nothing to reach through.
     */
    supportsRelationFieldFilters?: boolean;

    /**
     * Can a sort key be an aggregate over a to-many relation — "oldest waiting
     * first", "busiest first"?
     *
     * Compiled as a correlated scalar subquery in `ORDER BY`, which a document
     * store cannot express at all. Optional and defaulting to **false**.
     *
     * A wrongly claimed sort capability fails differently from a wrongly
     * claimed filter one, and worse in one respect: a driver that cannot
     * resolve the key drops the `ORDER BY` and answers 200 with rows in
     * whatever order the database pleased, which reads as a sorted list. Paging
     * over that repeats and skips rows.
     */
    relationAggregateSorts?: boolean;

    // ── Admin capability flags ───────────────────────────────────────
    /** Does this source support SQL admin operations (SQL editor, EXPLAIN, etc.)? */
    supportsSQLAdmin: boolean;

    /** Does this source support document admin operations (aggregation, stats)? */
    supportsDocumentAdmin: boolean;

    /** Does this source support schema admin (unmapped tables, table metadata)? */
    supportsSchemaAdmin: boolean;
}

/**
 * Subset of DataSourceCapabilities containing only feature flags.
 * Useful when you only need to check capabilities without UI metadata.
 * @group Models
 */
export type DataSourceFeatures = Omit<DataSourceCapabilities, "key" | "label">;

/**
 * The default data-source key, used when a collection does not name a
 * `dataSource`. Shared by the frontend router and the backend driver
 * registry so both agree on "the default database".
 * @group Models
 */
export const DEFAULT_DATA_SOURCE_KEY = "(default)";

/**
 * How the *frontend* reaches a data source.
 *
 * - `"server"` — through the Rebase backend (the `RebaseClient`). The backend
 *   holds the actual database adapter and routes by data-source key. This is
 *   the default and covers Postgres, MongoDB, and any other server-mediated
 *   engine.
 * - `"direct"` — straight from the client to the external backend via its own
 *   SDK driver (e.g. Firestore). The Rebase backend is not in the data path.
 * - `"custom"` — a developer-supplied {@link DataDriver}, transport unspecified.
 *
 * @group Models
 */
export type DataSourceTransport = "server" | "direct" | "custom";

/**
 * Declarative definition of a data source — a named place data lives.
 *
 * Declared once and shared front and back: the frontend uses it to decide
 * transport (client vs direct driver), the backend uses the same `key` to
 * resolve a database adapter, and the editor derives capabilities from
 * `engine`. Collections reference a definition by its `key` via
 * `collection.dataSource`.
 *
 * @group Models
 */
export interface DataSourceDefinition {
    /**
     * Unique identifier for this data source. Collections point at it via
     * `dataSource`. Defaults to {@link DEFAULT_DATA_SOURCE_KEY}.
     */
    key: string;

    /**
     * The engine backing this data source (e.g. `"postgres"`, `"mongodb"`,
     * `"firestore"`, or a custom id). Determines the
     * {@link DataSourceCapabilities} surfaced in the editor.
     */
    engine: string;

    /**
     * How the frontend reaches this source. Optional — when omitted it is
     * inferred: `"direct"` if the definition carries a client-side driver,
     * `"server"` otherwise.
     */
    transport?: DataSourceTransport;

    /**
     * The physical database/schema/Firestore-database within the engine.
     * Threaded to drivers/adapters as the existing `databaseId` runtime
     * parameter. Defaults to the engine's own default.
     */
    databaseId?: string;

    /** Human-readable label for the UI. */
    label?: string;
}

/**
 * The resolved data source for a collection: the single source of truth that
 * the frontend router, backend registry, and editor all derive from.
 * Produced by `resolveDataSource(collection, registry)`.
 *
 * @group Models
 */
export interface ResolvedDataSource {
    /** Data-source key (routing key, shared front + back). */
    key: string;
    /** Engine backing the source (drives capabilities). */
    engine: string;
    /** Frontend transport. */
    transport: DataSourceTransport;
    /** Within-engine instance, if any (the `databaseId` runtime param). */
    databaseId?: string;
    /** Capabilities derived from {@link engine}. */
    capabilities: DataSourceCapabilities;
}

/**
 * Relation kinds assumed filterable when a driver does not say.
 *
 * `belongsTo` alone: its filter is a comparison on a column of the row being
 * filtered, the one shape that needs no query construction a driver might not
 * have. Everything else is a correlated subquery over another table.
 *
 * @group Models
 */
export const DEFAULT_FILTERABLE_RELATION_KINDS: readonly string[] = ["belongsTo"];

// ── Built-in driver capabilities ─────────────────────────────────────

/** @group Models */
export const POSTGRES_CAPABILITIES: DataSourceCapabilities = {
    key: "postgres",
    label: "PostgreSQL",
    supportsRelations: true,
    supportsSubcollections: false,
    supportsRLS: true,
    supportsReferences: false,
    supportsColumnTypes: true,
    supportsRealtime: true,
    supportsVectors: true,
    filterOperators: ALL_WHERE_FILTER_OPS,
    // `via` is absent: its join path is authored source → target with no
    // stated inverse, so the driver has nothing to reverse into a filter.
    filterableRelationKinds: ["belongsTo", "manyToMany", "hasMany", "hasOne"],
    supportsRelationFieldFilters: true,
    relationAggregateSorts: true,
    supportsSQLAdmin: true,
    supportsDocumentAdmin: false,
    supportsSchemaAdmin: true
};

/** @group Models */
export const FIREBASE_CAPABILITIES: DataSourceCapabilities = {
    key: "firestore",
    label: "Firebase / Firestore",
    supportsRelations: false,
    supportsSubcollections: true,
    supportsRLS: false,
    supportsReferences: true,
    supportsColumnTypes: false,
    supportsRealtime: true,
    supportsVectors: false,
    // Firestore has no SQL pattern matching — the driver throws on the LIKE
    // family, so the UI must never offer it.
    filterOperators: ALL_WHERE_FILTER_OPS.filter(op =>
        op !== "like" && op !== "ilike" && op !== "not-like" && op !== "not-ilike"),
    // No relations at all — a document store links by reference. Nothing to
    // reach through, so neither of the two relation-reaching features either.
    filterableRelationKinds: [],
    supportsRelationFieldFilters: false,
    relationAggregateSorts: false,
    supportsSQLAdmin: false,
    supportsDocumentAdmin: false,
    supportsSchemaAdmin: false
};

/** @group Models */
export const MONGODB_CAPABILITIES: DataSourceCapabilities = {
    key: "mongodb",
    label: "MongoDB",
    supportsRelations: false,
    supportsSubcollections: true,
    supportsRLS: false,
    supportsReferences: true,
    supportsColumnTypes: false,
    supportsRealtime: false,
    supportsVectors: false,
    filterOperators: ALL_WHERE_FILTER_OPS,
    filterableRelationKinds: [],
    supportsRelationFieldFilters: false,
    relationAggregateSorts: false,
    supportsSQLAdmin: false,
    supportsDocumentAdmin: true,
    supportsSchemaAdmin: true
};

/**
 * Fallback capabilities when the driver is unknown.
 * Enables everything so nothing is hidden unexpectedly.
 * @group Models
 */
export const DEFAULT_CAPABILITIES: DataSourceCapabilities = {
    key: "(default)",
    label: "Default",
    supportsRelations: true,
    supportsSubcollections: true,
    supportsRLS: true,
    supportsReferences: true,
    supportsColumnTypes: true,
    supportsRealtime: true,
    supportsVectors: true,
    filterOperators: ALL_WHERE_FILTER_OPS,
    // The exception to this descriptor's "enable everything" rule. The other
    // flags hide a tab or a picker when they are wrong; this one decides
    // whether a query is sent that an unknown driver may answer by dropping
    // the condition — which returns every row rather than none.
    filterableRelationKinds: DEFAULT_FILTERABLE_RELATION_KINDS,
    // Narrow for the same reason, and more sharply. An unknown driver that is
    // assumed to compile these answers by dropping the key: the filter widens
    // the read to every row, and the sort comes back unordered while looking
    // sorted. Both have to be claimed.
    supportsRelationFieldFilters: false,
    relationAggregateSorts: false,
    supportsSQLAdmin: true,
    supportsDocumentAdmin: true,
    supportsSchemaAdmin: true
};

const CAPABILITIES_REGISTRY: Record<string, DataSourceCapabilities> = {
    postgres: POSTGRES_CAPABILITIES,
    firestore: FIREBASE_CAPABILITIES,
    mongodb: MONGODB_CAPABILITIES,
    "(default)": DEFAULT_CAPABILITIES
};

/**
 * Look up capabilities for a given engine key.
 * If `engine` is undefined or not found, returns `DEFAULT_CAPABILITIES`.
 * @group Models
 */
export function getDataSourceCapabilities(engine?: string): DataSourceCapabilities {
    if (!engine) return POSTGRES_CAPABILITIES; // postgres is the default engine
    return CAPABILITIES_REGISTRY[engine] ?? DEFAULT_CAPABILITIES;
}

/**
 * Register custom capabilities for a third-party driver.
 * @group Models
 */
export function registerDataSourceCapabilities(capabilities: DataSourceCapabilities): void {
    CAPABILITIES_REGISTRY[capabilities.key] = capabilities;
}
