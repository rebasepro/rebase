/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * Saving a policy on a collection-mapped table POSTed the rules straight to
 * `/schema-editor/collection/save`. No plan, no confirmation, no sight of the
 * SQL — while the identical edit made in the collection editor two tabs away
 * showed all three, because it went through `useLiveSchemaEditing`.
 *
 * Studio cannot import that hook (`@rebasepro/cms` is a *peer* of
 * `@rebasepro/studio`, which has to run without it), so it reaches it over the
 * Studio bridge. These assert the routing: with an editor mounted the save goes
 * to the bridge, and with none it falls back to the direct write that is the
 * only thing the hosted console has.
 */

const updateCollection = jest.fn<(id: string, patch: Record<string, unknown>) => Promise<void>>();
let editorAvailable = true;

/**
 * Whether the host can write to the project's collection source.
 *
 * `true` for a `rebase dev` server sitting next to its own `collectionsDir`,
 * `false` for the hosted console, whose container is rebuilt from the
 * customer's repository on every deploy. The RLS editor's save branches on it,
 * and that branch is what the render-level tests below are about.
 */
let hasCodebase = true;

/**
 * The `pg_policies` rows the load path answers with — none unless a test puts
 * some there. Shaped as the driver returns them: `roles` is Postgres's array
 * literal, not a JavaScript array.
 */
let livePolicies: Record<string, unknown>[] = [];

/** One mapped table, and the SQL the editor's load path asks for. */
const executeSql = jest.fn<(sql: string) => Promise<unknown>>(async (sql: string) => {
    if (sql.includes("pg_tables")) {
        return { rows: [{ schemaname: "public", tablename: "authors", rowsecurity: true }] };
    }
    if (sql.includes("pg_policies")) return { rows: livePolicies };
    return { rows: [] };
});

/**
 * One object, for the life of the module.
 *
 * The editor's load effect depends on `databaseAdmin` by identity, so a hook
 * that answers with a fresh literal on every render re-fetches on every render
 * — a loop that never settles and that no assertion after it can survive.
 */
const databaseAdmin = {
    executeSql,
    fetchAvailableRoles: async () => ["public", "rebase_user"]
};

const translation = {
    t: (key: string) => en[key as keyof typeof en] ?? key,
    i18n: { language: "en" }
};

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useNavigationGroupLabel: () => (group: string) => group,
    useStudioSchemaEditing: () => ({ available: editorAvailable, updateCollection }),
    useStudioCollectionRegistry: () => ({
        // `authors` is mapped; nothing else is. `table` is the field the editor
        // matches on, and the slug is what a save has to be filed under — a
        // different word on purpose, so a save addressed by table name shows.
        // (A Postgres collection has no `id`; this fixture used to give it one,
        // which is how a save filed under the wrong key passed.)
        collections: [{ slug: "writers",
table: "authors",
securityRules: [] }],
        getCollection: () => undefined
    }),
    useStudioCapabilities: () => ({ codebase: hasCodebase }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    useRebaseContext: () => ({ databaseAdmin }),
    useSnackbarController: () => ({ open: jest.fn() }),
    // The policy editor's expression fields are Monaco, which asks the host
    // whether it is in dark mode.
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    ErrorView: () => null,
    ConfirmationDialog: ({ open, title }: { open: boolean; title: React.ReactNode }) =>
        open ? <div data-testid="confirm">{title}</div> : null
}));

import { RLSEditor } from "../src/components/RLSEditor/RLSEditor";

beforeEach(() => {
    updateCollection.mockReset();
    updateCollection.mockResolvedValue(undefined);
    executeSql.mockClear();
    livePolicies = [];
    editorAvailable = true;
    hasCodebase = true;
    // Watched in both directions: the point of the bridge path is that it does
    // *not* reach the transport.
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "" })) as never;
});

