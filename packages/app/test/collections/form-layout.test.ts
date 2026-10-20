import type { AdminCollection } from "@rebasepro/cms-types";
import type { Property } from "@rebasepro/types";
import {
    isIdPropertyEditable,
    resolveFormLayout
} from "../../src/collections/form-layout";

const collection = (properties: Record<string, unknown>, admin: Record<string, unknown> = {}) =>
    ({
        name: "Products",
        singularName: "Product",
        slug: "products",
        properties,
        ...admin
    } as unknown as AdminCollection);

const keysOf = (layout: { sections: { fields: { key: string }[] }[] }) =>
    layout.sections.flatMap(s => s.fields.map(f => f.key));

const spanOf = (layout: { sections: { fields: { key: string, span: number }[] }[] }, key: string) =>
    layout.sections.flatMap(s => s.fields).find(f => f.key === key)?.span;

describe("isIdPropertyEditable", () => {
    it("keeps a manual id typeable while creating and freezes it afterwards", () => {
        const manual = { type: "string", isId: "manual" } as unknown as Property;
        expect(isIdPropertyEditable(manual, "new")).toBe(true);
        expect(isIdPropertyEditable(manual, "copy")).toBe(true);
        expect(isIdPropertyEditable(manual, "existing")).toBe(false);
    });

    it("never offers a generated id for typing", () => {
        const uuid = { type: "string", isId: "uuid" } as unknown as Property;
        expect(isIdPropertyEditable(uuid, "new")).toBe(false);
        expect(isIdPropertyEditable(uuid, "existing")).toBe(false);
    });

    it("treats a plain property as editable", () => {
        expect(isIdPropertyEditable({ type: "string" } as Property, "existing")).toBe(true);
    });
});

