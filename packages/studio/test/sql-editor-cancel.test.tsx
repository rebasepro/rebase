/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "../../app/src/locales/en";
import type { SqlScriptResult } from "@rebasepro/types";

/**
 * Nothing could stop a console run: Run spun until the statement ended or the
 * server's statement_timeout (30 s) stopped it. While a run is in flight the
 * console offers "Cancel run", which aborts the run's signal — the server
 * cancels the statement when it can — and gives the console back at once.
 */

type RunOptions = { database?: string; role?: string; signal?: AbortSignal };

const runSqlScript = jest.fn((sql: string, options?: RunOptions) => new Promise<SqlScriptResult>((resolve, reject) => {
    if (!sql.includes("pg_sleep")) {
        resolve({ rows: [], columns: [], tables: [], notices: [] });
        return;
    }
    options?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
}));
const sleeping = () => runSqlScript.mock.calls.find(([sql]) => sql.includes("pg_sleep"));
const executeSql = jest.fn(async (sql: string): Promise<unknown> =>
    sql.includes("current_user") ? [{ role: "postgres" }] : []);
const databaseAdmin: Record<string, unknown> = {
    executeSql,
    runSqlScript,
    fetchAvailableDatabases: async () => ["postgres"],
    fetchAvailableRoles: async () => ["postgres"],
    fetchCurrentDatabase: async () => "postgres"
};

const translation = {
    t: (key: string) => (en as unknown as Record<string, string>)[key] ?? key,
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

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
        <textarea aria-label="SQL" value={value} onChange={(e) => onChange(e.target.value)}/>
}));

import { SQLEditor } from "../src/components/SQLEditor/SQLEditor";

describe("cancelling a console run", () => {
    it("offers Cancel run while a run is in flight, aborts it, and gives the console back", async () => {
        render(<SQLEditor/>);
        expect(screen.queryByRole("button", { name: en.studio_sql_cancel_run as string })).toBeNull();

        fireEvent.change(await screen.findByLabelText("SQL"), { target: { value: "SELECT pg_sleep(30)" } });
        fireEvent.click(screen.getByRole("button", { name: en.studio_sql_run as string }));
        await waitFor(() => expect(sleeping()).toBeDefined());
        const signal = sleeping()![1]?.signal;
        expect(signal?.aborted).toBe(false);

        fireEvent.click(await screen.findByRole("button", { name: en.studio_sql_cancel_run as string }));

        expect(signal?.aborted).toBe(true);
        expect(await screen.findByText(en.studio_sql_run_cancelled as string)).toBeTruthy();
        await waitFor(() => expect((screen.getByRole("button", { name: en.studio_sql_run as string }) as HTMLButtonElement).disabled).toBe(false));
        expect(screen.queryByRole("button", { name: en.studio_sql_cancel_run as string })).toBeNull();
    });
});
