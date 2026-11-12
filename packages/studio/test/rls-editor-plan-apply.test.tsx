/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import { FakeResponse } from "./helpers/fakeResponse";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { col, defineTable } from "@rebasepro/types";
import type { SecurityRule, TablePatch } from "@rebasepro/types";
import type { TableDescriptorsState } from "@rebasepro/app";
import { servedTables } from "./helpers/servedTables";
import { readyTables } from "./helpers/tableDescriptors";

/** The rules a save sets: a table with no rules of its own gets them whole, as `setRls`. */
function rulesSent(patches: TablePatch[]): SecurityRule[] {
    const [patch] = patches;
    if (patches.length !== 1 || patch.op !== "setRls" || !Array.isArray(patch.rls)) {
        throw new Error(`expected one setRls with rules, got ${JSON.stringify(patches)}`);
    }
    return patch.rls;
}

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

const applyTablePatches = jest.fn<(table: string, patches: TablePatch[]) => Promise<void>>();
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

/**
 * `authors` is declared; nothing else is. Its slug is `writers` — what a save
 * has to be filed under — a different word from the table on purpose, so a
 * save addressed by table name shows. No rules unless a test says: the
 * admin-only posture.
 */
function served(rules: SecurityRule[]): TableDescriptorsState {
    const [first, ...rest] = rules;
    return readyTables(servedTables([defineTable("writers", {
        table: "authors",
        columns: { id: col.serial().primaryKey(), authorId: col.text().column("author_id") },
        rls: first ? [first, ...rest] : "admin-only"
    })]));
}
let tables = served([]);

/** Every snackbar the editor opened, so a refusal can be read back. */
const snackbarOpen = jest.fn<(options: { type: string; message: string }) => void>();

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
    useStudioSchemaEditing: () => ({ available: editorAvailable, applyTablePatches }),
    useTableDescriptors: () => tables,
    useStudioCapabilities: () => ({ codebase: hasCodebase }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    useRebaseContext: () => ({ databaseAdmin }),
    useSnackbarController: () => ({ open: snackbarOpen }),
    // The policy editor's expression fields are Monaco, which asks the host
    // whether it is in dark mode.
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    ErrorView: () => null,
    ConfirmationDialog: ({ open, title }: { open: boolean; title: React.ReactNode }) =>
        open ? <div data-testid="confirm">{title}</div> : null
}));

import { RLSEditor } from "../src/components/RLSEditor/RLSEditor";
import { getPolicyNamesForRule } from "@rebasepro/utils";

beforeEach(() => {
    applyTablePatches.mockReset();
    applyTablePatches.mockResolvedValue(undefined);
    executeSql.mockClear();
    livePolicies = [];
    tables = served([]);
    snackbarOpen.mockClear();
    editorAvailable = true;
    hasCodebase = true;
    // Watched in both directions: the point of the bridge path is that it does
    // *not* reach the transport.
    global.fetch = jest.fn<typeof fetch>(async () => new FakeResponse({ text: "" }));
});

