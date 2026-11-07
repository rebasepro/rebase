import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    Alert,
    BooleanSwitch,
    Button,
    Chip,
    CircularProgress,
    IconButton,
    ImageIcon,
    Maximize2Icon,
    Select,
    SelectItem,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    TextField,
    Tooltip,
    Typography,
    cls,
    getColorSchemeForKey,
    getColorSchemeForSeed,
    iconSize
} from "@rebasepro/ui";
import { isRecord, type HostContext, type McpAppBridge, type ToolResult } from "../bridge";

/** A column as show_collection describes it (`tableColumns` in the server's `mcp-tools.ts`). */
interface Column {
    key: string;
    title: string;
    type: "string" | "number" | "boolean" | "date" | "other";
    enum?: { id: string | number; label: string; color?: string }[];
    editable: boolean;
}

/** A tool the view calls, and the arguments it always sends to it. */
interface ToolAction {
    tool: string;
    arguments: Record<string, unknown>;
}

/**
 * What the view calls to page and to save a cell. The server that served it
 * may name its own (`actions` in show_collection's result): the hosted Rebase
 * connector pages with `query` and saves with `write`, each with the project.
 * Absent, they are the app's own `/mcp` tools.
 */
interface TableActions {
    page: ToolAction;
    edit: ToolAction;
}

const DEFAULT_ACTIONS: TableActions = {
    page: { tool: "query_collection", arguments: {} },
    edit: { tool: "update_document", arguments: {} }
};

/** show_collection's structured result. */
interface TablePage {
    collection: string;
    title: string;
    idKey: string;
    columns: Column[];
    writable: boolean;
    data: Record<string, unknown>[];
    total?: number;
    hasMore: boolean;
    actions: TableActions;
}

/**
 * A save the server answered with a plan instead of running: it is held here
 * until the person confirms it, then sent again with the plan's token.
 */
interface PendingSave {
    row: Row;
    column: Column;
    value: unknown;
    args: Record<string, unknown>;
    confirm: string;
    summary: string;
}

/** One edit the person made here, kept to tell the model. */
interface Edit {
    id: string;
    key: string;
    value: unknown;
}

type Row = Record<string, unknown>;

