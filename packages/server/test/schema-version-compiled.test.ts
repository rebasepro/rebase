import type { TableHooks } from "@rebasepro/types";
import { col, computeSchemaVersion, defineTable, rel } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";

describe("schema version — computed from the compiled tables", () => {
    const authors = defineTable("authors", {
        columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), name: col.text() },
        rls: "admin-only"
    });
    const others = defineTable("others", {
        columns: { id: col.uuid().primaryKey().defaultRandom() },
        rls: "admin-only"
    });
    const posts = (target: typeof authors | typeof others, hooks?: TableHooks) => defineTable("posts", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
        relations: { author: rel.belongsTo(() => target) },
        rls: "admin-only",
        ...(hooks ? { hooks } : {})
    });
    const version = (...defs: Parameters<typeof compileTables>[0]) => computeSchemaVersion(compileTables(defs));

    it("does not move when only a hook's code changes — hooks are presence flags", () => {
        const one = version(authors, posts(authors, { beforeSave: ({ values }) => values }));
        const two = version(authors, posts(authors, { beforeSave: ({ values }) => ({ ...values, title: "x" }) }));
        expect(one).toBe(two);
    });

    it("moves when a hook is added", () => {
        expect(version(authors, posts(authors, { afterRead: ({ values }) => values })))
            .not.toBe(version(authors, posts(authors)));
    });

    it("still changes when a relation target changes", () => {
        expect(version(authors, others, posts(authors))).not.toBe(version(authors, others, posts(others)));
    });

    it("is prefixed v2, so a stamp from the collection model can never match", () => {
        expect(version(authors)).toMatch(/^v2:[0-9a-f]{16}$/);
    });
});
