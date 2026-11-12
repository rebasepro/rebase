/**
 * The screen a show_* tool asked for, read from its result
 * (`McpViewPayload` in the server's `mcp/mcp-view.ts`).
 *
 * The payload carries the descriptors of the tables the screen draws, as the
 * server serves this caller (columns they may not read and raw policy SQL
 * already left out), and what the connection was granted on each. The view
 * renders them as the admin panel renders the tables `GET /api/schema/tables`
 * serves: projected, with the project's `customizeTable` customizations where
 * the view was built from the project's frontend, then the UI preferences the
 * payload carries (the workspace's and the caller's), folded as the panel
 * folds them.
 */
import {
    ALL_WHERE_FILTER_OPS,
    isUiTablePreferences,
    type FilterValues,
    type TableDescriptor,
    type UiPreferences,
    type WhereFilterOp
} from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { isRecord, type ToolResult } from "./bridge";
import { DEFAULT_ACTIONS, textOf, type SeedPage, type ToolAction, type ViewActions } from "./tool_driver";

export type ViewMode = "table" | "list" | "cards" | "kanban";

/** Rows of one table, in the admin panel's collection view (show_table). */
export interface TableBlock {
    key: string;
    type: "table";
    /** The table's slug, as the tools take it. */
    table: string;
    view?: ViewMode;
    where?: Record<string, unknown>;
    orderBy?: unknown;
    searchString?: string;
    limit?: number;
}

/** One row's form, or a new row's (show_record). */
export interface RecordBlock {
    key: string;
    type: "record";
    table: string;
    id?: string;
    values?: Record<string, unknown>;
}

/** An app the model wrote: compiled CommonJS, and the tables it reads. */
export interface AppBlock {
    key: string;
    type: "app";
    code: string;
    tables: string[];
}

export type Block = TableBlock | RecordBlock | AppBlock;

/** What the connection's scopes allow on one table. */
export interface TableGrant {
    read: boolean;
    write: boolean;
    delete: boolean;
}

/**
 * How the screen's tables are presented: the UI preference layers the server
 * holds, folded by `<RebaseCMS>` as on the project's page — `file` as its
 * `uiConfig`, then `workspace`, then `user`.
 */
export interface ScreenPreferences {
    /** `ui-config.json`, as the server knows it. */
    file: UiPreferences;
    /** The workspace's, stored by the server. */
    workspace: UiPreferences;
    /** The person's own. */
    user: UiPreferences;
}

export interface Screen {
    title?: string;
    blocks: Block[];
    /** The descriptors the screen draws, as the server serves this caller. */
    tables: TableDescriptor[];
    /** What the connection was granted on each table in {@link tables}, by slug. */
    grants: Record<string, TableGrant>;
    /** How the tables are presented: the server's UI preference layers. */
    preferences: ScreenPreferences;
    viewer: { uid: string; roles: string[] };
    actions: ViewActions;
    /** The page show_table read for the model: what the table block reads first. */
    firstPage?: SeedPage;
    /** The pages show_app read ahead of the app's first render, one per table it names. */
    seeds?: SeedPage[];
}

export type Parsed =
    | { kind: "screen"; screen: Screen }
    | { kind: "error"; message: string };

/**
 * The payload version this view draws: `MCP_VIEW_PAYLOAD_VERSION` in the
 * server's `mcp/mcp-view.ts`, bumped together. A host fetches the view for
 * the listing it holds (its address carries the document's hash), so a
 * mismatch is a host holding a stale document.
 */
export const PAYLOAD_VERSION = 3;

