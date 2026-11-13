import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { EntityRelation, col, defineTable, json, rel, type ArrayProperty, type MapProperty, type Property } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { getDefaultValuesFor } from "@rebasepro/cms-types";
import type { AdminPostgresCollection, FieldProps } from "@rebasepro/cms-types";
import { applyTableCustomization, applyTableCustomizations, customizeTable, updateRecord } from "@rebasepro/cms";
// The projector (slice C1) is not on the package entry yet; read it from its module.
import { collectionsFromTables } from "../../src/tables/project_table";
import { resetCustomizationWarnings, type TableCollection } from "../../src/tables/apply_customization";

/**
 * `applyTableCustomization` folds a customization into the collection a table
 * projects to, writing the spec's names (`fieldOrder`, `kanban.columnField`,
 * `fields.x.hidden` …) where the panel's views read the old ones
 * (`propertiesOrder`, `kanban.columnProperty`, `admin.hideFromCollection` …).
 *
 * The bases here are written by hand in the shape the projector
 * (`project_table.ts`) produces — flat presentation keys, enum values with
 * seeded colours, relation properties keyed by relation name — so the merge
 * is tested on its own; the last block projects real tables end to end.
 */

function CustomMarkdownEditor(props: FieldProps): React.ReactElement {
    return <textarea value={String(props.value ?? "")} readOnly/>;
}

function TagsPreview(): React.ReactElement {
    return <span>tags</span>;
}

const authorsBase: AdminPostgresCollection = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: { id: { type: "string", name: "Id", isId: "uuid" }, name: { type: "string", name: "Name" } }
};

const tagsBase: AdminPostgresCollection = {
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: { id: { type: "string", name: "Id", isId: "uuid" }, label: { type: "string", name: "Label" } }
};

/** A projected `posts`, as the projector writes it. */
function postsBase(): AdminPostgresCollection {
    return {
        slug: "posts",
        name: "Posts",
        singularName: "Post",
        table: "posts",
        properties: {
            id: { type: "string", name: "Id", isId: "uuid" },
            title: { type: "string", name: "Title", validation: { required: true } },
            heroImage: { type: "string", name: "Hero Image", storage: { storagePath: "posts/hero/", acceptedFiles: ["image/*"] } },
            content: { type: "string", name: "Content" },
            status: {
                type: "string",
                name: "Status",
                enum: [
                    { id: "draft", label: "Draft", color: "grayLight" },
                    { id: "needs_review", label: "Needs Review", color: "blueLight" },
                    { id: "published", label: "Published", color: "tealLight" },
                    { id: "archived", label: "Archived", color: "pinkLight" }
                ]
            },
            priority: { type: "number", name: "Priority", enum: [{ id: 1, label: "1" }, { id: 2, label: "2" }, { id: 3, label: "3" }] },
            views: { type: "number", name: "Views" },
            labels: { type: "array", name: "Labels", of: { type: "string", enum: [{ id: "hot", label: "Hot" }, { id: "cold", label: "Cold" }] } },
            seo: {
                type: "map",
                name: "Seo",
                properties: { title: { type: "string", name: "Title" }, canonical: { type: "string", name: "Canonical" } }
            },
            blocks: {
                type: "array",
                name: "Blocks",
                oneOf: { typeField: "type", valueField: "value", properties: { text: { type: "string", name: "Text" }, image: { type: "string", name: "Image" } } }
            },
            publishDate: { type: "date", name: "Publish Date", mode: "date_time" },
            orgId: { type: "string", name: "Org Id", columnType: "uuid" },
            firestoreDocId: { type: "string", name: "Firestore Doc Id" },
            featured: { type: "boolean", name: "Featured" },
            __order: { type: "string", name: "Order" },
            author: { type: "relation", name: "Author", relation: { kind: "belongsTo", relationName: "author", target: () => authorsBase } },
            tags: { type: "relation", name: "Tags", relation: { kind: "manyToMany", relationName: "tags", target: () => tagsBase } }
        },
        relations: [
            { kind: "belongsTo", relationName: "author", target: () => authorsBase },
            { kind: "manyToMany", relationName: "tags", target: () => tagsBase }
        ]
    };
}

let warn: jest.SpiedFunction<typeof console.warn>;

