/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { en } from "../../app/src/locales/en";
import type { SqlScriptColumn, SqlScriptResult, SqlScriptTable } from "@rebasepro/types";

/**
 * Editing a cell of the SQL console's results writes to the database and as
 * the role that read the row.
 *
 * Switching the database or the role left the results of the last run on
 * screen, and an edit of one of their cells ran its UPDATE on the database now
 * selected, with the key read from the other one: after `SELECT * FROM orders`
 * on app_prod and a switch to app_staging, editing prod's order 7 overwrote
 * staging's order 7 and reported "Row updated".
 */

type ExecuteOptions = { database?: string; role?: string };

const schemaColumns = [
    { schema: "public", table: "orders", column: "id", data_type: "integer", is_pk: true },
    { schema: "public", table: "orders", column: "status", data_type: "text", is_pk: false },
    { schema: "public", table: "posts", column: "id", data_type: "integer", is_pk: true },
    { schema: "public", table: "posts", column: "author_id", data_type: "integer", is_pk: false },
    { schema: "public", table: "authors", column: "id", data_type: "integer", is_pk: true },
    { schema: "public", table: "authors", column: "name", data_type: "text", is_pk: false }
];

const ORDERS = "SELECT * FROM orders";
const NOTES = "SELECT * FROM notes";
const POSTS_WITH_AUTHORS = "SELECT p.id, a.name FROM posts p JOIN authors a ON a.id = p.author_id";

const tableOf = (table: string): SqlScriptTable => ({ schema: "public", table, kind: "table", primaryKey: ["id"], hasInheritors: false });
const readFrom = (name: string, table: string): SqlScriptColumn => ({ name, source: { schema: "public", table, column: name } });

/** What the server answers for each query the console runs: rows, and where each column was read from. */
const scripts: Record<string, SqlScriptResult> = {
    [ORDERS]: {
        rows: [{ id: "7", status: "new" }],
        columns: [readFrom("id", "orders"), readFrom("status", "orders")],
        tables: [tableOf("orders")],
        notices: []
    },
    [NOTES]: {
        rows: [{ id: "3", title: "new", body: "", tag: null }],
        columns: [readFrom("id", "notes"), readFrom("title", "notes"), readFrom("body", "notes"), readFrom("tag", "notes")],
        tables: [tableOf("notes")],
        notices: []
    },
    [POSTS_WITH_AUTHORS]: {
        rows: [{ id: "1", name: "new" }],
        columns: [readFrom("id", "posts"), readFrom("name", "authors")],
        tables: [tableOf("posts"), tableOf("authors")],
        notices: []
    }
};

const scriptFor = (sql: string): SqlScriptResult | undefined =>
    Object.entries(scripts).find(([query]) => sql.startsWith(query))?.[1];

const executeSql = jest.fn(async (sql: string, _options?: ExecuteOptions): Promise<unknown> => {
    if (sql.includes("information_schema")) return schemaColumns;
    if (sql.includes("current_user")) return [{ role: "postgres" }];
    return scriptFor(sql)?.rows ?? [];
});
/** How many rows the next UPDATE reports it changed. */
let updatedRows = 1;
const runSqlScript = jest.fn(async (sql: string, _options?: ExecuteOptions): Promise<SqlScriptResult> =>
    sql.startsWith("UPDATE")
        ? { rows: [], columns: [], tables: [], notices: [], command: "UPDATE", rowCount: updatedRows }
        : scriptFor(sql) ?? { rows: [], columns: [], tables: [], notices: [] });
const databaseAdmin: Record<string, unknown> = {
    executeSql,
    runSqlScript,
    fetchAvailableDatabases: async () => ["app_prod", "app_staging"],
    fetchAvailableRoles: async () => ["postgres", "reader"],
    fetchCurrentDatabase: async () => "app_prod"
};

const translation = {
    t: (key: string, options?: Record<string, unknown>) => {
        const value = (en as unknown as Record<string, string>)[key] ?? key;
        return options
            ? value.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(options[k] ?? ""))
            : value;
    },
    i18n: { language: "en" }
};

const snackbarOpen = jest.fn((_props: { type: string; message: string }) => undefined);

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useRebaseContext: () => ({ databaseAdmin }),
    useStudioCollectionRegistry: () => ({ collections: [], getCollection: () => undefined }),
    useStudioSidePanelController: () => ({ open: jest.fn(), close: jest.fn() }),
    useSnackbarController: () => ({ open: snackbarOpen }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    IconForView: () => null,
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>,
    ConfirmationDialog: () => null
}));