export function CollectionTable({ bridge }: { bridge: McpAppBridge }) {
    const [page, setPage] = useState<TablePage>();
    const [failure, setFailure] = useState<string>();
    const [loadingMore, setLoadingMore] = useState(false);
    const [editing, setEditing] = useState<{ id: string; key: string }>();
    const [saving, setSaving] = useState<Set<string>>(new Set());
    const [pending, setPending] = useState<PendingSave>();
    const inputRef = useRef<Record<string, unknown>>({});
    const editsRef = useRef<Edit[]>([]);
    const rootRef = useRef<HTMLDivElement>(null);
    const [context, setContext] = useState<HostContext>({});
    const fullscreen = context.displayMode === "fullscreen";
    const canExpand = !fullscreen && context.availableDisplayModes?.includes("fullscreen") === true;

    useEffect(() => bridge.watchHostContext(setContext), [bridge]);

    useEffect(() => {
        bridge.ontoolinput = (args) => {
            inputRef.current = args;
        };
        bridge.ontoolresult = (result) => {
            const parsed = pageOf(result);
            if (typeof parsed === "string") setFailure(parsed);
            else setPage(parsed);
        };
    }, [bridge]);

    // The host sizes the iframe to the document, which it cannot measure
    // across the sandbox. Measured at `max-content`, as the reference SDK
    // does, so an iframe already taller than the table can still shrink.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const measure = () => {
            const html = document.documentElement;
            const previous = html.style.height;
            html.style.height = "max-content";
            const height = Math.ceil(html.getBoundingClientRect().height);
            html.style.height = previous;
            bridge.sizeChanged(height);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(root);
        measure();
        return () => observer.disconnect();
    }, [bridge]);

    const loadMore = useCallback(async () => {
        if (!page) return;
        setLoadingMore(true);
        try {
            // The same read the model asked for, one page on. query_collection
            // and show_collection take the same arguments.
            // `offset` counts on from the one it asked for, and `collection`
            // is the page's own in case the host sent no tool input.
            const result = await bridge.callTool(page.actions.page.tool, {
                ...inputRef.current,
                ...page.actions.page.arguments,
                collection: page.collection,
                offset: (Number(inputRef.current.offset) || 0) + page.data.length
            });
            const next = rowsOf(result);
            if (typeof next === "string") setFailure(next);
            else setPage({ ...page, data: [...page.data, ...next.data], hasMore: next.hasMore, total: next.total ?? page.total });
        } catch (error) {
            setFailure(messageOf(error));
        } finally {
            setLoadingMore(false);
        }
    }, [bridge, page]);

    /**
     * Send one cell's save — the first time, or with a plan's token once the
     * person confirmed it — and apply it when it ran.
     */
    const send = useCallback(async (row: Row, column: Column, value: unknown, args: Record<string, unknown>) => {
        if (!page) return;
        const id = String(row[page.idKey] ?? row.id);
        const cellKey = `${id}:${column.key}`;
        setSaving(current => new Set(current).add(cellKey));
        setFailure(undefined);
        try {
            const result = await bridge.callTool(page.actions.edit.tool, args);
            if (result.isError) throw new Error(textOf(result) ?? "The row could not be saved.");
            // The server wants the person's yes first: nothing was saved.
            const plan = planOf(result);
            if (plan) {
                setPending({ row, column, value, args, ...plan });
                return;
            }
            setPage(current => current && {
                ...current,
                data: current.data.map(candidate => String(candidate[current.idKey] ?? candidate.id) === id
                    ? { ...candidate, [column.key]: value }
                    : candidate)
            });
            editsRef.current = [
                ...editsRef.current.filter(edit => edit.id !== id || edit.key !== column.key),
                { id, key: column.key, value }
            ];
            // Sent with the person's next message, so the model knows the
            // rows it read are not the rows there are any more.
            await bridge.updateModelContext(
                `In the table of "${page.collection}", the user changed and saved: `
                + editsRef.current.map(edit => `row ${edit.id}, ${edit.key} → ${JSON.stringify(edit.value)}`).join("; ")
                + ".");
        } catch (error) {
            setFailure(messageOf(error));
        } finally {
            setSaving(current => {
                const next = new Set(current);
                next.delete(cellKey);
                return next;
            });
        }
    }, [bridge, page]);

    const save = useCallback(async (row: Row, column: Column, value: unknown) => {
        if (!page) return;
        const id = String(row[page.idKey] ?? row.id);
        setEditing(undefined);
        setPending(undefined);
        if (value === row[column.key]) return;
        await send(row, column, value, {
            ...page.actions.edit.arguments,
            collection: page.collection,
            id,
            data: { [column.key]: value }
        });
    }, [page, send]);

    const confirmPending = useCallback(async () => {
        if (!pending) return;
        setPending(undefined);
        await send(pending.row, pending.column, pending.value, { ...pending.args, confirm: pending.confirm });
    }, [pending, send]);

    return (
        <div ref={rootRef} className={cls("flex flex-col gap-3 p-4 bg-surface-sheet", fullscreen && "h-screen")}>
            {page ? (
                <>
                    <div className="flex items-center justify-between gap-3">
                        <Typography variant="subtitle2" noWrap>{page.title}</Typography>
                        <div className="flex items-center gap-2 min-w-0">
                            <Typography variant="caption" color="secondary" noWrap>
                                {page.total !== undefined && page.total >= page.data.length
                                    ? `${page.data.length} of ${page.total.toLocaleString()} rows`
                                    : `${page.data.length} rows`}
                                {page.writable ? " · click a cell to edit" : ""}
                            </Typography>
                            {canExpand && (
                                <Tooltip title="Expand">
                                    <IconButton
                                        size="small"
                                        aria-label="Expand"
                                        onClick={() => void bridge.requestDisplayMode("fullscreen").catch(() => undefined)}
                                    >
                                        <Maximize2Icon size={iconSize.smallest}/>
                                    </IconButton>
                                </Tooltip>
                            )}
                        </div>
                    </div>

                    {failure && <Alert color="error" size="small">{failure}</Alert>}

                    {pending && (
                        <Alert
                            color="warning"
                            size="small"
                            action={
                                <div className="flex gap-1">
                                    <Button variant="text" color="neutral" size="small" onClick={() => setPending(undefined)}>
                                        Cancel
                                    </Button>
                                    <Button variant="filled" color="primary" size="small" onClick={confirmPending}>
                                        Save
                                    </Button>
                                </div>
                            }
                        >
                            {pending.summary}
                        </Alert>
                    )}

                    <ScrollArea fullscreen={fullscreen}>
                        <Table className="w-full">
                            <TableHeader className={cls(fullscreen && "sticky top-0 z-10")}>
                                {page.columns.map(column => (
                                    <TableCell key={column.key} header className="whitespace-nowrap">
                                        {/* One line: a long title would make the header row two or three rows tall. */}
                                        <span className="block max-w-48 truncate" title={column.title}>{column.title}</span>
                                    </TableCell>
                                ))}
                            </TableHeader>
                            <TableBody>
                                {page.data.map(row => {
                                    const id = String(row[page.idKey] ?? row.id);
                                    return (
                                        <TableRow key={id}>
                                            {page.columns.map(column => {
                                                const cellKey = `${id}:${column.key}`;
                                                return (
                                                    <TableCell
                                                        key={column.key}
                                                        className={cls(
                                                            "whitespace-nowrap",
                                                            column.editable && "cursor-text",
                                                            saving.has(cellKey) && "opacity-50"
                                                        )}
                                                    >
                                                        <Cell
                                                            row={row}
                                                            column={column}
                                                            editing={editing?.id === id && editing.key === column.key}
                                                            onEdit={() => column.editable && setEditing({ id, key: column.key })}
                                                            onCancel={() => setEditing(undefined)}
                                                            onSave={value => save(row, column, value)}
                                                        />
                                                    </TableCell>
                                                );
                                            })}
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </ScrollArea>

                    {page.data.length === 0 && (
                        <Typography variant="body2" color="secondary">No rows match, or none are visible to you.</Typography>
                    )}

                    {page.hasMore && (
                        <div>
                            <Button variant="text" color="neutral" size="small" onClick={loadMore} disabled={loadingMore}>
                                {loadingMore ? "Loading…" : "Load more"}
                            </Button>
                        </div>
                    )}
                </>
            ) : failure ? (
                <Alert color="error" size="small">{failure}</Alert>
            ) : (
                <div className="flex items-center gap-2">
                    <CircularProgress size="smallest"/>
                    <Typography variant="body2" color="secondary">Loading rows…</Typography>
                </div>
            )}
        </div>
    );
}

interface CellProps {
    row: Row;
    column: Column;
    editing: boolean;
    onEdit: () => void;
    onCancel: () => void;
    onSave: (value: unknown) => void;
}

function Cell({ row, column, editing, onEdit, onCancel, onSave }: CellProps) {
    const value = row[column.key];

    // A switch is its own editor: one click is the edit.
    if (column.type === "boolean" && column.editable) {
        return (
            <BooleanSwitch
                size="small"
                value={value === true}
                aria-label={column.title}
                onValueChange={next => onSave(next)}
            />
        );
    }

    // An enum cell is a select that looks like its chip, as the admin
    // table's is (`VirtualTableSelect`): the trigger opens it, so it is never
    // mounted already open — which Radix dismisses as it mounts.
    if (column.enum && column.editable) {
        const entries = column.enum;
        return (
            <Select
                invisible
                size="smallest"
                padding={false}
                position="item-aligned"
                className="bg-transparent"
                value={value === null || value === undefined ? "" : String(value)}
                renderValue={key => <Display column={column} value={key}/>}
                onValueChange={next => {
                    const entry = entries.find(candidate => String(candidate.id) === next);
                    onSave(entry ? entry.id : next);
                }}
            >
                {entries.map(entry => (
                    <SelectItem key={String(entry.id)} value={String(entry.id)} textValue={entry.label}>
                        <Display column={column} value={entry.id}/>
                    </SelectItem>
                ))}
            </Select>
        );
    }

    if (editing) {
        return <InlineTextEditor column={column} value={value} onCancel={onCancel} onSave={onSave}/>;
    }

    return (
        <div onClick={onEdit} className="min-h-6 flex items-center">
            <Display column={column} value={value}/>
        </div>
    );
}

function InlineTextEditor({ column, value, onCancel, onSave }: {
    column: Column;
    value: unknown;
    onCancel: () => void;
    onSave: (value: unknown) => void;
}) {
    const original = value === null || value === undefined ? "" : String(value);
    const [draft, setDraft] = useState(original);
    const commit = () => {
        // Left as it was: nothing to save. An empty cell stays null, not "".
        if (draft === original) return onCancel();
        if (column.type === "number") {
            const parsed = draft.trim() === "" ? null : Number(draft);
            if (parsed !== null && Number.isNaN(parsed)) return onCancel();
            return onSave(parsed);
        }
        return onSave(draft);
    };
    return (
        <TextField
            size="small"
            autoFocus
            type={column.type === "number" ? "number" : "text"}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    commit();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    onCancel();
                }
            }}
        />
    );
}

