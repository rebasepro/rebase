/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SqlScriptResult } from "@rebasepro/types";
import { translateEn, useEnTranslation } from "./en-translation";

/**
 * The console's script-level features: one result tab per statement,
 * `:name` parameters, EXPLAIN ANALYZE in a rolled-back transaction, SQL
 * handed over by another view, and snippets kept by the project.
 */

type RunOptions = { database?: string; role?: string; signal?: AbortSignal };

let nextRun: (sql: string) => SqlScriptResult = () => ({ rows: [], columns: [], tables: [], notices: [] });
const runSqlScript = jest.fn(async (sql: string, _options?: RunOptions) => nextRun(sql));
const executeSql = jest.fn(async (sql: string): Promise<unknown> =>
    sql.includes("current_user") ? [{ role: "postgres" }] : []);
const databaseAdmin: Record<string, unknown> = {
    executeSql,
    runSqlScript,
    fetchAvailableDatabases: async () => ["postgres"],
    fetchAvailableRoles: async () => ["postgres"],
    fetchCurrentDatabase: async () => "postgres"
};

import { NO_TABLES } from "./helpers/tableDescriptors";

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => useEnTranslation(),
    useRebaseContext: () => ({ databaseAdmin }),
    useStudioCollectionRegistry: () => ({ collections: [], getCollection: () => undefined }),
    useTableDescriptors: () => NO_TABLES,
    useStudioSidePanelController: () => ({ open: jest.fn(), close: jest.fn() }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    IconForView: () => null,
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>,
    ConfirmationDialog: () => null
}));

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
        <textarea aria-label="SQL" value={value} onChange={(e) => onChange(e.target.value)}/>
}));

import { SQLEditor } from "../src/components/SQLEditor/SQLEditor";
import type { Snippet } from "../src/components/SQLEditor/SQLEditorSidebar";
import type { SqlSnippetRemote } from "../src/components/SQLEditor/useSqlSnippets";

const run = () => fireEvent.click(screen.getByRole("button", { name: translateEn("studio_sql_run") }));
const typeSql = async (text: string) => fireEvent.change(await screen.findByLabelText("SQL"), { target: { value: text } });
const scriptsRun = () => runSqlScript.mock.calls.map(([sql]) => sql);

beforeEach(() => {
    localStorage.clear();
    runSqlScript.mockClear();
    nextRun = () => ({ rows: [], columns: [], tables: [], notices: [] });
});

describe("a script of several statements", () => {
    it("shows one result tab per statement, labelled with its command and count, the last one open", async () => {
        nextRun = () => ({
            rows: [{ b: "2" }],
            columns: [{ name: "b" }],
            tables: [],
            command: "SELECT",
            rowCount: 1,
            notices: [],
            statements: [
                { rows: [{ a: "x" }, { a: "y" }], columns: [{ name: "a" }], tables: [], command: "SELECT", rowCount: 2 },
                { rows: [], columns: [], tables: [], command: "CREATE TABLE" },
                { rows: [{ b: "2" }], columns: [{ name: "b" }], tables: [], command: "SELECT", rowCount: 1 }
            ]
        });
        render(<SQLEditor/>);
        await typeSql("SELECT a FROM t; CREATE TABLE u (n int); SELECT 2 AS b");
        run();

        const strip = await screen.findByRole("tablist", { name: translateEn("studio_sql_statement_results") });
        const tabs = within(strip).getAllByRole("tab");
        expect(tabs.map(tab => tab.textContent)).toEqual(["1SELECT · 2 rows", "2CREATE TABLE", "3SELECT · 1 row"]);
        expect(tabs[2].getAttribute("aria-selected")).toBe("true");
        expect(screen.getByText(translateEn("studio_sql_rows")).nextElementSibling?.textContent).toBe("1");

        fireEvent.click(tabs[0]);
        await waitFor(() => expect(within(strip).getAllByRole("tab")[0].getAttribute("aria-selected")).toBe("true"));
        // The footer counts the rows of the statement on screen.
        expect(screen.getByText(translateEn("studio_sql_rows")).nextElementSibling?.textContent).toBe("2");
    });

    it("shows no statement tabs for a run of one statement", async () => {
        nextRun = () => ({ rows: [{ a: "1" }], columns: [{ name: "a" }], tables: [], notices: [], statements: [{ rows: [{ a: "1" }], columns: [{ name: "a" }], tables: [] }] });
        render(<SQLEditor/>);
        await typeSql("SELECT 1 AS a");
        run();

        await waitFor(() => expect(runSqlScript).toHaveBeenCalled());
        expect(screen.queryByRole("tablist", { name: translateEn("studio_sql_statement_results") })).toBeNull();
    });
});