// The kit's stub, with the three pieces an inline edit goes through made real
// enough to drive: the results grid renders its cells, a menu item can be
// pressed, and the cell editor is a textarea.
jest.mock("@rebasepro/ui", () => {
    const stub = jest.requireActual<Record<string, unknown>>("@rebasepro/ui");
    const overrides: Record<string, unknown> = {
        VirtualTable: ({ data, columns, cellRenderer }: {
            data?: Record<string, unknown>[];
            columns: { key: string; width: number }[];
            cellRenderer: (params: { rowData: Record<string, unknown>; column: { key: string; width: number }; rowIndex: number; columnIndex: number }) => React.ReactNode;
        }) => <div role="grid">
            {(data ?? []).map((rowData, rowIndex) => <div role="row" key={rowIndex}>
                {columns.map((column, columnIndex) => <div role="gridcell" key={column.key}>
                    {cellRenderer({ rowData, column, rowIndex, columnIndex })}
                </div>)}
            </div>)}
        </div>,
        MenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
            <button type="button" role="menuitem" onClick={onClick}>{children}</button>,
        TextareaAutosize: ({ defaultValue, onBlur, onKeyDown, onFocus }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) =>
            <textarea aria-label="cell editor" defaultValue={defaultValue} onBlur={onBlur} onKeyDown={onKeyDown} onFocus={onFocus}/>
    };
    return new Proxy(overrides, {
        get: (target, key: string | symbol) => typeof key === "string" && key in target ? target[key] : stub[key as string],
        has: () => true
    });
});

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
        <textarea aria-label="SQL" value={value} onChange={(e) => onChange(e.target.value)}/>
}));

import { SQLEditor } from "../src/components/SQLEditor/SQLEditor";

function label(key: keyof typeof en): string {
    const value = en[key];
    if (typeof value !== "string") throw new Error(`en.${String(key)} is not a string`);
    return value;
}

/** The UPDATEs sent, by either door, with the connection each was sent on. */
function updates(): [string, ExecuteOptions | undefined][] {
    return [...executeSql.mock.calls, ...runSqlScript.mock.calls]
        .filter(([sql]) => sql.startsWith("UPDATE"))
        .map(([sql, options]) => [sql, options]);
}

/** Runs `query` on app_prod as postgres and waits for its row. */
async function runQuery(query: string): Promise<void> {
    render(<SQLEditor/>);
    await screen.findByRole("menuitem", { name: "app_staging" });
    await waitFor(() => expect(executeSql.mock.calls.some(([sql]) => sql.includes("information_schema"))).toBe(true));
    fireEvent.change(await screen.findByLabelText("SQL"), { target: { value: query } });
    fireEvent.click(screen.getByRole("button", { name: label("studio_sql_run") }));
    await screen.findByText("new");
}

/** Runs `SELECT * FROM orders` on app_prod as postgres and waits for its row. */
async function selectOrders(): Promise<void> {
    await runQuery(ORDERS);
    const run = [...executeSql.mock.calls, ...runSqlScript.mock.calls].find(([sql]) => sql.startsWith(ORDERS));
    expect(run?.[1]).toEqual({ database: "app_prod", role: "postgres" });
}

async function editStatus(value: string): Promise<void> {
    fireEvent.doubleClick(screen.getByText("new"));
    const editor = await screen.findByLabelText("cell editor");
    fireEvent.change(editor, { target: { value } });
    fireEvent.keyDown(editor, { key: "Enter" });
}

