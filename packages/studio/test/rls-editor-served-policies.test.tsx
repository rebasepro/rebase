/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { col, defineTable, rel } from "@rebasepro/types";
import type { TableDescriptorsState } from "@rebasepro/app";
import { EDITOR, servedTables } from "./helpers/servedTables";
import { readyTables, unavailableTables } from "./helpers/tableDescriptors";

/**
 * The RLS editor reads what the code declares from the server — the tables'
 * rules and the policies the server compiles from them, junctions included —
 * and compares it with `pg_policies`. It compiles nothing itself, and it says
 * so when the server withholds the compiled policies (no `schema:read`) or
 * serves no tables at all (a runtime older than `GET /api/schema/tables`).
 */

const tags = defineTable("tags", {
    columns: { id: col.serial().primaryKey(), label: col.text() },
    rls: [{ name: "tags_public_read", operation: "select", access: "public" }]
});
const posts = defineTable("posts", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    relations: { tags: rel.manyToMany(() => tags) },
    rls: [{ name: "posts_raw_read", operation: "select", using: "true" }]
});

let tables: TableDescriptorsState = readyTables(servedTables([posts, tags]));
let livePolicies: Record<string, unknown>[] = [];
const updateCollection = jest.fn<(id: string, patch: Record<string, unknown>) => Promise<void>>();
const snackbarOpen = jest.fn<(options: { type: string; message: string }) => void>();

const executeSql = jest.fn<(sql: string) => Promise<unknown>>(async (sql: string) => {
    if (sql.includes("pg_tables")) {
        return { rows: ["posts", "posts_tags", "tags"].map(tablename => ({ schemaname: "public", tablename, rowsecurity: true })) };
    }
    if (sql.includes("pg_policies")) return { rows: livePolicies };
    return { rows: [] };
});
const databaseAdmin = { executeSql, fetchAvailableRoles: async () => ["public"] };

const translation = {
    t: (key: string, options?: Record<string, unknown>) => {
        const value = en[key as keyof typeof en] ?? key;
        return options && typeof value === "string"
            ? value.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(options[k] ?? ""))
            : value;
    },
    i18n: { language: "en" }
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useNavigationGroupLabel: () => (group: string) => group,
    useStudioSchemaEditing: () => ({ available: true, updateCollection }),
    useTableDescriptors: () => tables,
    useStudioCapabilities: () => ({ codebase: true }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    useRebaseContext: () => ({ databaseAdmin }),
    useSnackbarController: () => ({ open: snackbarOpen }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    ErrorView: () => null,
    ConfirmationDialog: () => null
}));

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
        <textarea data-testid="expression" value={value} onChange={(e) => onChange(e.target.value)}/>
}));

import { RLSEditor } from "../src/components/RLSEditor/RLSEditor";

function label(key: keyof typeof en): string {
    const value = en[key];
    if (typeof value !== "string") throw new Error(`en.${String(key)} is not a string`);
    return value;
}

function live(tablename: string, policyname: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
    return { schemaname: "public", tablename, policyname, permissive: "PERMISSIVE", roles: "{public}", cmd: "SELECT", qual: "true", with_check: null, ...fields };
}

async function rowOf(policyName: string): Promise<HTMLElement> {
    let row: HTMLElement | null = await screen.findByText(policyName);
    while (row && within(row).queryAllByRole("button", { name: label("studio_rls_edit") }).length !== 1) {
        row = row.parentElement;
    }
    if (!row) throw new Error(`no row for ${policyName}`);
    return row;
}

function selectTable(table: string): void {
    const row = screen.getAllByText(table)[0].closest<HTMLElement>(".cursor-pointer");
    if (!row) throw new Error(`no sidebar row for ${table}`);
    fireEvent.click(row);
}

beforeEach(() => {
    tables = readyTables(servedTables([posts, tags]));
    livePolicies = [];
    updateCollection.mockReset();
    updateCollection.mockResolvedValue(undefined);
    snackbarOpen.mockClear();
    executeSql.mockClear();
});

