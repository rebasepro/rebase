/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "../../app/src/locales/en";

/**
 * What the SQL console actually sends when a button is pressed.
 *
 * The editor is Monaco, which does not run in jsdom, so it is stood in for by a
 * textarea: these tests are about the statement the console builds from the
 * buffer, not about the editor.
 */

const executeSql = jest.fn<(sql: string, options?: unknown) => Promise<unknown>>(async () => []);
const databaseAdmin = {
    executeSql,
    fetchAvailableDatabases: async () => ["postgres"],
    fetchAvailableRoles: async () => ["postgres"],
    fetchCurrentDatabase: async () => "postgres"
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

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useRebaseContext: () => ({ databaseAdmin }),
    useStudioCollectionRegistry: () => ({ collections: [], getCollection: () => undefined }),
    useStudioSidePanelController: () => ({ open: jest.fn(), close: jest.fn() }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    IconForView: () => null,
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>,
    ConfirmationDialog: () => null
}));

/** What the stand-in editor reports as selected; nothing unless a test says. */
let editorSelection: string | undefined;

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ ref, value, onChange }: {
        ref?: React.Ref<{ getSelectedText: () => string | undefined }>;
        value: string;
        onChange: (value: string) => void;
    }) => {
        React.useImperativeHandle(ref, () => ({ getSelectedText: () => editorSelection }));
        return <textarea aria-label="SQL" value={value} onChange={(e) => onChange(e.target.value)}/>;
    }
}));

import { SQLEditor } from "../src/components/SQLEditor/SQLEditor";

/** An `en` string, refused rather than searched for as `undefined`. */
function label(key: keyof typeof en): string {
    const value = en[key];
    if (typeof value !== "string") throw new Error(`en.${String(key)} is not a string`);
    return value;
}

/** Every statement sent, minus the console's own `current_user` probe. */
function sent(): string[] {
    return executeSql.mock.calls
        .map(call => String(call[0]))
        .filter(sql => !sql.includes("current_user") && !sql.includes("information_schema"));
}

async function typeSql(text: string): Promise<void> {
    fireEvent.change(await screen.findByLabelText("SQL"), { target: { value: text } });
}

beforeEach(() => {
    executeSql.mockClear();
    localStorage.clear();
    editorSelection = undefined;
});

/**
 * "Explain" ran `EXPLAIN (FORMAT JSON, ANALYZE) <the whole tab>`. ANALYZE
 * executes the statement to time it, so explaining `DELETE FROM posts` deleted
 * every post — with none of the confirmation "Run" asks for first.
 */
describe("explaining a query", () => {
    it("plans the statement without executing it", async () => {
        render(<SQLEditor/>);
        await typeSql("DELETE FROM posts");

        fireEvent.click(screen.getByRole("button", { name: label("studio_sql_explain") }));

        await waitFor(() => expect(sent()).toHaveLength(1));
        expect(sent()[0]).toBe("EXPLAIN (FORMAT JSON) DELETE FROM posts");
    });

    it("refuses a buffer that holds more than one statement", async () => {
        // `EXPLAIN (…) SELECT 1; DELETE …` explains the SELECT and *runs* the
        // DELETE: only the first statement is the EXPLAIN's.
        render(<SQLEditor/>);
        await typeSql("SELECT 1; DELETE FROM posts WHERE id = 1");

        fireEvent.click(screen.getByRole("button", { name: label("studio_sql_explain") }));

        expect(await screen.findByText(label("studio_sql_explain_single_statement"))).toBeTruthy();
        expect(sent()).toHaveLength(0);
    });

    it("explains the selected statement when there is one", async () => {
        render(<SQLEditor/>);
        await typeSql("SELECT * FROM posts;\nDELETE FROM posts WHERE id = 1;");
        editorSelection = "SELECT * FROM posts;";

        fireEvent.click(screen.getByRole("button", { name: label("studio_sql_explain") }));

        await waitFor(() => expect(sent()).toHaveLength(1));
        expect(sent()[0]).toBe("EXPLAIN (FORMAT JSON) SELECT * FROM posts");
    });
});

/**
 * The "Limit 1000" toggle (on by default) appended `LIMIT 1000` to any text
 * containing the word SELECT. `INSERT INTO archive SELECT * FROM posts` and
 * `CREATE TABLE copy AS SELECT …` copied a thousand rows and reported success;
 * `SELECT 1; DELETE … WHERE id = 1` became a syntax error.
 */
describe("the automatic LIMIT", () => {
    async function run(text: string): Promise<string> {
        render(<SQLEditor/>);
        await typeSql(text);
        fireEvent.click(screen.getByRole("button", { name: label("studio_sql_run") }));
        await waitFor(() => expect(sent()).toHaveLength(1));
        return sent()[0];
    }

    it("limits a plain SELECT", async () => {
        expect(await run("SELECT * FROM posts")).toBe("SELECT * FROM posts LIMIT 1000;");
    });

    it("leaves an INSERT … SELECT whole", async () => {
        expect(await run("INSERT INTO archive SELECT * FROM posts")).toBe("INSERT INTO archive SELECT * FROM posts");
    });

    it("leaves a CREATE TABLE … AS SELECT whole", async () => {
        expect(await run("CREATE TABLE copy AS SELECT * FROM posts")).toBe("CREATE TABLE copy AS SELECT * FROM posts");
    });

    it("leaves a script of several statements whole", async () => {
        expect(await run("SELECT 1; DELETE FROM posts WHERE id = 1")).toBe("SELECT 1; DELETE FROM posts WHERE id = 1");
    });
});