beforeEach(() => {
    resetCustomizationWarnings();
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    warn.mockRestore();
});

function property(collection: TableCollection, key: string): Property {
    const found = collection.properties[key];
    if (!found) throw new Error(`no property ${key}`);
    return found;
}

describe("applyTableCustomization: the collection level", () => {
    it("writes labels, navigation, views, kanban and slots where the views read them", () => {
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            name: "Blog Posts",
            singularName: "Blog Post",
            description: "Everything we publish",
            metadata: { owner: "editorial" },
            icon: "FileText",
            group: "Content",
            hideFromNavigation: false,
            defaultViewMode: "cards",
            enabledViews: ["table", "cards", "kanban"],
            kanban: { columnField: "status", orderField: "__order" },
            display: { title: "title", image: "heroImage", status: "status", date: "publishDate", tags: ({ row }) => String(row.title) },
            defaultSize: "l",
            pagination: 25,
            inlineEditing: false,
            openEntityMode: "side_panel",
            exportable: false,
            hideIdFromCollection: true
        }));

        expect(out).toMatchObject({
            slug: "posts",
            name: "Blog Posts",
            singularName: "Blog Post",
            description: "Everything we publish",
            metadata: { owner: "editorial" },
            icon: "FileText",
            group: "Content",
            hideFromNavigation: false,
            defaultViewMode: "cards",
            enabledViews: ["table", "cards", "kanban"],
            kanban: { columnProperty: "status" },
            orderProperty: "__order",
            defaultSize: "l",
            pagination: 25,
            inlineEditing: false,
            openEntityMode: "side_panel",
            exportable: false,
            hideIdFromCollection: true
        });
        expect(out.display).toMatchObject({ title: "title", image: "heroImage", status: "status", date: "publishDate" });
        expect(typeof out.display?.tags).toBe("function");
        // Untouched: what the projection derived and the customization did not mention.
        expect(out.table).toBe("posts");
        expect(property(out, "title")).toEqual(property(postsBase(), "title"));
    });

    it("renames the column lists and the form layout", () => {
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            fieldOrder: ["title", "status", "author", "subcollection:tags", "seo.title"],
            listFields: ["title", "publishDate"],
            previewFields: ["title"],
            form: {
                sidebar: ["status", "publishDate", "author", "tags"],
                sections: [
                    { key: "post", fields: ["title", "heroImage"] },
                    { key: "body", title: "Content", fields: ["content"], collapsible: true }
                ],
                showRecordMeta: true
            },
            sort: ["publishDate", "desc"],
            fixedFilter: { orgId: ["==", "o1"] },
            defaultFilter: { status: ["==", "draft"] },
            filterPresets: [{ label: "Published", filterValues: { status: ["==", "published"] }, sort: ["publishDate", "desc"] }]
        }));
        expect(out.propertiesOrder).toEqual(["title", "status", "author", "subcollection:tags", "seo.title"]);
        expect(out.listProperties).toEqual(["title", "publishDate"]);
        expect(out.previewProperties).toEqual(["title"]);
        expect(out.form).toEqual({
            sidebar: ["status", "publishDate", "author", "tags"],
            sections: [
                { key: "post", properties: ["title", "heroImage"] },
                { key: "body", title: "Content", properties: ["content"], collapsible: true }
            ],
            showRecordMeta: true
        });
        expect(out.sort).toEqual(["publishDate", "desc"]);
        expect(out.fixedFilter).toEqual({ orgId: ["==", "o1"] });
        expect(out.defaultFilter).toEqual({ status: ["==", "draft"] });
        expect(out.filterPresets).toHaveLength(1);
    });

    it("hands actions, views and components over as the same values", () => {
        const onClick = jest.fn(async () => undefined);
        const isEnabled = jest.fn(() => true);
        const Builder = () => null;
        const Toolbar = () => null;
        const value = jest.fn(() => 3);
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            entityActions: [{ key: "publish", name: "Publish", icon: "Send", collapsed: false, isEnabled, onClick }, "archive"],
            disableDefaultActions: ["copy"],
            entityViews: [{ key: "preview", name: "Preview", Builder }, "blog_preview"],
            customViews: [{ key: "map", name: "Map", Builder }],
            formView: { Builder, includeActions: false },
            Actions: [Toolbar],
            components: { "Collection.EmptyState": { Component: Toolbar } },
            additionalFields: [{ key: "score", name: "Score", value }],
            browserCallbacks: { afterRead: ({ row }) => row }
        }));
        const [action, named] = out.entityActions ?? [];
        expect(named).toBe("archive");
        expect(typeof action === "object" && action.onClick).toBe(onClick);
        expect(typeof action === "object" && action.isEnabled).toBe(isEnabled);
        expect(typeof action === "object" && action.collapsed).toBe(false);
        expect(out.disableDefaultActions).toEqual(["copy"]);
        expect(out.entityViews).toEqual([{ key: "preview", name: "Preview", Builder }, "blog_preview"]);
        expect(out.customViews).toEqual([{ key: "map", name: "Map", Builder }]);
        expect(out.formView).toEqual({ Builder, includeActions: false });
        expect(out.Actions).toEqual([Toolbar]);
        expect(out.components).toEqual({ "Collection.EmptyState": { Component: Toolbar } });
        expect(out.additionalFields?.[0]).toMatchObject({ key: "score", name: "Score" });
        expect(typeof out.browserCallbacks?.afterRead).toBe("function");
    });

    it("mirrors the keys into an `admin` block when the collection carries one", () => {
        const base: AdminPostgresCollection = { ...postsBase(), admin: { icon: "Old", group: "Old group" } };
        const out = applyTableCustomization(base, customizeTable("posts", { icon: "FileText" }));
        expect(out.icon).toBe("FileText");
        expect(out.admin).toEqual({ icon: "FileText", group: "Old group" });
    });

    it("does not touch the collection it was given", () => {
        const base = postsBase();
        const snapshot = JSON.stringify(base);
        applyTableCustomization(base, customizeTable("posts", {
            icon: "FileText",
            fields: { status: { enumLabels: { draft: "Rough" } }, seo: { fields: { title: { multiline: true } } } }
        }));
        expect(JSON.stringify(base)).toBe(snapshot);
    });
});

