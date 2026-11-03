/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "../../app/src/locales/en";

/**
 * The SQL console's schema browser lists the tables of the database picked
 * now, whichever schema read answers last.
 *
 * Picking another database while the first one's schema was still being read
 * left two reads in flight, and the slower answer won: the browser — and the
 * editor's completions — listed app_prod's tables under app_staging.
 */

type ExecuteOptions = { database?: string; role?: string };

/** Each database's schema read, answered when a test says so. */
const pendingSchemas = new Map<string, (rows: Record<string, unknown>[]) => void>();

const executeSql = jest.fn(async (sql: string, options?: ExecuteOptions): Promise<unknown> => {
    if (sql.includes("information_schema")) {
        return new Promise(resolve => pendingSchemas.set(options?.database ?? "", resolve));
    }
    if (sql.includes("current_user")) return [{ role: "postgres" }];
    return [];
});

const databaseAdmin: Record<string, unknown> = {
    executeSql,
    fetchAvailableDatabases: async () => ["app_prod", "app_staging"],
    fetchAvailableRoles: async () => ["postgres"],
    fetchCurrentDatabase: async () => "app_prod"
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string) => (en as unknown as Record<string, string>)[key] ?? key,
        i18n: { language: "en" }
    }),
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

// The kit's stub, with a menu item that can be pressed.
jest.mock("@rebasepro/ui", () => {
    const stub = jest.requireActual<Record<string, unknown>>("@rebasepro/ui");
    const overrides: Record<string, unknown> = {
        MenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) =>
            <button type="button" role="menuitem" onClick={onClick}>{children}</button>
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

const tableRow = (table: string) => ({ schema: "public", table, column: "id", data_type: "integer", is_pk: true });

describe("the schema browser after a switch of database", () => {
    jest.setTimeout(20000);

    it("lists the tables of the database picked now, when the earlier read answers last", async () => {
        render(<SQLEditor/>);
        await waitFor(() => expect(pendingSchemas.has("app_prod")).toBe(true));

        fireEvent.click(screen.getByRole("menuitem", { name: "app_staging" }));
        await waitFor(() => expect(pendingSchemas.has("app_staging")).toBe(true));

        await act(async () => {
            pendingSchemas.get("app_staging")?.([tableRow("staging_only")]);
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        await act(async () => {
            pendingSchemas.get("app_prod")?.([tableRow("prod_only")]);
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        expect(screen.getByText("staging_only")).toBeTruthy();
        expect(screen.queryByText("prod_only")).toBeNull();
    });
});