describe("the RLS editor's write path", () => {

    // The component is large and its load path needs a database; what these
    // assert is the routing decision, which lives in one callback.
    const posts = { slug: "posts", rls: { posture: "admin-only" as const, rules: [], defaultPolicies: true } };
    const never = async () => false;

    it("is the bridge when a collection editor is mounted", async () => {
        const { saveRules } = await import("../src/components/RLSEditor/saveRules");
        await saveRules(
            { available: true, applyTablePatches },
            { apiBase: "http://api.test/api", getAuthToken: async () => "token" },
            posts,
            [{ name: "read_own", roles: ["editor"] }],
            { confirmDetach: never }
        );

        expect(applyTablePatches).toHaveBeenCalledWith("posts", [{ op: "setRls", table: "posts", rls: [{ name: "read_own", roles: ["editor"] }] }]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it("is the direct write of `{ patches }` when there is none", async () => {
        const { saveRules } = await import("../src/components/RLSEditor/saveRules");

        await saveRules(
            { available: false, applyTablePatches },
            { apiBase: "http://api.test/api", getAuthToken: async () => "token" },
            posts,
            [{ name: "read_own", roles: ["editor"] }],
            { confirmDetach: never }
        );

        expect(applyTablePatches).not.toHaveBeenCalled();
        const [url, init] = jest.mocked(global.fetch).mock.calls[0];
        expect(String(url)).toBe("http://api.test/api/admin/schema-editor/apply");
        expect(JSON.parse(String(init?.body))).toEqual({ patches: [{ op: "setRls", table: "posts", rls: [{ name: "read_own", roles: ["editor"] }] }] });
    });
});

describe("the rule operations a save sends", () => {
    const declared: SecurityRule[] = [
        { operation: "select", access: "public" },
        { operations: ["insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] }
    ];
    const table = { slug: "posts", rls: { posture: "rules" as const, rules: declared, defaultPolicies: true } };
    const never = async () => false;

    it("replaces only the edited rule; the others are not sent, so their policy names stay", async () => {
        const { rlsEdit } = await import("../src/components/RLSEditor/saveRules");
        const edited: SecurityRule[] = [declared[0], { operations: ["insert", "update"], roles: ["editor", "reviewer"] }, declared[2]];
        expect(await rlsEdit(table, edited, never)).toEqual([
            { op: "replaceRule", table: "posts", index: 1, rule: { operations: ["insert", "update"], roles: ["editor", "reviewer"] } }
        ]);
    });

    it("appends an imported rule as addRule", async () => {
        const { rlsEdit } = await import("../src/components/RLSEditor/saveRules");
        expect(await rlsEdit(table, [...declared, { operation: "select", roles: ["auditor"] }], never)).toEqual([
            { op: "addRule", table: "posts", index: 3, rule: { operation: "select", roles: ["auditor"] } }
        ]);
    });

    it("writes \"admin-only\" when no rule is left, never an empty list", async () => {
        const { rlsEdit } = await import("../src/components/RLSEditor/saveRules");
        expect(await rlsEdit(table, [], never)).toEqual([{ op: "setRls", table: "posts", rls: "admin-only" }]);
    });

    it("narrows a rule the policy editor built to the variant its fields make", async () => {
        const { asSecurityRule } = await import("../src/components/RLSEditor/saveRules");
        expect(asSecurityRule({ name: "r", operation: "select", using: "true" })).toEqual({ name: "r", operation: "select", using: "true" });
        expect(asSecurityRule({ operation: "select", access: "public" })).toEqual({ operation: "select", access: "public" });
        expect(asSecurityRule({ operation: "update", ownerField: "authorId" })).toEqual({ operation: "update", ownerField: "authorId" });
    });

    describe("on a table that inherits defaultRls", () => {
        const inherited = { slug: "notes", rls: { posture: "rules" as const, inherited: true as const, rules: [declared[0]], defaultPolicies: true } };

        it("asks before detaching, and writes nothing when the answer is to keep inheriting", async () => {
            const { rlsEdit, isCancellation } = await import("../src/components/RLSEditor/saveRules");
            const asked: string[] = [];
            const error = await rlsEdit(inherited, [declared[0], declared[1]], async slug => { asked.push(slug); return false; })
                .catch((e: unknown) => e);
            expect(asked).toEqual(["notes"]);
            expect(isCancellation(error)).toBe(true);
        });

        it("detaches into the table's own rules once confirmed", async () => {
            const { rlsEdit } = await import("../src/components/RLSEditor/saveRules");
            expect(await rlsEdit(inherited, [declared[0], declared[1]], async () => true)).toEqual([
                { op: "setRls", table: "notes", rls: [declared[0], declared[1]] }
            ]);
        });

        it("asks nothing and writes nothing when the rules are unchanged", async () => {
            const { rlsEdit } = await import("../src/components/RLSEditor/saveRules");
            const ask = jest.fn(async () => true);
            expect(await rlsEdit(inherited, [declared[0]], ask)).toEqual([]);
            expect(ask).not.toHaveBeenCalled();
        });
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
 * condition that actually decides is `savesToCodebase` (a declared table, and a codebase) in
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

        await waitFor(() => expect(applyTablePatches).toHaveBeenCalled());
        const [slug, patches] = applyTablePatches.mock.calls[0];
        // The slug, never the table name: the schema editor finds tables by it.
        expect(slug).toBe("writers");
        expect(rulesSent(patches)[0].name).toBe("sweep_test_policy");

        // The failure this exists for: the policy applied to the database and
        // the collection file never changed, so the next regeneration dropped
        // it. Nothing here may issue DDL.
        const statements = executeSql.mock.calls.map(call => String(call[0]));
        expect(statements.some(sql => /CREATE\s+POLICY/i.test(sql))).toBe(false);
    });

    it("with Studio mounted alone (no collection editor), posts `{ patches }` to the schema editor's apply route", async () => {
        // The console's Studio tab, the headless template: the bridge answers
        // `available: false`, and the source is still there to write.
        editorAvailable = false;
        hasCodebase = true;

        await createPolicy("studio_alone_policy");

        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        const [url, init] = jest.mocked(global.fetch).mock.calls[0];
        expect(String(url)).toBe("http://api.test/api/admin/schema-editor/apply");
        expect(String(url)).not.toMatch(/collection\/save/);
        const body: unknown = JSON.parse(String(init?.body));
        expect(body).toEqual({ patches: [expect.objectContaining({ op: "setRls", table: "writers" })] });
        expect(applyTablePatches).not.toHaveBeenCalled();
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
        expect(applyTablePatches).not.toHaveBeenCalled();
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
    function importedRule(): SecurityRule {
        expect(applyTablePatches).toHaveBeenCalledTimes(1);
        const [slug, patches] = applyTablePatches.mock.calls[0];
        // Filed under the table's slug, as the save above is.
        expect(slug).toBe("writers");
        const rules = rulesSent(patches);
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

        await waitFor(() => expect(applyTablePatches).toHaveBeenCalled());
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

        await waitFor(() => expect(applyTablePatches).toHaveBeenCalled());
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

    /**
     * A policy name is any identifier Postgres accepts, and the presets this
     * editor offers are named in words ("Enable read access for all users").
     * A name with a space or a quote is written as a quoted identifier, its
     * `"` doubled, not refused as unsafe.
     */
    it("writes a policy name with spaces and quotes as a quoted identifier", async () => {
        hasCodebase = false;
        livePolicies = [{ ...publicRead, policyname: "Enable read access for all users" }];
        render(<RLSEditor/>);

        let row: HTMLElement | null = await screen.findByText("Enable read access for all users");
        while (row && within(row).queryAllByRole("button", { name: label("studio_rls_edit") }).length !== 1) {
            row = row.parentElement;
        }
        if (!row) throw new Error("no row for the policy");
        fireEvent.click(within(row).getByRole("button", { name: label("studio_rls_edit") }));
        const nameField = await screen.findByLabelText(label("studio_policy_name"));
        fireEvent.change(nameField, { target: { value: "Everyone reads \"authors\"" } });
        fireEvent.click(screen.getByRole("button", { name: label("studio_policy_save") }));

        await waitFor(() => expect(policyDdl().length).toBeGreaterThan(0));
        const [statement] = policyDdl();
        expect(statement).toMatch(/DROP POLICY IF EXISTS "Enable read access for all users" ON "public"\."authors"/);
        expect(statement).toContain("CREATE POLICY \"Everyone reads \"\"authors\"\"\" ON \"public\".\"authors\"");
        expect(snackbarOpen.mock.calls.filter(([o]) => o.type === "error")).toHaveLength(0);
    });
});

/**
 * Editing a policy that a declared rule compiles to, where the host has source.
 *
 * The edit found its rule by `rule.name === policy name`. An unnamed rule's
 * policy is `<table>_<op>_<hash>`, a rule over several operations names its
 * policies `<name>_<op>`, and the admin baseline Rebase adds is declared by no
 * rule at all — so none of them matched, the unchanged rules were saved, and
 * the editor said "Policy saved successfully".
 */
describe("editing a policy declared in code", () => {
    function label(key: keyof typeof en): string {
        const value = en[key];
        if (typeof value !== "string") throw new Error(`en.${String(key)} is not a string`);
        return value;
    }

    /** Open the editor on one policy's row, rename it, and press Save. */
    async function editAndSave(policyName: string, newName: string): Promise<void> {
        render(<RLSEditor/>);
        let row: HTMLElement | null = await screen.findByText(policyName);
        while (row && within(row).queryAllByRole("button", { name: label("studio_rls_edit") }).length !== 1) {
            row = row.parentElement;
        }
        if (!row) throw new Error(`no row for ${policyName}`);
        fireEvent.click(within(row).getByRole("button", { name: label("studio_rls_edit") }));

        fireEvent.change(await screen.findByLabelText(label("studio_policy_name")), { target: { value: newName } });
        fireEvent.click(screen.getByRole("button", { name: label("studio_policy_save") }));
    }

    function errors(): string[] {
        return snackbarOpen.mock.calls.filter(([o]) => o.type === "error").map(([o]) => o.message);
    }

    it("edits the unnamed rule a generated policy name belongs to, keeping its condition", async () => {
        tables = served([{ operation: "select", access: "public" }]);
        const [generated] = getPolicyNamesForRule({ operation: "select", access: "public" }, "authors");

        await editAndSave(generated, "public_read");

        await waitFor(() => expect(applyTablePatches).toHaveBeenCalled());
        const [, patches] = applyTablePatches.mock.calls[0];
        // Renamed, and still `access: "public"`: the editor shows no USING for
        // a structured rule, and an untouched condition is not a change. One
        // rule replaced, by its position — nothing else rewritten.
        expect(patches).toEqual([{ op: "replaceRule", table: "writers", index: 0, rule: { name: "public_read", operation: "select", access: "public" } }]);
    });

    it("refuses one operation of a rule that covers several", async () => {
        tables = served([{ name: "owner_access", operations: ["select", "update"], ownerField: "authorId" }]);

        await editAndSave("owner_access_select", "owner_read");

        await waitFor(() => expect(errors()).toHaveLength(1));
        expect(errors()[0]).toBe(label("studio_rls_edit_several_operations").replace("{{policy}}", "owner_access_select"));
        expect(applyTablePatches).not.toHaveBeenCalled();
    });

    it("refuses a policy of the baseline Rebase generates", async () => {
        await editAndSave("authors_default_admin_read", "admins_read");

        await waitFor(() => expect(errors()).toHaveLength(1));
        expect(errors()[0]).toBe(label("studio_rls_edit_generated").replace("{{policy}}", "authors_default_admin_read"));
        expect(applyTablePatches).not.toHaveBeenCalled();
    });

    it("refuses a policy that exists only in the database", async () => {
        livePolicies = [{
            schemaname: "public",
            tablename: "authors",
            policyname: "hand_written",
            permissive: "PERMISSIVE",
            roles: "{public}",
            cmd: "SELECT",
            qual: "true",
            with_check: null
        }];

        await editAndSave("hand_written", "hand_written_2");

        await waitFor(() => expect(errors()).toHaveLength(1));
        expect(errors()[0]).toBe(label("studio_rls_edit_not_declared").replace("{{policy}}", "hand_written"));
        expect(applyTablePatches).not.toHaveBeenCalled();
    });
});

// Kept so the suite fails if the editor stops rendering at all.
describe("the editor still mounts", () => {
    it("renders without a database", () => {
        expect(() => render(<RLSEditor/>)).not.toThrow();
    });
});
