/**
 * The screen a show_* tool asked for, read from its result
 * (`McpViewPayload` in the server's `mcp/mcp-view.ts`).
 *
 * A result with no payload is one from a server that only knew the table
 * (show_collection before 0.29): the view draws that table.
 */
import {
    ALL_WHERE_FILTER_OPS,
    deserializeCollections,
    getCollectionDataPath,
    type CollectionConfig,
    type FilterValues,
    type WhereFilterOp
} from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { isRecord, type ToolResult } from "../bridge";
import { DEFAULT_ACTIONS, textOf, type ToolAction, type ViewActions } from "./tool-driver";

export type ViewMode = "table" | "list" | "cards" | "kanban";

export interface CollectionBlock {
    key: string;
    type: "collection";
    collection: string;
    view?: ViewMode;
    where?: Record<string, unknown>;
    orderBy?: unknown;
    searchString?: string;
    limit?: number;
}

export interface RecordBlock {
    key: string;
    type: "record";
    collection: string;
    id?: string;
    values?: Record<string, unknown>;
}

/** An app the model wrote: compiled CommonJS, and the collections it reads. */
export interface AppBlock {
    key: string;
    type: "app";
    code: string;
    collections: string[];
}

export type Block = CollectionBlock | RecordBlock | AppBlock;

export interface Screen {
    title?: string;
    blocks: Block[];
    collections: AdminCollection[];
    viewer: { uid: string; roles: string[] };
    actions: ViewActions;
}

export type Parsed =
    | { kind: "screen"; screen: Screen }
    /** A result from before the admin panel's views: the table's own columns. */
    | { kind: "table" }
    | { kind: "error"; message: string };

const PAYLOAD_VERSION = 1;

export function parseResult(result: ToolResult): Parsed {
    if (result.isError) return { kind: "error", message: textOf(result) ?? "The view could not be opened." };
    const content = result.structuredContent;
    if (!isRecord(content)) {
        return { kind: "error", message: "This view needs the tool's structured result, and the host did not pass it." };
    }
    const view = content.view;
    if (!isRecord(view)) {
        return Array.isArray(content.columns)
            ? { kind: "table" }
            : { kind: "error", message: "The result carries nothing this view can draw." };
    }
    if (view.version !== PAYLOAD_VERSION) {
        return { kind: "error", message: "This view is older than the server that answered; it cannot draw this screen." };
    }
    const collections = Array.isArray(view.collections)
        ? deserializeCollections(view.collections) as AdminCollection[]
        : [];
    const blocks = Array.isArray(view.blocks) ? view.blocks.filter(isBlock) : [];
    if (blocks.length === 0) return { kind: "error", message: "The screen has no blocks." };
    const viewer = isRecord(view.viewer) ? view.viewer : {};
    return {
        kind: "screen",
        screen: {
            ...(typeof view.title === "string" && { title: view.title }),
            blocks,
            collections,
            viewer: {
                uid: typeof viewer.uid === "string" ? viewer.uid : "",
                roles: Array.isArray(viewer.roles) ? viewer.roles.filter((role): role is string => typeof role === "string") : []
            },
            actions: actionsOf(content.actions)
        }
    };
}

function isBlock(value: unknown): value is Block {
    if (!isRecord(value) || typeof value.key !== "string") return false;
    if (value.type === "app") return typeof value.code === "string" && Array.isArray(value.collections);
    return typeof value.collection === "string" && (value.type === "collection" || value.type === "record");
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
        delete: action(raw.delete, DEFAULT_ACTIONS.delete)
    };
}

/** The collection a block names: by the name the tools take, which is its data path, or by slug. */
export function findCollection(collections: readonly AdminCollection[], name: string): AdminCollection | undefined {
    return collections.find(collection => getCollectionDataPath(collection as CollectionConfig) === name)
        ?? collections.find(collection => collection.slug === name);
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