describe("the RLS editor's write path", () => {

    // The component is large and its load path needs a database; what these
    // assert is the routing decision, which lives in one callback.
    it("is the bridge when a collection editor is mounted", async () => {
        const { saveRules } = await import("../src/components/RLSEditor/saveRules");
        await saveRules(
            { available: true, updateCollection },
            { apiBase: "http://api.test/api", getAuthToken: async () => "token" },
            "posts",
            [{ name: "read_own" }]
        );

        expect(updateCollection).toHaveBeenCalledWith("posts", { securityRules: [{ name: "read_own" }] });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it("is the direct write when there is none", async () => {
        const { saveRules } = await import("../src/components/RLSEditor/saveRules");

        await saveRules(
            { available: false, updateCollection },
            { apiBase: "http://api.test/api", getAuthToken: async () => "token" },
            "posts",
            [{ name: "read_own" }]
        );

        expect(updateCollection).not.toHaveBeenCalled();
        expect(global.fetch).toHaveBeenCalled();
    });
});

describe("cancelling the plan dialog", () => {

    it("is an answer, not an error to report", async () => {
        const { isCancellation } = await import("../src/components/RLSEditor/saveRules");
        const cancelled = new Error("The schema change was not applied.");
        cancelled.name = "SchemaChangeCancelled";

        expect(isCancellation(cancelled)).toBe(true);
        expect(isCancellation(new Error("connect ECONNREFUSED"))).toBe(false);
    });
});

/**
 * The branch, not the helper.
 *
 * The two tests at the top call `saveRules` directly, so they pass whatever the
 * component decides — which is how W10-12 was reported fixed while the running
 * admin still applied policies straight to the database on a scaffold. The
 * condition that actually decides is `activeCollection && hasCodebase` in
 * `RLSEditor.tsx`, and only a rendered save reaches it.
 *
 * `authors` is a *mapped* table in both tests below; the only thing that differs
 * is whether the host has source to write to.
 */
describe("saving a policy on a mapped table", () => {
    /** An `en` string, refused rather than searched for as `undefined`. */
    function label(key: keyof typeof en): string {
        const value = en[key];
        if (typeof value !== "string") throw new Error(`en.${String(key)} is not a string`);
        return value;
    }

    /** Load the editor, open "Create Policy", name it, and press Save. */
    async function createPolicy(name: string): Promise<void> {
        render(<RLSEditor/>);

        // The first non-internal table is selected for us, so the toolbar's
        // "Create Policy" is the whole of the navigation.
        const create = await screen.findByRole("button", { name: label("studio_rls_create_policy") });
        fireEvent.click(create);

        const nameField = await screen.findByLabelText(label("studio_policy_name"));
        fireEvent.change(nameField, { target: { value: name } });

        fireEvent.click(screen.getByRole("button", { name: label("studio_policy_save") }));
    }

    it("goes through the plan/apply dialog when the host has the source", async () => {
        hasCodebase = true;

        await createPolicy("sweep_test_policy");

        await waitFor(() => expect(updateCollection).toHaveBeenCalled());
        const [collectionId, patch] = updateCollection.mock.calls[0];
        // The slug, never the table name: `updateCollection` looks collections
        // up by slug, and one it cannot find is written as a new file holding
        // nothing but these rules — a collection with no slug, which fails the
        // next boot.
        expect(collectionId).toBe("writers");
        expect((patch as { securityRules: { name: string }[] }).securityRules[0].name)
            .toBe("sweep_test_policy");

        // The failure this exists for: the policy applied to the database and
        // the collection file never changed, so the next regeneration dropped
        // it. Nothing here may issue DDL.
        const statements = executeSql.mock.calls.map(call => String(call[0]));
        expect(statements.some(sql => /CREATE\s+POLICY/i.test(sql))).toBe(false);
    });

    it("falls back to the direct write only where there is no source", async () => {
        // The hosted console: the container is rebuilt from the customer's
        // repository on every deploy, so the database is the only place a
        // policy can live. Remove `hasCodebase` from the condition and this is
        // the test that goes red.
        hasCodebase = false;

        await createPolicy("console_policy");

        await waitFor(() =>
            expect(executeSql.mock.calls.some(call => /CREATE\s+POLICY/i.test(String(call[0])))).toBe(true));
        expect(updateCollection).not.toHaveBeenCalled();
    });
});

/**
 * "Import to codebase" on a policy that exists only in the database.
 *
 * A live policy's `roles` is its `TO` list — *database* roles. The import
 * copied it into `SecurityRule.roles`, which holds *application* roles and
 * compiles into a `rebase.roles()` check. For a restrictive policy that is a
 * fail-open: `AS RESTRICTIVE TO public USING (tenant_id = …)` came back from
 * the generator as `USING (NOT (… && ARRAY['public']) OR tenant_id = …)`, and
 * since no user holds an application role called `public`, the gate passed for
 * everyone. A permissive one matched nobody instead.
 */
describe("importing a live policy into the codebase", () => {
    function importButtons(): Promise<HTMLElement[]> {
        return screen.findAllByRole("button", { name: "Import to codebase" });
    }

    /** The rule the import appended, from the one save it made. */
    function importedRule(): Record<string, unknown> {
        expect(updateCollection).toHaveBeenCalledTimes(1);
        const [collectionId, patch] = updateCollection.mock.calls[0];
        // Filed under the collection's slug, as the save above is.
        expect(collectionId).toBe("writers");
        const rules = (patch as { securityRules: Record<string, unknown>[] }).securityRules;
        return rules[rules.length - 1];
    }

    it("keeps a restrictive policy's TO public out of the application roles", async () => {
        livePolicies = [{
            schemaname: "public",
            tablename: "authors",
            policyname: "tenant_isolation",
            permissive: "RESTRICTIVE",
            roles: "{public}",
            cmd: "SELECT",
            qual: "(tenant_id = current_setting('app.tenant')::uuid)",
            with_check: null
        }];

        render(<RLSEditor/>);
        fireEvent.click((await importButtons())[0]);

        await waitFor(() => expect(updateCollection).toHaveBeenCalled());
        // `public` is the default `TO` target, so the rule carries no role
        // field at all — and above all no application-role check.
        expect(importedRule()).toEqual({
            name: "tenant_isolation",
            operation: "select",
            mode: "restrictive",
            using: "(tenant_id = current_setting('app.tenant')::uuid)"
        });
    });

    it("files a named database role under pgRoles", async () => {
        livePolicies = [{
            schemaname: "public",
            tablename: "authors",
            policyname: "service_writes",
            permissive: "PERMISSIVE",
            roles: "{rebase_user}",
            cmd: "UPDATE",
            qual: "true",
            with_check: "true"
        }];

        render(<RLSEditor/>);
        fireEvent.click((await importButtons())[0]);

        await waitFor(() => expect(updateCollection).toHaveBeenCalled());
        const rule = importedRule();
        expect(rule.pgRoles).toEqual(["rebase_user"]);
        expect(rule).not.toHaveProperty("roles");
    });
});

/**
 * Editing a policy straight in the database — the hosted console, where there
 * is no source to write to.
 *
 * The edit dropped the policy under its *new* name and created it under the
 * new name, as two separate statements. Renaming `public_read` to
 * `owner_read` dropped nothing and added a second policy beside the first, so
 * the world-readable one stayed. And the two statements committed on their
 * own: a typo in the new USING clause failed the CREATE after the DROP had
 * already gone through, and the policy was simply gone.
 */
describe("editing a policy in the database", () => {
    const publicRead = {
        schemaname: "public",
        tablename: "authors",
        policyname: "public_read",
        permissive: "PERMISSIVE",
        roles: "{public}",
        cmd: "SELECT",
        qual: "true",
        with_check: null
    };

    function label(key: keyof typeof en): string {
        const value = en[key];
        if (typeof value !== "string") throw new Error(`en.${String(key)} is not a string`);
        return value;
    }

    /** Every statement the editor sent that touches a policy definition. */
    function policyDdl(): string[] {
        return executeSql.mock.calls
            .map(call => String(call[0]))
            .filter(sql => /(DROP|CREATE)\s+POLICY/i.test(sql));
    }

    async function editAndSave(newName: string): Promise<void> {
        hasCodebase = false;
        livePolicies = [publicRead];
        render(<RLSEditor/>);

        // The table is mapped, so the generated admin baseline is listed too:
        // press the Edit that sits in `public_read`'s own row.
        let row: HTMLElement | null = await screen.findByText("public_read");
        while (row && within(row).queryAllByRole("button", { name: label("studio_rls_edit") }).length !== 1) {
            row = row.parentElement;
        }
        if (!row) throw new Error("no row for public_read");
        fireEvent.click(within(row).getByRole("button", { name: label("studio_rls_edit") }));
        const nameField = await screen.findByLabelText(label("studio_policy_name"));
        fireEvent.change(nameField, { target: { value: newName } });
        fireEvent.click(screen.getByRole("button", { name: label("studio_policy_save") }));

        await waitFor(() => expect(policyDdl().length).toBeGreaterThan(0));
    }

    it("drops the policy under the name it had, not the one it is getting", async () => {
        await editAndSave("owner_read");

        const [statement] = policyDdl();
        expect(statement).toMatch(/DROP POLICY IF EXISTS "public_read" ON "public"\."authors"/);
        expect(statement).toMatch(/CREATE POLICY "owner_read" ON "public"\."authors"/);
        expect(statement).not.toMatch(/DROP POLICY IF EXISTS "owner_read"/);
    });

    it("sends the drop and the create as one statement, so a failed create keeps the old policy", async () => {
        await editAndSave("public_read");

        // One call: a multi-statement simple query runs as a single implicit
        // transaction, so the DROP rolls back if the CREATE fails.
        expect(policyDdl()).toHaveLength(1);
        const [statement] = policyDdl();
        expect(statement.indexOf("DROP POLICY")).toBeLessThan(statement.indexOf("CREATE POLICY"));
        // No explicit BEGIN/COMMIT: a failure between them would leave a pooled
        // connection inside an aborted transaction.
        expect(statement).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
    });
});

// Kept so the suite fails if the editor stops rendering at all.
describe("the editor still mounts", () => {
    it("renders without a database", () => {
        expect(() => render(<RLSEditor/>)).not.toThrow();
    });
});
