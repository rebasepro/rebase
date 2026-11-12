import React, { forwardRef, memo } from "react";
import { describe, expect, it } from "@jest/globals";
import { col, defineTable, rel } from "@rebasepro/types";
import type { FieldProps, TableCustomization } from "@rebasepro/cms-types";
import { customizeTable, updateRecord } from "@rebasepro/cms";

/**
 * `customizeTable`'s runtime half: the brand, the freeze, and the refusals
 * that tell an author what to write instead. The typed half is in
 * `packages/cms-types/test/table_customization.test.ts`; the signature's own
 * guarantees (the slug, the loose form) are asserted here, which
 * `tsconfig.tests.json` puts in the `pnpm typecheck` program.
 */

const users = defineTable("users", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    rls: "admin-only"
});

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        heroImage: col.storage({ path: "posts/hero/" }),
        content: col.text(),
        status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
        publishDate: col.timestamptz(),
        orgId: col.uuid(),
        __order: col.text()
    },
    relations: { author: rel.belongsTo(() => users) },
    rls: "admin-only"
});

const blogPosts = defineTable("blog_posts_table", {
    slug: "blog_posts",
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text() },
    rls: "admin-only"
});

/** `customizeTable` as a JavaScript caller sees it: no types to stop an old `admin` key or a string component. */
const untypedCustomizeTable: (slug: string, options: object) => unknown = customizeTable;

function CustomMarkdownEditor(props: FieldProps): React.ReactElement {
    return <textarea data-testid="markdown" value={String(props.value ?? "")} readOnly/>;
}

