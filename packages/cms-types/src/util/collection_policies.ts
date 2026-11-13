/**
 * The policy compiler's view of a CMS collection.
 *
 * The backend compiles rules against compiled tables (`policyTableFromDescriptor`,
 * `compileTableRulePolicies`, `tableEffectiveRules` in `@rebasepro/common`). The
 * panel's collection editor holds a collection view model, so it calls these
 * collection-shaped entry points, which build a {@link PolicyTable} from the
 * collection and compile through the same code.
 *
 * @module
 */
import {
    isPostgresCollectionConfig,
    type AuthCollectionConfig,
    type CollectionConfig,
    type CollectionTenantConfig,
    type PolicyExpression,
    type Property,
    type ResolvedRelation,
    type SecurityRule
} from "@rebasepro/types";
import { getPolicyNamesForRules, toSnakeCase } from "@rebasepro/utils";
import {
    compilePolicyExpression,
    compileTableRulePolicies,
    findRelation,
    getTableName,
    resolveCollectionRelations,
    tableEffectiveRules,
    tableGeneratedPolicyNames,
    tableInjectedRules,
    type ClaimCastType,
    type CompiledRulePolicy,
    type PolicyColumn,
    type PolicyTable,
    type ResolvePolicyTable,
    type RulePolicySwitches
} from "@rebasepro/common";

type ResolveCollection = (slug: string) => CollectionConfig | undefined;

/**
 * A {@link ResolvePolicyTable} over a collection resolver: each collection it
 * returns, viewed as a table.
 */
export function legacyTableResolver(resolveCollection: ResolveCollection | undefined): ResolvePolicyTable | undefined {
    if (!resolveCollection) return undefined;
    return (slug: string) => {
        const collection = resolveCollection(slug);
        return collection ? policyTableFromCollection(collection, resolveCollection) : undefined;
    };
}

/**
 * The policy compiler's view of a legacy collection: every property as a key
 * a rule may name (its `columnName`, or the snake_case of its key), a
 * `belongsTo` relation as a link to its foreign key column, and the claim cast
 * each needs — read from the property, through a relation's target key.
 */
export function policyTableFromCollection(collection: CollectionConfig, resolveCollection?: ResolveCollection): PolicyTable {
    // Read lazily: resolving a collection's relations caches them, and the
    // rule-level callers (`getEffectiveSecurityRules`) never need a column.
    let keys: { columns: Record<string, PolicyColumn>; links: Record<string, PolicyColumn> } | undefined;
    const keysOf = () => (keys ??= collectionKeys(collection, resolveCollection));
    const tenant = tenantOfCollection(collection);
    const schema = isPostgresCollectionConfig(collection) ? collection.schema || undefined : undefined;
    return {
        slug: collection.slug,
        table: getTableName(collection),
        ...(schema ? { schema } : {}),
        ...(isPostgresCollectionConfig(collection) && collection.dataSource !== undefined ? { database: collection.dataSource } : {}),
        get columns() {
            return keysOf().columns;
        },
        get links() {
            return keysOf().links;
        },
        idKey: idPropertyName(collection),
        rules: collection.securityRules ?? [],
        ...legacyDefaultPolicies(collection),
        auth: isAuthCollection(collection),
        ...(tenant ? { tenant } : {})
    };
}

function collectionKeys(
    collection: CollectionConfig,
    resolveCollection: ResolveCollection | undefined
): { columns: Record<string, PolicyColumn>; links: Record<string, PolicyColumn> } {
    const columns: Record<string, PolicyColumn> = {};
    const links: Record<string, PolicyColumn> = {};
    for (const [key, raw] of Object.entries(collection.properties ?? {})) {
        const prop = raw as Property | undefined;
        if (!prop) continue;
        const claimCast = propertyClaimCastType(key, collection, resolveCollection);
        if ("columnName" in prop && typeof prop.columnName === "string") {
            columns[key] = { column: prop.columnName, claimCast };
            continue;
        }
        const relation = prop.type === "relation" ? resolvePropertyRelation(key, collection) : undefined;
        if (relation?.kind === "belongsTo") links[key] = { column: relation.localKey, claimCast };
        else columns[key] = { column: toSnakeCase(key), claimCast };
    }
    // A `belongsTo` declared in `relations` alone, with no property: a key a
    // shorthand may name. It addresses the snake_case of its name, as it
    // always has — no property says otherwise.
    for (const [name, relation] of safeRelations(collection)) {
        if (relation.kind !== "belongsTo" || name in columns || name in links) continue;
        links[name] = { column: toSnakeCase(name), claimCast: "text" };
    }
    return { columns, links };
}

