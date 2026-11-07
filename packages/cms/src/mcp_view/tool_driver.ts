/**
 * The admin panel's data layer, over the MCP tools of the server that served
 * this view.
 *
 * `<Rebase>` reads and writes through a `DataDriver`; this one turns each read
 * and write into a `tools/call` the host relays to the server — the same
 * tools, the same person, the same RLS as the model's own calls. Rows go and
 * come in the REST shape those tools speak (dates as ISO text, a belongsTo as
 * its foreign key); `<Rebase>` turns them into the admin panel's view model
 * and back, as it does for any driver.
 *
 * A write the server answers with a plan (the hosted connector's two-step
 * `write`) is held: the person is shown the plan and the write is sent again
 * with its token only if they confirm. The admin panel sees one save that
 * took a moment longer, or one that failed with "Not saved".
 */
import type {
    CollectionConfig,
    DataDriver,
    DeleteProps,
    FetchCollectionProps,
    FetchOneProps,
    ListenCollectionProps,
    ListenOneProps,
    SaveProps
} from "@rebasepro/types";
import { buildCompositeId, fieldKeyForColumn, getDeclaredPrimaryKeys, resolveCollectionRelations } from "@rebasepro/common";
import { isRecord, type ToolResult } from "./bridge";

/** A tool the view calls, and the arguments it always sends to it. */
export interface ToolAction {
    tool: string;
    arguments: Record<string, unknown>;
    /**
     * The tool answers a plan before it changes anything (the hosted
     * connector's `write`), so the person confirms there. Not set, an app's
     * own change is confirmed in the view before it is sent.
     */
    plans?: boolean;
}

/**
 * The tools the view reads and writes with. The server that served it may
 * name its own (`actions` in a show_* result): the hosted Rebase connector
 * reads with `query` and writes with `write`, each with the project. Absent,
 * they are an app's own `/mcp` tools.
 */
export interface ViewActions {
    page: ToolAction;
    get: ToolAction;
    count: ToolAction;
    create: ToolAction;
    update: ToolAction;
    delete: ToolAction;
}

export const DEFAULT_ACTIONS: ViewActions = {
    page: { tool: "query_collection", arguments: {} },
    get: { tool: "get_document", arguments: {} },
    count: { tool: "count_documents", arguments: {} },
    create: { tool: "create_document", arguments: {} },
    update: { tool: "update_document", arguments: {} },
    delete: { tool: "delete_document", arguments: {} }
};

/** What a write's first call answered instead of running: what it will do, for the person to confirm. */
export interface WritePlan {
    summary: string;
    effects?: string[];
    reversible?: string;
}

/** One change the person made here, as the model is told about it. */
export interface ViewChange {
    action: "created" | "updated" | "deleted";
    collection: string;
    id: string;
    fields?: string[];
}

/** The calls the driver makes: the bridge's `callTool`, as a function so a test can stand in for the host. */
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolDriverOptions {
    callTool: CallTool;
    actions: ViewActions;
    /** Show the person a write's plan; true when they confirm it. */
    confirm: (plan: WritePlan) => Promise<boolean>;
    /** Every change made through this driver, in order, after each one. */
    onChange?: (changes: readonly ViewChange[]) => void;
    /**
     * The name a collection is watched under, for a name the tools take
     * (its slug or its data path): an app names collections as the model
     * wrote them, the admin panel by slug, and a write must refresh both.
     */
    canonical?: (collection: string) => string;
}

type Row = Record<string, unknown>;

/**
 * The project's data, by collection, as an app reads and writes it: rows as
 * the read tools serve them, and every change confirmed by the person before
 * it is sent — by the server's plan where the tool plans, here otherwise.
 * What an app changes refreshes every view of that collection, the admin
 * panel's included.
 */
export interface ToolData {
    find(collection: string, args?: Record<string, unknown>): Promise<{ data: Row[]; total?: number; hasMore: boolean }>;
    get(collection: string, id: string | number): Promise<Row | undefined>;
    count(collection: string, where?: Record<string, unknown>): Promise<number>;
    create(collection: string, data: Row, id?: string | number): Promise<Row>;
    update(collection: string, id: string | number, data: Row): Promise<Row>;
    remove(collection: string, id: string | number): Promise<void>;
    /** Called after every change to `collection`; returns the unsubscribe. */
    watch(collection: string, refresh: () => void): () => void;
}

export interface ToolDriver {
    /** For `<Rebase>`: the admin panel's reads and saves. */
    driver: DataDriver;
    /** For an app's code. */
    data: ToolData;
}

/** A save the person declined at the plan. The form shows it as the save's error. */
export class SaveCancelledError extends Error {
    constructor() {
        super("Not saved: the change was not confirmed.");
        this.name = "SaveCancelledError";
    }
}

