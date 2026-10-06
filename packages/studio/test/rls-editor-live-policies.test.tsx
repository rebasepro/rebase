/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * The RLS editor lists what the database enforces.
 *
 * A policy the code also declares — every policy Rebase injects
 * (`<table>_default_admin_read`, the tenancy gate, the auth write gate) and every
 * declared rule that has been applied — was listed with the *code's* fields in
 * place of the database's. So a policy edited in SQL looked exactly like its
 * declaration, and a rule written as a structured `condition` showed no USING at
 * all. Where the editor writes straight to the database (the hosted console),
 * opening such a policy and pressing Save recreated it without its condition: a
 * restrictive tenancy gate with no USING restricts nothing.
 */

const updateCollection = jest.fn<(id: string, patch: Record<string, unknown>) => Promise<void>>();
let hasCodebase = true;
let livePolicies: Record<string, unknown>[] = [];
let declaredRules: Record<string, unknown>[] = [];
const snackbarOpen = jest.fn<(options: { type: string; message: string }) => void>();

const executeSql = jest.fn<(sql: string) => Promise<unknown>>(async (sql: string) => {
    if (sql.includes("pg_tables")) {
        return { rows: [{ schemaname: "public", tablename: "authors", rowsecurity: true }] };
    }
    if (sql.includes("pg_policies")) return { rows: livePolicies };
    return { rows: [] };
});

const databaseAdmin = {
    executeSql,
    fetchAvailableRoles: async () => ["public", "rebase_user"]
};

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
    useStudioCollectionRegistry: () => ({
        collections: [{ slug: "writers",
table: "authors",
securityRules: declaredRules }],
        getCollection: () => undefined
    }),
    useStudioCapabilities: () => ({ codebase: hasCodebase }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    useRebaseContext: () => ({ databaseAdmin }),
    useSnackbarController: () => ({ open: snackbarOpen }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    ErrorView: () => null,
    ConfirmationDialog: ({ open, title, body }: { open: boolean; title: React.ReactNode; body: React.ReactNode }) =>
        open ? <div data-testid="confirm">{title}<p>{body}</p></div> : null
}));

// Monaco does not run in jsdom. A textarea holds the same value and takes the
// same edits, so what the editor was opened with can be read back.
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

/** The live row for a policy, shaped as `pg_policies` returns it. */
function live(policyname: string, fields: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        schemaname: "public",
        tablename: "authors",
        policyname,
        permissive: "PERMISSIVE",
        roles: "{public}",
        cmd: "SELECT",
        qual: "((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))",
        with_check: null,
        ...fields
    };
}

/** The list row that holds a policy's name — the smallest element with its own Edit button. */
async function rowOf(policyName: string): Promise<HTMLElement> {
    let row: HTMLElement | null = await screen.findByText(policyName);
    while (row && within(row).queryAllByRole("button", { name: label("studio_rls_edit") }).length !== 1) {
        row = row.parentElement;
    }
    if (!row) throw new Error(`no row for ${policyName}`);
    return row;
}

function policyDdl(): string[] {
    return executeSql.mock.calls
        .map(call => String(call[0]))
        .filter(sql => /(DROP|CREATE)\s+POLICY/i.test(sql));
}

beforeEach(() => {
    updateCollection.mockReset();
    updateCollection.mockResolvedValue(undefined);
    executeSql.mockClear();
    snackbarOpen.mockClear();
    livePolicies = [];
    declaredRules = [];
    hasCodebase = true;
});

describe("a policy both the code and the database have", () => {

    it("is listed with the database's TO list, not the declaration's", async () => {
        livePolicies = [live("authors_default_admin_read", { roles: "{rebase_user}" })];
        render(<RLSEditor/>);

        const row = await rowOf("authors_default_admin_read");
        expect(within(row).getByText("rebase_user")).toBeTruthy();
    });

    it("says how the database differs from what the code compiles to", async () => {
        livePolicies = [live("authors_default_admin_read", { roles: "{rebase_user}", qual: null })];
        render(<RLSEditor/>);

        const row = await rowOf("authors_default_admin_read");
        const badge = within(row).getByText(new RegExp(label("studio_rls_drift")));
        expect(badge.textContent).toContain("roles");
        expect(badge.textContent).toContain("USING");
    });

    it("is not flagged when the database holds what the code compiles to", async () => {
        livePolicies = [live("authors_default_admin_read")];
        render(<RLSEditor/>);

        const row = await rowOf("authors_default_admin_read");
        expect(within(row).queryByText(new RegExp(label("studio_rls_drift")))).toBeNull();
    });

    it("opens in the editor with the USING clause the database holds", async () => {
        const qual = "((rebase.uid() IS NULL) OR (tenant_id = 'acme'::text))";
        livePolicies = [live("authors_default_admin_read", { qual })];
        render(<RLSEditor/>);

        fireEvent.click(within(await rowOf("authors_default_admin_read"))
            .getByRole("button", { name: label("studio_rls_edit") }));

        const expressions = await screen.findAllByTestId("expression");
        expect((expressions[0] as HTMLTextAreaElement).value).toBe(qual);
    });
});

