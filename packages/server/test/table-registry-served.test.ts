import { describe, expect, it } from "@jest/globals";
import { col, defineAuthTable, defineTable } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { TableRegistry } from "../src/schema/table-registry";
import { hasReadHooks } from "../src/storage/maintenance";

/**
 * The table registry keeps each table's server-only code beside its
 * descriptor: what storage's read-hook check, the auth table and the hooks
 * attached after boot (`setTableHooks`) read.
 */

const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
    rls: "admin-only"
});
const users = defineAuthTable("users", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), email: col.text() },
    rls: "admin-only",
    auth: { onCreateUser: async values => ({ values }) }
});

function servedOf(registry: TableRegistry, slug: string) {
    const table = registry.table(slug);
    if (!table) throw new Error(`no table "${slug}"`);
    return table;
}

describe("TableRegistry", () => {
    it("serves compiled tables and bare descriptors alike", () => {
        const [postsT, usersT] = compileSchema([posts, users]);
        const registry = new TableRegistry();
        registry.replaceAll([postsT, usersT.descriptor]);
        expect(registry.get("posts")).toBe(postsT.descriptor);
        expect(registry.table("users")).toEqual({ descriptor: usersT.descriptor });
        expect(registry.list().map(table => table.slug)).toEqual(["posts", "users"]);
    });

    it("finds the auth table by its descriptor, with its lifecycle hooks", () => {
        const registry = new TableRegistry();
        registry.replaceAll(compileSchema([posts, users]));
        expect(registry.authTable()?.descriptor.slug).toBe("users");
        expect(typeof registry.authTable()?.auth?.onCreateUser).toBe("function");
    });

    it("hands out one list per revision, so a cache keyed on it holds", () => {
        const registry = new TableRegistry();
        registry.replaceAll(compileSchema([posts]));
        const first = registry.list();
        expect(registry.list()).toBe(first);
        registry.replaceAll(compileSchema([posts]));
        expect(registry.list()).not.toBe(first);
    });

    it("takes hooks attached after boot without moving the descriptor, and storage sees them", () => {
        const registry = new TableRegistry();
        registry.replaceAll(compileSchema([posts]));
        const descriptor = registry.get("posts");
        expect(hasReadHooks(servedOf(registry, "posts"))).toBe(false);

        expect(registry.setHooks("posts", { afterRead: ({ values }) => values })).toBe(true);
        expect(registry.get("posts")).toBe(descriptor);
        expect(hasReadHooks(servedOf(registry, "posts"))).toBe(true);
        expect(registry.setHooks("missing", {})).toBe(false);
    });
});
