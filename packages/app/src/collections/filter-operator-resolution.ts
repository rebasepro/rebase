import {
    ALL_WHERE_FILTER_OPS,
    DataType,
    DEFAULT_FILTERABLE_RELATION_KINDS,
    getDataSourceCapabilities,
    Property,
    RelationProperty,
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

/**
 * Item types an array can be filtered by — the ones a filter field can take a
 * single item value for. An array of booleans, maps or geopoints is not: the
 * dialog used to offer `array-contains` for every item type, so an array of
 * maps listed a row with nothing to fill in.
 */
const ARRAY_ITEM_FILTERABLE_TYPES: readonly DataType[] = ["string", "number", "date", "reference", "relation"];

/**
 * Whether a relation is one the collection's engine can compile into a
 * `WHERE`.
 *
 * Which kinds those are is the *driver's* answer, not this function's, so it
 * comes from {@link DataSourceCapabilities.filterableRelationKinds}. The admin
 * is one UI over Postgres, MongoDB, Firestore and whatever a developer
 * registers, and "a many-to-many compiles to an `EXISTS` over the junction" is
 * a fact about the Postgres driver — true today, and not the sort of thing to
 * assert on an engine's behalf.
 *
 * Offering an uncompilable filter is not a cosmetic bug. The Postgres driver
 * used to drop a filter key it could not resolve, which *widened* the result
 * set — filtering a many-to-many column returned every row instead of none.
 * That now fails closed with a 400, which is correct for a real schema drift
 * and wrong as the answer to a control the admin itself put on screen.
 *
 * A relation whose kind cannot be determined at all — no inline `relation`
 * block and no stamped `resolvedRelation` — stays filterable. The server
 * resolves relations before the config reaches the admin, so this is the
 * hand-built-property case, and silently dropping a working filter there would
 * be its own regression.
 */
export function isFilterableRelation(property: Property, engine?: string): boolean {
    if (property.type !== "relation") return true;
    const relationProperty = property as RelationProperty;
    const kind = relationProperty.relation?.kind ?? relationProperty.resolvedRelation?.kind;
    if (!kind) return true;
    const kinds = getDataSourceCapabilities(engine).filterableRelationKinds
        ?? DEFAULT_FILTERABLE_RELATION_KINDS;
    return kinds.includes(kind);
}

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
 * Returns an empty array when the property is not filterable — by type, by
 * developer narrowing (`filterOperators: []`), or because it is a relation the
 * query layer has no column for (see {@link isFilterableRelation}).
 *
 * @group Models
 */
export function resolveFilterOperators({
    property,
    isArray,
    engine
}: ResolveFilterOperatorsParams): WhereFilterOp[] {
    if (!isFilterableRelation(property, engine)) return [];

    const typeDefaults: readonly WhereFilterOp[] = isArray
        ? (ARRAY_ITEM_FILTERABLE_TYPES.includes(property.type) ? ARRAY_OPS : [])
        : DEFAULT_OPS_BY_TYPE[property.type] ?? [];
    if (typeDefaults.length === 0) return [];

    const engineOps = new Set(getDataSourceCapabilities(engine).filterOperators ?? ALL_WHERE_FILTER_OPS);

    const narrowing = property.admin?.filterOperators;
    const narrowingSet = narrowing !== undefined ? new Set(narrowing) : undefined;

    return typeDefaults.filter(op =>
        engineOps.has(op) && (narrowingSet === undefined || narrowingSet.has(op)));
}

/**
 * Whether a property can be filtered at all — the one answer the table header
 * and the filters dialog both give.
 *
 * They used to answer it with a predicate each, and disagreed: the header
 * allowed an array only of strings, numbers, dates, references and relations;
 * the dialog allowed an array of anything, and listed an array of maps with an
 * empty control. The header, for its part, ignored both the developer's
 * `filterOperators: []` and a custom `admin.Filter`.
 *
 * A property with a custom filter field is filterable: the developer owns that
 * field. Otherwise it is filterable when at least one operator survives
 * {@link resolveFilterOperators} — for an array, on its item type. A tuple
 * array (`of: [a, b]`) has no single item type to filter by.
 *
 * @group Models
 */
export function isPropertyFilterable(property: Property, engine?: string): boolean {
    const isArray = property.type === "array";
    const base = isArray
        ? (property.of && !Array.isArray(property.of) ? property.of : undefined)
        : property;
    if (!base) return false;
    if (base.admin?.Filter) return true;
    return resolveFilterOperators({ property: base, isArray, engine }).length > 0;
}