describe("applyTableCustomization: fields", () => {
    it("merges enum labels and colours onto the projected values, keeping the seeded colour of the rest", () => {
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            fields: {
                status: {
                    enumLabels: {
                        draft: { label: "Draft", color: "gray" },
                        published: { label: "Live", color: "green", disabled: true },
                        archived: "Gone"
                    }
                }
            }
        }));
        const status = property(out, "status");
        expect(status.type === "string" && status.enum).toEqual([
            { id: "draft", label: "Draft", color: "gray" },
            { id: "needs_review", label: "Needs Review", color: "blueLight" },
            { id: "published", label: "Live", color: "green", disabled: true },
            { id: "archived", label: "Gone", color: "pinkLight" }
        ]);
    });

    it("reorders values with enumOrder, numbers and arrays included", () => {
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            fields: {
                status: { enumOrder: ["published", "draft"] },
                priority: { enumLabels: { 3: { label: "High", color: "red" } }, enumOrder: [3, 2, 1] },
                labels: { enumLabels: { hot: "On fire" } }
            }
        }));
        const status = property(out, "status");
        const order = status.type === "string" && Array.isArray(status.enum) ? status.enum.map(value => value.id) : [];
        expect(order).toEqual(["published", "draft", "needs_review", "archived"]);
        const priority = property(out, "priority");
        expect(priority.type === "number" && priority.enum).toEqual([
            { id: 3, label: "High", color: "red" }, { id: 2, label: "2" }, { id: 1, label: "1" }
        ]);
        const labels = property(out, "labels");
        const item = labels.type === "array" && !Array.isArray(labels.of) ? labels.of : undefined;
        expect(item?.type === "string" && item.enum).toEqual([{ id: "hot", label: "On fire" }, { id: "cold", label: "Cold" }]);
    });

    it("writes the presentation options onto the property's admin block", () => {
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            fields: {
                title: { multiline: true, name: "Headline", description: "Shown on cards", span: 2, columnWidth: 320 },
                content: { Field: CustomMarkdownEditor, markdown: true },
                tags: { Preview: TagsPreview, renderInForm: true, previewFields: ["label"], widget: "dialog" },
                orgId: { hidden: true, filledByServer: true },
                __order: { hidden: true, disabled: true },
                views: { format: { style: "decimal", maximumFractionDigits: 0 }, clearable: true, readOnly: true, filterOperators: ["==", ">"] },
                publishDate: { mode: "date", timezone: "Europe/Madrid", clearable: true },
                featured: { hiddenInForm: true },
                seo: { spreadChildren: true, fieldOrder: ["canonical", "title"], fields: { title: { multiline: true } } },
                blocks: { expanded: true, oneOf: { text: { markdown: true } } }
            }
        }));
        expect(property(out, "title")).toMatchObject({ name: "Headline", description: "Shown on cards", admin: { multiline: true, span: 2, columnWidth: 320 } });
        expect(property(out, "content").admin).toEqual({ Field: CustomMarkdownEditor, markdown: true });
        expect(property(out, "tags").admin).toEqual({ Preview: TagsPreview, renderInForm: true, previewProperties: ["label"], widget: "dialog" });
        expect(property(out, "orgId").admin).toEqual({ hideFromCollection: true, filledByServer: true });
        expect(property(out, "__order").admin).toEqual({ hideFromCollection: true, disabled: true });
        expect(property(out, "views").admin).toEqual({ format: { style: "decimal", maximumFractionDigits: 0 }, clearable: true, readOnly: true, filterOperators: ["==", ">"] });
        expect(property(out, "publishDate")).toMatchObject({ mode: "date", timezone: "Europe/Madrid", admin: { clearable: true } });
        expect(property(out, "featured").admin).toEqual({ disabled: { hidden: true } });

        const seo = property(out, "seo");
        const seoMap: MapProperty | undefined = seo.type === "map" ? seo : undefined;
        expect(seoMap?.admin).toEqual({ spreadChildren: true });
        expect(seoMap?.propertiesOrder).toEqual(["canonical", "title"]);
        expect(seoMap?.properties?.title?.admin).toEqual({ multiline: true });

        const blocks = property(out, "blocks");
        const blocksArray: ArrayProperty | undefined = blocks.type === "array" ? blocks : undefined;
        expect(blocksArray?.admin).toEqual({ expanded: true });
        expect(blocksArray?.oneOf?.properties.text?.admin).toEqual({ markdown: true });
    });

    it("adds the browser-only storage functions to the column's rules", () => {
        const path = () => "posts/today/";
        const previewUrl = (name: string) => `https://cdn.example.com/${name}`;
        const processFile = async (file: File) => file;
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            fields: { heroImage: { storage: { path, previewUrl, processFile } } }
        }));
        const hero = property(out, "heroImage");
        expect(hero.type === "string" && hero.storage).toEqual({ storagePath: path, acceptedFiles: ["image/*"], previewUrl, processFile });
    });

    it("turns a text column with referenceTo into a reference to that collection", () => {
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            fields: { firestoreDocId: { referenceTo: "fs_events", name: "Event", includeEntityLink: false } }
        }));
        expect(property(out, "firestoreDocId")).toEqual({
            type: "reference",
            path: "fs_events",
            name: "Event",
            admin: { includeEntityLink: false }
        });
    });

    it("puts a relation's tab overrides on the relation, both where the views look", () => {
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            fields: { tags: { overrides: { name: "Post tags", defaultViewMode: "cards", hideFromNavigation: false } } }
        }));
        const expected = { name: "Post tags", admin: { defaultViewMode: "cards", hideFromNavigation: false } };
        const tags = property(out, "tags");
        expect(tags.type === "relation" && tags.relation?.overrides).toEqual(expected);
        expect(out.relations?.find(r => r.relationName === "tags")?.overrides).toEqual(expected);
        expect(out.relations?.find(r => r.relationName === "author")?.overrides).toBeUndefined();
    });

    it("applies what dynamicProps returns as a customization, over the customized field", () => {
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            fields: {
                content: {
                    multiline: true,
                    dynamicProps: ({ values }) => values.status === "published" ? { readOnly: true, description: "Published posts are locked" } : undefined
                }
            }
        }));
        const content = property(out, "content");
        const props = { path: "posts", authController: { user: null, initialLoading: false, authLoading: false } };
        expect(content.dynamicProps?.({ ...props, values: { status: "draft" } })).toEqual({});
        expect(content.dynamicProps?.({ ...props, values: { status: "published" } })).toMatchObject({
            type: "string",
            description: "Published posts are locked",
            admin: { multiline: true, readOnly: true }
        });
    });
});

