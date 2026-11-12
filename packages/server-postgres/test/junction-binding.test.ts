import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { bindJoinPathJunction, bindThroughJunction } from "../src/services/junction-writes";

/**
 * Finding a junction's two columns used to be written twice — once for the
 * owning direction, once for the inverse — and the two did not agree.
 *
 * The owning one asked `getTableNamesFromColumns` which table a step's columns
 * belonged to. That helper answers `""` for a bare column name, so for the
 * documented form `{ table: "posts_tags", on: { from: "id", to: "tag_id" } }`
 * no branch matched, both columns stayed null, and the write was skipped with a
 * warning. Writing a to-many `via` relation did nothing whatsoever, and said so
 * only in a log line.
 *
 * The surviving implementation keys on `step.table`, which is always there, and
 * still reads the qualified `table.column` form where it is used. Both spellings
 * are legal, so both are pinned here.
 */
describe("binding a junction's two columns", () => {
    const registry = new FixtureTableRegistry();
    registry.registerPgTable(pgTable("posts", { id: integer("id").primaryKey(), title: text("title") }), "posts");
    registry.registerPgTable(pgTable("tags", { id: integer("id").primaryKey(), label: text("label") }), "tags");
    registry.registerPgTable(pgTable("posts_tags", { post_id: integer("post_id"), tag_id: integer("tag_id") }), "posts_tags");

    describe("declared with `through`", () => {
        it("takes the two columns as named", () => {
            const binding = bindThroughJunction(
                registry,
                { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" },
                "posts.tags"
            );
            expect(binding.parentColumn.name).toBe("post_id");
            expect(binding.targetColumn.name).toBe("tag_id");
        });

        it("refuses a junction table that is not registered", () => {
            expect(() => bindThroughJunction(
                registry,
                { table: "nope", sourceColumn: "post_id", targetColumn: "tag_id" },
                "posts.tags"
            )).toThrow(/no table 'nope'/);
        });

        it("refuses a column the junction does not have", () => {
            expect(() => bindThroughJunction(
                registry,
                { table: "posts_tags", sourceColumn: "post_id", targetColumn: "label_id" },
                "posts.tags"
            )).toThrow(/no target column 'label_id'/);
        });
    });

    describe("declared with `joinPath`", () => {
        it("binds the unqualified form — the one that silently wrote nothing", () => {
            const binding = bindJoinPathJunction(
                registry,
                [
                    { table: "posts_tags", on: { from: "id", to: "tag_id" } },
                    { table: "posts", on: { from: "post_id", to: "id" } }
                ],
                "tags",
                "posts",
                "tags.posts_via_tag"
            );
            expect(binding.parentColumn.name).toBe("tag_id");
            expect(binding.targetColumn.name).toBe("post_id");
        });

        it("binds the qualified form the old owning path could read", () => {
            const binding = bindJoinPathJunction(
                registry,
                [
                    { table: "posts_tags", on: { from: "tags.id", to: "posts_tags.tag_id" } },
                    { table: "posts", on: { from: "posts_tags.post_id", to: "posts.id" } }
                ],
                "tags",
                "posts",
                "tags.posts_via_tag"
            );
            expect(binding.parentColumn.name).toBe("tag_id");
            expect(binding.targetColumn.name).toBe("post_id");
        });

        it("binds the same path walked from the other end", () => {
            const binding = bindJoinPathJunction(
                registry,
                [
                    { table: "posts_tags", on: { from: "id", to: "post_id" } },
                    { table: "tags", on: { from: "tag_id", to: "id" } }
                ],
                "posts",
                "tags",
                "posts.tags_via_post"
            );
            expect(binding.parentColumn.name).toBe("post_id");
            expect(binding.targetColumn.name).toBe("tag_id");
        });

        it("refuses a path with nothing between the two ends to hold links", () => {
            expect(() => bindJoinPathJunction(
                registry,
                [{ table: "posts", on: { from: "id", to: "tag_id" } }],
                "tags",
                "posts",
                "tags.posts"
            )).toThrow(/no table between the two ends/);
        });

        it("refuses a path whose junction never reaches one of the ends", () => {
            expect(() => bindJoinPathJunction(
                registry,
                [
                    { table: "posts_tags", on: { from: "id", to: "tag_id" } },
                    { table: "posts_tags", on: { from: "tag_id", to: "tag_id" } }
                ],
                "tags",
                "posts",
                "tags.posts_via_tag"
            )).toThrow(/does not connect/);
        });
    });
});