describe("customizeTable", () => {
    it("returns the options, branded with the table's slug, frozen", () => {
        const postsCms = customizeTable<typeof posts>("posts", {
            name: "Blog Posts",
            fields: { content: { Field: CustomMarkdownEditor }, status: { enumLabels: { draft: "Draft" } } }
        });
        expect(postsCms.brand).toBe("rebase.table-customization");
        expect(postsCms.table).toBe("posts");
        expect(postsCms.name).toBe("Blog Posts");
        expect(postsCms.fields?.content?.Field).toBe(CustomMarkdownEditor);
        expect(Object.isFrozen(postsCms)).toBe(true);
        expect(Object.isFrozen(postsCms.fields)).toBe(true);
        expect(Object.isFrozen(postsCms.fields?.status)).toBe(true);
        // The component itself is not frozen: React may still set a displayName on it.
        expect(Object.isFrozen(CustomMarkdownEditor)).toBe(false);
    });

    it("builds the spec's block as written (§6.2)", () => {
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
        expect(postsCms.kanban).toEqual({ columnField: "status", orderField: "__order" });
        expect(postsCms.entityActions).toHaveLength(1);
    });

    it("accepts components in every form React makes them", () => {
        class ClassField extends React.Component<FieldProps> {
            render() { return null; }
        }
        const Memo = memo(CustomMarkdownEditor);
        const Forwarded = forwardRef<HTMLDivElement, FieldProps>(function Forwarded() { return null; });
        expect(() => customizeTable("posts", {
            fields: { a: { Field: ClassField }, b: { Field: Memo }, c: { Field: Forwarded } }
        })).not.toThrow();
    });

    it("is typed against the table's slug when given the table", () => {
        // @ts-expect-error the first argument is the table's slug, "posts"
        expect(() => customizeTable<typeof posts>("post", {})).not.toThrow();
        // A table defined with its own `slug` is matched by that slug, read from its type.
        const blogCms = customizeTable<typeof blogPosts>("blog_posts", { fields: { title: { multiline: true } } });
        expect(blogCms.table).toBe("blog_posts");
        const slugIsLiteral: "blog_posts" = blogCms.table;
        void slugIsLiteral;
        // @ts-expect-error the slug is "blog_posts", not the name the table was defined under
        expect(() => customizeTable<typeof blogPosts>("blog_posts_table", {})).not.toThrow();
        // Without type arguments, any slug and any field: the zero-ceremony form.
        const loose = customizeTable("anything", { fields: { whatever: { hidden: true } } });
        expect(loose.table).toBe("anything");
        // Either way the result is what `<RebaseCMS tableCustomizations>` takes.
        const all: TableCustomization[] = [loose, customizeTable<typeof posts>("posts", {})];
        expect(all).toHaveLength(2);
    });

    describe("refuses what it cannot apply, saying what to write", () => {
        it("a missing slug", () => {
            // @ts-expect-error the slug is required
            expect(() => customizeTable(undefined, {})).toThrow(/needs the slug of the table/);
            expect(() => untypedCustomizeTable("", {})).toThrow(/needs the slug of the table/);
        });

        it("an unknown top-level option, with the new name of an old `admin` key", () => {
            const legacy: Record<string, unknown> = { propertiesOrder: ["title"], icon: "FileText" };
            expect(() => untypedCustomizeTable("posts", legacy)).toThrow(/`propertiesOrder` — it is `fieldOrder` now/);
            expect(() => untypedCustomizeTable("posts", { admin: { icon: "x" } }))
                .toThrow(/no `admin` block/);
        });

        it("a misspelt option, with the closest one", () => {
            const typo: Record<string, unknown> = { defaultViewmode: "cards" };
            expect(() => untypedCustomizeTable("posts", typo)).toThrow(/did you mean `defaultViewMode`\?/);
        });

        it("an unknown field option, naming the field", () => {
            const fields: Record<string, unknown> = { title: { hideFromCollection: true } };
            expect(() => untypedCustomizeTable("posts", { fields }))
                .toThrow(/fields\.title: unknown option:\n {2}- `hideFromCollection` — it is `hidden` now/);
        });

        it("a component given as a string path", () => {
            const fields: Record<string, unknown> = { content: { Field: "../components/CustomMarkdownEditor" } };
            expect(() => untypedCustomizeTable("posts", { fields }))
                .toThrow(/fields\.content\.Field is the string "\.\.\/components\/CustomMarkdownEditor"\. Components are imported by value now/);
        });

        it("a component given as a lazy import thunk", () => {
            const thunk = () => import("../helpers/fakes");
            const fields: Record<string, unknown> = { content: { Preview: thunk } };
            expect(() => untypedCustomizeTable("posts", { fields }))
                .toThrow(/fields\.content\.Preview is a lazy import thunk\. Components are imported by value now/);
        });

        it("the old lazy component reference, anywhere a component goes", () => {
            const lazy = { __rebaseLazy: true, load: async () => ({ default: CustomMarkdownEditor }) };
            const options: Record<string, unknown> = { formView: { Builder: lazy } };
            expect(() => untypedCustomizeTable("posts", options)).toThrow(/formView\.Builder is a lazy component reference/);
            const views: Record<string, unknown> = { entityViews: [{ key: "preview", name: "Preview", Builder: "./Preview" }] };
            expect(() => untypedCustomizeTable("posts", views)).toThrow(/entityViews\[0\]\.Builder is the string/);
            const overrides: Record<string, unknown> = { components: { "Entity.Form": { Component: "./Form" } } };
            expect(() => untypedCustomizeTable("posts", overrides)).toThrow(/components\["Entity\.Form"\]\.Component is the string/);
            const actions: Record<string, unknown> = { Actions: ["./Toolbar"] };
            expect(() => untypedCustomizeTable("posts", actions)).toThrow(/Actions\[0\] is the string/);
        });

        it("a nested field's component, by its path", () => {
            const fields: Record<string, unknown> = { seo: { fields: { title: { Field: "./SeoTitle" } } } };
            expect(() => untypedCustomizeTable("posts", { fields }))
                .toThrow(/fields\.seo\.fields\.title\.Field is the string/);
        });

        it("the old kanban key", () => {
            const kanban: Record<string, unknown> = { kanban: { columnProperty: "status" } };
            expect(() => untypedCustomizeTable("posts", kanban)).toThrow(/`columnProperty` — it is `columnField` now/);
        });

        it("an entity action without a name or an onClick", () => {
            const noClick: Record<string, unknown> = { entityActions: [{ name: "Publish" }] };
            expect(() => untypedCustomizeTable("posts", noClick)).toThrow(/entityActions\[0\] needs an `onClick` function/);
            const noName: Record<string, unknown> = { entityActions: [{ onClick: () => undefined }] };
            expect(() => untypedCustomizeTable("posts", noName)).toThrow(/entityActions\[0\] needs a `name`/);
            // A string names an action registered app-wide.
            expect(() => untypedCustomizeTable("posts", { entityActions: ["archive"] })).not.toThrow();
        });

        it("fields inside a relation's tab overrides", () => {
            const fields: Record<string, unknown> = { author: { overrides: { fields: { name: { hidden: true } } } } };
            expect(() => untypedCustomizeTable("posts", { fields }))
                .toThrow(/overrides\.fields: a relation's `overrides` restyle the tab/);
        });
    });
});
