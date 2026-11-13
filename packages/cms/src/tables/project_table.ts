/**
 * The projector: a {@link TableDescriptor} from `GET /api/schema/tables`
 * becomes the panel's default collection, with no frontend configuration
 * (POSTGRES-FIRST.md §6.1).
 *
 * The panel keeps its own view model — a flat collection of `Property`s — and
 * every view keeps reading it unchanged; this module is the one place a
 * descriptor is translated into it. Identity is never re-derived: the
 * collection's slug is the descriptor's slug and every property key is a
 * column key or a relation name, because saved layouts, favourites, URLs and
 * API calls are all keyed by them.
 *
 * Presentation is the panel's, not the projector's. A projected collection
 * states a presentation key only where the table states a fact that implies it
 * (a column type, a validation rule, a storage column, a stamp, a relation);
 * everything else — the view mode, how a record opens, the display slots, the
 * columns shown — is left unset, so a table opens exactly as an authored
 * collection that said nothing did, and `customizeTable` is where a project
 * chooses otherwise. The one stated default beyond the facts is POSTGRES-FIRST.md
 * §6.1's: audit stamps (`createdAt`/`updatedAt`) are left out of the default
 * table columns.
 */
import type {
    TableDescriptor
} from "@rebasepro/types";
import type { AdminPostgresCollection, AnyCollectionConfig, AuthCollectionConfig, PostgresProperties } from "@rebasepro/cms-types";
import { tableLabels } from "./labels";
import { enumValuesFrom, propertyFromColumn } from "./column_property";
import { projectRelations, type TargetResolver } from "./relations";
import { securityRulesFromRls } from "./rls";

/**
 * What a table projects to: the panel's collection view model.
 *
 * @group Tables
 */
export type ProjectedCollection = AdminPostgresCollection;

/**
 * What a projection reads besides the table itself.
 *
 * @group Tables
 */
export interface TableProjectionContext {
    /**
     * Every table the caller was served. Relation targets are resolved among
     * them by slug; a relation to a table not listed here is left out.
     */
    tables: readonly TableDescriptor[];
}

/**
 * How {@link collectionsFromTables} resolves relation targets.
 *
 * @group Tables
 */
export interface TableProjectionOptions {
    /**
     * The collection a relation to the table `slug` opens, when it is not the
     * bare projection: the panel passes the composed collection (projected,
     * customized, with the workspace's preferences), so a relation's picker,
     * preview and tab read the target as the panel shows it — what an authored
     * collection's `target: () => other` handed them. Read lazily, each time a
     * relation's `target()` is called; `undefined` falls back to the
     * projection.
     */
    targetCollection?: (slug: string) => AnyCollectionConfig | undefined;
}

/**
 * The auth table's `roles` column, given the roles the auth table declares as
 * its options — what the scaffolded users collection spelled by hand.
 */
function withDeclaredRoles(properties: PostgresProperties, table: TableDescriptor): void {
    const declared = table.auth?.roles ? Object.keys(table.auth.roles) : [];
    const roles = properties.roles;
    if (declared.length === 0 || roles?.type !== "array" || Array.isArray(roles.of)) return;
    const item = roles.of;
    if (item?.type !== "string" || item.enum) return;
    roles.of = { ...item, enum: enumValuesFrom(declared) };
}

function authConfig(table: TableDescriptor): AuthCollectionConfig | undefined {
    if (!table.auth) return undefined;
    return {
        enabled: true,
        ...(table.auth.roles ? { roles: table.auth.roles } : {}),
        ...(table.auth.scopes ? { scopes: table.auth.scopes } : {}),
        ...(table.auth.personalKeys !== undefined ? { personalKeys: table.auth.personalKeys } : {})
    };
}

/** Projects tables lazily, once each, resolving relation targets by slug. */
class Projection {
    private readonly bySlug = new Map<string, TableDescriptor>();
    private readonly projected = new Map<TableDescriptor, ProjectedCollection>();
    private readonly resolveTarget: TargetResolver = {
        has: (slug) => this.bySlug.has(slug),
        get: (slug) => {
            const table = this.bySlug.get(slug);
            if (!table) return undefined;
            return this.targetCollection?.(slug) ?? this.project(table);
        }
    };

