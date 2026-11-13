import { describe, expect, it } from "@jest/globals";
import { col, defineTable, type TableHooks } from "@rebasepro/types";
import { compileTables, composeTableHooks } from "@rebasepro/common";

import { createCallContext } from "../src/index";

/**
 * Testing a table hook is calling it — no driver, no database, no boot: the
 * hooks compose with `composeTableHooks`, and `createCallContext` (from
 * `@rebasepro/server`) builds the context a hook reads.
 */
describe("testing a table hook", () => {
    const [posts] = compileTables([defineTable("posts", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text(), slug: col.text() },
        rls: "admin-only"
    })]);

    const slugFromTitle: TableHooks = {
        beforeSave: ({ values }) => ({ slug: String(values.title).toLowerCase().replace(/\s+/g, "-") })
    };
    const requireTitle: TableHooks = {
        beforeSave: ({ values }) => {
            if (!values.title) throw new Error("A post needs a title.");
            return values;
        }
    };

    it("runs a composed hook against a context built for the test", async () => {
        const hooks = composeTableHooks(requireTitle, slugFromTitle);

        await expect(hooks.beforeSave!({
            table: posts, path: "posts", status: "new",
            values: { title: "Hello World" },
            context: createCallContext()
        })).resolves.toEqual({ title: "Hello World", slug: "hello-world" });

        await expect(hooks.beforeSave!({
            table: posts, path: "posts", status: "new",
            values: {},
            context: createCallContext()
        })).rejects.toThrow("A post needs a title.");
    });

    it("names the context field a hook used and the test did not provide", async () => {
        const notify: TableHooks = {
            afterSave: async ({ context, id }) => {
                await context.client.functions!.invoke("notify", { id });
            }
        };

        await expect(notify.afterSave!({
            table: posts, path: "posts", id: 1, status: "new", values: {}, context: createCallContext()
        })).rejects.toThrow("context.client was not provided to createCallContext");
    });
});
