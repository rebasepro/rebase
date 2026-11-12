/**
 * Three schema modules that import each other — authors ↔ books, books ↔
 * shelves, shelves → authors, and a self-reference — written with plain
 * `() => other` thunks and no annotation. `cycle.test.ts` proves they compile.
 */
import { col, defineTable, rel } from "../../../src/schema";
import { books } from "./books";

export const authors = defineTable("authors", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    relations: {
        books: rel.hasMany(() => books, { foreignKey: "author_id" }),
        mentor: rel.belongsTo(() => authors, { localKey: "mentor_ref" })
    },
    rls: "admin-only"
});
