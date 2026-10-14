/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { en } from "../../app/src/locales/en";

/**
 * What the SQL console actually sends when a button is pressed.
 *
 * The editor is Monaco, which does not run in jsdom, so it is stood in for by a
 * textarea: these tests are about the statement the console builds from the
 * buffer, not about the editor.
 */

const executeSql = jest.fn<(sql: string, options?: unknown) => Promise<unknown>>(async () => []);
const databaseAdmin: Record<string, unknown> = {
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
    // The confirmation the console asks for, reduced to its title and its two
    // answers: a test can see it was asked, and answer it.
    ConfirmationDialog: ({ open, title, onAccept, onCancel }: {
        open: boolean;
        title: string;
        onAccept: () => void;
        onCancel: () => void;
    }) => open
        ? <div role="dialog" aria-label={title}>
            <button onClick={onAccept}>accept</button>
            <button onClick={onCancel}>cancel</button>
        </div>
        : null
}));

/** What the stand-in editor reports as selected; nothing unless a test says. */
let editorSelection: string | undefined;

/**
 * The stand-in editor's own text and the props it was last rendered with.
 * Monaco's model changes the moment the person types or pastes, and the
 * console only learns of it when it re-renders from `onChange`; `text` is that
 * model. `onRun` is what Cmd+Enter inside the editor calls — the handler of the
 * last render, as Monaco's action reads it from a ref.
 */
const editorModel: {
    text: string;
    onChange?: (value: string) => void;
    onRun?: (selectedText?: string) => void;
} = { text: "" };

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ ref, value, onChange, onRun }: {
        ref?: React.Ref<{ getSelectedText: () => string | undefined; getValue: () => string }>;
        value: string;
        onChange: (value: string) => void;
        onRun?: (selectedText?: string) => void;
    }) => {
        editorModel.onChange = onChange;
        editorModel.onRun = onRun;
        // A new `value` from the console (Format, a tab switch) is written
        // into the model, as @monaco-editor/react does.
        React.useLayoutEffect(() => { editorModel.text = value; }, [value]);
        React.useImperativeHandle(ref, () => ({
            getSelectedText: () => editorSelection,
            getValue: () => editorModel.text
        }));
        return <textarea aria-label="SQL" value={value} onChange={(e) => {
            editorModel.text = e.target.value;
            onChange(e.target.value);
        }}/>;
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
    editorModel.text = "";
});

/**
 * The editor's text changes, and the console hears of it through `onChange`
 * — but it has not re-rendered yet when `then` runs, as when Run or Cmd+Enter
 * comes right after a paste. Both happen inside one `act`, so React renders
 * once, after both.
 */
function editThen(text: string, then: () => void): void {
    act(() => {
        editorModel.text = text;
        editorModel.onChange?.(text);
        then();
    });
}

/** The Run button, once the run before has finished. */
async function idleRunButton(): Promise<HTMLButtonElement> {
    const button = screen.getByRole("button", { name: label("studio_sql_run") }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    return button;
}

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

    it("limits a SELECT that ends in a comment, before the comment", async () => {
        // Appended to the text, the limit landed inside the comment and the
        // whole table came back with "Limit 1000" checked.
        expect(await run("SELECT * FROM posts -- newest first")).toBe("SELECT * FROM posts LIMIT 1000; -- newest first");
    });

    it("limits a SELECT that names an aggregate function", async () => {
        expect(await run("SELECT *, count(*) OVER () AS total FROM posts")).toBe("SELECT *, count(*) OVER () AS total FROM posts LIMIT 1000;");
    });
});

/**
 * "Format SQL" rewrote the literals in the buffer along with the code: the
 * next Run wrote `'a, b = c'` where the person had typed `'a,b=c'`.
 */
describe("formatting the buffer", () => {
    it("leaves the values in string literals as they were typed", async () => {
        render(<SQLEditor/>);
        await typeSql("INSERT INTO cfg VALUES ('k','a,b=c')");

        fireEvent.click(screen.getByRole("button", { name: label("studio_sql_format_sql") }));

        expect((screen.getByLabelText("SQL") as HTMLTextAreaElement).value).toBe("INSERT INTO cfg VALUES ('k', 'a,b=c')");
    });
});

/**
 * Cmd+Enter in the editor ran the selection; the Run button beside it ran the
 * whole buffer. Highlighting one statement of a script and pressing Run
 * executed every statement in it.
 */
