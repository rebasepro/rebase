/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "../../app/src/locales/en";
import { lookupEn } from "./en-translation";
import type { SqlScriptColumn, SqlScriptResult, SqlScriptTable } from "@rebasepro/types";

/**
 * An edited cell is drawn into the rows it was edited in, never over the rows
 * of a run that ended while its UPDATE was in flight.
 *
 * The console drew the edit into the rows it had held when the edit began, so
 * an UPDATE that answered after a new run put the old query's rows back on
 * screen — beside the new run's column provenance, which the next edit of one
 * of those rows was resolved against.
 */

type ExecuteOptions = { database?: string; role?: string };

const ORDERS = "SELECT * FROM orders";
const AUTHORS = "SELECT * FROM authors";

const tableOf = (table: string): SqlScriptTable => ({ schema: "public", table, kind: "table", primaryKey: ["id"], hasInheritors: false });
const readFrom = (name: string, table: string): SqlScriptColumn => ({ name, source: { schema: "public", table, column: name } });

const scripts: Record<string, SqlScriptResult> = {
    [ORDERS]: {
        rows: [{ id: "7", status: "new" }],
        columns: [readFrom("id", "orders"), readFrom("status", "orders")],
        tables: [tableOf("orders")],
        notices: []
    },
    [AUTHORS]: {
        rows: [{ id: "12", name: "Ada" }],
        columns: [readFrom("id", "authors"), readFrom("name", "authors")],
        tables: [tableOf("authors")],
        notices: []
    }
};

const scriptFor = (sql: string): SqlScriptResult | undefined =>
    Object.entries(scripts).find(([query]) => sql.startsWith(query))?.[1];

const executeSql = jest.fn(async (sql: string, _options?: ExecuteOptions): Promise<unknown> => {
    if (sql.includes("information_schema")) return [];
    if (sql.includes("current_user")) return [{ role: "postgres" }];
    return scriptFor(sql)?.rows ?? [];
});

/** Answers the UPDATE in flight, when a test says so. */
let answerUpdate: (() => void) | undefined;
const runSqlScript = jest.fn(async (sql: string, _options?: ExecuteOptions): Promise<SqlScriptResult> => {
    if (sql.startsWith("UPDATE")) {
        await new Promise<void>(resolve => { answerUpdate = resolve; });
        return { rows: [], columns: [], tables: [], notices: [], command: "UPDATE", rowCount: 1 };
    }
    return scriptFor(sql) ?? { rows: [], columns: [], tables: [], notices: [] };
});

const databaseAdmin: Record<string, unknown> = {
    executeSql,
    runSqlScript,
    fetchAvailableDatabases: async () => ["app"],
    fetchAvailableRoles: async () => ["postgres"],
    fetchCurrentDatabase: async () => "app"
};

const translation = {
    t: (key: string, options?: Record<string, unknown>) => {
        const value = lookupEn(key) ?? key;
        return options
            ? value.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(options[k] ?? ""))
            : value;
    },
    i18n: { language: "en" }
};

const snackbarOpen = jest.fn((_props: { type: string; message: string }) => undefined);

import { NO_TABLES } from "./helpers/tableDescriptors";

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useRebaseContext: () => ({ databaseAdmin }),
    useStudioCollectionRegistry: () => ({ collections: [], getCollection: () => undefined }),
    useTableDescriptors: () => NO_TABLES,
    useStudioSidePanelController: () => ({ open: jest.fn(), close: jest.fn() }),
    useSnackbarController: () => ({ open: snackbarOpen }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    IconForView: () => null,
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>,
    ConfirmationDialog: () => null
}));

// The results grid renders its cells, and the cell editor is a textarea.
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

async function run(query: string, shows: string): Promise<void> {
    fireEvent.change(await screen.findByLabelText("SQL"), { target: { value: query } });
    fireEvent.click(screen.getByRole("button", { name: label("studio_sql_run") }));
    await screen.findByText(shows);
}

beforeEach(() => {
    answerUpdate = undefined;
    executeSql.mockClear();
    runSqlScript.mockClear();
    snackbarOpen.mockClear();
    localStorage.clear();
});

describe("an inline edit whose UPDATE answers after another run", () => {
    jest.setTimeout(20000);

    it("leaves the new run's rows on screen", async () => {
        render(<SQLEditor/>);
        await waitFor(() => expect(executeSql.mock.calls.some(([sql]) => sql.includes("information_schema"))).toBe(true));
        await run(ORDERS, "new");

        fireEvent.doubleClick(screen.getByText("new"));
        const editor = await screen.findByLabelText("cell editor");
        fireEvent.change(editor, { target: { value: "shipped" } });
        fireEvent.keyDown(editor, { key: "Enter" });
        await waitFor(() => expect(answerUpdate).toBeDefined());

        await run(AUTHORS, "Ada");

        await act(async () => {
            answerUpdate?.();
            await new Promise(resolve => setTimeout(resolve, 50));
        });

        expect(snackbarOpen).toHaveBeenCalledWith({ type: "success", message: label("studio_sql_row_updated") });
        expect(screen.getByText("Ada")).toBeTruthy();
        expect(screen.queryByText("shipped")).toBeNull();
        expect(screen.queryByText("7")).toBeNull();
    });
});