function Display({ column, value }: { column: Column; value: unknown }) {
    if (value === null || value === undefined || value === "") {
        return <Typography variant="body2" color="disabled">—</Typography>;
    }
    const entry = column.enum?.find(candidate => String(candidate.id) === String(value));
    if (entry) {
        return (
            <Chip size="small" colorScheme={entry.color ? getColorSchemeForKey(entry.color) : getColorSchemeForSeed(String(entry.id))}>
                {entry.label}
            </Chip>
        );
    }
    if (column.type === "boolean") {
        return <Typography variant="body2">{value === true ? "Yes" : "No"}</Typography>;
    }
    if (column.type === "date" && typeof value === "string") {
        const date = new Date(value);
        return <Typography variant="body2">{Number.isNaN(date.getTime()) ? value : date.toLocaleString()}</Typography>;
    }
    if (typeof value === "string" && isImageUrl(value)) {
        return <Thumbnail url={value}/>;
    }
    // A list of plain values reads as one: `Rock, 90s`, not `["Rock","90s"]`.
    const text = typeof value === "string"
        ? value
        : Array.isArray(value) && value.every(item => typeof item !== "object" || item === null)
            ? value.join(", ")
            : JSON.stringify(value);
    return <Typography variant="body2" className="truncate max-w-64" title={text}>{text}</Typography>;
}