/** The ceiling every read tool takes for `limit` (`MAX_LIST_LIMIT`). */
const MAX_LIMIT = 1000;

export function createToolDriver(options: ToolDriverOptions): ToolDriver {
    const { callTool, actions, confirm, onChange } = options;
    const canonical = options.canonical ?? ((collection: string) => collection);
    const changes: ViewChange[] = [];
    // Who is drawing what: a write reads every list and record of its
    // collection again, which is how a row saved in one block shows in another.
    const watchers = new Map<string, Set<() => void>>();
    // A table draws each row's relations by reading the related row, so a
    // page of orders asks for the same customer many times over. Each read is
    // a round trip through the host: one per row is shared until a write.
    const rows = new Map<string, Promise<Record<string, unknown> | undefined>>();

    const call = async (action: ToolAction, args: Record<string, unknown>): Promise<unknown> => {
        const result = await callTool(action.tool, { ...action.arguments, ...args });
        if (result.isError) throw new Error(textOf(result) ?? "The server refused this call.");
        return result.structuredContent ?? parseText(result);
    };

    /** A write, through its plan where the server asks for one. */
    const write = async (action: ToolAction, args: Record<string, unknown>): Promise<unknown> => {
        const first = await call(action, args);
        const plan = planOf(first);
        if (!plan) return first;
        if (!await confirm(plan.plan)) throw new SaveCancelledError();
        const second = await call(action, { ...args, confirm: plan.token });
        if (planOf(second)) throw new Error("The server asked for confirmation again; nothing was saved.");
        return second;
    };

    const changed = (change: ViewChange) => {
        const key = canonical(change.collection);
        for (const row of rows.keys()) if (canonical(row.slice(0, row.lastIndexOf("/"))) === key) rows.delete(row);
        changes.push(change);
        onChange?.(changes);
        for (const watcher of watchers.get(key) ?? []) watcher();
    };

    const watch = (path: string, refresh: () => void): (() => void) => {
        const key = canonical(path);
        const set = watchers.get(key) ?? new Set();
        set.add(refresh);
        watchers.set(key, set);
        return () => {
            set.delete(refresh);
        };
    };

    /**
     * An app's change: confirmed by the person before it goes, where the
     * tool does not plan it itself — code can change rows without a click,
     * and every change it makes is theirs to agree to.
     */
    const appWrite = async (action: ToolAction, args: Record<string, unknown>, plan: WritePlan): Promise<unknown> => {
        if (!action.plans && !await confirm(plan)) throw new SaveCancelledError();
        return write(action, args);
    };

    /**
     * A page's rows into the row cache, keyed as {@link fetchOne} asks for
     * them: the row a view lists is the row its record opens with, and an
     * app's `get` of a row it was just shown asks the server nothing. By the
     * collection's key where its config is known, by `id` otherwise; a write
     * to the collection drops them, as it drops every row read. Not a page
     * that lists deleted rows: `get` answers none for those.
     */
    const remember = (collection: string, page: Row[], config?: FetchCollectionProps["collection"]) => {
        const keys = config ? getDeclaredPrimaryKeys(config) : [];
        for (const row of page) {
            const id = keys.length > 1 ? buildCompositeId(row, keys) : row[keys[0]?.fieldName ?? "id"];
            if (typeof id !== "string" && typeof id !== "number") continue;
            rows.set(`${collection}/${String(id)}`, Promise.resolve(row));
        }
    };

    const fetchCollection = async (props: FetchCollectionProps): Promise<Record<string, unknown>[]> => {
        const collection = collectionArg(props.path);
        const page = await call(actions.page, {
            collection,
            ...readArgs(props)
        });
        if (!isRecord(page) || !Array.isArray(page.data)) throw new Error("The read returned no rows.");
        const found = page.data.filter(isRecord);
        if (!props.withDeleted) remember(collection, found, props.collection);
        return found;
    };

    const fetchOne = (props: FetchOneProps): Promise<Record<string, unknown> | undefined> => {
        const collection = collectionArg(props.path);
        const key = `${collection}/${String(props.id)}`;
        const cached = rows.get(key);
        if (cached) return cached;
        const read = call(actions.get, { collection, id: String(props.id) })
            .then(row => isRecord(row) ? row : undefined)
            .catch((error: unknown) => {
                rows.delete(key);
                // One answer for "absent" and "not visible to you", by design.
                if (error instanceof Error && /^No row with id/.test(error.message)) return undefined;
                throw error;
            });
        rows.set(key, read);
        return read;
    };

    const data: ToolData = {
        async find(collection, args = {}) {
            const name = collectionArg(collection);
            const page = await call(actions.page, { ...args, collection: name });
            if (!isRecord(page) || !Array.isArray(page.data)) throw new Error("The read returned no rows.");
            const meta = isRecord(page.meta) ? page.meta : {};
            const found = page.data.filter(isRecord);
            if (args.deleted === undefined) remember(name, found);
            return {
                data: found,
                ...(typeof meta.total === "number" && { total: meta.total }),
                hasMore: meta.hasMore === true
            };
        },
        get: (collection, id) => fetchOne({ path: collection, id }),
        async count(collection, where) {
            const answer = await call(actions.count, { collection: collectionArg(collection), ...(where && { where }) });
            if (isRecord(answer) && typeof answer.count === "number") return answer.count;
            throw new Error("The count returned no number.");
        },
        async create(collection, values, id) {
            const saved = await appWrite(actions.create,
                { collection: collectionArg(collection), data: values, ...(id !== undefined && { id: String(id) }) },
                { summary: `Create a row in ${collection}.` });
            const row = isRecord(saved) ? saved : { ...values };
            changed({ action: "created", collection, id: String(row.id ?? id ?? ""), fields: Object.keys(values) });
            return row;
        },
        async update(collection, id, values) {
            const saved = await appWrite(actions.update,
                { collection: collectionArg(collection), id: String(id), data: values },
                { summary: `Change ${Object.keys(values).join(", ")} on row ${String(id)} of ${collection}.` });
            changed({ action: "updated", collection, id: String(id), fields: Object.keys(values) });
            return isRecord(saved) ? saved : { id, ...values };
        },
        async remove(collection, id) {
            await appWrite(actions.delete, { collection: collectionArg(collection), id: String(id) },
                { summary: `Delete row ${String(id)} of ${collection}.` });
            changed({ action: "deleted", collection, id: String(id) });
        },
        watch
    };

    const driver: DataDriver = {
        key: "(default)",
        initialised: true,

        fetchCollection,
        fetchOne,

        listenCollection(props: ListenCollectionProps): () => void {
            let live = true;
            const read = () => fetchCollection(props)
                .then(rows => live && props.onUpdate(rows))
                .catch(error => live && props.onError?.(error instanceof Error ? error : new Error(String(error))));
            void read();
            const stop = watch(collectionArg(props.path), () => void read());
            return () => {
                live = false;
                stop();
            };
        },

        listenOne(props: ListenOneProps): () => void {
            let live = true;
            const read = () => fetchOne(props)
                .then(row => live && props.onUpdate(row ?? null))
                .catch(error => live && props.onError?.(error instanceof Error ? error : new Error(String(error))));
            void read();
            const stop = watch(collectionArg(props.path), () => void read());
            return () => {
                live = false;
                stop();
            };
        },

        async save(props: SaveProps): Promise<Record<string, unknown>> {
            const collection = collectionArg(props.path);
            const data = toWire(props.values);
            const creating = props.status !== "existing";
            const saved = creating
                ? await write(actions.create, { collection, data, ...(props.id !== undefined && { id: String(props.id) }) })
                : await write(actions.update, { collection, id: String(props.id), data });
            const row = isRecord(saved) ? saved : { ...data };
            const id = String(row.id ?? props.id ?? "");
            changed({ action: creating ? "created" : "updated", collection, id, fields: Object.keys(data) });
            return row;
        },

        async delete(props: DeleteProps): Promise<void> {
            const collection = collectionArg(props.row.path);
            await write(actions.delete, { collection, id: String(props.row.id) });
            changed({ action: "deleted", collection, id: String(props.row.id) });
        },

        async count(props: FetchCollectionProps): Promise<number> {
            const answer = await call(actions.count, {
                collection: collectionArg(props.path),
                ...pickRead(readArgs(props), ["where", "searchString", "deleted"])
            });
            if (isRecord(answer) && typeof answer.count === "number") return answer.count;
            throw new Error("The count returned no number.");
        },

        // The server checks a unique field when the row is written; a check
        // here would be one more round trip through the host for each keystroke.
        async checkUniqueField(): Promise<boolean> {
            return true;
        }
    };

    return { driver, data };
}