function legacyDefaultPolicies(collection: CollectionConfig): { defaultPolicies?: boolean } {
    // A collection Postgres does not store has the baseline on, whatever any
    // database declares.
    if (!isPostgresCollectionConfig(collection)) return { defaultPolicies: true };
    if (collection.disableDefaultPolicies === undefined) return {};
    return { defaultPolicies: !collection.disableDefaultPolicies };
}

function isAuthCollection(collection: CollectionConfig): boolean {
    const auth = collection.auth;
    return auth === true || (typeof auth === "object" && (auth as AuthCollectionConfig)?.enabled === true);
}

/** The property marked as the row id (falls back to `id`). */
function idPropertyName(collection: CollectionConfig): string {
    for (const [name, prop] of Object.entries(collection.properties ?? {})) {
        if (prop && typeof prop === "object" && "isId" in prop && prop.isId) return name;
    }
    return "id";
}

function safeRelations(collection: CollectionConfig): [string, ResolvedRelation][] {
    try {
        return Object.entries(resolveCollectionRelations(collection));
    } catch {
        // A relation whose target is not in this bundle: it names no column here.
        return [];
    }
}

/**
 * The resolved relation a `relation` property stands for, by the property's
 * own key — `resolveCollectionRelations` normalises an inline `relation` and
 * an entry of the `relations` array under it.
 */
function resolvePropertyRelation(propName: string, collection: CollectionConfig): ResolvedRelation | undefined {
    try {
        return findRelation(resolveCollectionRelations(collection), propName);
    } catch {
        return undefined;
    }
}

/**
 * What `name` on `collection` compares against a text claim as. `depth` stops
 * a `reference` cycle from recursing forever.
 */
function propertyClaimCastType(
    name: string,
    collection: CollectionConfig | undefined,
    resolveCollection: ResolveCollection | undefined,
    depth = 0
): ClaimCastType {
    const prop = collection?.properties?.[name] as Property | undefined;
    if (!prop || depth > 2) return "text";

    switch (prop.type) {
        case "string": {
            if (prop.enum) return "text";
            return prop.isId === "uuid" || prop.columnType === "uuid" ? "uuid" : "text";
        }
        case "number": {
            if (prop.columnType === "numeric") return "numeric";
            if (prop.columnType || prop.validation?.integer || prop.isId) return "bigint";
            // A `number` with no `columnType` and no `validation.integer` is NUMERIC.
            return "numeric";
        }
        case "reference":
            return primaryKeyClaimCastType(resolveTargetCollection(prop.path, resolveCollection), resolveCollection, depth);
        case "relation":
            return primaryKeyClaimCastType(relationTarget(name, prop, collection, resolveCollection), resolveCollection, depth);
        default:
            return "text";
    }
}

/** The cast a column pointing at `target`'s primary key needs. */
function primaryKeyClaimCastType(
    target: CollectionConfig | undefined,
    resolveCollection: ResolveCollection | undefined,
    depth: number
): ClaimCastType {
    if (!target) return "text";
    for (const [key, property] of Object.entries(target.properties ?? {})) {
        if (!property || typeof property !== "object" || !("isId" in property) || !property.isId) continue;
        return propertyClaimCastType(key, target, resolveCollection, depth + 1);
    }
    // No declared key: the implicit `id TEXT PRIMARY KEY`.
    return "text";
}

/** A relation's target slug, from a slug or a thunk returning a collection. */
function relationTargetSlug(target: unknown): string | undefined {
    if (typeof target === "string") return target;
    if (typeof target !== "function") return undefined;
    try {
        const resolved: unknown = target();
        if (typeof resolved !== "object" || resolved === null || !("slug" in resolved)) return undefined;
        return typeof resolved.slug === "string" ? resolved.slug : undefined;
    } catch {
        // A thunk needing a registry this compilation does not have.
        return undefined;
    }
}

function resolveTargetCollection(slug: string | undefined, resolveCollection: ResolveCollection | undefined): CollectionConfig | undefined {
    if (!slug || !resolveCollection) return undefined;
    // A `reference` path may be nested; the collection is its last segment.
    return resolveCollection(slug) ?? resolveCollection(slug.split("/").pop() ?? slug);
}

