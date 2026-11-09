/**
 * What an MCP App view needs to run the admin panel's own components on a
 * project's collections: the collections themselves, reduced to data, for
 * the one person the view is drawn for, and what to put on screen — a
 * collection, a record, or an app the model wrote.
 *
 * The view (`@rebasepro/mcp-apps`) mounts `<Rebase>` with a data driver that
 * calls this endpoint's tools, and renders the admin panel's collection views
 * and record forms from these configs. So a config here is the project's own —
 * fields, enums, validation, relations, security rules, the `admin` block's
 * presentation — with everything a `postMessage` cannot carry taken out
 * (callbacks, custom components, a data source the view has no driver for),
 * and narrowed to the caller:
 *
 *  - a field this caller never receives (`excludeFromApi`, `access.read`) is
 *    not in the form at all;
 *  - a field they may not set (`access.write`) is read-only in it;
 *  - an operation their connection was not granted (`data:write`,
 *    `data:delete`) is closed by a restrictive security rule, which is what the
 *    admin panel asks before it offers Add, Save or Delete.
 *
 * None of that is a permission: every save goes through the write tools,
 * which check the field rules, the scopes and RLS again. It keeps the view
 * from offering what would be refused.
 *
 * @module
 */
import type { CollectionConfig, Property, SecurityRule } from "@rebasepro/types";
import { getCollectionDataPath, serializeCollections } from "@rebasepro/types";
import { type FieldViewer, canReadField, canWriteField } from "@rebasepro/common";

/** The ways a collection block lays out its rows, as the admin panel names them. */
export const VIEW_MODES = ["table", "list", "cards", "kanban"] as const;
export type McpViewMode = (typeof VIEW_MODES)[number];

/** A collection block: rows of one collection, opened in the admin panel's collection view (show_collection). */
export interface McpCollectionBlock {
    key: string;
    type: "collection";
    collection: string;
    view?: McpViewMode;
    where?: Record<string, unknown>;
    orderBy?: unknown;
    searchString?: string;
    limit?: number;
}

/** A record block: one row's form, or a new row's (show_record). */
export interface McpRecordBlock {
    key: string;
    type: "record";
    collection: string;
    /** The row to open. Absent, the form creates a new one. */
    id?: string;
    /** A new row's starting values. */
    values?: Record<string, unknown>;
}

/** An app block: code the model wrote, compiled, and the collections it reads (show_app). */
export interface McpAppBlock {
    key: string;
    type: "app";
    /** CommonJS, with the source's line numbers; `require` is the view's. */
    code: string;
    collections: string[];
}

export type McpViewBlock = McpCollectionBlock | McpRecordBlock | McpAppBlock;

/** What a show_* tool hands its view, besides what the model reads. */
export interface McpViewPayload {
    /** The payload's own version: a view refuses one it does not know rather than misdraw it. */
    version: 1;
    title?: string;
    /** One block: the collection, the record or the app the tool opens. */
    blocks: McpViewBlock[];
    /** The configs the block needs: its collections and their relations' targets, serialized. */
    collections: unknown[];
    /** Who the security rules are evaluated for, as the server knows them. */
    viewer: { uid: string; roles: string[] };
    /**
     * show_app's: the first page of each collection the app names, read as
     * the caller before the view opens, so its first render reads none of
     * them through the host. Absent where a read failed.
     */
    seeds?: McpViewSeed[];
    /**
     * When the server began reading the rows the result carries (show_collection's
     * page, show_app's seeds), in epoch milliseconds. The view serves them in
     * place of a read only while that is recent, so a host that draws a stored
     * result again later reads afresh.
     */
    readAt?: number;
}

/** A page read ahead for a view: the rows, the read's arguments, and the count where the server took it. */
export interface McpViewSeed {
    collection: string;
    args: Record<string, unknown>;
    rows: unknown[];
    total?: number;
}

/** What the caller's connection may do to one collection. */
export interface McpViewGrant {
    read: boolean;
    write: boolean;
    delete: boolean;
}