/** Double-clicks the status cell and, if an editor opens, saves "shipped" in it. */
async function tryToEditStatus(): Promise<void> {
    fireEvent.doubleClick(screen.getByText("new"));
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const editor = screen.queryByLabelText("cell editor");
    if (!editor) return;
    fireEvent.change(editor, { target: { value: "shipped" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
    });
}

beforeEach(() => {
    updatedRows = 1;
    executeSql.mockClear();
    runSqlScript.mockClear();
    databaseAdmin.runSqlScript = runSqlScript;
    snackbarOpen.mockClear();
    localStorage.clear();
});

describe("inline editing a result row", () => {
    jest.setTimeout(20000);
    it("writes on the database and as the role the row was read with", async () => {
        await selectOrders();
        await editStatus("shipped");

        await waitFor(() => expect(updates()).toHaveLength(1));
        expect(updates()[0]).toEqual([
            "UPDATE \"public\".\"orders\" SET \"status\" = 'shipped' WHERE \"id\" = '7';",
            { database: "app_prod", role: "postgres" }
        ]);
    });

    it("says the row was updated, and shows the new value, when the database changed it", async () => {
        await selectOrders();
        await editStatus("shipped");

        await waitFor(() => expect(snackbarOpen).toHaveBeenCalledWith({ type: "success", message: label("studio_sql_row_updated") }));
        expect(screen.getByText("shipped")).toBeTruthy();
    });

    /**
     * An UPDATE that matches no row succeeds as far as the database is
     * concerned: a policy that lets the role read the row but not update it,
     * or a row changed or deleted since it was read. The console said "Row
     * updated successfully" and drew the new value over the old one.
     */
    it("does not report an edit that changed no row, and keeps the value that is stored", async () => {
        updatedRows = 0;
        await selectOrders();
        await editStatus("shipped");

        await waitFor(() => expect(snackbarOpen).toHaveBeenCalledWith({ type: "error", message: label("studio_sql_update_no_row") }));
        expect(snackbarOpen).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
        expect(screen.queryByText("shipped")).toBeNull();
        expect(screen.getByText("new")).toBeTruthy();
    });

    it("does not edit a row read from another database than the one selected", async () => {
        await selectOrders();
        fireEvent.click(screen.getByRole("menuitem", { name: "app_staging" }));
        await waitFor(() => expect(executeSql.mock.calls.filter(([sql, options]) =>
            sql.includes("information_schema") && options?.database === "app_staging")).toHaveLength(1));

        await tryToEditStatus();

        expect(updates()).toEqual([]);
        expect(snackbarOpen).toHaveBeenCalledWith({
            type: "error",
            message: label("studio_sql_cannot_edit_other_connection")
        });
    });

    it("does not edit a row read as another role than the one selected", async () => {
        await selectOrders();
        fireEvent.click(screen.getByRole("menuitem", { name: /^reader/ }));

        await tryToEditStatus();

        expect(updates()).toEqual([]);
        expect(snackbarOpen).toHaveBeenCalledWith({
            type: "error",
            message: label("studio_sql_cannot_edit_other_connection")
        });
    });
});

/**
 * Editing a cell of a join updated a different row of the edited table: the
 * key was read off the query's text, and the only `id` in the result was the
 * post's. `UPDATE authors SET name = … WHERE id = <the post's id>` overwrote
 * whichever author had that id, and the console said "Row updated".
 */
describe("inline editing a joined table", () => {
    jest.setTimeout(20000);

    it("does not write a column whose table's key is not in the result", async () => {
        await runQuery(POSTS_WITH_AUTHORS);

        await tryToEditStatus();

        expect(updates()).toEqual([]);
        expect(snackbarOpen).toHaveBeenCalledWith({
            type: "error",
            message: "To edit columns of public.authors, select its primary key (id) under a name no other column of the result has."
        });
    });

    it("edits nothing when the backend cannot say where a column came from", async () => {
        delete databaseAdmin.runSqlScript;
        await selectOrders();

        await tryToEditStatus();

        expect(updates()).toEqual([]);
        expect(snackbarOpen).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    });
});

/**
 * An empty string was drawn as NULL, and the cell editor saved an empty box
 * as NULL — so opening a cell holding '' and clicking away compared NULL with
 * "" and ran `UPDATE … SET body = NULL`, reported as "Row updated", on a cell
 * nobody had edited.
 */
describe("empty and NULL cells", () => {
    jest.setTimeout(20000);

    /** The cells of the one result row, in column order: id, title, body, tag. */
    function noteCells(): HTMLElement[] {
        return within(screen.getAllByRole("row")[0]).getAllByRole("gridcell");
    }

    async function openAndLeave(cell: HTMLElement): Promise<void> {
        const target = cell.firstElementChild;
        if (!target) throw new Error("the cell renders nothing to double-click");
        fireEvent.doubleClick(target);
        const editor = await screen.findByLabelText("cell editor");
        fireEvent.blur(editor);
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
        });
    }

    it("draws an empty string as empty, and only NULL as NULL", async () => {
        await runQuery(NOTES);

        const [, , body, tag] = noteCells();
        expect(body.textContent).toBe("");
        expect(tag.textContent).toBe("NULL");
    });

    it("writes nothing when an empty-string cell is opened and left unchanged", async () => {
        await runQuery(NOTES);

        await openAndLeave(noteCells()[2]);

        expect(updates()).toEqual([]);
        expect(snackbarOpen).not.toHaveBeenCalled();
    });

    it("writes nothing when a NULL cell is opened and left unchanged", async () => {
        await runQuery(NOTES);

        await openAndLeave(noteCells()[3]);

        expect(updates()).toEqual([]);
        expect(snackbarOpen).not.toHaveBeenCalled();
    });
});
