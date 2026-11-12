/**
 * What `<RebaseCMS>` registers: the served tables, customized; the external
 * collections beside them; the collections still declared in code, which win
 * over a table with their slug. A slug names one collection only.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AdminCollection, CollectionConfigsBuilder } from "@rebasepro/cms-types";
import type { TableDescriptor } from "@rebasepro/types";
import { col, defineTable } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { composeCollections, resetCompositionWarnings } from "../../src/hooks/navigation/compose_collections";
import { composeCollectionsInput } from "../../src/hooks/navigation/compose_collections_input";
import { customizeTable } from "../../src/tables/customize_table";
import { fakeAuthController, fakeSdkData } from "../helpers/fakes";

const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text().notNull(), legacyRef: col.text() },
    rls: "admin-only"
});
const tags = defineTable("tags", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    rls: "admin-only"
});
const tables: TableDescriptor[] = compileTables([posts, tags]);

const events: AdminCollection = {
    slug: "fs_events",
    name: "Live Events",
    engine: "firestore",
    dataSource: "firestore",
    path: "events",
    properties: { type: { type: "string", name: "Type" } }
};

const declaredPosts: AdminCollection = {
    slug: "posts",
    name: "Posts (declared)",
    table: "posts",
    properties: { title: { type: "string", name: "Title" } }
};

const NONE = { tables: [], tableCustomizations: [], externalCollections: [], declared: [] };

let warn: jest.SpiedFunction<typeof console.warn>;
beforeEach(() => {
    resetCompositionWarnings();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe("composeCollections", () => {
    it("is every served table, projected, in the order served", () => {
        const out = composeCollections({ ...NONE, tables });
        expect(out.map(c => c.slug)).toEqual(["posts", "tags"]);
        expect(out[0]).toMatchObject({ name: "Posts", singularName: "Post" });
    });

    it("folds each table's customization in", () => {
        const out = composeCollections({ ...NONE, tables, tableCustomizations: [customizeTable<typeof posts>("posts", { name: "Blog Posts", icon: "FileText" })] });
        expect(out[0]).toMatchObject({ slug: "posts", name: "Blog Posts", icon: "FileText" });
        expect(out[1]).toMatchObject({ slug: "tags", name: "Tags" });
    });

    it("keeps a referenceTo column as a reference", () => {
        const out = composeCollections({
            ...NONE,
            tables,
            externalCollections: [events],
            tableCustomizations: [customizeTable<typeof posts>("posts", { fields: { legacyRef: { referenceTo: "fs_events" } } })]
        });
        expect(out[0].properties.legacyRef).toMatchObject({ type: "reference", path: "fs_events" });
    });

    it("puts the external collections after the tables", () => {
        const out = composeCollections({ ...NONE, tables, externalCollections: [events] });
        expect(out.map(c => c.slug)).toEqual(["posts", "tags", "fs_events"]);
    });

    it("lets a collection declared in code win over a table with its slug, and says so once", () => {
        const out = composeCollections({ ...NONE, tables, declared: [declaredPosts] });
        expect(out.map(c => c.slug)).toEqual(["posts", "tags"]);
        expect(out[0]).toBe(declaredPosts);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain("\"posts\"");
        expect(String(warn.mock.calls[0][0])).toContain("customizeTable(\"posts\"");

        composeCollections({ ...NONE, tables, declared: [declaredPosts] });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("leaves an app with collections declared in code and no served tables as it was", () => {
        const out = composeCollections({ ...NONE, declared: [declaredPosts, events] });
        expect(out).toEqual([declaredPosts, events]);
        expect(warn).not.toHaveBeenCalled();
    });

    it("refuses an external collection with a served table's slug, naming both", () => {
        const clash: AdminCollection = { ...events, slug: "tags", name: "Tags (Firestore)" };
        expect(() => composeCollections({ ...NONE, tables, externalCollections: [clash] }))
            .toThrow("externalCollections: \"tags\" (\"Tags (Firestore)\") has the slug of the table \"tags\" (\"Tags\") the server serves");
    });

    it("refuses an external collection with a declared collection's slug, naming both", () => {
        const clash: AdminCollection = { ...events, slug: "posts", name: "Posts (Firestore)" };
        expect(() => composeCollections({ ...NONE, declared: [declaredPosts], externalCollections: [clash] }))
            .toThrow("\"posts\" (\"Posts (Firestore)\") has the slug of \"posts\" (\"Posts (declared)\") in <RebaseCMS collections>");
    });

    it("refuses two external collections with one slug", () => {
        expect(() => composeCollections({ ...NONE, externalCollections: [events, { ...events, name: "Other events" }] }))
            .toThrow("\"fs_events\" (\"Live Events\") and \"fs_events\" (\"Other events\") have the same slug");
    });

    it("refuses two customizations of one table", () => {
        expect(() => composeCollections({
            ...NONE,
            tables,
            tableCustomizations: [customizeTable("posts", { icon: "A" }), customizeTable("posts", { icon: "B" })]
        })).toThrow("Two `customizeTable(\"posts\", …)` results");
    });
});

describe("composeCollectionsInput", () => {
    const params = { user: null, authController: fakeAuthController(), data: fakeSdkData() };

    it("calls a collections builder each time, with the signed-in user, and composes its answer", async () => {
        const builder = jest.fn<CollectionConfigsBuilder>(async () => [declaredPosts]);
        const compose = composeCollectionsInput(builder, { tables, tableCustomizations: [], externalCollections: [events] });
        const out = await compose(params);
        expect(builder).toHaveBeenCalledWith(params);
        expect(out.map(c => c.slug)).toEqual(["posts", "tags", "fs_events"]);
        expect(out[0]).toBe(declaredPosts);
    });

    it("rejects, rather than throws, on a collision — the navigation shows it as its loading error", async () => {
        const compose = composeCollectionsInput(undefined, { tables, tableCustomizations: [], externalCollections: [{ ...events, slug: "tags" }] });
        await expect(compose(params)).rejects.toThrow("has the slug of the table \"tags\"");
    });
});