describe("applyTableCustomization: what does not match is skipped, never thrown", () => {
    it("skips a field the table does not serve, and says so once", () => {
        const base = postsBase();
        const customization = customizeTable("posts", { fields: { salary: { hidden: true }, title: { multiline: true } } });
        const out = applyTableCustomization(base, customization);
        applyTableCustomization(base, customization);
        expect(out.properties.salary).toBeUndefined();
        expect(property(out, "title").admin).toEqual({ multiline: true });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/serves no field "salary" to this user\. Skipped\./);
    });

    it("drops list entries, display slots and kanban columns that name missing fields", () => {
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            fieldOrder: ["title", "salary", "subcollection:comments", "subcollection:tags"],
            display: { title: "title", image: "cover" },
            kanban: { columnField: "stage", orderField: "rank" },
            form: { sections: [{ key: "main", fields: ["title", "salary"] }] }
        }));
        expect(out.propertiesOrder).toEqual(["title", "subcollection:tags"]);
        expect(out.display).toEqual({ title: "title" });
        expect(out.kanban).toBeUndefined();
        expect(out.orderProperty).toBeUndefined();
        expect(out.form?.sections).toEqual([{ key: "main", properties: ["title"] }]);
        const warnings = warn.mock.calls.map(call => String(call[0])).join("\n");
        for (const name of ["salary", "subcollection:comments", "cover", "stage", "rank"]) expect(warnings).toContain(`"${name}"`);
    });

    it("skips an option that does not apply to the field's type, and labels for values the column lacks", () => {
        const out = applyTableCustomization(postsBase(), customizeTable("posts", {
            fields: { title: { format: { style: "percent" } }, status: { enumLabels: { deleted: "Deleted" } } }
        }));
        expect(property(out, "title").admin).toEqual({});
        expect(warn.mock.calls.map(call => String(call[0])).join("\n"))
            .toMatch(/fields\.title\.format does not apply to a string field[\s\S]*"deleted", which is not one of the column's values/);
    });

    it("does not apply a customization of another table", () => {
        const base = postsBase();
        const out = applyTableCustomization(base, customizeTable("authors", { icon: "User" }));
        expect(out).toBe(base);
        expect(String(warn.mock.calls[0][0])).toMatch(/customizeTable\("authors"\) was applied to the "posts" table/);
    });
});