/**
 * The collections a set of blocks needs, ready for the view: each named
 * collection and, one hop out, the targets of its relations — the form's
 * relation fields read and pick rows of those.
 *
 * `grant` answers what this connection was granted on a collection; a target
 * it cannot read is left out, and the relation field pointing at it with it.
 */
export function viewCollections(
    named: readonly CollectionConfig[],
    all: readonly CollectionConfig[],
    viewer: FieldViewer,
    grant: (collection: CollectionConfig) => McpViewGrant
): unknown[] {
    const included = new Map<string, CollectionConfig>();
    const bySlug = (slug: string) => all.find(c => c.slug === slug);
    for (const collection of named) included.set(collection.slug, collection);
    for (const collection of named) {
        const declared: object[] = [
            ...Object.values(collection.properties).filter(property => property.type === "relation"),
            ...("relations" in collection && Array.isArray(collection.relations) ? collection.relations : [])
        ];
        for (const relation of declared) {
            const target = relationTargetSlug(relation);
            const found = target ? bySlug(target) : undefined;
            if (found && !included.has(found.slug) && grant(found).read) included.set(found.slug, found);
        }
    }
    // A target's own relations reach collections the view was not given, so
    // `forView` drops those fields: a relation field whose target is missing
    // has nothing to pick from.

    const sanitized = [...included.values()].map(collection =>
        forView(collection, viewer, grant(collection), slug => included.has(slug)));
    const serialized = serializeCollections(sanitized);
    // `serializeCollections` drops the collection's `admin` block — its job is
    // describing data — so the presentation the view draws with goes back on
    // here, already reduced to data.
    return serialized.map(entry => {
        if (!isRecord(entry) || typeof entry.slug !== "string") return entry;
        const source = included.get(entry.slug);
        const admin = source ? presentationOf(source) : undefined;
        return admin ? { ...entry, admin } : entry;
    });
}

/** The tool arguments a block's collection is named by: the collection's data path. */
export function viewCollectionName(collection: CollectionConfig): string {
    return getCollectionDataPath(collection);
}

function forView(
    collection: CollectionConfig,
    viewer: FieldViewer,
    grant: McpViewGrant,
    included: (slug: string) => boolean
): CollectionConfig {
    const {
        callbacks: _callbacks,
        subcollections: _subcollections,
        indexes: _indexes,
        dataSource: _dataSource,
        databaseId: _databaseId,
        metadata: _metadata,
        admin: _admin,
        ...rest
    } = collection as CollectionConfig & Record<string, unknown>;

    const properties: Record<string, Property> = {};
    for (const [key, property] of Object.entries(collection.properties)) {
        const shown = forViewProperty(property, viewer, included);
        if (shown) properties[key] = shown;
    }

    // The relations the view can follow: those whose target it was given.
    const relations = Array.isArray(rest.relations)
        ? (rest.relations as unknown[]).filter(relation => {
            const slug = isRecord(relation) ? relationTargetSlug(relation) : undefined;
            return slug === undefined || included(slug);
        })
        : undefined;

    return {
        ...rest,
        properties,
        ...(relations && { relations }),
        securityRules: [...(collection.securityRules ?? []), ...closedOperations(grant)]
    } as CollectionConfig;
}

/**
 * A restrictive rule closing what this connection was not granted. The admin
 * panel evaluates security rules before it offers an action, and a
 * restrictive rule that cannot pass closes the operation for everybody — a
 * role nobody holds is the rule's only condition.
 */
function closedOperations(grant: McpViewGrant): SecurityRule[] {
    const closed = [
        ...(grant.write ? [] : ["insert", "update"] as const),
        ...(grant.delete ? [] : ["delete"] as const)
    ];
    if (closed.length === 0) return [];
    return [{
        name: "mcp_connection_scope",
        mode: "restrictive",
        operations: closed,
        roles: [NO_ROLE]
    } as SecurityRule];
}

/** A role no account holds: the condition of a rule meant never to pass. */
const NO_ROLE = "__mcp_connection_not_granted__";

