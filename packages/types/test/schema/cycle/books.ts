import { col, defineTable, rel } from "../../../src/schema";
import { authors } from "./authors";
import { shelves } from "./shelves";

export const books = defineTable("books", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text().notNull() },
    relations: {
        author: rel.belongsTo(() => authors, { localKey: "author_id", notNull: true }),
        shelf: rel.belongsTo(() => shelves),
        sequels: rel.manyToMany(() => books, { through: "book_sequels" })
    },
    rls: "admin-only"
});
