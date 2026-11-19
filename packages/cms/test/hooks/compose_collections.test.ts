/**
 * What `<RebaseCMS>` registers: the served tables, customized, and the
 * external collections beside them. A slug names one collection only.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { TableDescriptor } from "@rebasepro/types";
import { col, defineTable } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { composeCollections } from "../../src/hooks/navigation/compose_collections";
import { registeredCollection } from "../../src/hooks/navigation/registered_collection";
import { composeCollectionsInput } from "../../src/hooks/navigation/compose_collections_input";
import { customizeTable } from "../../src/tables/customize_table";
import { computeNavigationGroups } from "../../src/hooks/navigation/utils";
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

const NONE = { tables: [], tableCustomizations: [], externalCollections: [] };

let warn: jest.SpiedFunction<typeof console.warn>;
beforeEach(() => {
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

    it("is the external collections alone when no table is served", () => {
        expect(composeCollections({ ...NONE, externalCollections: [events] })).toEqual([events]);
        expect(warn).not.toHaveBeenCalled();
    });

    it("refuses an external collection with a served table's slug, naming both", () => {
        const clash: AdminCollection = { ...events, slug: "tags", name: "Tags (Firestore)" };
        expect(() => composeCollections({ ...NONE, tables, externalCollections: [clash] }))
            .toThrow("externalCollections: \"tags\" (\"Tags (Firestore)\") has the slug of the table \"tags\" (\"Tags\") the server serves");
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

describe("composeCollections: navigation order", () => {
    // Served alphabetically, as the server reads them off the schema index
    // module namespace; the project declares another order.
    const articles = defineTable("articles", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" });
    const audit = defineTable("audit_log", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" });
    const songs = defineTable("songs", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" });
    const users = defineTable("users", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" });
    const served: TableDescriptor[] = compileTables([articles, audit, songs, users]);
    const declared = [
        customizeTable<typeof songs>("songs", { group: "Music" }),
        customizeTable<typeof articles>("articles", { group: "Content" }),
        customizeTable<typeof audit>("audit_log", { group: "System" })
    ];

    it("lists the tables in tableCustomizations order, the uncustomized after them in served order", () => {
        const out = composeCollections({ ...NONE, tables: served, tableCustomizations: declared, externalCollections: [events] });
        expect(out.map(c => c.slug)).toEqual(["songs", "articles", "audit_log", "users", "fs_events"]);
    });

    it("puts the groups in that order", () => {
        const collections = composeCollections({ ...NONE, tables: served, tableCustomizations: declared }).map(registeredCollection);
        expect(computeNavigationGroups({ collections }).map(g => g.name)).toEqual(["Music", "Content", "System", "Views"]);
    });

    it("still lets navigationGroupMappings decide the groups", () => {
        const collections = composeCollections({ ...NONE, tables: served, tableCustomizations: declared }).map(registeredCollection);
        const groups = computeNavigationGroups({
            collections,
            navigationGroupMappings: [{ name: "System", entries: ["audit_log"] }, { name: "Content", entries: ["articles"] }]
        });
        expect(groups.map(g => g.name)).toEqual(["System", "Content", "Music", "Views"]);
    });
});

describe("composeCollectionsInput", () => {
    const params = { user: null, authController: fakeAuthController(), data: fakeSdkData() };

    it("composes the tables and the external collections", async () => {
        const compose = composeCollectionsInput({ tables, tableCustomizations: [], externalCollections: [events] });
        const out = await compose(params);
        expect(out.map(c => c.slug)).toEqual(["posts", "tags", "fs_events"]);
    });

    it("rejects, rather than throws, on a collision — the navigation shows it as its loading error", async () => {
        const compose = composeCollectionsInput({ tables, tableCustomizations: [], externalCollections: [{ ...events, slug: "tags" }] });
        await expect(compose(params)).rejects.toThrow("has the slug of the table \"tags\"");
    });
});
