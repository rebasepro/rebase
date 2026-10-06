/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
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
/**
 * The role the server says each script ran as: the one asked for, or — with
 * role switching turned off on the server — this connection owner.
 */
let connectionOwner: string | undefined;
/** What the server says of the rows it did not send, when it cut a result short. */
let cutShort: Pick<SqlScriptResult, "truncated" | "rowCount"> = {};
const runSqlScript = jest.fn(async (sql: string, options?: ExecuteOptions): Promise<SqlScriptResult> => ({
    ...(sql.startsWith(ORDERS) ? { ...orders, ...cutShort } : { rows: [], columns: [], tables: [], notices: [] }),
    ...(options?.role ? { effectiveRole: connectionOwner ?? options.role } : {})
}));
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
const snackbarOpen = jest.fn((_props: Record<string, unknown>) => undefined);

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useRebaseContext: () => ({ databaseAdmin }),
    useStudioCollectionRegistry: () => ({ collections: [ordersCollection], getCollection: () => undefined }),
    useStudioSidePanelController: () => ({ open: sidePanelOpen, close: jest.fn() }),
    useSnackbarController: () => ({ open: snackbarOpen }),
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
            <button type="button" role="menuitem" onClick={onClick} disabled={disabled}>{children}</button>,
        Alert: ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) =>
            <div role="status">{children}{action}</div>
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
    connectionOwner = undefined;
    cutShort = {};
    executeSql.mockClear();
    runSqlScript.mockClear();
    sidePanelOpen.mockClear();
    snackbarOpen.mockClear();
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

/**
 * With `DISABLE_DB_ROLE_SWITCHING` on the server, every statement runs as the
 * connection owner. The console still offered every role and labelled the
 * owner's rows with the one picked, so a table `rebase_user` cannot read
 * looked readable to it.
 */
describe("the role the rows were read as", () => {
    jest.setTimeout(20000);

    it("says so when the server ran the query as someone other than the role picked", async () => {
        connectionOwner = "app_owner";
        await runOn("app_prod", ORDERS);

        expect(screen.getByText(translation.t("studio_sql_ran_as_other_role", { ranAs: "app_owner", role: "postgres" }))).toBeTruthy();
        expect(screen.getByText(translation.t("studio_sql_role_switching_disabled", { role: "app_owner" }))).toBeTruthy();
        expect((screen.getByRole("menuitem", { name: /^reader/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("adds nothing when the rows were read as the role picked", async () => {
        await runOn("app_prod", ORDERS);

        expect(screen.queryByText(translation.t("studio_sql_ran_as_other_role", { ranAs: "postgres", role: "postgres" }))).toBeNull();
        expect(screen.queryByText(/role switching/i)).toBeNull();
        expect((screen.getByRole("menuitem", { name: /^reader/ }) as HTMLButtonElement).disabled).toBe(false);
    });
});

/**
 * The server keeps at most 10,000 rows of a result (`SQL_CONSOLE_RESULT_LIMITS`
 * in server-postgres): a run that held every row of a million-row table took
 * the server down. The console says when the rows on screen are not all of
 * them, and how many there were.
 */
describe("a result the server cut short", () => {
    jest.setTimeout(20000);

    it("says how many rows there were, and that only the first are shown", async () => {
        cutShort = { truncated: true, rowCount: 50_000 };
        await runOn("app_prod", ORDERS);

        expect(screen.getByText(translation.t("studio_sql_result_truncated", {
            shown: (1).toLocaleString(),
            total: (50_000).toLocaleString()
        }))).toBeTruthy();
    });

    it("says nothing when the rows on screen are all of them", async () => {
        await runOn("app_prod", ORDERS);

        expect(screen.queryByText(/Showing the first/)).toBeNull();
        expect(screen.queryByRole("button", { name: label("studio_sql_download_full_csv") })).toBeNull();
    });

    /**
     * The 10,000-row cap left no way to the rest of a result. The server streams
     * the whole of it through a read-only cursor (`POST /admin/sql/csv`); the
     * console offers it on a result it cut short.
     */
    describe("downloading the whole result", () => {
        const realFetch = global.fetch;
        const realCreateObjectURL = URL.createObjectURL;
        const realRevokeObjectURL = URL.revokeObjectURL;
        /** What `fetch` answers: jsdom has no `Response`, so the parts the console reads. */
        type Answer = { ok: boolean; status: number; blob: () => Promise<Blob>; json: () => Promise<unknown> };
        let requests: { url: string; init: RequestInit }[];
        let answer: () => Answer;
        const csv = (): Answer => ({ ok: true, status: 200, blob: async () => new Blob(["id,status\r\n7,new\r\n"]), json: async () => null });

        beforeEach(() => {
            requests = [];
            answer = csv;
            global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
                requests.push({ url: String(url), init: init ?? {} });
                return answer();
            }) as never;
            URL.createObjectURL = jest.fn(() => "blob:download");
            URL.revokeObjectURL = jest.fn();
        });

        afterEach(() => {
            global.fetch = realFetch;
            URL.createObjectURL = realCreateObjectURL;
            URL.revokeObjectURL = realRevokeObjectURL;
        });

        it("asks the server for the query on screen, on its database, as its role", async () => {
            cutShort = { truncated: true, rowCount: 50_000 };
            await runOn("app_prod", ORDERS);

            fireEvent.click(screen.getByRole("button", { name: label("studio_sql_download_full_csv") }));

            await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
            expect(requests).toHaveLength(1);
            expect(requests[0].url).toBe("http://api.test/api/admin/sql/csv");
            expect(requests[0].init.method).toBe("POST");
            expect((requests[0].init.headers as Record<string, string>).Authorization).toBe("Bearer token");
            expect(JSON.parse(String(requests[0].init.body))).toEqual({ sql: expect.stringMatching(/^SELECT \* FROM orders/), database: "app_prod", role: "postgres" });
        });

        it("says why when the server refuses", async () => {
            answer = () => ({
                ok: false,
                status: 501,
                blob: async () => new Blob([]),
                json: async () => ({ error: { code: "SQL_EXPORT_UNSUPPORTED", message: "needs a Postgres server" } })
            });
            cutShort = { truncated: true, rowCount: 50_000 };
            await runOn("app_prod", ORDERS);

            fireEvent.click(screen.getByRole("button", { name: label("studio_sql_download_full_csv") }));

            await waitFor(() => expect(snackbarOpen).toHaveBeenCalledWith(expect.objectContaining({
                type: "error",
                message: expect.stringMatching(/needs a Postgres server/)
            })));
            expect(URL.createObjectURL).not.toHaveBeenCalled();
        });
    });
});
