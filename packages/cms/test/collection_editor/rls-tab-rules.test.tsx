import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

/**
 * What the collection editor's RLS tab writes into `securityRules`, and which
 * live table it reads policies from.
 *
 * Importing a live policy is covered in `rls-tab-import.test.tsx`; this file
 * covers the tab's own editor and the table it looks at.
 */

const setFieldValue = jest.fn();

let values: Record<string, unknown> = {};

/**
 * A `pg_policies` stand-in that filters the way Postgres would, on whatever
 * the query pins: a `tablename = '…'` and a `schemaname = '…'`. A query that
 * does not pin the schema gets every schema's policies for that table name.
 */
type LivePolicy = Record<string, unknown> & { schemaname: string; tablename: string };
let livePolicies: LivePolicy[] = [];
const policyQueries: string[] = [];

const databaseAdmin = {
    executeSql: async (sql: string) => {
        if (!sql.includes("pg_policies")) return { rows: [] };
        policyQueries.push(sql);
        const table = /tablename\s*=\s*'([^']+)'/.exec(sql)?.[1];
        const schema = /schemaname\s*=\s*'([^']+)'/.exec(sql)?.[1];
        return {
            rows: livePolicies.filter(p =>
                (table === undefined || p.tablename === table) &&
                (schema === undefined || p.schemaname === schema))
        };
    },
    fetchApplicationRoles: async () => []
};

jest.mock("@rebasepro/forms", () => ({
    useFormex: () => ({ values, setFieldValue })
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
    policyQueries.length = 0;
    values = { slug: "posts", name: "Posts", table: "posts", properties: {}, securityRules: [] };
});

/** The rules the tab last wrote. */
async function savedRules(): Promise<Record<string, unknown>[]> {
    await waitFor(() => expect(setFieldValue).toHaveBeenCalledTimes(1));
    const [field, rules] = setFieldValue.mock.calls[0] as [string, Record<string, unknown>[]];
    expect(field).toBe("securityRules");
    return rules;
}

describe("creating a policy in the RLS tab", () => {
    it("keeps the WITH CHECK of an INSERT policy, which has no USING", async () => {
        render(<CollectionRLSTab/>);

        fireEvent.click(screen.getByRole("button", { name: "CREATE POLICY" }));
        fireEvent.change(await screen.findByLabelText("studio_policy_name"), { target: { value: "authors_insert" } });
        fireEvent.click(screen.getByRole("button", { name: "INSERT" }));
        // INSERT has no USING clause, so the editor does not offer one.
        expect(screen.queryByLabelText("studio_policy_using_expr")).toBeNull();
        fireEvent.change(screen.getByLabelText("studio_policy_check_expr"), { target: { value: "author_id = rebase.uid()" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        const rules = await savedRules();
        // Without `withCheck` this is a roles-only rule with no roles, which
        // the generator compiles to `WITH CHECK (false)`: nobody can insert.
        expect(rules).toEqual([
            {
                name: "authors_insert",
                operation: "insert",
                mode: "permissive",
                roles: [],
                withCheck: "author_id = rebase.uid()"
            }
        ]);
    });
});

describe("editing a rule in the RLS tab", () => {
    /** Open the editor on the rule at `index`. */
    async function edit(index: number) {
        render(<CollectionRLSTab/>);
        fireEvent.click(screen.getAllByRole("button", { name: "EDIT" })[index]);
        return await screen.findByLabelText("studio_policy_name");
    }

    it("keeps what the editor does not show", async () => {
        values.securityRules = [
            { name: "own_rows", operations: ["select", "update"], ownerField: "user_id", pgRoles: ["app_user"] }
        ];
        fireEvent.change(await edit(0), { target: { value: "own_rows_v2" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        // The editor has no field for `ownerField`, `operations` or `pgRoles`.
        // Rebuilt from the form, the rule came back roles-only with no roles —
        // `USING (false)` on every operation — from a rename.
        expect(await savedRules()).toEqual([
            { name: "own_rows_v2", operations: ["select", "update"], ownerField: "user_id", pgRoles: ["app_user"] }
        ]);
    });

    it("replaces the operations when the command is changed", async () => {
        values.securityRules = [{ name: "own_rows", operations: ["select", "update"], ownerField: "user_id" }];
        await edit(0);
        fireEvent.click(screen.getByRole("button", { name: "DELETE" }));
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        // `operations` wins over `operation`: left in place, the edit is a no-op.
        expect(await savedRules()).toEqual([{ name: "own_rows", operation: "delete", ownerField: "user_id" }]);
    });

    it("edits the unnamed rule it was opened on", async () => {
        values.securityRules = [
            { operation: "select", access: "public" },
            { operation: "delete", roles: ["admin"] }
        ];
        fireEvent.change(await edit(0), { target: { value: "public_read" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        // Found by `name`, an unnamed rule matched nothing, and the save wrote
        // the rules back unchanged.
        expect(await savedRules()).toEqual([
            { name: "public_read", operation: "select", access: "public" },
            { operation: "delete", roles: ["admin"] }
        ]);
    });

    it("deletes only the unnamed rule it was asked to", async () => {
        values.securityRules = [
            { operation: "select", access: "public" },
            { operation: "delete", roles: ["admin"] }
        ];
        render(<CollectionRLSTab/>);
        const row = screen.getAllByRole("button", { name: "EDIT" })[0].parentElement!;
        const [, remove] = within(row).getAllByRole("button");
        fireEvent.click(remove);

        // Filtered by `name`, every unnamed rule went with it.
        expect(await savedRules()).toEqual([{ operation: "delete", roles: ["admin"] }]);
    });
});

describe("the live table the RLS tab reads", () => {
    it("is the table a collection with no `table` compiles to", async () => {
        values = { slug: "blogPosts", name: "Blog posts", properties: {}, securityRules: [] };
        livePolicies = [{ schemaname: "public", tablename: "blog_posts", policyname: "hand_written", cmd: "SELECT", qual: "true" }];
        render(<CollectionRLSTab/>);

        // `getTableName`: `toSnakeCase(slug)` when `table` is absent. The tab
        // read `id || table || alias`, found nothing, and never asked.
        expect(await screen.findByText("hand_written")).toBeTruthy();
        expect(policyQueries).toHaveLength(1);
    });

    it("is in the collection's schema, not a same-named table elsewhere", async () => {
        values = { slug: "users", name: "Users", table: "users", schema: "app", properties: {}, securityRules: [] };
        livePolicies = [
            { schemaname: "app", tablename: "users", policyname: "app_users_policy", cmd: "SELECT", qual: "true" },
            { schemaname: "public", tablename: "users", policyname: "public_users_policy", cmd: "SELECT", qual: "true" }
        ];
        render(<CollectionRLSTab/>);

        expect(await screen.findByText("app_users_policy")).toBeTruthy();
        // Offered for import into this collection, it would have filed another
        // table's policy under this one.
        expect(screen.queryByText("public_users_policy")).toBeNull();
    });

    it("is in `public` when the collection declares no schema, as `db push` puts it", async () => {
        livePolicies = [
            { schemaname: "public", tablename: "posts", policyname: "public_posts_policy", cmd: "SELECT", qual: "true" },
            { schemaname: "archive", tablename: "posts", policyname: "archived_posts_policy", cmd: "SELECT", qual: "true" }
        ];
        render(<CollectionRLSTab/>);

        expect(await screen.findByText("public_posts_policy")).toBeTruthy();
        expect(screen.queryByText("archived_posts_policy")).toBeNull();
    });
});