export function parseResult(result: ToolResult): Parsed {
    if (result.isError) return { kind: "error", message: textOf(result) ?? "The view could not be opened." };
    const content = result.structuredContent;
    if (!isRecord(content)) {
        return { kind: "error", message: "This view needs the tool's structured result, and the host did not pass it." };
    }
    const view = content.view;
    if (!isRecord(view)) return { kind: "error", message: "The result carries nothing this view can draw." };
    if (view.version !== PAYLOAD_VERSION) {
        return {
            kind: "error",
            message: typeof view.version === "number" && view.version > PAYLOAD_VERSION
                ? "This view is older than the server that answered; it cannot draw this screen."
                : "This view is newer than the server that answered; it cannot draw this screen."
        };
    }
    const tables = Array.isArray(view.tables) ? view.tables.filter(isTableDescriptor) : [];
    const blocks = Array.isArray(view.blocks) ? view.blocks.filter(isBlock) : [];
    if (blocks.length === 0) return { kind: "error", message: "The screen has no blocks." };
    const viewer = isRecord(view.viewer) ? view.viewer : {};
    // When the server read the rows the result carries: they are that old
    // however late the host draws it.
    const readAt = typeof view.readAt === "number" && Number.isFinite(view.readAt) ? view.readAt : undefined;
    const stamped = (page: SeedPage): SeedPage => readAt === undefined ? page : { ...page, readAt };
    const firstPage = firstPageOf(blocks[0], content);
    const seeds = Array.isArray(view.seeds) ? view.seeds.flatMap(seedOf).map(stamped) : [];
    return {
        kind: "screen",
        screen: {
            ...(typeof view.title === "string" && { title: view.title }),
            blocks,
            tables,
            grants: grantsOf(view.grants, tables),
            preferences: preferencesOf(view.preferences),
            viewer: {
                uid: typeof viewer.uid === "string" ? viewer.uid : "",
                roles: Array.isArray(viewer.roles) ? viewer.roles.filter((role): role is string => typeof role === "string") : []
            },
            actions: actionsOf(content.actions),
            ...(firstPage && { firstPage: stamped(firstPage) }),
            ...(seeds.length > 0 && { seeds })
        }
    };
}

/** A descriptor as the wire carries it: checked for the fields the projector reads first. */
function isTableDescriptor(value: unknown): value is TableDescriptor {
    return isRecord(value)
        && typeof value.slug === "string"
        && typeof value.table === "string"
        && Array.isArray(value.columns)
        && Array.isArray(value.relations)
        && Array.isArray(value.primaryKey)
        && isRecord(value.rls);
}

/** One layer as sent, keeping only valid table preferences: data from the wire, narrowed like the panel's. */
function layerOf(raw: unknown): UiPreferences {
    const tables: UiPreferences["tables"] = {};
    const listed = isRecord(raw) && isRecord(raw.tables) ? raw.tables : {};
    for (const [slug, preferences] of Object.entries(listed)) {
        if (isUiTablePreferences(preferences)) tables[slug] = preferences;
    }
    return { tables };
}

/** The preference layers as sent; an absent layer is empty. */
function preferencesOf(raw: unknown): ScreenPreferences {
    const sent = isRecord(raw) ? raw : {};
    return { file: layerOf(sent.file), workspace: layerOf(sent.workspace), user: layerOf(sent.user) };
}

/** Each table's grant as sent; a table the server sent none for is read-only. */
function grantsOf(raw: unknown, tables: readonly TableDescriptor[]): Record<string, TableGrant> {
    const sent = isRecord(raw) ? raw : {};
    return Object.fromEntries(tables.map(table => {
        const grant = sent[table.slug];
        return [table.slug, {
            read: !isRecord(grant) || grant.read !== false,
            write: isRecord(grant) && grant.write === true,
            delete: isRecord(grant) && grant.delete === true
        }];
    }));
}

/**
 * The rows a show_table result carries beside its screen — the page the
 * server read for the model — and the arguments that read them: the block's,
 * with the window the server says it read.
 */
function firstPageOf(block: Block, content: Record<string, unknown>): SeedPage | undefined {
    if (block.type !== "table" || !Array.isArray(content.data)) return undefined;
    const meta = isRecord(content.meta) ? content.meta : {};
    const limit = typeof meta.limit === "number" ? meta.limit : block.limit;
    return {
        collection: block.table,
        args: {
            ...(block.where && { where: block.where }),
            ...(block.orderBy !== undefined && { orderBy: block.orderBy }),
            ...(block.searchString && { searchString: block.searchString }),
            ...(limit !== undefined && { limit }),
            ...(typeof meta.offset === "number" && { offset: meta.offset })
        },
        rows: content.data.filter(isRecord)
    };
}

