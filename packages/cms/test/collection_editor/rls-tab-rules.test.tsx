import React from "react";
import { render, screen } from "@testing-library/react";

/**
 * Which live table the collection editor's RLS tab reads policies from.
 *
 * Importing a live policy is covered in `rls-tab-import.test.tsx`.
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