describe("running a selection", () => {
    it("runs only the selected statement from the Run button", async () => {
        render(<SQLEditor/>);
        await typeSql("SELECT 1;\nSELECT * FROM posts");
        editorSelection = "SELECT * FROM posts";

        fireEvent.click(screen.getByRole("button", { name: label("studio_sql_run") }));

        await waitFor(() => expect(sent()).toHaveLength(1));
        expect(sent()[0]).toBe("SELECT * FROM posts LIMIT 1000;");
    });

    it("runs only the selected statement from the shortcut outside the editor", async () => {
        render(<SQLEditor/>);
        await typeSql("SELECT 1;\nSELECT * FROM posts");
        editorSelection = "SELECT * FROM posts";
        // The shortcut is the page's only while no text field has the focus —
        // and the sidebar's search takes it on mount.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

        fireEvent.keyDown(window, { key: "Enter", metaKey: true });

        await waitFor(() => expect(sent()).toHaveLength(1));
        expect(sent()[0]).toBe("SELECT * FROM posts LIMIT 1000;");
    });
});

/**
 * "Run" asks before a DELETE or UPDATE without WHERE. It decided that on the
 * text, so the word WHERE anywhere — another statement, a comment — turned the
 * question off: `DELETE FROM posts; SELECT * FROM posts WHERE id = 1` deleted
 * every post at once.
 */
