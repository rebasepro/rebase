import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * "Import to codebase" on the collection editor's RLS tab.
 *
 * A live policy's `roles` is its `TO` list — *database* roles. The import
 * copied it into `SecurityRule.roles`, which holds *application* roles and
 * compiles into a `rebase.roles()` check. On a restrictive policy that fails
 * open: `AS RESTRICTIVE TO public USING (tenant_id = …)` was regenerated as
 * `USING (NOT (… && ARRAY['public']) OR tenant_id = …)`, and since no user
 * holds an application role named `public`, the gate passed for everyone.
 *
 * Studio's RLS editor has the same button and was fixed alongside; this is the
 * other door.
 */

const setFieldValue = jest.fn();

let livePolicies: Record<string, unknown>[] = [];

const databaseAdmin = {
    executeSql: async (sql: string) => (sql.includes("pg_policies") ? { rows: livePolicies } : { rows: [] }),
    fetchApplicationRoles: async () => []
};

jest.mock("@rebasepro/forms", () => ({
    useFormex: () => ({
        values: { slug: "posts", name: "Posts", table: "posts", properties: {}, securityRules: [] },
        setFieldValue
    })
}));

jest.mock("../../src/collection_editor/useCollectionsConfigController", () => ({
    useCollectionsConfigController: () => ({ readOnly: false })
}));

jest.mock("@rebasepro/app", () => ({
    useRebaseContext: () => ({ databaseAdmin }),
    useTranslation: () => ({ t: (key: string) => key })
}));

import { CollectionRLSTab } from "../../src/collection_editor/ui/collection_editor/CollectionRLSTab";

beforeEach(() => {
    setFieldValue.mockReset();
    livePolicies = [];
});

/** Import the one live policy, and return the rule that was appended. */
async function importOnly(policy: Record<string, unknown>): Promise<Record<string, unknown>> {
    livePolicies = [{ tablename: "posts", ...policy }];
    render(<CollectionRLSTab/>);

    fireEvent.click(await screen.findByRole("button", { name: "Import to codebase" }));

    await waitFor(() => expect(setFieldValue).toHaveBeenCalledTimes(1));
    const [field, rules] = setFieldValue.mock.calls[0] as [string, Record<string, unknown>[]];
    expect(field).toBe("securityRules");
    return rules[rules.length - 1];
}

describe("importing a live policy from the RLS tab", () => {
    it("keeps a restrictive policy's TO public out of the application roles", async () => {
        const rule = await importOnly({
            policyname: "tenant_isolation",
            permissive: "RESTRICTIVE",
            roles: "{public}",
            cmd: "SELECT",
            qual: "(tenant_id = current_setting('app.tenant')::uuid)",
            with_check: null
        });

        // `public` is the default `TO` target, so the rule carries no role
        // field at all — and above all no application-role check.
        expect(rule).toEqual({
            name: "tenant_isolation",
            operation: "select",
            mode: "restrictive",
            using: "(tenant_id = current_setting('app.tenant')::uuid)"
        });
    });

    it("files a named database role under pgRoles", async () => {
        const rule = await importOnly({
            policyname: "service_writes",
            permissive: "PERMISSIVE",
            roles: "{rebase_user}",
            cmd: "UPDATE",
            qual: "true",
            with_check: "true"
        });

        expect(rule.pgRoles).toEqual(["rebase_user"]);
        expect(rule.roles).toBeUndefined();
    });

    it("keeps the WITH CHECK of an INSERT policy, which has no USING", async () => {
        const rule = await importOnly({
            policyname: "authors_insert",
            permissive: "PERMISSIVE",
            roles: "{public}",
            cmd: "INSERT",
            qual: null,
            with_check: "(author_id = rebase.uid())"
        });

        // Dropped, the rule is roles-only with no roles, which compiles to
        // `WITH CHECK (false)` — the imported policy would stop every insert.
        expect(rule).toEqual({
            name: "authors_insert",
            operation: "insert",
            mode: "permissive",
            withCheck: "(author_id = rebase.uid())"
        });
    });
});
