/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";

/**
 * Which collection the RLS editor attributes a live table to.
 *
 * It matched a table to any collection whose `id`, `path`, `table`, `slug` or
 * `collectionId` equalled the table's name, in any schema. So an unmapped
 * table named like another collection's slug — or a same-named table in
 * another schema — was taken for that collection: it listed the collection's
 * generated policies as missing from the table, and offered to import the
 * table's own policies into the collection.
 *
 * A collection maps the table `db push` writes for it: `getTableName`, in the
 * schema it declares or `public`.
 */

/** The live tables, as `pg_tables` rows. */
let liveTables: { schemaname: string; tablename: string }[] = [];

/** The live policies, as `pg_policies` rows. */
let livePolicies: Record<string, unknown>[] = [];

let collections: Record<string, unknown>[] = [];

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
    useStudioCollectionRegistry: () => ({ collections, getCollection: () => undefined }),
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
    collections = [];
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

describe("the collection a live table belongs to", () => {
    it("is not the one whose slug is the table's name, when its table is another", async () => {
        collections = [{ slug: "writers", table: "authors" }];
        await loadTable("public", "writers");

        expect(isAttributed()).toBe(false);
    });

    it("is not one whose table is in another schema", async () => {
        collections = [{ slug: "authors" }];
        await loadTable("archive", "authors");

        expect(isAttributed()).toBe(false);
    });

    it("is the one whose table it is, by the table `db push` derives from the slug", async () => {
        collections = [{ slug: "blogPosts" }];
        await loadTable("public", "blog_posts");

        expect(isAttributed()).toBe(true);
    });

    it("is the one that declares the table's schema", async () => {
        collections = [{ slug: "authors", schema: "app" }];
        await loadTable("app", "authors");

        expect(isAttributed()).toBe(true);
    });
});
