import type { PostgresCollectionConfig } from "@rebasepro/types";
import { getTableName } from "./relations";

/**
 * `table` was required on the type while `getTableName()` had always derived it
 * from the slug when absent — so the smallest collection anyone could write
 * named its table twice, and "why do I write `todos` twice" was the first
 * question every evaluator asked.
 *
 * These pin the derivation now that the type admits it is optional. A derived
 * name is still a real name: once a table exists it must keep resolving to the
 * same string, so this is a compatibility test, not a preference.
 */
describe("getTableName", () => {
    const base = { name: "Todos", properties: {} };

    it("derives the table from the slug when none is given", () => {
        expect(getTableName({ ...base, slug: "todos" } as PostgresCollectionConfig)).toBe("todos");
    });

    it("snake_cases a multi-word slug", () => {
        expect(getTableName({ ...base, slug: "orderItems" } as PostgresCollectionConfig)).toBe("order_items");
        expect(getTableName({ ...base, slug: "product-locales" } as PostgresCollectionConfig)).toBe("product_locales");
    });

    it("an explicit table always wins, so existing collections are untouched", () => {
        expect(getTableName({ ...base, slug: "posts", table: "blog_posts" } as PostgresCollectionConfig))
            .toBe("blog_posts");
    });

    it("falls back to the name when there is no slug either", () => {
        expect(getTableName({ name: "Todo Items", properties: {} } as unknown as PostgresCollectionConfig))
            .toBe("todo_items");
    });
});