describe("editing a generated policy straight in the database", () => {

    it("is refused, as it is where the host has source", async () => {
        hasCodebase = false;
        livePolicies = [live("authors_default_admin_read")];
        render(<RLSEditor/>);

        fireEvent.click(within(await rowOf("authors_default_admin_read"))
            .getByRole("button", { name: label("studio_rls_edit") }));
        fireEvent.click(await screen.findByRole("button", { name: label("studio_policy_save") }));

        // Whatever the editor answers, it answers once: wait for that, then
        // read it, so a save that wrongly succeeds fails here and not on a timeout.
        await waitFor(() => expect(snackbarOpen).toHaveBeenCalled());
        expect(snackbarOpen.mock.calls[0][0]).toEqual({
            type: "error",
            message: label("studio_rls_edit_generated").replace("{{policy}}", "authors_default_admin_read")
        });
        expect(policyDdl()).toEqual([]);
    });

    it("still applies an edit of a policy the project does not generate", async () => {
        hasCodebase = false;
        livePolicies = [live("public_read", { qual: "true" })];
        render(<RLSEditor/>);

        fireEvent.click(within(await rowOf("public_read"))
            .getByRole("button", { name: label("studio_rls_edit") }));
        fireEvent.click(await screen.findByRole("button", { name: label("studio_policy_save") }));

        await waitFor(() => expect(policyDdl()).toHaveLength(1));
        expect(policyDdl()[0]).toMatch(/CREATE POLICY "public_read" ON "public"\."authors" AS PERMISSIVE FOR SELECT TO "public" USING \(true\)/);
    });
});

describe("a table whose policies the deployment owns", () => {

    it("says, where the editor writes to the database, that the server re-applies them", async () => {
        hasCodebase = false;
        render(<RLSEditor/>);

        expect(await screen.findByText(label("studio_rls_reapplied_on_start").replace("{{table}}", "authors")))
            .toBeTruthy();
    });

    it("says nothing of the kind where saves go to the source", async () => {
        hasCodebase = true;
        render(<RLSEditor/>);

        await screen.findByText("authors_default_admin_read");
        expect(screen.queryByText(label("studio_rls_reapplied_on_start").replace("{{table}}", "authors"))).toBeNull();
    });

    it("warns that disabling RLS lasts only until the server next starts", async () => {
        render(<RLSEditor/>);

        fireEvent.click(await screen.findByRole("button", { name: label("studio_rls_disable_rls") }));

        const dialog = await screen.findByTestId("confirm");
        expect(dialog.textContent).toContain(label("studio_rls_disable_reapplied").replace("{{table}}", "authors"));
    });
});

describe("saving a declared policy with nothing changed", () => {

    it("does not say it was saved", async () => {
        declaredRules = [{ name: "public_read", operation: "select", using: "true" }];
        render(<RLSEditor/>);

        fireEvent.click(within(await rowOf("public_read"))
            .getByRole("button", { name: label("studio_rls_edit") }));
        fireEvent.click(await screen.findByRole("button", { name: label("studio_policy_save") }));

        await waitFor(() => expect(snackbarOpen).toHaveBeenCalled());
        expect(snackbarOpen.mock.calls.map(([o]) => o.type)).not.toContain("success");
        expect(snackbarOpen.mock.calls[0][0].message).toBe(label("studio_rls_nothing_changed"));
        expect(updateCollection).not.toHaveBeenCalled();
    });

    it("is still saved once something has changed", async () => {
        declaredRules = [{ name: "public_read", operation: "select", using: "true" }];
        render(<RLSEditor/>);

        fireEvent.click(within(await rowOf("public_read"))
            .getByRole("button", { name: label("studio_rls_edit") }));
        fireEvent.change(await screen.findByLabelText(label("studio_policy_name")), { target: { value: "everyone_reads" } });
        fireEvent.click(screen.getByRole("button", { name: label("studio_policy_save") }));

        await waitFor(() => expect(updateCollection).toHaveBeenCalled());
    });
});
