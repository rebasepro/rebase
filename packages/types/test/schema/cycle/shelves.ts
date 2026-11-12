import { col, defineTable, rel } from "../../../src/schema";
import { authors } from "./authors";
import { books } from "./books";

export const shelves = defineTable("shelves", {
    slug: "racks",
    columns: { id: col.uuid().primaryKey().defaultRandom(), label: col.text() },
    relations: {
        books: rel.hasMany(() => books),
        curator: rel.belongsTo(() => authors)
    },
    rls: "admin-only"
});