describe("applyTableCustomizations", () => {
    it("customizes the tables it has a customization for and leaves the rest as they are", () => {
        const [posts, authors] = applyTableCustomizations([postsBase(), authorsBase], [customizeTable("posts", { icon: "FileText" })]);
        expect(posts.icon).toBe("FileText");
        expect(authors).toBe(authorsBase);
    });

    it("ignores a customization for a table that is not served, with a warning", () => {
        const out = applyTableCustomizations([authorsBase], [customizeTable("payroll", { icon: "Lock" })]);
        expect(out).toEqual([authorsBase]);
        expect(String(warn.mock.calls[0][0])).toMatch(/customizeTable\("payroll"\) matches no table served to this user/);
    });

    it("refuses two customizations of one table", () => {
        expect(() => applyTableCustomizations([postsBase()], [customizeTable("posts", {}), customizeTable("posts", {})]))
            .toThrow(/Two `customizeTable\("posts", …\)` results were passed/);
    });
});

describe("end to end: defineTable → descriptor → projection → customization", () => {
    const users = defineTable("users", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
        rls: "admin-only"
    });

    const posts = defineTable("posts", {
        columns: {
            id: col.uuid().primaryKey().defaultRandom(),
            title: col.text().notNull(),
            heroImage: col.storage({ path: "posts/hero/", accept: ["image/*"] }),
            content: col.text(),
            seo: col.jsonb(json.object({ title: json.string() })),
            status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
            publishDate: col.timestamp({ withTimezone: true }),
            orgId: col.uuid(),
            __order: col.text()
        },
        relations: { author: rel.belongsTo(() => users) },
        rls: [{ operation: "select", access: "public" }, { operations: ["insert", "update", "delete"], roles: ["editor"] }]
    });

    it("pre-fills a relation's picker with the field's `defaultValue`, and a new record's form starts with it", () => {
        const projected = collectionsFromTables(compileTables([users, posts]));
        const ada = new EntityRelation("u1", "users");
        const [, customized] = applyTableCustomizations(projected, [customizeTable<typeof posts>("posts", { fields: { author: { defaultValue: ada } } })]);
        const author = property(customized, "author");
        expect(author.type === "relation" && author.defaultValue).toBe(ada);
        expect(getDefaultValuesFor(customized.properties).author).toBe(ada);
        // Without one, the picker starts empty.
        expect(getDefaultValuesFor(projected[1].properties).author).toBeNull();
    });

    it("projects a JSON array's `uniqueBy` as `uniqueInArray` on the named fields of its items, which the form checks", () => {
        const orders = defineTable("orders", {
            columns: {
                id: col.uuid().primaryKey().defaultRandom(),
                lines: col.jsonb(json.array(json.object({ sku: json.string(), qty: json.number() })).validate({ uniqueBy: ["sku"] }))
            },
            rls: "admin-only"
        });
        const [projected] = collectionsFromTables(compileTables([orders]));
        const lines = property(projected, "lines");
        const item = lines.type === "array" && !Array.isArray(lines.of) ? lines.of : undefined;
        expect(item?.type === "map" && item.properties?.sku?.validation?.uniqueInArray).toBe(true);
        expect(item?.type === "map" && item.properties?.qty?.validation?.uniqueInArray).toBeUndefined();
    });

    it("projects the spec's posts and folds the spec's customization in", () => {
        const projected = collectionsFromTables(compileTables([users, posts]));
        const postsCms = customizeTable<typeof posts>("posts", {
            name: "Blog Posts",
            singularName: "Blog Post",
            icon: "FileText",
            group: "Content",
            defaultViewMode: "cards",
            enabledViews: ["table", "cards", "kanban"],
            kanban: { columnField: "status", orderField: "__order" },
            display: { title: "title", image: "heroImage", status: "status", date: "publishDate" },
            fields: {
                status: {
                    enumLabels: {
                        draft: { label: "Draft", color: "gray" },
                        needs_review: { label: "Needs Review", color: "orange" },
                        published: { label: "Published", color: "green" },
                        archived: { label: "Archived", color: "red" }
                    }
                },
                title: { multiline: true },
                content: { Field: CustomMarkdownEditor },
                orgId: { hidden: true },
                __order: { hidden: true, disabled: true }
            },
            entityActions: [{
                key: "publish",
                name: "Publish",
                icon: "Send",
                collapsed: false,
                isEnabled: ({ row }) => row?.status !== "published",
                onClick: ({ id, context }) =>
                    updateRecord(context, "posts", id, { status: "published", publishDate: new Date().toISOString() }, "Published")
            }]
        });

        const [, customized] = applyTableCustomizations(projected, [postsCms]);
        expect(customized).toMatchObject({
            slug: "posts",
            name: "Blog Posts",
            singularName: "Blog Post",
            icon: "FileText",
            group: "Content",
            defaultViewMode: "cards",
            enabledViews: ["table", "cards", "kanban"],
            kanban: { columnProperty: "status" },
            orderProperty: "__order",
            display: { title: "title", image: "heroImage", status: "status", date: "publishDate" }
        });
        const status = property(customized, "status");
        expect(status.type === "string" && status.enum).toEqual([
            { id: "draft", label: "Draft", color: "gray" },
            { id: "needs_review", label: "Needs Review", color: "orange" },
            { id: "published", label: "Published", color: "green" },
            { id: "archived", label: "Archived", color: "red" }
        ]);
        expect(property(customized, "title").admin).toMatchObject({ multiline: true });
        expect(property(customized, "content").admin).toMatchObject({ Field: CustomMarkdownEditor });
        expect(property(customized, "orgId").admin).toMatchObject({ hideFromCollection: true });
        expect(property(customized, "__order").admin).toMatchObject({ hideFromCollection: true, disabled: true });
        // The projection's own facts survive: the relation, the rules, the storage rule.
        expect(property(customized, "author").type).toBe("relation");
        expect(customized.securityRules).toEqual(projected[1].securityRules);
        const hero = property(customized, "heroImage");
        expect(hero.type === "string" && hero.storage?.storagePath).toBe("posts/hero/");
        expect(warn).not.toHaveBeenCalled();
    });
});
