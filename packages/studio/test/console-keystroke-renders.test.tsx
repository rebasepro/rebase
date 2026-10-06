/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SqlScriptResult } from "@rebasepro/types";

/**
 * Typing in the SQL or JS console must not draw the result again.
 *
 * Each keystroke re-renders the console (the text is its state). The result
 * grid was handed a cell renderer written inline, and the SQL console's column
 * widths were kept under the text being typed — so every character gave
 * `VirtualTable` new props, and every visible cell was drawn again. The JS
 * console's JSON view re-tokenised the whole result per keystroke.
 *
 * `VirtualTable` is stubbed with the real one's memo rule — `data` by
 * reference, every other prop by value, functions by identity — so a render it
 * counts is one the real grid would do.
 */

let gridRenders = 0;
let cellRenders = 0;
let highlightRenders = 0;

function sameProps(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        const left = a[key];
        const right = b[key];
        if (key === "data" || typeof left === "function" || typeof right === "function") {
            if (left !== right) return false;
        } else if (JSON.stringify(left) !== JSON.stringify(right)) {
            return false;
        }
    }
    return true;
}

jest.mock("@rebasepro/ui", () => {
    const stub = jest.requireActual<Record<string, unknown>>("@rebasepro/ui");
    type Grid = {
        data?: Record<string, unknown>[];
        columns: { key: string; width: number }[];
        cellRenderer: (params: { rowData: Record<string, unknown>; column: { key: string; width: number }; rowIndex: number; columnIndex: number }) => React.ReactNode;
    };
    const Grid = React.memo(function Grid({ data, columns, cellRenderer }: Grid) {
        gridRenders++;
        return <div role="grid">
            {(data ?? []).map((rowData, rowIndex) => <div role="row" key={rowIndex}>
                {columns.map((column, columnIndex) => {
                    cellRenders++;
                    return <div role="gridcell" key={column.key}>{cellRenderer({ rowData, column, rowIndex, columnIndex })}</div>;
                })}
            </div>)}
        </div>;
    }, (a, b) => sameProps(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>));
    const overrides: Record<string, unknown> = { VirtualTable: Grid };
    return new Proxy(overrides, {
        get: (target, key: string | symbol) => typeof key === "string" && key in target ? target[key] : stub[key as string],
        has: () => true
    });
});

jest.mock("prism-react-renderer", () => ({
    Highlight: ({ code, children }: {
        code: string;
        children: (props: { style: object; tokens: { content: string }[][]; getLineProps: () => object; getTokenProps: (p: { token: { content: string } }) => object }) => React.ReactNode;
    }) => {
        highlightRenders++;
        return children({
            style: {},
            tokens: [[{ content: code }]],
            getLineProps: () => ({}),
            getTokenProps: ({ token }) => ({ children: token.content })
        });
    },
    themes: { vsDark: {}, github: {} }
}));

const ROWS = Array.from({ length: 30 }, (_, row) =>
    Object.fromEntries(Array.from({ length: 10 }, (_, column) => [`c${column}`, `r${row}c${column}`])));

const script: SqlScriptResult = {
    rows: ROWS,
    columns: Object.keys(ROWS[0]).map(name => ({ name })),
    tables: [],
    notices: []
};

