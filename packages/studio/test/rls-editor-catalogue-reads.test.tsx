/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * How often the RLS editor reads the catalogue.
 *
 * Its load depended on the selected table, so picking a table re-read
 * `pg_tables`, all of `pg_policies` and the junction-table query — 1.4 MB and
 * ~70 ms of catalogue at 2,000 tables and 8,000 policies — and the first
 * load, which picks a table, ran twice. It now reads once when it opens, and
 * again only when asked (Refresh, or after a change it made).
 */

const liveTables = ["authors", "posts", "tags"].map(tablename => ({ schemaname: "public", tablename, rowsecurity: true }));

const executeSql = jest.fn<(sql: string) => Promise<unknown>>(async (sql: string) => {
    if (sql.includes("pg_tables")) return { rows: liveTables };
    if (sql.includes("pg_policies")) return { rows: [] };
    return { rows: [] };
});

/** One object for the module's life: the load effect depends on it by identity. */
const databaseAdmin = {
    executeSql,
    fetchAvailableRoles: async () => ["public"]
};

const translation = {
    t: (key: string) => en[key as keyof typeof en] ?? key,
    i18n: { language: "en" }
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useNavigationGroupLabel: () => (group: string) => group,
    useStudioSchemaEditing: () => ({ available: true, updateCollection: jest.fn() }),
    useStudioCollectionRegistry: () => ({ collections: [], getCollection: () => undefined }),
    useStudioCapabilities: () => ({ codebase: true }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    useRebaseContext: () => ({ databaseAdmin }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    ErrorView: () => null,
    ConfirmationDialog: () => null
}));

import { RLSEditor } from "../src/components/RLSEditor/RLSEditor";

/** The catalogue reads so far: tables, policies, junction tables. */
const catalogueReads = () => executeSql.mock.calls
    .map(([sql]) => sql)
    .filter(sql => sql.includes("pg_tables") || sql.includes("pg_policies") || sql.includes("information_schema.tables"));

beforeEach(() => {
    executeSql.mockClear();
});

/** The sidebar's row for `table`: the clickable element around its name. */
function sidebarRow(table: string): HTMLElement {
    const row = screen.getAllByText(table)[0].closest<HTMLElement>(".cursor-pointer");
    if (!row) throw new Error(`no sidebar row for ${table}`);
    return row;
}

describe("the catalogue reads of the RLS editor", () => {
    it("reads tables, policies and junction tables once when it opens", async () => {
        render(<RLSEditor/>);
        await screen.findAllByText("authors");
        // Let anything a first load sets off run.
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(catalogueReads()).toHaveLength(3);
    });

    it("reads nothing again when another table is picked", async () => {
        render(<RLSEditor/>);
        await screen.findAllByText("authors");
        await new Promise(resolve => setTimeout(resolve, 50));
        const afterOpen = catalogueReads().length;

        for (const table of ["posts", "tags"]) {
            fireEvent.click(sidebarRow(table));
            await waitFor(() => expect(sidebarRow(table).className).toContain("bg-primary/10"));
        }
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(catalogueReads().length).toBe(afterOpen);
    });
});
