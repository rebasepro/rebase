/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "../../app/src/locales/en";
import type { SqlScriptResult } from "@rebasepro/types";

/**
 * The console holds every value as the database's text, so "Export JSON"
 * writes `"42"` and `"t"`. "Export typed JSON" writes each value read by its
 * column's type — offered when the run said its columns' types.
 */

const QUERY = "SELECT id, active, meta, note FROM things";
const script: SqlScriptResult = {
    rows: [{ id: "42", active: "t", meta: "{\"a\":1}", note: "x" }],
    columns: [
        { name: "id", type: "integer" },
        { name: "active", type: "boolean" },
        { name: "meta", type: "jsonb" },
        { name: "note", type: "text" }
    ],
    tables: [],
    notices: []
};

const executeSql = jest.fn(async (sql: string): Promise<unknown> =>
    sql.includes("current_user") ? [{ role: "postgres" }] : []);
const runSqlScript = jest.fn(async (): Promise<SqlScriptResult> => script);
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

async function run() {
    render(<SQLEditor/>);
    fireEvent.change(await screen.findByLabelText("SQL"), { target: { value: QUERY } });
    fireEvent.click(screen.getByRole("button", { name: en.studio_sql_run as string }));
    await waitFor(() => expect(runSqlScript).toHaveBeenCalled());
    await screen.findByRole("button", { name: en.studio_sql_export_json as string });
}

async function exported(buttonName: string): Promise<unknown> {
    const blobs: Blob[] = [];
    URL.createObjectURL = jest.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:test";
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = jest.fn();
    HTMLAnchorElement.prototype.click = jest.fn();
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
    expect(blobs).toHaveLength(1);
    const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blobs[0]);
    });
    return JSON.parse(text);
}

describe("exporting the console's result as JSON", () => {
    it("writes the text as it is held with Export JSON, as before", async () => {
        await run();
        expect(await exported(en.studio_sql_export_json as string)).toEqual(script.rows);
    });

    it("writes each value read by its column's type with Export typed JSON", async () => {
        await run();
        expect(await exported(en.studio_sql_export_json_typed as string))
            .toEqual([{ id: 42, active: true, meta: { a: 1 }, note: "x" }]);
    });
});