describe("the destructive-statement confirmation", () => {
    async function run(text: string): Promise<void> {
        render(<SQLEditor/>);
        await typeSql(text);
        fireEvent.click(screen.getByRole("button", { name: label("studio_sql_run") }));
    }

    for (const text of [
        "DELETE FROM posts",
        "DELETE FROM posts; SELECT * FROM posts WHERE id = 1",
        "-- clean up where needed\nDELETE FROM posts",
        "UPDATE users SET role = 'admin'; SELECT * FROM users WHERE id = 1"
    ]) {
        it(`asks before running ${JSON.stringify(text)}, and runs it once accepted`, async () => {
            await run(text);
            const dialog = await screen.findByRole("dialog", { name: label("studio_sql_dangerous_operation") });
            expect(sent()).toEqual([]);

            fireEvent.click(within(dialog).getByRole("button", { name: "accept" }));
            await waitFor(() => expect(sent()).toEqual([text]));
        });
    }

    it("runs a DELETE with its own WHERE without asking", async () => {
        await run("DELETE FROM posts WHERE id = 1");
        await waitFor(() => expect(sent()).toEqual(["DELETE FROM posts WHERE id = 1"]));
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

/**
 * A ROLLBACK or COMMIT with no transaction to end did nothing, and the console
 * said "Success": Postgres's "there is no transaction in progress" is a
 * warning, and nothing showed warnings. A transaction split across runs
 * relied on exactly that — `BEGIN`, an UPDATE, then a `ROLLBACK` that ended
 * nothing, so the UPDATE stayed.
 */
describe("what the database says while a script runs", () => {
    afterEach(() => {
        delete databaseAdmin.runSqlScript;
    });

    it("shows a ROLLBACK that ended nothing as the warning it is", async () => {
        databaseAdmin.runSqlScript = jest.fn(async () => ({
            rows: [],
            columns: [],
            tables: [],
            command: "ROLLBACK",
            notices: [{ severity: "WARNING", message: "there is no transaction in progress" }]
        }));
        render(<SQLEditor/>);
        await typeSql("ROLLBACK");

        fireEvent.click(screen.getByRole("button", { name: label("studio_sql_run") }));

        expect(await screen.findByText("WARNING: there is no transaction in progress")).toBeTruthy();
    });

    it("shows the refusal of a run that left a transaction open", async () => {
        databaseAdmin.runSqlScript = jest.fn(async () => {
            throw new Error("This SQL began a transaction and did not end it, so it was rolled back: nothing it did was kept.");
        });
        render(<SQLEditor/>);
        await typeSql("BEGIN");

        fireEvent.click(screen.getByRole("button", { name: label("studio_sql_run") }));

        expect(await screen.findByText(/did not end it/)).toBeTruthy();
    });
});

/**
 * Only the Run button was disabled while a run was in flight. Cmd+Enter twice
 * ran an INSERT twice, and whichever answer came back last drew over the other.
 */
describe("a run already in flight", () => {
    it("is not started again by the shortcut", async () => {
        let finish: (rows: unknown) => void = () => undefined;
        executeSql.mockImplementation(async (statement: string) =>
            statement.startsWith("INSERT") ? new Promise(resolve => { finish = resolve; }) : []);
        try {
            render(<SQLEditor/>);
            await typeSql("INSERT INTO audit (note) VALUES ('once')");

            fireEvent.click(screen.getByRole("button", { name: label("studio_sql_run") }));
            await waitFor(() => expect(sent()).toHaveLength(1));
            // The shortcut is the page's only while no text field has the focus.
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            fireEvent.keyDown(window, { key: "Enter", metaKey: true });
            fireEvent.keyDown(window, { key: "Enter", metaKey: true });

            finish([]);
            await waitFor(() => expect((screen.getByRole("button", { name: label("studio_sql_run") }) as HTMLButtonElement).disabled).toBe(false));
            expect(sent()).toEqual(["INSERT INTO audit (note) VALUES ('once')"]);
        } finally {
            executeSql.mockImplementation(async () => []);
        }
    });
});

/**
 * Run read the statement from the console's state, which learns of an edit
 * only when it re-renders. Run or Cmd+Enter right after a paste executed the
 * statement the buffer held before it — the editor showed one query and the
 * grid the rows of another — and a DELETE run a moment earlier ran again.
 */
describe("running right after an edit", () => {
    it("runs the text the editor holds from the Run button", async () => {
        render(<SQLEditor/>);
        await typeSql("select count(*) as n_posts from posts");
        fireEvent.click(await idleRunButton());
        await waitFor(() => expect(sent()).toHaveLength(1));

        const run = await idleRunButton();
        editThen("select count(*) as n_authors from authors", () => run.click());

        await waitFor(() => expect(sent()).toHaveLength(2));
        expect(sent()[1]).toBe("select count(*) as n_authors from authors LIMIT 1000;");
    });

    it("runs the text the editor holds from Cmd+Enter in the editor", async () => {
        render(<SQLEditor/>);
        await typeSql("select 'stale'");
        fireEvent.click(await idleRunButton());
        await waitFor(() => expect(sent()).toHaveLength(1));
        await idleRunButton();

        editThen("select 'fresh'", () => editorModel.onRun?.(undefined));

        await waitFor(() => expect(sent()).toHaveLength(2));
        expect(sent()[1]).toBe("select 'fresh' LIMIT 1000;");
    });

    it("does not run the DELETE that ran before the edit again", async () => {
        render(<SQLEditor/>);
        await typeSql("DELETE FROM posts WHERE id = 1");
        fireEvent.click(await idleRunButton());
        await waitFor(() => expect(sent()).toEqual(["DELETE FROM posts WHERE id = 1"]));

        const run = await idleRunButton();
        editThen("SELECT 1", () => run.click());

        await waitFor(() => expect(sent()).toHaveLength(2));
        expect(sent()).toEqual(["DELETE FROM posts WHERE id = 1", "SELECT 1 LIMIT 1000;"]);
    });

    it("asks about the statement on screen, and runs that one once accepted", async () => {
        // The confirmation was decided on the same stale text: a DELETE pasted
        // over a SELECT ran without a question, as the SELECT it replaced.
        render(<SQLEditor/>);
        await typeSql("SELECT * FROM posts");
        const run = await idleRunButton();

        editThen("DELETE FROM posts", () => run.click());

        const dialog = await screen.findByRole("dialog", { name: label("studio_sql_dangerous_operation") });
        expect(sent()).toEqual([]);
        fireEvent.click(within(dialog).getByRole("button", { name: "accept" }));
        await waitFor(() => expect(sent()).toEqual(["DELETE FROM posts"]));
    });

    it("records the statement that ran in the history", async () => {
        render(<SQLEditor/>);
        await typeSql("select 'stale'");
        const run = await idleRunButton();

        editThen("select 'fresh'", () => run.click());

        await waitFor(() => expect(sent()).toHaveLength(1));
        await waitFor(() => expect(JSON.parse(localStorage.getItem("rebase_sql_history_default") ?? "[]")).toEqual(["select 'fresh'"]));
    });

    it("explains the text the editor holds", async () => {
        render(<SQLEditor/>);
        await typeSql("SELECT 'stale'");
        const explainButton = screen.getByRole("button", { name: label("studio_sql_explain") });

        editThen("SELECT 'fresh'", () => explainButton.click());

        await waitFor(() => expect(sent()).toHaveLength(1));
        expect(sent()[0]).toBe("EXPLAIN (FORMAT JSON) SELECT 'fresh'");
    });

    it("formats the text the editor holds, not the text it held before", async () => {
        // Format wrote the formatted old text back over the paste.
        render(<SQLEditor/>);
        await typeSql("select 'stale'");
        const formatButton = screen.getByRole("button", { name: label("studio_sql_format_sql") });

        editThen("select 1,2", () => formatButton.click());

        expect((screen.getByLabelText("SQL") as HTMLTextAreaElement).value).toBe("select 1, 2");
    });
});

/**
 * A stored active tab that names none of the stored tabs — a tab whose write
 * did not reach storage — left every edit landing nowhere: the editor showed
 * the first tab, and its state never changed from what was stored.
 */
describe("a stored active tab that names no tab", () => {
    it("opens the first tab and keeps what is typed in it", async () => {
        localStorage.setItem("rebase_sql_tabs_default", JSON.stringify([{ id: "1", name: "Query 1", sql: "SELECT 'stored'" }]));
        localStorage.setItem("rebase_sql_active_tab_default", "gone");
        render(<SQLEditor/>);

        await typeSql("SELECT 'typed'");

        expect((screen.getByLabelText("SQL") as HTMLTextAreaElement).value).toBe("SELECT 'typed'");
        await waitFor(() => expect(JSON.parse(localStorage.getItem("rebase_sql_tabs_default") ?? "[]")[0].sql).toBe("SELECT 'typed'"));
    });
});