/**
 * The collection a driver path names. The views open top-level collections
 * only; a subcollection path has no tool to read it.
 */
function collectionArg(path: string): string {
    if (path.includes("/")) throw new Error(`"${path}" is a subcollection, which this view cannot open.`);
    return path;
}

/** A read's arguments, as the read tools take them. */
function readArgs(props: FetchCollectionProps): Record<string, unknown> {
    const where = props.filter ? wireFilter(props.filter, props.collection) : undefined;
    const orderBy = wireOrderBy(props, props.collection);
    return {
        ...(where && Object.keys(where).length > 0 && { where }),
        ...(orderBy && { orderBy }),
        ...(props.searchString && { searchString: props.searchString }),
        ...(props.limit !== undefined && { limit: Math.min(props.limit, MAX_LIMIT) }),
        ...(props.offset && { offset: props.offset }),
        ...(props.withDeleted !== undefined && props.withDeleted !== false && {
            deleted: props.withDeleted === "only" ? "only" : "include"
        })
    };
}

function pickRead(args: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(args).filter(([name]) => names.includes(name)));
}

/**
 * The admin panel's filter as the read tools' `where`: a belongsTo is
 * filtered by its foreign key there, and a value is the wire's — a relation
 * its id, a date its ISO text.
 */
function wireFilter(filter: Record<string, unknown>, collection: CollectionConfig | undefined): Record<string, unknown> {
    const keys = foreignKeys(collection);
    const where: Record<string, unknown> = {};
    for (const [key, condition] of Object.entries(filter)) {
        if (condition === undefined) continue;
        where[keys.get(key) ?? key] = toWireValue(condition);
    }
    return where;
}