describe(":name parameters", () => {
    it("lists the placeholders, refuses a run while one is empty, and runs with quoted values", async () => {
        render(<SQLEditor/>);
        await typeSql("SELECT * FROM posts WHERE author = :author AND id > :min_id AND created_at::date = :day");

        expect(await screen.findByLabelText(translateEn("studio_sql_params_value_for", { name: "author" }))).toBeTruthy();
        expect(screen.queryByLabelText(translateEn("studio_sql_params_value_for", { name: "date" }))).toBeNull();

        run();
        expect(await screen.findByText(translateEn("studio_sql_params_missing", { names: ":author, :min_id, :day" }))).toBeTruthy();
        expect(scriptsRun()).toEqual([]);

        fireEvent.change(screen.getByLabelText(translateEn("studio_sql_params_value_for", { name: "author" })), { target: { value: "O'Brien" } });
        fireEvent.change(screen.getByLabelText(translateEn("studio_sql_params_value_for", { name: "min_id" })), { target: { value: "10" } });
        fireEvent.click(within(screen.getByRole("group", { name: translateEn("studio_sql_params_mode_for", { name: "min_id" }) })).getByText(translateEn("studio_sql_params_mode_raw")));
        fireEvent.click(within(screen.getByRole("group", { name: translateEn("studio_sql_params_mode_for", { name: "day" }) })).getByText("NULL"));
        run();

        await waitFor(() => expect(scriptsRun()).toHaveLength(1));
        expect(scriptsRun()[0]).toBe("SELECT * FROM posts WHERE author = 'O''Brien' AND id > 10 AND created_at::date = NULL LIMIT 1000;");
    });
});

describe("EXPLAIN ANALYZE", () => {
    it("runs the statement in a transaction it rolls back, and draws the timed plan with a note", async () => {
        const plan = [{
            Plan: { "Node Type": "Seq Scan", "Relation Name": "posts", "Startup Cost": 0, "Total Cost": 10, "Plan Rows": 5, "Plan Width": 8,
                "Actual Startup Time": 0.01, "Actual Total Time": 0.5, "Actual Rows": 5, "Actual Loops": 1, "Shared Hit Blocks": 3, "Shared Read Blocks": 0 },
            "Planning Time": 0.1,
            "Execution Time": 0.6
        }];
        nextRun = () => ({
            rows: [], columns: [], tables: [], command: "ROLLBACK", notices: [],
            statements: [
                { rows: [], columns: [], tables: [], command: "BEGIN" },
                { rows: [{ "QUERY PLAN": JSON.stringify(plan) }], columns: [{ name: "QUERY PLAN", type: "json" }], tables: [], command: "EXPLAIN" },
                { rows: [], columns: [], tables: [], command: "ROLLBACK" }
            ]
        });
        render(<SQLEditor/>);
        await typeSql("DELETE FROM posts WHERE id = 1");

        fireEvent.click(screen.getByText(translateEn("studio_sql_explain_analyze")));

        await waitFor(() => expect(scriptsRun()).toHaveLength(1));
        expect(scriptsRun()[0]).toBe("BEGIN;\nEXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) DELETE FROM posts WHERE id = 1\n;\nROLLBACK;");
        expect(await screen.findByText(translateEn("studio_sql_explain_analyze_note"))).toBeTruthy();
        expect(screen.getByText("Seq Scan")).toBeTruthy();
        expect(screen.getByText(translateEn("studio_sql_explain_slowest_rank", { rank: 1 }))).toBeTruthy();
    });

    it("refuses more than one statement", async () => {
        render(<SQLEditor/>);
        await typeSql("SELECT 1; DELETE FROM posts");

        fireEvent.click(screen.getByText(translateEn("studio_sql_explain_analyze")));

        expect(await screen.findByText(translateEn("studio_sql_explain_single_statement"))).toBeTruthy();
        expect(scriptsRun()).toEqual([]);
    });
});

