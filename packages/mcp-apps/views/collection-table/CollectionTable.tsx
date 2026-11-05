import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    Alert,
    BooleanSwitch,
    Button,
    Chip,
    CircularProgress,
    Select,
    SelectItem,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    TextField,
    Typography,
    cls,
    getColorSchemeForKey,
    getColorSchemeForSeed
} from "@rebasepro/ui";
import { isRecord, type McpAppBridge, type ToolResult } from "../bridge";

/** A column as show_collection describes it (`tableColumns` in the server's `mcp-tools.ts`). */
interface Column {
    key: string;
    title: string;
    type: "string" | "number" | "boolean" | "date" | "other";
    enum?: { id: string | number; label: string; color?: string }[];
    editable: boolean;
}

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
    const inputRef = useRef<Record<string, unknown>>({});
    const editsRef = useRef<Edit[]>([]);
    const rootRef = useRef<HTMLDivElement>(null);

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
            const result = await bridge.callTool("query_collection", {
                ...inputRef.current,
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

    const save = useCallback(async (row: Row, column: Column, value: unknown) => {
        if (!page) return;
        const id = String(row[page.idKey] ?? row.id);
        setEditing(undefined);
        if (value === row[column.key]) return;
        const cellKey = `${id}:${column.key}`;
        setSaving(current => new Set(current).add(cellKey));
        setFailure(undefined);
        try {
            const result = await bridge.callTool("update_document", {
                collection: page.collection,
                id,
                data: { [column.key]: value }
            });
            if (result.isError) throw new Error(textOf(result) ?? "The row could not be saved.");
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

    return (
        <div ref={rootRef} className="flex flex-col gap-3 p-4 bg-surface-sheet">
            {page ? (
                <>
                    <div className="flex items-baseline justify-between gap-3">
                        <Typography variant="subtitle2" noWrap>{page.title}</Typography>
                        <Typography variant="caption" color="secondary" noWrap>
                            {page.total !== undefined && page.total >= page.data.length
                                ? `${page.data.length} of ${page.total} rows`
                                : `${page.data.length} rows`}
                            {page.writable ? " · click a cell to edit" : ""}
                        </Typography>
                    </div>

                    {failure && <Alert color="error" size="small">{failure}</Alert>}

                    <div className="overflow-x-auto">
                        <Table className="w-full">
                            <TableHeader>
                                {page.columns.map(column => (
                                    <TableCell key={column.key} header>{column.title}</TableCell>
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
                    </div>

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
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return <Typography variant="body2" className="truncate max-w-80">{text}</Typography>;
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
        ...rows
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