/** Admin options that are components or code: nothing the view could run. */
const COMPONENT_OPTIONS = ["Field", "Preview", "Filter", "customProps"];

function forViewProperty(property: Property, viewer: FieldViewer, included: (slug: string) => boolean): Property | undefined {
    if (property.excludeFromApi === true || !canReadField(property, viewer)) return undefined;
    if (property.type === "relation") {
        const target = relationTargetSlug(property);
        if (target !== undefined && !included(target)) return undefined;
    }
    const admin: Record<string, unknown> = "admin" in property && isRecord(property.admin) ? { ...property.admin } : {};
    for (const option of COMPONENT_OPTIONS) delete admin[option];
    if (!canWriteField(property, viewer)) admin.readOnly = true;

    const shown = { ...property, admin } as Property & Record<string, unknown>;
    if (shown.type === "map" && shown.properties) {
        const nested: Record<string, Property> = {};
        for (const [key, child] of Object.entries(shown.properties)) {
            const kept = forViewProperty(child, viewer, included);
            if (kept) nested[key] = kept;
        }
        shown.properties = nested;
    }
    if (shown.type === "array" && shown.of) {
        if (Array.isArray(shown.of)) {
            shown.of = shown.of.map(item => forViewProperty(item, viewer, included))
                .filter((item): item is Property => item !== undefined);
        } else {
            const of = forViewProperty(shown.of, viewer, included);
            if (!of) return undefined;
            shown.of = of;
        }
    }
    return shown;
}

/**
 * The collection's `admin` block, reduced to the presentation the view draws
 * with — each option a plain value. A `display` role or an icon written as a
 * function stays the admin panel's.
 */
function presentationOf(collection: CollectionConfig): Record<string, unknown> | undefined {
    const admin = (collection as { admin?: unknown }).admin;
    if (!isRecord(admin)) return undefined;
    const kept: Record<string, unknown> = {};
    for (const option of PRESENTATION_OPTIONS) {
        const value = admin[option];
        if (value !== undefined && isPlainData(value)) kept[option] = value;
    }
    if (isRecord(admin.display)) {
        const display = Object.fromEntries(Object.entries(admin.display).filter(([, role]) => typeof role === "string"));
        if (Object.keys(display).length > 0) kept.display = display;
    }
    if (typeof admin.icon === "string") kept.icon = admin.icon;
    // The view's own blocks decide where a record opens.
    delete kept.openEntityMode;
    return Object.keys(kept).length > 0 ? kept : undefined;
}

const PRESENTATION_OPTIONS = [
    "propertiesOrder", "previewProperties", "listProperties", "enabledViews", "defaultViewMode", "kanban",
    "defaultSize", "inlineEditing", "hideIdFromForm", "hideIdFromCollection", "sort", "defaultFilter", "fixedFilter",
    "pagination", "group", "form", "formView", "includeJsonView", "alwaysApplyDefaultValues", "disableDefaultActions",
    "selectionEnabled", "orderProperty"
] as const;

/** JSON all the way down: no function, no class instance a `postMessage` would mangle. */
function isPlainData(value: unknown, depth = 0): boolean {
    if (depth > 12) return false;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
    if (Array.isArray(value)) return value.every(item => isPlainData(item, depth + 1));
    if (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.values(value).every(item => item === undefined || isPlainData(item, depth + 1));
    }
    return false;
}

/** The slug a relation (or a relation property) points at, where it can be told without resolving anything. */
function relationTargetSlug(holder: object): string | undefined {
    const relation = "relation" in holder && isRecord(holder.relation) ? holder.relation : holder;
    const target = isRecord(relation) ? relation.target : undefined;
    if (typeof target === "string") return target;
    if (typeof target === "function") {
        try {
            const resolved: unknown = target();
            const config = isRecord(resolved) && isRecord(resolved.default) ? resolved.default : resolved;
            return isRecord(config) && typeof config.slug === "string" ? config.slug : undefined;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