const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i;

/** An http(s) address whose path names an image file. */
function isImageUrl(value: string): boolean {
    if (!/^https?:\/\//i.test(value)) return false;
    try {
        return IMAGE_PATH.test(new URL(value).pathname);
    } catch {
        return false;
    }
}

/**
 * The image itself where the host lets it load; a small label where it does
 * not. A host loads only the origins the view declared, and this view cannot
 * know a project's image hosts in advance, so in most hosts the label is what
 * shows — instead of the address, which says nothing at a glance.
 */
function Thumbnail({ url }: { url: string }) {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return (
            <span className="inline-flex items-center gap-1 text-text-secondary dark:text-text-secondary-dark" title={url}>
                <ImageIcon size={iconSize.smallest}/>
                <Typography variant="body2" color="secondary">Image</Typography>
            </span>
        );
    }
    return (
        <img
            src={url}
            alt=""
            title={url}
            loading="lazy"
            onError={() => setFailed(true)}
            className="block size-8 rounded object-cover bg-surface-card-hover"
        />
    );
}

/**
 * The table's scroller. Inline it scrolls sideways and its height is the
 * table's, which the host sizes the frame to; a fade on an edge says there
 * are more columns that way. Fullscreen it also scrolls down, under a header
 * that stays.
 */
function ScrollArea({ fullscreen, children }: { fullscreen: boolean; children: React.ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState({ left: false, right: false });

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        const update = () => setEdges({
            left: element.scrollLeft > 1,
            right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1
        });
        update();
        element.addEventListener("scroll", update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(element);
        if (element.firstElementChild) observer.observe(element.firstElementChild);
        return () => {
            element.removeEventListener("scroll", update);
            observer.disconnect();
        };
    }, []);

    return (
        <div className={cls("relative", fullscreen && "flex-1 min-h-0")}>
            <div ref={ref} className={cls("overflow-x-auto", fullscreen && "h-full overflow-y-auto")}>
                {children}
            </div>
            {edges.left && <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-linear-to-r from-surface-sheet"/>}
            {edges.right && <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-linear-to-l from-surface-sheet"/>}
        </div>
    );
}

function pageOf(result: ToolResult): TablePage | string {
    if (result.isError) return textOf(result) ?? "The rows could not be read.";
    const content = result.structuredContent;
    if (!isRecord(content) || typeof content.collection !== "string" || !Array.isArray(content.columns)) {
        return "This view needs show_collection's structured result, and the host did not pass it.";
    }
    const rows = rowsOf(result);
    if (typeof rows === "string") return rows;
    return {
        collection: content.collection,
        title: typeof content.title === "string" ? content.title : content.collection,
        idKey: typeof content.idKey === "string" ? content.idKey : "id",
        columns: content.columns.filter(isRecord).map(columnOf),
        writable: content.writable === true,
        actions: actionsOf(content.actions),
        ...rows
    };
}

function actionsOf(raw: unknown): TableActions {
    if (!isRecord(raw)) return DEFAULT_ACTIONS;
    const action = (value: unknown, fallback: ToolAction): ToolAction => isRecord(value) && typeof value.tool === "string"
        ? { tool: value.tool, arguments: isRecord(value.arguments) ? value.arguments : {} }
        : fallback;
    return { page: action(raw.page, DEFAULT_ACTIONS.page), edit: action(raw.edit, DEFAULT_ACTIONS.edit) };
}

/** The plan and token of a result that asks for confirmation before it runs (the server's `confirmation.ts`). */
function planOf(result: ToolResult): { confirm: string; summary: string } | undefined {
    const content = result.structuredContent;
    if (!isRecord(content) || content.status !== "confirmation_required" || typeof content.confirm !== "string") return undefined;
    const plan = isRecord(content.plan) ? content.plan : {};
    return {
        confirm: content.confirm,
        summary: typeof plan.summary === "string" ? plan.summary : "Save this change?"
    };
}

/** The rows and paging of a read — show_collection's or query_collection's. */
function rowsOf(result: ToolResult): { data: Row[]; total?: number; hasMore: boolean } | string {
    if (result.isError) return textOf(result) ?? "The rows could not be read.";
    const content = result.structuredContent;
    if (!isRecord(content) || !Array.isArray(content.data)) return "The read returned no rows.";
    const meta = isRecord(content.meta) ? content.meta : {};
    return {
        data: content.data.filter(isRecord),
        ...(typeof meta.total === "number" && { total: meta.total }),
        hasMore: meta.hasMore === true
    };
}

function columnOf(raw: Record<string, unknown>): Column {
    const type = raw.type === "string" || raw.type === "number" || raw.type === "boolean" || raw.type === "date"
        ? raw.type
        : "other";
    const enumValues = Array.isArray(raw.enum)
        ? raw.enum.filter(isRecord).map(entry => ({
            id: typeof entry.id === "number" ? entry.id : String(entry.id),
            label: String(entry.label ?? entry.id),
            ...(typeof entry.color === "string" && { color: entry.color })
        }))
        : undefined;
    return {
        key: String(raw.key),
        title: String(raw.title ?? raw.key),
        type,
        ...(enumValues && { enum: enumValues }),
        editable: raw.editable === true
    };
}

function textOf(result: ToolResult): string | undefined {
    return result.content?.find(block => typeof block.text === "string")?.text;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