describe("the policies the server serves", () => {

    it("lists a declared rule's policy and the baseline Rebase injects, by the names the server compiled", async () => {
        livePolicies = [live("posts", "posts_raw_read")];
        render(<RLSEditor/>);

        // In the database and declared: no drift, no "DB only".
        const declared = await rowOf("posts_raw_read");
        expect(within(declared).queryByText(new RegExp(label("studio_rls_drift")))).toBeNull();
        expect(within(declared).queryByText("DB Only")).toBeNull();
        // Injected by the server, not yet applied.
        const baseline = await rowOf("posts_default_admin_read");
        expect(within(baseline).getByText(label("studio_rls_unapplied"))).toBeTruthy();
    });

    it("lists a junction's derived policies, served under the table that declares the relation", async () => {
        livePolicies = [live("posts_tags", "posts_tags_default_admin_read", { roles: "{rebase_admin}", qual: "(rebase.uid() IS NULL)" })];
        render(<RLSEditor/>);
        await screen.findAllByText("posts_tags");
        selectTable("posts_tags");

        const applied = await rowOf("posts_tags_default_admin_read");
        expect(within(applied).queryByText(new RegExp(label("studio_rls_drift")))).toBeNull();
        // Derived and still missing from the database.
        expect(within(await rowOf("posts_tags_default_admin_write_insert")).getByText(label("studio_rls_unapplied"))).toBeTruthy();
        // Its admin-request companion is not missing where the server wrote none.
        expect(screen.queryByText(/^posts_tags_default_admin_read_ar_/)).toBeNull();
        // The junction is the platform's: the server re-applies it.
        expect(screen.getByText(label("studio_rls_reapplied_on_start").replace("{{table}}", "posts_tags"))).toBeTruthy();
    });

    it("refuses to edit a junction's derived policy: no declared rule holds it", async () => {
        livePolicies = [live("posts_tags", "posts_tags_default_admin_read", { roles: "{rebase_admin}" })];
        render(<RLSEditor/>);
        await screen.findAllByText("posts_tags");
        selectTable("posts_tags");

        fireEvent.click(within(await rowOf("posts_tags_default_admin_read")).getByRole("button", { name: label("studio_rls_edit") }));
        fireEvent.click(await screen.findByRole("button", { name: label("studio_policy_save") }));

        await waitFor(() => expect(snackbarOpen).toHaveBeenCalled());
        expect(snackbarOpen.mock.calls[0][0]).toEqual({
            type: "error",
            message: label("studio_rls_edit_generated").replace("{{policy}}", "posts_tags_default_admin_read")
        });
        expect(executeSql.mock.calls.some(([sql]) => /CREATE\s+POLICY/i.test(String(sql)))).toBe(false);
    });

    it("saves an edit of a declared rule to the slug the server names, rule by its served index", async () => {
        livePolicies = [live("posts", "posts_raw_read")];
        render(<RLSEditor/>);

        fireEvent.click(within(await rowOf("posts_raw_read")).getByRole("button", { name: label("studio_rls_edit") }));
        fireEvent.change(await screen.findByLabelText(label("studio_policy_name")), { target: { value: "everyone_reads" } });
        fireEvent.click(screen.getByRole("button", { name: label("studio_policy_save") }));

        await waitFor(() => expect(updateCollection).toHaveBeenCalled());
        expect(updateCollection.mock.calls[0]).toEqual(["posts", { securityRules: [{ name: "everyone_reads", operation: "select", using: "true" }] }]);
    });
});

describe("a caller the server withholds the compiled policies from", () => {

    beforeEach(() => {
        tables = readyTables(servedTables([posts, tags], EDITOR));
    });

    it("sees what the database holds, and is told why the declaration is not shown", async () => {
        livePolicies = [live("posts", "posts_raw_read")];
        render(<RLSEditor/>);

        await rowOf("posts_raw_read");
        expect(screen.getByText(label("studio_rls_declared_withheld").replace("{{table}}", "posts"))).toBeTruthy();
        // Nothing to compare against: no generated policy is listed as missing,
        // and nothing is offered for import into a declaration it cannot read.
        expect(screen.queryByText("posts_default_admin_read")).toBeNull();
        expect(screen.queryByRole("button", { name: "Import to codebase" })).toBeNull();
    });

    it("is refused a save to the codebase, and nothing is written", async () => {
        render(<RLSEditor/>);

        // The toolbar's, and the empty list's: either opens the same editor.
        fireEvent.click((await screen.findAllByRole("button", { name: label("studio_rls_create_policy") }))[0]);
        fireEvent.change(await screen.findByLabelText(label("studio_policy_name")), { target: { value: "mine" } });
        fireEvent.click(screen.getByRole("button", { name: label("studio_policy_save") }));

        await waitFor(() => expect(snackbarOpen).toHaveBeenCalled());
        expect(snackbarOpen.mock.calls[0][0]).toEqual({
            type: "error",
            message: label("studio_rls_save_needs_schema_read").replace("{{table}}", "posts")
        });
        expect(updateCollection).not.toHaveBeenCalled();
        expect(executeSql.mock.calls.some(([sql]) => /CREATE\s+POLICY/i.test(String(sql)))).toBe(false);
    });
});

describe("a runtime that does not serve its schema", () => {

    it("says to upgrade it, and still lists what the database holds", async () => {
        tables = unavailableTables("predates-route");
        livePolicies = [live("posts", "hand_written")];
        render(<RLSEditor/>);

        await rowOf("hand_written");
        expect(screen.getByText(label("studio_schema_outdated_title"))).toBeTruthy();
        expect(screen.getByText(label("studio_schema_outdated_body"))).toBeTruthy();
    });
});