function wireOrderBy(props: FetchCollectionProps, collection: CollectionConfig | undefined): string | unknown[] | undefined {
    const keys = foreignKeys(collection);
    if (typeof props.orderBy === "string") {
        const field = keys.get(props.orderBy) ?? props.orderBy;
        return props.order ? `${field}:${props.order}` : field;
    }
    if (Array.isArray(props.orderBy) && props.orderBy.length > 0) {
        return props.orderBy.map(entry => Array.isArray(entry) && typeof entry[0] === "string"
            ? [keys.get(entry[0]) ?? entry[0], ...entry.slice(1)]
            : entry);
    }
    return undefined;
}

/**
 * A save's values as the write tools take them. A relation is sent as its id
 * under its own key — the write tools take a belongsTo by its name or by its
 * foreign key — and a date as ISO text. `undefined` is not sent.
 */
function toWire(values: Record<string, unknown>): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        data[key] = toWireValue(value);
    }
    return data;
}

function toWireValue(value: unknown): unknown {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (Array.isArray(value)) return value.map(toWireValue);
    if (isRecord(value)) {
        if ((value.__type === "relation" || value.__type === "reference") && "id" in value) return value.id;
        return Object.fromEntries(Object.entries(value)
            .filter(([, child]) => child !== undefined)
            .map(([key, child]) => [key, toWireValue(child)]));
    }
    return value;
}

/** A collection's belongsTo relations, by name → the foreign key its rows carry. */
function foreignKeys(collection: CollectionConfig | undefined): Map<string, string> {
    const keys = new Map<string, string>();
    if (!collection) return keys;
    try {
        for (const [name, relation] of Object.entries(resolveCollectionRelations(collection))) {
            if (relation.kind === "belongsTo" && relation.localKey) {
                keys.set(name, fieldKeyForColumn(collection, relation.localKey));
            }
        }
    } catch {
        // A relation whose target is not in this view: no key to rename.
    }
    return keys;
}

/** A write's plan and token, where its first call answered one (the server's `confirmation.ts`). */
function planOf(answer: unknown): { token: string; plan: WritePlan } | undefined {
    if (!isRecord(answer) || answer.status !== "confirmation_required" || typeof answer.confirm !== "string") return undefined;
    const plan = isRecord(answer.plan) ? answer.plan : {};
    return {
        token: answer.confirm,
        plan: {
            summary: typeof plan.summary === "string" ? plan.summary : "Save this change?",
            ...(Array.isArray(plan.effects) && { effects: plan.effects.filter((line): line is string => typeof line === "string") }),
            ...(typeof plan.reversible === "string" && { reversible: plan.reversible })
        }
    };
}

/** A result with no `structuredContent`: its text, as JSON where it is JSON. */
function parseText(result: ToolResult): unknown {
    const text = textOf(result);
    if (text === undefined) return undefined;
    // The server fences rows as untrusted data; the JSON is inside the fence.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < start) return undefined;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return undefined;
    }
}

export function textOf(result: ToolResult): string | undefined {
    return result.content?.find(block => typeof block.text === "string")?.text;
}

/** What the model is told the person changed here, sent with their next message. */
export function describeChanges(changes: readonly ViewChange[]): string {
    const lines = changes.map(change => change.action === "updated"
        ? `updated ${change.fields?.join(", ") || "fields"} on row ${change.id} of ${change.collection}`
        : `${change.action} row ${change.id} of ${change.collection}`);
    return `In the Rebase view, the user saved these changes: ${lines.join("; ")}. `
        + "Rows you read before them may be out of date.";
}