/** The collection a `relation` property points at. */
function relationTarget(
    propName: string,
    prop: Property & { type: "relation" },
    collection: CollectionConfig | undefined,
    resolveCollection: ResolveCollection | undefined
): CollectionConfig | undefined {
    const relation = collection ? resolvePropertyRelation(propName, collection) : undefined;
    if (relation) {
        try {
            const target = relation.target();
            if (target) return target;
        } catch {
            // A thunk needing a registry this compilation does not have.
        }
    }
    return resolveTargetCollection(relationTargetSlug(prop.relation?.target), resolveCollection);
}

/**
 * The collection's tenancy declaration, or nothing: `tenant` is an object
 * carrying a `field` and a `from`.
 */
function tenantOfCollection(collection: CollectionConfig): CollectionTenantConfig | undefined {
    const tenant = isPostgresCollectionConfig(collection) ? collection.tenant : undefined;
    if (!tenant || typeof tenant !== "object") return undefined;
    if (typeof tenant.field !== "string" || !tenant.field) return undefined;
    if (!tenant.from || typeof tenant.from !== "object") return undefined;
    return tenant;
}

/** Compile options for a collection: a resolver for `existsIn` joins and relation targets. */
export interface LegacyPolicyCompileOptions {
    /** Resolve a collection by slug, for `existsIn` joins and relation targets. */
    resolveCollection?: (slug: string) => CollectionConfig | undefined;
}

/** {@link compileRulePolicies}' options: the collection resolver and the role switches. */
export interface LegacyRulePolicyCompileOptions extends LegacyPolicyCompileOptions, RulePolicySwitches {}

/** `compilePolicyExpression` against a collection, for the panel's rule editor. */
export function policyToPostgres(expr: PolicyExpression, collection?: CollectionConfig, options?: LegacyPolicyCompileOptions): string {
    const resolveCollection = options?.resolveCollection;
    return compilePolicyExpression(expr, collection ? policyTableFromCollection(collection, resolveCollection) : undefined, {
        resolveTable: legacyTableResolver(resolveCollection)
    });
}

/** `compileTableRulePolicies` against a collection. */
export function compileRulePolicies(
    collection: CollectionConfig,
    rule: SecurityRule,
    options?: LegacyRulePolicyCompileOptions
): CompiledRulePolicy[] {
    const resolveCollection = options?.resolveCollection;
    return compileTableRulePolicies(policyTableFromCollection(collection, resolveCollection), rule, {
        resolveTable: legacyTableResolver(resolveCollection),
        ...(options?.adminRole !== undefined ? { adminRole: options.adminRole } : {}),
        ...(options?.adminRequestRole !== undefined ? { adminRequestRole: options.adminRequestRole } : {})
    });
}

/** `tableEffectiveRules` for a collection: its rules plus the injected baseline. */
export function getEffectiveSecurityRules(collection: CollectionConfig): SecurityRule[] {
    return tableEffectiveRules(policyTableFromCollection(collection));
}

/** `tableInjectedRules` for a collection: the framework defaults alone. */
export function getInjectedSecurityRules(collection: CollectionConfig): SecurityRule[] {
    return tableInjectedRules(policyTableFromCollection(collection));
}

/** `tableGeneratedPolicyNames` for a collection: every policy name `db push` writes for it. */
export function getGeneratedPolicyNames(collection: CollectionConfig): Set<string> {
    return tableGeneratedPolicyNames(policyTableFromCollection(collection));
}

/**
 * {@link getEffectiveSecurityRules} for a collection that may already carry
 * the injected rules: each injected rule is added only when the collection
 * does not hold a rule of its name.
 *
 * A collection the admin panel projects from a served table
 * (`GET /api/schema/tables`) already carries its effective rules — the panel
 * reflects permissions from them — so the panel's editors, which list what
 * Postgres holds, would otherwise show every injected policy twice. For a
 * collection declared in code the answer is the same as
 * `getEffectiveSecurityRules`'s. Every injected rule is named, and Postgres
 * admits one policy per name on a table.
 */
export function getEffectiveSecurityRulesOnce(collection: CollectionConfig): SecurityRule[] {
    const declared = collection.securityRules ?? [];
    const held = new Set(declared.flatMap(rule => (rule.name ? [rule.name] : [])));
    const injected = getInjectedSecurityRules(collection).filter(rule => !rule.name || !held.has(rule.name));
    return [...declared, ...injected];
}

/**
 * {@link getGeneratedPolicyNames} over {@link getEffectiveSecurityRulesOnce}:
 * for the panel, whose collections may already carry their injected rules.
 */
export function getGeneratedPolicyNamesOnce(collection: CollectionConfig): Set<string> {
    return getPolicyNamesForRules(getEffectiveSecurityRulesOnce(collection), policyTableFromCollection(collection).table);
}
