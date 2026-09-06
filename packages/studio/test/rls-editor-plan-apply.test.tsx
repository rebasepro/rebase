/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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

/** One mapped table, and the SQL the editor's load path asks for. */
const executeSql = jest.fn<(sql: string) => Promise<unknown>>(async (sql: string) => {
    if (sql.includes("pg_tables")) {
        return { rows: [{ schemaname: "public", tablename: "authors", rowsecurity: true }] };
    }
    if (sql.includes("pg_policies")) return { rows: [] };
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
        // matches on, and the id is what a save has to be filed under.
        collections: [{ id: "authors",
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
    /** Load the editor, open "Create Policy", name it, and press Save. */
    async function createPolicy(name: string): Promise<void> {
        render(<RLSEditor/>);

        // The first non-internal table is selected for us, so the toolbar's
        // "Create Policy" is the whole of the navigation.
        const create = await screen.findByRole("button", { name: en.studio_rls_create_policy });
        fireEvent.click(create);

        const nameField = await screen.findByLabelText(en.studio_policy_name);
        fireEvent.change(nameField, { target: { value: name } });

        fireEvent.click(screen.getByRole("button", { name: en.studio_policy_save }));
    }

    it("goes through the plan/apply dialog when the host has the source", async () => {
        hasCodebase = true;

        await createPolicy("sweep_test_policy");

        await waitFor(() => expect(updateCollection).toHaveBeenCalled());
        const [collectionId, patch] = updateCollection.mock.calls[0];
        expect(collectionId).toBe("authors");
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

// Kept so the suite fails if the editor stops rendering at all.
describe("the editor still mounts", () => {
    it("renders without a database", () => {
        expect(() => render(<RLSEditor/>)).not.toThrow();
    });
});
