import { describe, it, expect, jest } from "@jest/globals";
import { compileTables, isSchemaDefinitionError } from "@rebasepro/common";
import { col, defineTable, rel } from "@rebasepro/types";
import { generateTypedefs } from "../src/generate-types";
import { block, compiledOnly } from "./helpers/tables";

/**
 * A relation whose target cannot be resolved never reaches the generator.
 *
 * The collection generator resolved relation thunks itself; when one threw (a
 * circular import, usually) it warned and emitted the table without the
 * relation *or its foreign key*, so `where: { authorId }` stopped compiling
 * with nothing pointing back at generation. Descriptors carry relations
 * already resolved to a slug: a thunk that throws is refused when the schema
 * is compiled, naming the table and the relation, before any SDK is written —
 * and a relation into a table outside the run keeps its foreign key.
 */
describe("a relation that cannot be resolved", () => {
    it("is refused when the schema is compiled, naming the table, the relation and the cause", () => {
        const posts = defineTable("posts", {
            columns: { id: col.text().primaryKey(), title: col.text() },
            relations: { author: rel.belongsTo(() => { throw new Error("Cannot access 'users' before initialization"); }) },
            rls: "admin-only"
        });
        let problems: string[] = [];
        try {
            compileTables([posts]);
        } catch (error) {
            if (isSchemaDefinitionError(error)) problems = error.problems.map(p => `${p.table}.${p.key ?? ""}: ${p.message}`);
        }
        expect(problems).toEqual([expect.stringMatching(/^posts\.author: .*before initialization/)]);
    });

    it("keeps the foreign key and the include of a relation into a table outside the run, and says nothing", () => {
        const users = defineTable("users", { columns: { id: col.text().primaryKey() }, rls: "admin-only" });
        const posts = defineTable("posts", {
            columns: { id: col.text().primaryKey(), title: col.text() },
            relations: { author: rel.belongsTo(() => users, { localKey: "author_id" }) },
            rls: "admin-only"
        });
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const ts = generateTypedefs(compiledOnly([posts, users], ["posts"]));
            expect(block(ts, "Row", "posts")).toContain("authorId?: string | null;");
            expect(block(ts, "Row", "posts")).toContain("author?: Record<string, unknown>;");
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });
});
