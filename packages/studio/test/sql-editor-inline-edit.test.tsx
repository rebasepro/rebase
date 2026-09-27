/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "../../app/src/locales/en";

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

const orderColumns = [
    { schema: "public", table: "orders", column: "id", data_type: "integer", is_pk: true },
    { schema: "public", table: "orders", column: "status", data_type: "text", is_pk: false }
];

const executeSql = jest.fn(async (sql: string, _options?: ExecuteOptions): Promise<unknown> => {
    if (sql.includes("information_schema")) return orderColumns;
    if (sql.includes("current_user")) return [{ role: "postgres" }];
    if (sql.startsWith("SELECT * FROM orders")) return [{ id: 7, status: "new" }];
    return [];
});
const databaseAdmin = {
    executeSql,
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

/** The UPDATEs sent, with the connection each was sent on. */
function updates(): [string, ExecuteOptions | undefined][] {
    return executeSql.mock.calls
        .filter(([sql]) => sql.startsWith("UPDATE"))
        .map(([sql, options]) => [sql, options]);
}

/** Runs `SELECT * FROM orders` on app_prod as postgres and waits for its row. */
async function selectOrders(): Promise<void> {
    render(<SQLEditor/>);
    await screen.findByRole("menuitem", { name: "app_staging" });
    await waitFor(() => expect(executeSql.mock.calls.some(([sql]) => sql.includes("information_schema"))).toBe(true));
    fireEvent.change(await screen.findByLabelText("SQL"), { target: { value: "SELECT * FROM orders" } });
    fireEvent.click(screen.getByRole("button", { name: label("studio_sql_run") }));
    await screen.findByText("new");
    const run = executeSql.mock.calls.find(([sql]) => sql.startsWith("SELECT * FROM orders"));
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
    executeSql.mockClear();
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
            "UPDATE \"orders\" SET \"status\" = 'shipped' WHERE \"id\" = 7;",
            { database: "app_prod", role: "postgres" }
        ]);
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