describe("resolveFormLayout — defaults", () => {
    const products = collection({
        id: { type: "string", isId: "uuid" },
        name: { type: "string" },
        sku: { type: "string" },
        price: { type: "number" },
        stock: { type: "number" },
        description: { type: "string", admin: { markdown: true } }
    }, { display: { title: "name" } });

    const layout = resolveFormLayout({
        collection: products,
        fieldKeys: ["id", "name", "sku", "price", "stock", "description"],
        status: "existing"
    });

    it("puts every field in one untitled group when nothing is configured", () => {
        expect(layout.sections).toHaveLength(1);
        expect(layout.sections[0].title).toBeUndefined();
        expect(layout.sections[0].collapsible).toBe(false);
    });

    it("routes a generated id out of the form and into the record block", () => {
        expect(keysOf(layout)).not.toContain("id");
        expect(layout.showRecordMeta).toBe(true);
        expect(layout.hasRail).toBe(true);
    });

    it("keeps every column of a composite key visible", () => {
        // Postgres has no `id`: a row is addressed by its key columns, and
        // `entity.id` is a synthesised `a:::b` token. On a junction row the key
        // columns ARE the data — which order, which product — so hiding them
        // behind an unreadable address would empty the form.
        const junction = collection({
            order_id: { type: "string", isId: "manual" },
            product_id: { type: "string", isId: "manual" },
            quantity: { type: "number" }
        });
        const l = resolveFormLayout({
            collection: junction,
            fieldKeys: ["order_id", "product_id", "quantity"],
            status: "existing"
        });
        expect(keysOf(l)).toEqual(["order_id", "product_id", "quantity"]);
    });

    it("keeps a manual id in the form while creating", () => {
        const manual = collection({
            id: { type: "string", isId: "manual" },
            name: { type: "string" }
        });
        const creating = resolveFormLayout({ collection: manual, fieldKeys: ["id", "name"], status: "new" });
        expect(keysOf(creating)).toContain("id");

        const editing = resolveFormLayout({ collection: manual, fieldKeys: ["id", "name"], status: "existing" });
        expect(keysOf(editing)).not.toContain("id");
    });

    it("gives every field the full row, whatever its type", () => {
        for (const key of keysOf(layout)) {
            expect(spanOf(layout, key)).toBe(4);
        }
    });

    it("does not widen or narrow the title property", () => {
        // Being the record's title says nothing about how wide its editor is.
        // Nothing in the layout reads `display.title`.
        const titled = collection({
            code: { type: "string", admin: { span: 1 } },
            label: { type: "string" }
        }, { display: { title: "code" } });
        const l = resolveFormLayout({ collection: titled, fieldKeys: ["code", "label"], status: "existing" });
        expect(spanOf(l, "code")).toBe(1);
        expect(spanOf(l, "label")).toBe(4);
    });

    it("lays a short form out as one column", () => {
        // The users form: Email and Name were paired by type and Roles was
        // left alone on the row below — three unrelated values in a zig-zag,
        // on a form that fits on screen with no columns at all.
        const users = collection({
            id: { type: "string", isId: "uuid" },
            email: { type: "string" },
            displayName: { type: "string" },
            roles: { type: "array", of: { type: "string", enum: { admin: "Admin" } } }
        });
        const l = resolveFormLayout({
            collection: users,
            fieldKeys: ["id", "email", "displayName", "roles"],
            status: "new"
        });
        expect(keysOf(l)).toEqual(["email", "displayName", "roles"]);
        for (const key of keysOf(l)) {
            expect(spanOf(l, key)).toBe(4);
        }
    });

    it("keeps a span the author wrote, even in a short form", () => {
        const short = collection({
            from: { type: "date", admin: { span: 2 } },
            to: { type: "date", admin: { span: 2 } },
            note: { type: "string" }
        });
        const l = resolveFormLayout({ collection: short, fieldKeys: ["from", "to", "note"], status: "new" });
        expect(spanOf(l, "from")).toBe(2);
        expect(spanOf(l, "to")).toBe(2);
        expect(spanOf(l, "note")).toBe(4);
    });

    it("preserves the incoming field order", () => {
        expect(keysOf(layout)).toEqual(["name", "sku", "price", "stock", "description"]);
    });

    it("drops fields hidden by a disabled block", () => {
        const withHidden = collection({
            name: { type: "string" },
            secret: { type: "string", admin: { disabled: { hidden: true } } }
        });
        const l = resolveFormLayout({ collection: withHidden, fieldKeys: ["name", "secret"], status: "existing" });
        expect(keysOf(l)).toEqual(["name"]);
    });

    it("drops a field declared `conditions: { hidden: true }`", () => {
        // The unconditional case, said with a boolean instead of `{ "==": [1, 1] }`.
        const withHidden = collection({
            name: { type: "string" },
            secret: { type: "string", conditions: { hidden: true } }
        });
        const l = resolveFormLayout({ collection: withHidden, fieldKeys: ["name", "secret"], status: "existing" });
        expect(keysOf(l)).toEqual(["name"]);
    });

    it("routes audit timestamps to the record block instead of the column", () => {
        // They were rendering as disabled inputs mid-form while the record block
        // showed the same two dates — each timestamp twice on one screen.
        const audited = collection({
            name: { type: "string" },
            created_at: { type: "date", autoValue: "on_create", admin: { readOnly: true } },
            updated_at: { type: "date", autoValue: "on_update", admin: { readOnly: true } },
            publish_date: { type: "date" }
        });
        const l = resolveFormLayout({
            collection: audited,
            fieldKeys: ["name", "created_at", "updated_at", "publish_date"],
            status: "existing"
        });
        expect(keysOf(l)).toEqual(["name", "publish_date"]);
        expect(l.showRecordMeta).toBe(true);
    });

    it("keeps an audit timestamp the author explicitly put in the sidebar", () => {
        const audited = collection({
            name: { type: "string" },
            created_at: { type: "date", autoValue: "on_create" }
        }, { form: { sidebar: ["created_at"] } });
        const l = resolveFormLayout({
            collection: audited,
            fieldKeys: ["name", "created_at"],
            status: "existing"
        });
        expect(l.sidebar.map(f => f.key)).toEqual(["created_at"]);
    });

    it("keeps a plain date field, which is not an audit timestamp", () => {
        const l = resolveFormLayout({
            collection: collection({ publish_date: { type: "date" } }),
            fieldKeys: ["publish_date"],
            status: "existing"
        });
        expect(keysOf(l)).toEqual(["publish_date"]);
    });

    it("honours hideIdFromForm by suppressing the record block too", () => {
        const hidden = collection({
            id: { type: "string", isId: "uuid" },
            name: { type: "string" }
        }, { hideIdFromForm: true });
        const l = resolveFormLayout({ collection: hidden, fieldKeys: ["id", "name"], status: "existing" });
        expect(l.showRecordMeta).toBe(false);
        expect(l.hasRail).toBe(false);
        expect(keysOf(l)).toEqual(["name"]);
    });
});

describe("resolveFormLayout — spans the author wrote", () => {
    it("never resizes them to close a row", () => {
        // The author picked these widths; a gap they leave is theirs to keep.
        const l = resolveFormLayout({
            collection: collection({
                city: { type: "string", admin: { span: 3 } },
                postcode: { type: "string", admin: { span: 1 } },
                country: { type: "string", admin: { span: 2 } },
                notes: { type: "string" }
            }),
            fieldKeys: ["city", "postcode", "country", "notes"],
            status: "existing"
        });
        expect(l.sections[0].fields.map(f => [f.key, f.span])).toEqual([
            ["city", 3], ["postcode", 1], ["country", 2], ["notes", 4]
        ]);
    });
});

