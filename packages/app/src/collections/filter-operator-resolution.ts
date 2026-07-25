import {
    ALL_WHERE_FILTER_OPS,
    DataType,
    getDataSourceCapabilities,
    Property,
    WhereFilterOp
} from "@rebasepro/types";

/**
 * Default operators offered per property type, before engine capabilities and
 * per-property narrowing are applied. These mirror what the built-in filter
 * fields can render.
 */
const COMPARISON_OPS: readonly WhereFilterOp[] = ["==", "!=", ">", ">=", "<", "<="];
const NULL_CHECK_OPS: readonly WhereFilterOp[] = ["is-null", "is-not-null"];
const MEMBERSHIP_OPS: readonly WhereFilterOp[] = ["in", "not-in"];
const PATTERN_OPS: readonly WhereFilterOp[] = ["like", "ilike", "not-like", "not-ilike"];

const DEFAULT_OPS_BY_TYPE: Partial<Record<DataType, readonly WhereFilterOp[]>> = {
    string: [...COMPARISON_OPS, ...MEMBERSHIP_OPS, ...PATTERN_OPS, ...NULL_CHECK_OPS],
    number: [...COMPARISON_OPS, ...MEMBERSHIP_OPS, ...NULL_CHECK_OPS],
    date: [...COMPARISON_OPS, ...NULL_CHECK_OPS],
    boolean: ["==", "!=", ...NULL_CHECK_OPS],
    reference: ["==", "!=", ...MEMBERSHIP_OPS, ...NULL_CHECK_OPS],
    relation: ["==", "!=", ...MEMBERSHIP_OPS, ...NULL_CHECK_OPS]
    // geopoint, map, vector, binary, array (as a container): not filterable
    // through the generic filter UI.
};

/** Operators offered when the property is an *array of* a filterable type. */
const ARRAY_OPS: readonly WhereFilterOp[] = ["array-contains", "array-contains-any"];

export interface ResolveFilterOperatorsParams {
    /**
     * The property to filter on. For array properties, pass the **item**
     * property (`property.of`) together with `isArray: true` — the same
     * convention the filter field dispatchers use.
     */
    property: Property;
    /** True when filtering an array of `property`. */
    isArray?: boolean;
    /**
     * The engine backing the collection (`collection.engine`, e.g.
     * `"postgres"`, `"firestore"`). Falls back to the default engine's
     * capabilities when omitted.
     */
    engine?: string;
}

/**
 * Resolve which filter operators the UI should offer for a property.
 *
 * The result is the **intersection** of three sets:
 * 1. what the engine can execute — {@link DataSourceCapabilities.filterOperators}
 *    (e.g. Firestore cannot run the LIKE family);
 * 2. what makes sense for the property type (e.g. no `>` on booleans);
 * 3. the developer's optional narrowing — `property.admin.filterOperators`.
 *
 * Returns an empty array when the property is not filterable (either by
 * type, or because the developer disabled it with `filterOperators: []`).
 *
 * @group Models
 */
export function resolveFilterOperators({
    property,
    isArray,
    engine
}: ResolveFilterOperatorsParams): WhereFilterOp[] {
    const typeDefaults: readonly WhereFilterOp[] = isArray
        ? ARRAY_OPS
        : DEFAULT_OPS_BY_TYPE[property.type] ?? [];
    if (typeDefaults.length === 0) return [];

    const engineOps = new Set(getDataSourceCapabilities(engine).filterOperators ?? ALL_WHERE_FILTER_OPS);

    const narrowing = property.admin?.filterOperators;
    const narrowingSet = narrowing !== undefined ? new Set(narrowing) : undefined;

    return typeDefaults.filter(op =>
        engineOps.has(op) && (narrowingSet === undefined || narrowingSet.has(op)));
}
