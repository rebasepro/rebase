import { describe, expect, it } from "@jest/globals";
import type { CollectionCallbacks, CollectionConfig } from "@rebasepro/types";

import { composeCallbacks, createCallContext } from "../src/index";

/**
 * The two callback helpers, reached the way a backend author reaches them:
 * from `@rebasepro/server`. A callback is a plain function, so testing one is
 * calling it — no driver, no database, no boot.
 */
describe("callback helpers from @rebasepro/server", () => {
    const posts: CollectionConfig = {
        name: "Posts",
        slug: "posts",
        table: "posts",
        properties: { title: { name: "Title", type: "string" }, slug: { name: "Slug", type: "string" } }
    };

    const slugFromTitle: CollectionCallbacks = {
        beforeSave: ({ values }) => ({ slug: String(values.title).toLowerCase().replace(/\s+/g, "-") })
    };
    const requireTitle: CollectionCallbacks = {
        beforeSave: ({ values }) => {
            if (!values.title) throw new Error("A post needs a title.");
            return values;
        }
    };

    it("runs a composed hook against a context built for the test", async () => {
        const callbacks = composeCallbacks(requireTitle, slugFromTitle);

        await expect(callbacks.beforeSave!({
            collection: posts, path: "posts", status: "new",
            values: { title: "Hello World" },
            context: createCallContext()
        })).resolves.toEqual({ title: "Hello World", slug: "hello-world" });

        await expect(callbacks.beforeSave!({
            collection: posts, path: "posts", status: "new",
            values: {},
            context: createCallContext()
        })).rejects.toThrow("A post needs a title.");
    });

    it("names the context field a hook used and the test did not provide", async () => {
        const notify: CollectionCallbacks = {
            afterSave: async ({ context, id }) => {
                await context.client.functions!.invoke("notify", { id });
            }
        };

        await expect(notify.afterSave!({
            collection: posts, path: "posts", id: 1, status: "new", values: {}, context: createCallContext()
        })).rejects.toThrow("context.client was not provided to createCallContext");
    });
});