describe("resolveFormLayout — explicit config", () => {
    const posts = collection({
        title: { type: "string" },
        slug: { type: "string" },
        body: { type: "string", admin: { markdown: true } },
        status: { type: "string", enum: [] },
        publish_date: { type: "date" },
        author: { type: "relation" }
    }, {
        form: {
            sidebar: ["status", "publish_date", "author"],
            sections: [
                { key: "content", title: "Content", properties: ["title", "slug", "body"] },
                { key: "seo", title: "SEO", properties: ["meta"], collapsed: true }
            ]
        }
    });

    const layout = resolveFormLayout({
        collection: posts,
        fieldKeys: ["title", "slug", "body", "status", "publish_date", "author"],
        status: "existing"
    });

    it("pulls the named properties into the rail", () => {
        expect(layout.sidebar.map(f => f.key)).toEqual(["status", "publish_date", "author"]);
        expect(keysOf(layout)).not.toContain("status");
    });

    it("keeps the configured section order and titles", () => {
        expect(layout.sections.map(s => s.title)).toEqual(["Content"]);
        expect(keysOf(layout)).toEqual(["title", "slug", "body"]);
    });

    it("drops a section whose keys all turned out to be unavailable", () => {
        // "seo" named `meta`, which the collection does not define
        expect(layout.sections.map(s => s.key)).not.toContain("seo");
    });

    it("makes a titled section collapsible by default and an untitled one not", () => {
        expect(layout.sections[0].collapsible).toBe(true);
        expect(layout.sections[0].collapsed).toBe(false);
    });

    it("carries a declared read variant through untouched", () => {
        // The resolver decides which fields a section holds; how the read-only
        // view stacks them is the surface's business, so this is passed along
        // rather than acted on here.
        const order = collection({
            subtotal: { type: "number" },
            tax: { type: "number" },
            total: { type: "number" }
        }, {
            form: {
                sections: [{
                    key: "totals",
                    title: "Totals",
                    properties: ["subtotal", "tax", "total"],
                    readVariant: "summary"
                }]
            }
        });
        const l = resolveFormLayout({
            collection: order,
            fieldKeys: ["subtotal", "tax", "total"],
            status: "existing"
        });
        expect(l.sections[0].readVariant).toBe("summary");
        expect(l.sections[0].fields.map(f => f.key)).toEqual(["subtotal", "tax", "total"]);
    });

    it("leaves the read variant undefined when none is declared", () => {
        expect(layout.sections[0].readVariant).toBeUndefined();
    });

    it("never drops a property no section claimed", () => {
        const partial = collection({
            a: { type: "string" },
            b: { type: "string" },
            surprise: { type: "string" }
        }, {
            form: { sections: [{ key: "one", title: "One", properties: ["a", "b"] }] }
        });
        const l = resolveFormLayout({
            collection: partial,
            fieldKeys: ["a", "b", "surprise"],
            status: "existing"
        });
        expect(keysOf(l)).toContain("surprise");
        // in its own trailing group, not silently inside "One"
        expect(l.sections).toHaveLength(2);
        expect(l.sections[1].title).toBeUndefined();
    });

    it("puts unplaced fields after every configured section, not inside the untitled one", () => {
        // The bug this pins: `created_at`/`updated_at` were unplaced, found the
        // first untitled section, and landed between the images and the pricing.
        const c = collection({
            name: { type: "string" },
            price: { type: "number" },
            created_at: { type: "date" }
        }, {
            form: {
                sections: [
                    { key: "basics", properties: ["name"] },              // untitled
                    { key: "pricing", title: "Pricing", properties: ["price"] }
                ]
            }
        });
        const l = resolveFormLayout({
            collection: c,
            fieldKeys: ["name", "price", "created_at"],
            status: "existing"
        });
        expect(l.sections.map(s => s.key)).toEqual(["basics", "pricing", "__other"]);
        expect(l.sections[0].fields.map(f => f.key)).toEqual(["name"]);
        expect(l.sections[2].fields.map(f => f.key)).toEqual(["created_at"]);
    });

    it("lets an empty sidebar array suppress the derived rail fields", () => {
        const l = resolveFormLayout({
            collection: collection({ a: { type: "string" } }, { form: { sidebar: [], showRecordMeta: false } }),
            fieldKeys: ["a"],
            status: "existing"
        });
        expect(l.sidebar).toEqual([]);
        expect(l.hasRail).toBe(false);
    });

    it("prefers an explicit span over the default", () => {
        const explicit = collection({
            a: { type: "number", admin: { span: 4 } },
            b: { type: "number", admin: { span: 2 } },
            c: { type: "number", admin: { span: 3 } }
        });
        const l = resolveFormLayout({ collection: explicit, fieldKeys: ["a", "b", "c"], status: "existing" });
        expect(spanOf(l, "a")).toBe(4);
        expect(spanOf(l, "b")).toBe(2);
        expect(spanOf(l, "c")).toBe(3);
    });

    it("gives an additionalFields entry the full row", () => {
        const withExtra = {
            ...collection({ a: { type: "string" } }),
            additionalFields: [{ key: "computed", name: "Computed" }]
        } as unknown as AdminCollection;
        const l = resolveFormLayout({ collection: withExtra, fieldKeys: ["a", "computed"], status: "existing" });
        expect(spanOf(l, "computed")).toBe(4);
        expect(l.sections[0].fields.find(f => f.key === "computed")?.additional).toBe(true);
    });

    it("ignores a sidebar key that names something unknown", () => {
        const l = resolveFormLayout({
            collection: collection({ a: { type: "string" } }, { form: { sidebar: ["nope"] } }),
            fieldKeys: ["a"],
            status: "existing"
        });
        expect(l.sidebar).toEqual([]);
        expect(keysOf(l)).toEqual(["a"]);
    });
});
