import type { AdminCollection } from "@rebasepro/cms-types";
import type { Property } from "@rebasepro/types";
import {
    isIdPropertyEditable,
    pairCompactFields,
    pairKind,
    resolveFormLayout,
    type ResolvedFormField
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

describe("pairKind", () => {
    const p = (v: unknown) => v as Property;

    it("names the compact editors", () => {
        expect(pairKind(p({ type: "number", name: "Price" }))).toBe("number");
        expect(pairKind(p({ type: "boolean", name: "Active" }))).toBe("switch");
        expect(pairKind(p({ type: "date", name: "Starts" }))).toBe("date");
        expect(pairKind(p({ type: "date", name: "Starts", mode: "date_time" }))).toBe("date_time");
        expect(pairKind(p({ type: "string", name: "Status", enum: { draft: "Draft", live: "Live" } }))).toBe("select");
        expect(pairKind(p({ type: "number", name: "Priority", enum: [{ id: 1, label: "Low" }] }))).toBe("select");
        expect(pairKind(p({ type: "string", name: "Plan", enum: new Map([["a", "A"]]) }))).toBe("select");
    });

    it("never pairs a free-text string, whatever it is called or holds", () => {
        // Namespace beside Custom Domain: both strings, nothing alike.
        expect(pairKind(p({ type: "string", name: "Namespace" }))).toBeUndefined();
        expect(pairKind(p({ type: "string", name: "Git Branch" }))).toBeUndefined();
    });

    it("never pairs what renders another record or a list", () => {
        expect(pairKind(p({ type: "relation", name: "Owner" }))).toBeUndefined();
        expect(pairKind(p({ type: "reference", name: "Owner" }))).toBeUndefined();
        expect(pairKind(p({ type: "array", name: "Tags", of: { type: "string" } }))).toBeUndefined();
        expect(pairKind(p({ type: "map", name: "Address" }))).toBeUndefined();
    });

    it("keeps a field with long help text, a long label or long options on its own row", () => {
        expect(pairKind(p({
            type: "string",
            name: "App Capacity",
            enum: { shared: "Shared", reserved: "Reserved" },
            description: "Shared: you get what you buy and can use more when there is spare capacity."
        }))).toBeUndefined();
        expect(pairKind(p({ type: "number", name: "Maximum concurrent connections per region" }))).toBeUndefined();
        expect(pairKind(p({
            type: "string",
            name: "Tier",
            enum: { a: "Dedicated hardware running this project and nothing else" }
        }))).toBeUndefined();
        expect(pairKind(p({ type: "number", name: "Seats", description: "Paid seats." }))).toBe("number");
    });

    it("keeps a custom editor or a conditional field on its own row", () => {
        expect(pairKind(p({ type: "number", name: "Score", admin: { Field: () => null } }))).toBeUndefined();
        expect(pairKind(p({ type: "number", name: "Score", conditions: { hidden: {} } }))).toBeUndefined();
    });

    it("keeps a field some users may not read on its own row", () => {
        // The form renders nothing for a field its user may not read, and a
        // partner paired with it sat alone at half width.
        expect(pairKind(p({ type: "number", name: "Cost", access: { read: ["finance"] } }))).toBeUndefined();
        expect(pairKind(p({ type: "number", name: "Score", excludeFromApi: true }))).toBeUndefined();
        // A write rule alone hides nothing, but it is the same rule the form
        // reads, so it is treated alike.
        expect(pairKind(p({ type: "number", name: "Cost", access: { write: ["finance"] } }))).toBeUndefined();
    });
});

describe("pairCompactFields", () => {
    const field = (key: string, span: ResolvedFormField["span"] = 4, spanExplicit = false): ResolvedFormField =>
        ({ key, span, additional: false, spanExplicit });
    const props: Record<string, unknown> = {
        n1: { type: "number", name: "Width" },
        n2: { type: "number", name: "Height" },
        n3: { type: "number", name: "Depth" },
        n4: { type: "number", name: "Weight" },
        b1: { type: "boolean", name: "Active" },
        b2: { type: "boolean", name: "Featured" },
        d1: { type: "date", name: "Starts" },
        d2: { type: "date", name: "Ends" },
        dt: { type: "date", name: "Sent", mode: "date_time" },
        s1: { type: "string", name: "Namespace" },
        x2: { type: "string", name: "Code" }
    };
    const pair = (fields: ResolvedFormField[]) =>
        pairCompactFields(fields, key => props[key] as Property | undefined).map(f => [f.key, f.span]);

    it("pairs two neighbours of the same kind", () => {
        expect(pair([field("n1"), field("n2")])).toEqual([["n1", 2], ["n2", 2]]);
        expect(pair([field("b1"), field("b2")])).toEqual([["b1", 2], ["b2", 2]]);
        expect(pair([field("d1"), field("d2")])).toEqual([["d1", 2], ["d2", 2]]);
    });

    it("does not pair different kinds", () => {
        expect(pair([field("n1"), field("b1")])).toEqual([["n1", 4], ["b1", 4]]);
        expect(pair([field("d1"), field("dt")])).toEqual([["d1", 4], ["dt", 4]]);
    });

    it("does not pair fields that are not next to each other", () => {
        expect(pair([field("n1"), field("s1"), field("n2")])).toEqual([["n1", 4], ["s1", 4], ["n2", 4]]);
    });

    it("pairs a run two at a time and leaves the odd one out on its own row, in order", () => {
        expect(pair([field("n1"), field("n2"), field("n3")])).toEqual([["n1", 2], ["n2", 2], ["n3", 4]]);
        expect(pair([field("n1"), field("n2"), field("n3"), field("n4")]))
            .toEqual([["n1", 2], ["n2", 2], ["n3", 2], ["n4", 2]]);
    });

    it("never resizes a span the author wrote, nor pairs with it", () => {
        expect(pair([field("n1", 2, true), field("n2")])).toEqual([["n1", 2], ["n2", 4]]);
    });

    it("only starts a pair at the beginning of a row", () => {
        // `x2` takes half a row: a pair after it would split across two rows.
        expect(pair([field("x2", 2, true), field("n1"), field("n2")]))
            .toEqual([["x2", 2], ["n1", 4], ["n2", 4]]);
        // once the author's row is full, pairing resumes
        expect(pair([field("x2", 2, true), field("x2", 2, true), field("n1"), field("n2")]))
            .toEqual([["x2", 2], ["x2", 2], ["n1", 2], ["n2", 2]]);
    });

    it("leaves additionalFields alone", () => {
        const extra: ResolvedFormField = { key: "n1", span: 4, additional: true };
        expect(pairCompactFields([extra, field("n2")], key => props[key] as Property).map(f => f.span))
            .toEqual([4, 4]);
    });
});

describe("resolveFormLayout — the projects form", () => {
    // The form that started this: every value a string, so nothing pairs.
    it("keeps unrelated strings on rows of their own", () => {
        const projects = collection({
            name: { type: "string", name: "Name" },
            subdomain: { type: "string", name: "Subdomain" },
            namespace: { type: "string", name: "Namespace" },
            customDomain: { type: "string", name: "Custom Domain" },
            gitRepositoryUrl: { type: "string", name: "Git Repository URL" },
            gitBranch: { type: "string", name: "Git Branch" }
        });
        const keys = ["name", "subdomain", "namespace", "customDomain", "gitRepositoryUrl", "gitBranch"];
        const l = resolveFormLayout({ collection: projects, fieldKeys: keys, status: "existing" });
        for (const key of keys) expect(spanOf(l, key)).toBe(4);
    });

    it("pairs within a section, never across two", () => {
        const sectioned = collection({
            a: { type: "number", name: "A" },
            b: { type: "number", name: "B" },
            c: { type: "number", name: "C" }
        }, {
            form: {
                sections: [
                    { key: "one", properties: ["a"] },
                    { key: "two", title: "Two", properties: ["b", "c"] }
                ]
            }
        });
        const l = resolveFormLayout({ collection: sectioned, fieldKeys: ["a", "b", "c"], status: "existing" });
        expect(spanOf(l, "a")).toBe(4);
        expect(spanOf(l, "b")).toBe(2);
        expect(spanOf(l, "c")).toBe(2);
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

    it("leaves a number full width when its neighbour may not be read", () => {
        const layout = resolveFormLayout({
            collection: collection({
                price: { type: "number", name: "Price" },
                cost: { type: "number", name: "Cost", access: { read: ["finance"] } },
                stock: { type: "number", name: "Stock" },
                weight: { type: "number", name: "Weight" }
            }),
            fieldKeys: ["price", "cost", "stock", "weight"],
            status: "existing"
        });
        expect(spanOf(layout, "price")).toBe(spanOf(layout, "cost"));
        expect(spanOf(layout, "stock")).toBe(spanOf(layout, "weight"));
        expect(spanOf(layout, "price")).not.toBe(spanOf(layout, "stock"));
    });

    it("pairs the two neighbouring numbers and leaves every string full width", () => {
        expect(spanOf(layout, "name")).toBe(4);
        expect(spanOf(layout, "sku")).toBe(4);
        expect(spanOf(layout, "price")).toBe(2);
        expect(spanOf(layout, "stock")).toBe(2);
        expect(spanOf(layout, "description")).toBe(4);
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
