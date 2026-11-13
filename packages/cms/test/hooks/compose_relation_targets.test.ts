/**
 * A relation opens its target as the panel registers it.
 *
 * On `main` a relation's `target: () => tagsCollection` handed every reader
 * the authored collection, presentation included. A table's relation must
 * hand them the composed one — projected, customized, with the workspace's
 * preferences — or a target's `hideFromEntityViews`, display and labels are
 * lost wherever the panel reaches it through a relation: the record's tabs,
 * the form's pickers, relation previews and table cells, the row codec.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { RelationProperty } from "@rebasepro/types";
import { col, defineTable, rel } from "@rebasepro/types";
import { compileTables, getEntityChildViews, resolveCollectionRelations } from "@rebasepro/common";
import { getAdminEntityChildViews, getFormFieldKeys, getRedundantChildViewColumnIds } from "@rebasepro/app";
import { composeCollections } from "../../src/hooks/navigation/compose_collections";
import { customizeTable } from "../../src/tables/customize_table";

const authors = defineTable("authors", {
    rls: "admin-only",
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() }
});
const tags = defineTable("tags", {
    rls: "admin-only",
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    relations: { posts: rel.manyToMany(() => posts) }
});
const posts = defineTable("posts", {
    rls: "admin-only",
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text().notNull(), authorId: col.uuid() },
    relations: { author: rel.belongsTo(() => authors), tags: rel.manyToMany(() => tags) }
});
const tables = compileTables([authors, tags, posts]);

const tagsCms = customizeTable<typeof tags>("tags", {
    hideFromEntityViews: true,
    display: { title: "name" },
    fields: { name: { name: "Tag Name" } }
});
const authorsCms = customizeTable<typeof authors>("authors", { singularName: "Writer", display: { title: "name" } });

let warn: jest.SpiedFunction<typeof console.warn>;
beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

function compose() {
    const out = composeCollections({
        tables,
        tableCustomizations: [tagsCms, authorsCms],
        externalCollections: [],
        uiConfig: { tables: { authors: { icon: "PenLine" } } }
    });
    const bySlug = (slug: string): AdminCollection => {
        const found = out.find(collection => collection.slug === slug);
        if (!found) throw new Error(`"${slug}" was not composed`);
        return found;
    };
    return { posts: bySlug("posts"), tags: bySlug("tags"), authors: bySlug("authors") };
}

function relationProperty(collection: AdminCollection, key: string): RelationProperty {
    const property = collection.properties[key];
    if (property?.type !== "relation") throw new Error(`"${key}" is not a relation`);
    return property;
}

describe("a relation's target is the composed collection", () => {
    it("for the relation map (`resolveCollectionRelations`)", () => {
        const composed = compose();
        const relations = resolveCollectionRelations(composed.posts);
        expect(relations.tags.target()).toBe(composed.tags);
        expect(relations.author.target()).toBe(composed.authors);
        expect(resolveCollectionRelations(composed.tags).posts.target()).toBe(composed.posts);
    });

    it("for the relation property (pickers, relation previews and cells, RelationSelector, the row codec)", () => {
        const composed = compose();
        expect(relationProperty(composed.posts, "tags").relation.target()).toBe(composed.tags);
        expect(relationProperty(composed.posts, "author").relation.target()).toBe(composed.authors);
        // The customization and the workspace's preferences both reach the reader.
        expect(relationProperty(composed.posts, "author").relation.target()).toMatchObject({
            singularName: "Writer",
            icon: "PenLine",
            display: { title: "name" }
        });
        expect(relationProperty(composed.posts, "tags").relation.target().properties.name).toMatchObject({ name: "Tag Name" });
    });

    it("for the record's tabs: a target hidden from entity views gets no tab", () => {
        const composed = compose();
        expect(getEntityChildViews(composed.posts).map(view => view.key)).toEqual(["tags"]);
        const views = getAdminEntityChildViews(composed.posts);
        expect(views.map(view => [view.key, view.collection.hideFromEntityViews])).toEqual([["tags", true]]);
        // What DetailViewBinding and EditViewBinding draw.
        expect(views.filter(view => !view.collection.hideFromEntityViews)).toEqual([]);
    });

    it("for the form: with no tab, the tags picker stays in the post's form", () => {
        expect(getFormFieldKeys(compose().posts)).toContain("tags");
    });

    it("for the table: the tags column is kept and no tab button is added", () => {
        const composed = compose();
        expect(getRedundantChildViewColumnIds(composed.posts)).toEqual(new Set(["subcollection:tags"]));
    });
});