describe("SQL handed over by another view", () => {
    it("opens the draft in a new tab and says it was consumed, once", async () => {
        const consumed = jest.fn();
        const { rerender } = render(<SQLEditor incomingDraft="SELECT * FROM orders" onDraftConsumed={consumed}/>);

        await waitFor(() => expect((screen.getByLabelText("SQL") as HTMLTextAreaElement).value).toBe("SELECT * FROM orders"));
        expect(consumed).toHaveBeenCalledTimes(1);
        rerender(<SQLEditor incomingDraft="SELECT * FROM orders" onDraftConsumed={consumed}/>);
        expect(consumed).toHaveBeenCalledTimes(1);
        expect(screen.getAllByRole("tab").filter(tab => /^Query \d+$/.test(tab.textContent ?? ""))).toHaveLength(2);
    });
});

describe("snippets the project keeps", () => {
    function fakeRemote(options: { failList?: boolean; failCreateAfter?: number } = {}) {
        const stored: Snippet[] = [];
        let creates = 0;
        const remote: SqlSnippetRemote = {
            list: jest.fn(async () => {
                if (options.failList) throw new Error("404 Not Found");
                return [...stored];
            }),
            create: jest.fn(async (input: Parameters<SqlSnippetRemote["create"]>[0]) => {
                creates++;
                if (options.failCreateAfter !== undefined && creates > options.failCreateAfter) throw new Error("500");
                const snippet: Snippet = { id: `srv-${creates}`, name: input.name, sql: input.sql, createdAt: 0, isFavorite: input.favorite, visibility: input.visibility };
                stored.push(snippet);
                return snippet;
            }),
            update: jest.fn(async (id: string, patch: Parameters<SqlSnippetRemote["update"]>[1]) => ({ ...stored.find(snippet => snippet.id === id)!, ...patch })),
            remove: jest.fn(async () => undefined)
        };
        return { remote, stored };
    }
    const local = (id: string, name: string): Snippet => ({ id, name, sql: `SELECT '${name}'`, createdAt: 1 });
    const key = "rebase_sql_snippets_default";

    it("uploads the snippets this browser kept once, and keeps none locally after", async () => {
        localStorage.setItem(key, JSON.stringify([local("a", "first"), local("b", "second")]));
        const { remote, stored } = fakeRemote();
        render(<SQLEditor snippetRemote={remote}/>);

        await waitFor(() => expect(stored.map(snippet => snippet.name)).toEqual(["first", "second"]));
        await waitFor(() => expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual([]));
    });

    it("keeps a snippet local until the server has confirmed it", async () => {
        localStorage.setItem(key, JSON.stringify([local("a", "first"), local("b", "second")]));
        const { remote, stored } = fakeRemote({ failCreateAfter: 1 });
        render(<SQLEditor snippetRemote={remote}/>);

        await waitFor(() => expect(remote.create).toHaveBeenCalledTimes(2));
        expect(stored.map(snippet => snippet.name)).toEqual(["first"]);
        await waitFor(() => expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual([local("b", "second")]));
    });

    it("stays on local storage when the server has no snippet store", async () => {
        localStorage.setItem(key, JSON.stringify([local("a", "first")]));
        const { remote } = fakeRemote({ failList: true });
        render(<SQLEditor snippetRemote={remote}/>);

        await waitFor(() => expect(remote.list).toHaveBeenCalled());
        await act(async () => undefined);
        expect(remote.create).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual([local("a", "first")]);
    });
});
