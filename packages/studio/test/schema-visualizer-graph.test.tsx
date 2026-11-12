/**
 * @jest-environment jsdom
 */
import { describe, expect, it } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import { col, defineTable, rel } from "@rebasepro/types";
import type { TableDescriptor } from "@rebasepro/types";

import { useSchemaGraph, type TableNodeData } from "../src/components/SchemaVisualizer/useSchemaGraph";
import { EDITOR, servedTables } from "./helpers/servedTables";

/**
 * The diagram is drawn from the tables the server serves: their SQL names,
 * the Postgres types of their columns, keys and constraints, and their
 * relations — with or without a CMS on the page.
 */

const authors = defineTable("authors", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        salary: col.integer().access({ read: ["hr"] })
    },
    // Readable by any signed-in caller, so the editor below is described it
    // (a table no rule grants a person's roles is not described to them).
    rls: [{ operation: "select", access: "authenticated" }]
});
const tags = defineTable("tags", {
    columns: { id: col.serial().primaryKey(), label: col.varchar(40).notNull() },
    rls: "admin-only"
});
const blogPosts = defineTable("blog-posts", {
    table: "blog_posts",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
        subtotal: col.numeric(10, 2),
        authorId: col.uuid().column("author_id")
    },
    relations: {
        author: rel.belongsTo(() => authors, { localKey: "author_id" }),
        tags: rel.manyToMany(() => tags)
    },
    history: true,
    rls: "admin-only"
});

function graphOf(tables: readonly TableDescriptor[], liveRls: Set<string> | null = null) {
    const { result } = renderHook(() => useSchemaGraph(tables, liveRls));
    return result.current;
}

function nodeOf(tables: readonly TableDescriptor[], id: string, liveRls: Set<string> | null = null): TableNodeData {
    const node = graphOf(tables, liveRls).allNodes.find(n => n.id === id);
    if (!node) throw new Error(`no node ${id}`);
    return node.data as TableNodeData;
}

const all = servedTables([authors, tags, blogPosts]);

describe("a table", () => {

    it("is drawn as its SQL table, named and slugged as the server declares it", () => {
        expect(nodeOf(all, "table-blog_posts")).toMatchObject({ tableName: "blog_posts", slug: "blog-posts", collectionName: "blog-posts", historyEnabled: true });
    });

    it("shows the RLS the database reports for that table, and the declaration's when it cannot ask", () => {
        expect(nodeOf(all, "table-blog_posts", new Set(["public.authors"])).rlsEnabled).toBe(false);
        expect(nodeOf(all, "table-blog_posts", new Set(["public.blog_posts"])).rlsEnabled).toBe(true);
        expect(nodeOf(all, "table-blog_posts", null).rlsEnabled).toBe(true);
    });
});

describe("a column", () => {

    it("carries its SQL name, row key, Postgres type, nullability, key and enum values", () => {
        const columns = nodeOf(all, "table-blog_posts").columns;
        expect(columns.map(c => [c.name, c.key, c.typeLabel, c.isRequired])).toEqual([
            ["id", "id", "uuid", true],
            ["title", "title", "text", true],
            ["status", "status", expect.stringContaining("draft"), true],
            ["subtotal", "subtotal", "numeric(10, 2)", false],
            ["author_id", "authorId", "uuid", false]
        ]);
        expect(columns.find(c => c.name === "id")?.isPrimaryKey).toBe(true);
        expect(columns.find(c => c.name === "status")).toMatchObject({ isEnum: true, enumValues: ["draft", "published"] });
        expect(columns.find(c => c.name === "author_id")).toMatchObject({ isForeignKey: true, relationName: "author" });
    });

    it("shows a UNIQUE constraint and a varchar's length", () => {
        expect(nodeOf(all, "table-authors").columns.find(c => c.name === "email")?.isUnique).toBe(true);
        expect(nodeOf(all, "table-tags").columns.find(c => c.name === "label")?.typeLabel).toBe("varchar(40)");
    });

    it("is not drawn when the server withholds it from the caller", () => {
        expect(nodeOf(servedTables([authors, tags, blogPosts], EDITOR), "table-authors").columns.map(c => c.name)).not.toContain("salary");
        expect(nodeOf(all, "table-authors").columns.map(c => c.name)).toContain("salary");
    });
});

describe("a relation", () => {

    it("draws a belongsTo from its foreign key to the target's key", () => {
        const edge = graphOf(all).edges.find(e => e.id === "edge-table-blog_posts-table-authors-author");
        expect(edge).toBeDefined();
        expect(edge?.sourceHandle).toMatch(/^source-author_id-/);
        expect(edge?.targetHandle).toMatch(/^target-id-/);
    });

    it("draws a manyToMany through its junction, with the keys the server names and their types", () => {
        const junction = nodeOf(all, "junction-blog_posts_tags");
        expect(junction.isJunction).toBe(true);
        expect(junction.columns.map(c => [c.name, c.typeLabel])).toEqual([
            ["blog_post_id", "uuid"],
            ["tag_id", "integer"]
        ]);
        const ids = graphOf(all).edges.map(e => e.id);
        expect(ids).toContain("edge-table-blog_posts-junction-blog_posts_tags");
        expect(ids).toContain("edge-junction-blog_posts_tags-table-tags");
    });
});
