import type { AdminCollection } from "@rebasepro/admin-types";
import type { Property } from "@rebasepro/types";
import {
    deriveSpan,
    isIdPropertyEditable,
    resolveFormLayout,
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

describe("deriveSpan", () => {
    const p = (v: unknown) => v as Property;

    it("gives compact editors a quarter row", () => {
        expect(deriveSpan(p({ type: "number" }), false)).toBe(1);
        expect(deriveSpan(p({ type: "boolean" }), false)).toBe(1);
    });

    it("gives ordinary editors half a row", () => {
        expect(deriveSpan(p({ type: "string" }), false)).toBe(2);
        expect(deriveSpan(p({ type: "date" }), false)).toBe(2);
        expect(deriveSpan(p({ type: "relation" }), false)).toBe(2);
    });

    it("gives the whole row to editors that need it", () => {
        expect(deriveSpan(p({ type: "string", admin: { markdown: true } }), false)).toBe(4);
        expect(deriveSpan(p({ type: "string", admin: { multiline: true } }), false)).toBe(4);
        expect(deriveSpan(p({ type: "string", storage: { storagePath: "x/" } }), false)).toBe(4);
        expect(deriveSpan(p({ type: "map" }), false)).toBe(4);
    });

    it("splits arrays on what they hold, not on being arrays", () => {
        // tags — reads fine beside another field
        expect(deriveSpan(p({ type: "array", of: { type: "string" } }), false)).toBe(2);
        // uploads and nested shapes — do not
        expect(deriveSpan(p({ type: "array", of: { type: "string", storage: { storagePath: "x/" } } }), false)).toBe(4);
        expect(deriveSpan(p({ type: "array", of: { type: "map" } }), false)).toBe(4);
        expect(deriveSpan(p({ type: "array", oneOf: { properties: {} } }), false)).toBe(4);
        expect(deriveSpan(p({ type: "array" }), false)).toBe(4);
    });

    it("gives the title property the full row whatever its type", () => {
        expect(deriveSpan(p({ type: "string" }), true)).toBe(4);
        expect(deriveSpan(p({ type: "number" }), true)).toBe(4);
    });
});

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

describe("resolveFormLayout — derived defaults", () => {
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

    it("derives a mixed-width row rather than a run of full-width fields", () => {
        expect(spanOf(layout, "name")).toBe(4);        // title
        expect(spanOf(layout, "sku")).toBe(2);
        expect(spanOf(layout, "price")).toBe(1);
        expect(spanOf(layout, "stock")).toBe(1);
        expect(spanOf(layout, "description")).toBe(4); // markdown
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

describe("fillRows", () => {
    it("closes the gap left by a lone half-width field", () => {
        // name | sku  then  brand | ␣␣ — the stranded half is what this removes.
        const l = resolveFormLayout({
            collection: collection({
                name: { type: "string" },
                sku: { type: "string" },
                brand: { type: "string" }
            }),
            fieldKeys: ["name", "sku", "brand"],
            status: "existing"
        });
        const spans = l.sections[0].fields.map(f => [f.key, f.span]);
        expect(spans).toEqual([["name", 2], ["sku", 2], ["brand", 4]]);
    });

    it("never resizes a field whose span the author set", () => {
        const l = resolveFormLayout({
            collection: collection({
                a: { type: "string" },
                b: { type: "string" },
                c: { type: "string", admin: { span: 2 } }
            }),
            fieldKeys: ["a", "b", "c"],
            status: "existing"
        });
        const spans = l.sections[0].fields.map(f => [f.key, f.span]);
        expect(spans).toEqual([["a", 2], ["b", 2], ["c", 2]]);
    });

    it("closes the gap left by a lone quarter-width field", () => {
        const l = resolveFormLayout({
            collection: collection({
                a: { type: "number" }, b: { type: "number" },
                c: { type: "number" }, d: { type: "number" },
                lonely: { type: "number" }
            }),
            fieldKeys: ["a", "b", "c", "d", "lonely"],
            status: "existing"
        });
        // row one is full; `lonely` starts a row of its own with a gap of 3
        expect(l.sections[0].fields.map(f => [f.key, f.span])).toEqual([
            ["a", 1], ["b", 1], ["c", 1], ["d", 1], ["lonely", 4]
        ]);
    });

    it("spreads the remainder across the row rather than onto the last field", () => {
        // two quarter-width numbers and half a row spare: both grow, so you do
        // not get one full-width input beside one quarter-width one.
        const l = resolveFormLayout({
            collection: collection({ a: { type: "number" }, b: { type: "number" } }),
            fieldKeys: ["a", "b"],
            status: "existing"
        });
        expect(l.sections[0].fields.map(f => f.span)).toEqual([2, 2]);
    });

    it("leaves a full row alone", () => {
        const l = resolveFormLayout({
            collection: collection({
                a: { type: "number" }, b: { type: "number" },
                c: { type: "number" }, d: { type: "number" }
            }),
            fieldKeys: ["a", "b", "c", "d"],
            status: "existing"
        });
        expect(l.sections[0].fields.map(f => f.span)).toEqual([1, 1, 1, 1]);
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

    it("prefers an explicit span over the derived one", () => {
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