/** One page show_app read ahead, as the server sent it; nothing for one malformed. */
function seedOf(value: unknown): SeedPage[] {
    if (!isRecord(value) || typeof value.table !== "string" || !isRecord(value.args) || !Array.isArray(value.rows)) return [];
    return [{
        collection: value.table,
        args: value.args,
        rows: value.rows.filter(isRecord),
        ...(typeof value.total === "number" && { total: value.total })
    }];
}

function isBlock(value: unknown): value is Block {
    if (!isRecord(value) || typeof value.key !== "string") return false;
    if (value.type === "app") return typeof value.code === "string" && Array.isArray(value.tables);
    return typeof value.table === "string" && (value.type === "table" || value.type === "record");
}

/**
 * The tools a result says to read and write with, over the defaults. The
 * hosted connector's table named `edit` for what is `update` here.
 */
export function actionsOf(raw: unknown): ViewActions {
    if (!isRecord(raw)) return DEFAULT_ACTIONS;
    const action = (value: unknown, fallback: ToolAction): ToolAction => isRecord(value) && typeof value.tool === "string"
        ? { tool: value.tool, arguments: isRecord(value.arguments) ? value.arguments : {}, ...(value.plans === true && { plans: true }) }
        : fallback;
    return {
        page: action(raw.page, DEFAULT_ACTIONS.page),
        get: action(raw.get, DEFAULT_ACTIONS.get),
        count: action(raw.count, DEFAULT_ACTIONS.count),
        create: action(raw.create, DEFAULT_ACTIONS.create),
        update: action(raw.update ?? raw.edit, DEFAULT_ACTIONS.update),
        delete: action(raw.delete, DEFAULT_ACTIONS.delete),
        aggregate: action(raw.aggregate, DEFAULT_ACTIONS.aggregate)
    };
}

/** The collection a table's slug names: the table's view in the admin panel has the same slug. */
export function findCollection(collections: readonly AdminCollection[], name: string): AdminCollection | undefined {
    return collections.find(collection => collection.slug === name);
}

/**
 * A block's `where` as the admin panel's filter: each field's condition, or
 * list of conditions, kept where it is one the read tools take. The server
 * checked it before it opened the screen.
 */
export function filterOf(where: Record<string, unknown> | undefined): FilterValues<string> | undefined {
    if (!where) return undefined;
    const filter: FilterValues<string> = {};
    for (const [key, raw] of Object.entries(where)) {
        const single = conditionOf(raw);
        if (single) {
            filter[key] = single;
        } else if (Array.isArray(raw)) {
            const conditions = raw.map(conditionOf).filter((entry): entry is [WhereFilterOp, unknown] => entry !== undefined);
            if (conditions.length > 0 && conditions.length === raw.length) filter[key] = conditions;
        }
    }
    return filter;
}

function conditionOf(raw: unknown): [WhereFilterOp, unknown] | undefined {
    if (!Array.isArray(raw) || raw.length !== 2) return undefined;
    const op = ALL_WHERE_FILTER_OPS.find(candidate => candidate === raw[0]);
    return op ? [op, raw[1]] : undefined;
}

/** A sort as the collection view takes it: its first key. */
export function orderOf(raw: unknown): [string, "asc" | "desc"] | undefined {
    if (typeof raw === "string" && raw !== "") {
        const [field, direction] = raw.split(":");
        return [field, direction === "desc" ? "desc" : "asc"];
    }
    if (Array.isArray(raw) && raw.length > 0) {
        const first: unknown[] = Array.isArray(raw[0]) ? raw[0] : raw;
        if (typeof first[0] === "string") return [first[0], first[1] === "desc" ? "desc" : "asc"];
    }
    return undefined;
}
