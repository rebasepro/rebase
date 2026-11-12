/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { col, defineTable } from "@rebasepro/types";
import type { AnyTableDef } from "@rebasepro/types";
import type { TableDescriptorsState } from "@rebasepro/app";
import { servedTables } from "./helpers/servedTables";
import { NO_TABLES, readyTables } from "./helpers/tableDescriptors";

/**
 * Which declared table the RLS editor attributes a live table to.
 *
 * It matched a table to any collection whose `id`, `path`, `table`, `slug` or
 * `collectionId` equalled the table's name, in any schema. So an unmapped
 * table named like another table's slug — or a same-named table in another
 * schema — was taken for that table: it listed the declared generated
 * policies as missing from the table, and offered to import the table's own
 * policies into the declaration.
 *
 * A declared table maps the SQL table the server says it is, in the schema
 * the server says.
 */

/** The live tables, as `pg_tables` rows. */
let liveTables: { schemaname: string; tablename: string }[] = [];

/** The live policies, as `pg_policies` rows. */
let livePolicies: Record<string, unknown>[] = [];

let tables: TableDescriptorsState = NO_TABLES;
const declare = (...defs: AnyTableDef[]) => { tables = readyTables(servedTables(defs)); };
const columns = { id: col.serial().primaryKey() };

const executeSql = jest.fn<(sql: string) => Promise<unknown>>(async (sql: string) => {
    if (sql.includes("pg_tables")) return { rows: liveTables.map(t => ({ ...t, rowsecurity: true })) };
    if (sql.includes("pg_policies")) return { rows: livePolicies };
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
    useTableDescriptors: () => tables,
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

beforeEach(() => {
    executeSql.mockClear();
    liveTables = [];
    livePolicies = [];
    tables = NO_TABLES;
});

/** Load the editor on its one table, which holds one hand-written policy. */
async function loadTable(schemaname: string, tablename: string): Promise<void> {
    liveTables = [{ schemaname, tablename }];
    livePolicies = [{
        schemaname,
        tablename,
        policyname: "hand_written",
        permissive: "PERMISSIVE",
        roles: "{public}",
        cmd: "SELECT",
        qual: "true",
        with_check: null
    }];
    render(<RLSEditor/>);
    await screen.findByText("hand_written");
}

/** Whether the editor took the loaded table for a collection. */
function isAttributed(): boolean {
    // Offered only on a table a collection maps; and a mapped table lists the
    // admin baseline Rebase generates for it.
    const importOffered = screen.queryAllByRole("button", { name: "Import to codebase" }).length > 0;
    const baselineListed = screen.queryAllByText(/_default_admin_read$/).length > 0;
    expect(importOffered).toBe(baselineListed);
    return importOffered;
}

describe("the declared table a live table belongs to", () => {
    it("is not the one whose slug is the table's name, when its table is another", async () => {
        declare(defineTable("writers", { table: "authors", columns, rls: "admin-only" }));
        await loadTable("public", "writers");

        expect(isAttributed()).toBe(false);
    });

    it("is not one whose table is in another schema", async () => {
        declare(defineTable("authors", { columns, rls: "admin-only" }));
        await loadTable("archive", "authors");

        expect(isAttributed()).toBe(false);
    });

    it("is the one whose SQL table it is, whatever its slug", async () => {
        declare(defineTable("blogPosts", { table: "blog_posts", columns, rls: "admin-only" }));
        await loadTable("public", "blog_posts");

        expect(isAttributed()).toBe(true);
    });

    it("is the one that declares the table's schema", async () => {
        declare(defineTable("authors", { schema: "app", columns, rls: "admin-only" }));
        await loadTable("app", "authors");

        expect(isAttributed()).toBe(true);
    });
});
