/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "../../app/src/locales/en";
import type { SqlScriptResult } from "@rebasepro/types";

/**
 * What the SQL console says about where the rows on screen came from, and what
 * it offers to do with them.
 */

type ExecuteOptions = { database?: string; role?: string };

const ORDERS = "SELECT * FROM orders";

const orders: SqlScriptResult = {
    rows: [{ id: "7", status: "new" }],
    columns: [
        { name: "id", source: { schema: "public", table: "orders", column: "id" } },
        { name: "status", source: { schema: "public", table: "orders", column: "status" } }
    ],
    tables: [{ schema: "public", table: "orders", kind: "table", primaryKey: ["id"], hasInheritors: false }],
    notices: []
};

const executeSql = jest.fn(async (sql: string, _options?: ExecuteOptions): Promise<unknown> => {
    if (sql.includes("current_user")) return [{ role: "postgres" }];
    return [];
});
const runSqlScript = jest.fn(async (sql: string, _options?: ExecuteOptions): Promise<SqlScriptResult> =>
    sql.startsWith(ORDERS) ? orders : { rows: [], columns: [], tables: [], notices: [] });
const databaseAdmin: Record<string, unknown> = {
    executeSql,
    runSqlScript,
    fetchAvailableDatabases: async () => ["app_prod", "rb_feature"],
    fetchAvailableRoles: async () => ["postgres", "reader"],
    // The database the app — and the CMS behind "Open …" — reads and writes.
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

const ordersCollection = { slug: "orders", name: "Orders", table: "orders", properties: {} };
const sidePanelOpen = jest.fn((_props: Record<string, unknown>) => undefined);

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useRebaseContext: () => ({ databaseAdmin }),
    useStudioCollectionRegistry: () => ({ collections: [ordersCollection], getCollection: () => undefined }),
    useStudioSidePanelController: () => ({ open: sidePanelOpen, close: jest.fn() }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    IconForView: () => null,
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>,
    ConfirmationDialog: () => null
}));

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
        MenuItem: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) =>
            <button type="button" role="menuitem" onClick={onClick} disabled={disabled}>{children}</button>
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

/** Runs `query` on `database` and waits for its rows. */
async function runOn(database: string, query: string): Promise<void> {
    render(<SQLEditor/>);
    fireEvent.click(await screen.findByRole("menuitem", { name: database }));
    fireEvent.change(await screen.findByLabelText("SQL"), { target: { value: query } });
    fireEvent.click(screen.getByRole("button", { name: label("studio_sql_run") }));
    await screen.findByText("new");
    const run = runSqlScript.mock.calls.find(([sql]) => sql.startsWith(query));
    expect(run?.[1]).toEqual(expect.objectContaining({ database }));
}

const OPEN_ORDER_7 = "Open Orders #7";

beforeEach(() => {
    executeSql.mockClear();
    runSqlScript.mockClear();
    sidePanelOpen.mockClear();
    localStorage.clear();
});

/**
 * "Open Orders #7" opens the record through the app, on the app's database.
 * Offered on rows read from a branch or any other database, it opened — and
 * saved — the app database's order 7: different values, or none at all, while
 * the row on screen was the branch's.
 */
describe("opening a result row as a record", () => {
    jest.setTimeout(20000);

    it("is offered on rows read from the app's own database", async () => {
        await runOn("app_prod", ORDERS);

        fireEvent.click(screen.getByRole("button", { name: OPEN_ORDER_7 }));

        expect(sidePanelOpen).toHaveBeenCalledWith(expect.objectContaining({ path: "orders", entityId: "7" }));
    });

    it("is not offered on rows read from another database", async () => {
        await runOn("rb_feature", ORDERS);

        expect(screen.queryByRole("button", { name: OPEN_ORDER_7 })).toBeNull();
        expect(screen.queryByText(label("studio_sql_collections_label"))).toBeNull();
    });
});