// Stable across renders, as the real contexts are.
const databaseAdmin = {
    executeSql: jest.fn(async (sql: string): Promise<Record<string, unknown>[]> => sql.includes("current_user") ? [{ role: "postgres" }] : []),
    runSqlScript: jest.fn(async (): Promise<SqlScriptResult> => script),
    fetchAvailableDatabases: async () => ["app"],
    fetchAvailableRoles: async () => ["postgres"],
    fetchCurrentDatabase: async () => "app"
};
const rebaseContext = { databaseAdmin, authController: { user: { uid: "admin-1", email: "admin@example.test", displayName: null, roles: ["admin"] } } };
const translation = { t: (key: string) => key, i18n: { language: "en" } };
const registry = { collections: [{ slug: "posts", name: "Posts", properties: { title: { type: "string" } } }], getCollection: () => undefined };
const sidePanel = { open: jest.fn(), close: jest.fn() };
const snackbar = { open: jest.fn() };
const mode = { mode: "light", setMode: jest.fn() };
const apiConfig = { apiUrl: "http://api.test", apiPath: "/api", getAuthToken: async () => "admin-token" };
const posts = { data: ROWS.map((row, index) => ({ id: index + 1, ...row })), meta: { total: 30, limit: 30, offset: 0, hasMore: false } };
const dataLayer = { collection: () => ({ find: async () => posts }) };
const appClient = { admin: { listUsersPaginated: async () => ({ users: [], total: 0, limit: 50, offset: 0 }) }, data: dataLayer };

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useRebaseContext: () => rebaseContext,
    useRebaseClient: () => appClient,
    useApiConfig: () => apiConfig,
    useApiBase: () => "http://api.test/api",
    useStudioCollectionRegistry: () => registry,
    useStudioSidePanelController: () => sidePanel,
    useStudioUrlController: () => ({}),
    useSnackbarController: () => snackbar,
    useModeController: () => mode,
    IconForView: () => null,
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>,
    ConfirmationDialog: () => null,
    UserSelectPopover: () => null
}));

jest.mock("@rebasepro/client", () => ({
    createRebaseClient: () => ({ data: dataLayer, setAuthTokenGetter: () => undefined, close: () => undefined }),
    createMemoryStorage: () => ({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
}));

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
        <textarea aria-label="SQL" value={value} onChange={(e) => onChange(e.target.value)}/>
}));

jest.mock("../src/components/JSEditor/JSMonacoEditor", () => ({
    JSMonacoEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
        <textarea aria-label="Script" value={value} onChange={(e) => onChange(e.target.value)}/>
}));

import { SQLEditor } from "../src/components/SQLEditor/SQLEditor";
import { JSEditor } from "../src/components/JSEditor/JSEditor";

beforeEach(() => {
    localStorage.clear();
    gridRenders = 0;
    cellRenders = 0;
    highlightRenders = 0;
});

/** Type `text` one character at a time, as a person does. */
function typeInto(editor: HTMLElement, start: string, text: string): void {
    let value = start;
    for (const character of text) {
        value += character;
        fireEvent.change(editor, { target: { value } });
    }
}

describe("typing in the SQL console", () => {
    it("does not draw the result grid again", async () => {
        render(<SQLEditor/>);
        const editor = await screen.findByLabelText("SQL");
        fireEvent.change(editor, { target: { value: "SELECT * FROM wide" } });
        fireEvent.click(screen.getByRole("button", { name: "studio_sql_run" }));
        await screen.findByText("r29c9");

        const grid = gridRenders;
        const cells = cellRenders;
        typeInto(editor, "SELECT * FROM wide", " WHERE c0 = 'r1'");

        expect(gridRenders).toBe(grid);
        expect(cellRenders).toBe(cells);
    });
});

describe("typing in the JS console", () => {
    async function run(code: string): Promise<HTMLElement> {
        render(<JSEditor/>);
        const editor = screen.getByLabelText("Script");
        fireEvent.change(editor, { target: { value: code } });
        fireEvent.click(screen.getByRole("button", { name: /Run$/ }));
        return editor;
    }

    it("does not tokenise the JSON result again", async () => {
        const code = "return [1, 2, 3];";
        const editor = await run(code);
        await screen.findByText(/\[\s*1,/);

        const highlights = highlightRenders;
        typeInto(editor, code, " // and more");

        expect(highlightRenders).toBe(highlights);
    });

    it("does not draw the result table again", async () => {
        const code = `return await client.data.collection("posts").find();`;
        const editor = await run(code);
        await screen.findByText("r29c9");

        const grid = gridRenders;
        const cells = cellRenders;
        typeInto(editor, code, " // and more");

        expect(gridRenders).toBe(grid);
        expect(cellRenders).toBe(cells);
    });
});