    constructor(
        tables: readonly TableDescriptor[],
        private readonly targetCollection?: TableProjectionOptions["targetCollection"]
    ) {
        for (const table of tables) {
            if (!this.bySlug.has(table.slug)) this.bySlug.set(table.slug, table);
        }
    }

    /** Lets a table outside the served list resolve relations to itself. */
    include(table: TableDescriptor): void {
        if (!this.bySlug.has(table.slug)) this.bySlug.set(table.slug, table);
    }

    project(table: TableDescriptor): ProjectedCollection {
        const done = this.projected.get(table);
        if (done) return done;
        const collection = build(table, this.resolveTarget);
        this.projected.set(table, collection);
        return collection;
    }
}

function build(table: TableDescriptor, resolveTarget: TargetResolver): ProjectedCollection {
    const relations = projectRelations(table, resolveTarget);
    const replacing = new Map(relations.filter(r => r.replacesColumn).map(r => [r.replacesColumn, r]));
    const columnKeys = new Set(table.columns.map(column => column.key));

    const properties: PostgresProperties = {};
    for (const column of table.columns) {
        const relation = replacing.get(column.key);
        if (relation) {
            properties[relation.key] = relation.property;
            continue;
        }
        const property = propertyFromColumn(column, { primaryKey: table.primaryKey, tenantField: table.tenant?.field });
        if (!property) continue;
        properties[column.key] = property;
    }
    for (const relation of relations) {
        if (relation.replacesColumn) continue;
        // A relation never takes the key of a column: the column's key is what
        // rows and saved layouts already use.
        if (columnKeys.has(relation.key)) continue;
        properties[relation.key] = relation.property;
    }

    // The tenant column replaced by its relation is still the tenant column.
    const tenantRelation = table.tenant ? replacing.get(table.tenant.field) : undefined;
    if (tenantRelation) {
        tenantRelation.property.admin = { ...tenantRelation.property.admin, filledByServer: true };
    }

    withDeclaredRoles(properties, table);

    const { name, singularName } = tableLabels(table);
    const auth = authConfig(table);

    const collection: ProjectedCollection = {
        slug: table.slug,
        name,
        singularName,
        table: table.table,
        schema: table.schema,
        properties,
        securityRules: securityRulesFromRls(table, { properties }),
        ...(table.description ? { description: table.description } : {}),
        ...(table.database ? { dataSource: table.database } : {}),
        ...(table.history ? { history: true } : {}),
        ...(table.search ? { search: table.search } : {}),
        ...(table.softDelete ? { softDelete: { field: table.softDelete.field } } : {}),
        ...(table.tenant
            ? {
                tenant: {
                    field: table.tenant.field,
                    from: table.tenant.from,
                    ...(table.tenant.bypassRoles ? { bypassRoles: table.tenant.bypassRoles } : {})
                }
            }
            : {}),
        ...(auth ? { auth } : {}),
        ...(table.view
            ? {
                view: {
                    query: table.view.query ?? "",
                    materialized: table.view.materialized,
                    ...(table.view.roles ? { roles: [...table.view.roles] } : {})
                }
            }
            : {}),
        ...(table.strictWrites === false ? { strictWrites: false } : {}),
        ...(table.metadata ? { metadata: table.metadata } : {})
    };
    return collection;
}

/**
 * One table as the panel's default collection.
 *
 * Relation targets are resolved among `context.tables` by slug, lazily, so
 * tables that point at each other project without a cycle. A target the
 * caller was not served degrades: a `belongsTo` keeps its foreign key as a
 * plain field, any other relation is left out.
 *
 * @group Tables
 */
export function collectionFromTable(table: TableDescriptor, context: TableProjectionContext): ProjectedCollection {
    const projection = new Projection(context.tables);
    projection.include(table);
    return projection.project(table);
}

/**
 * Every table as the panel's default collection, in the order served. Tables
 * that relate to each other share one projection, so a relation's target is
 * the very collection listed beside it — or, with
 * `options.targetCollection`, the collection the caller composed from it.
 *
 * @group Tables
 */
export function collectionsFromTables(tables: readonly TableDescriptor[], options: TableProjectionOptions = {}): ProjectedCollection[] {
    const projection = new Projection(tables, options.targetCollection);
    return tables.map(table => projection.project(table));
}
