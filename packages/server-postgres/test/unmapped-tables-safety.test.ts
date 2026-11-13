import { compileTables } from "@rebasepro/common";
import { col, defineTable, rel } from "@rebasepro/types";

import { getTableIncludesFromTables } from "../src/cli-helpers";

describe("Unmapped tables safety with Atlas", () => {
    it("should produce include filters only for managed tables and M2M junction tables", () => {
        const users = defineTable("users", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text() },
            rls: "admin-only"
        });
        const tags = defineTable("tags", {
            columns: { id: col.uuid().primaryKey().defaultRandom() },
            rls: "admin-only"
        });
        const posts = defineTable("posts", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
            relations: { tags: rel.manyToMany(() => tags, { through: "posts_to_tags", sourceKey: "post_id", targetKey: "tag_id" }) },
            rls: "admin-only"
        });

        const includes = getTableIncludesFromTables(compileTables([users, posts, tags]));

        // Verify only managed tables and their junctions are included
        expect(includes).toContain("public.users");
        expect(includes).toContain("public.posts");
        expect(includes).toContain("public.posts_to_tags");

        // Verify unmapped tables are NOT included, ensuring they are ignored by Atlas --include filters
        const unmappedTables = [
            "public.legacy_orders",
            "public.external_analytics",
            "public.stripe_webhooks",
            "public.audit_log"
        ];
        for (const unmapped of unmappedTables) {
            expect(includes).not.toContain(unmapped);
        }
    });

    it("should support custom schemas in table include paths", () => {
        const orders = defineTable("orders", {
            schema: "sales",
            columns: { id: col.text().primaryKey() },
            rls: "admin-only"
        });

        const includes = getTableIncludesFromTables(compileTables([orders]));
        expect(includes).toContain("sales.orders");
        expect(includes).not.toContain("public.orders");
    });
});
