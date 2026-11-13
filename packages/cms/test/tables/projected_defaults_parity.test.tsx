/**
 * A projected table opens exactly as the collection it replaces did on `main`
 * when that collection said nothing about its presentation.
 *
 * Each case is one of the demo's tables twice: authored with `defineTable`
 * and projected, and written as a `main`-style collection literal that carries
 * the same facts (types, validation, storage, stamps, relations) and no
 * presentation key. Everything the panel resolves from a collection to draw
 * it — the view mode, how a record opens, the views offered, the default
 * columns and their order, the form layout, the record's tabs, its actions —
 * must come out the same. A projector that sets a presentation default the
 * panel would not have chosen on its own fails here.
 *
 * The one stated exception is POSTGRES-FIRST.md §6.1: audit stamps are
 * read-only and out of the default table columns, which the literals below
 * say by hand, as `main`'s collections did.
 */
import { describe, expect, it } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import type { AdminCollection, PostgresCollectionConfig } from "@rebasepro/cms-types";
import { col, defineTable, json, rel } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { getAdminEntityChildViews, getFormFieldKeys, resolveFormLayout, useColumnIds } from "@rebasepro/app";
import { resolveOpenEntityMode, resolveViewMode } from "../../src/util/view_mode";
import { collectionsFromTables } from "../../src/tables";

// ── The demo's tables, as `app/backend/schema` defines them ──────────────────

const authors = defineTable("authors", {
    rls: "admin-only",
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() }
});
const products = defineTable("products", {
    rls: "admin-only",
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() }
});
const orders = defineTable("orders", {
    rls: "admin-only",
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    relations: { items: rel.hasMany(() => orderItems, { foreignKey: "order_id" }) }
});
const tags = defineTable("tags", {
    rls: "admin-only",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull()
    },
    relations: { posts: rel.manyToMany(() => posts) },
    history: true
});
const posts = defineTable("posts", {
    rls: "admin-only",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug: col.text().notNull().unique(),
        hero_image: col.storage({ path: "posts/hero/" }),
        excerpt: col.text().validate({ max: 300 }),
        content: col.jsonb(json.array(json.oneOf({
            text: json.string(),
            image: json.storage({ path: "posts/content/" })
        }))),
        status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
        publish_date: col.timestamp({ withTimezone: true }),
        created_at: col.timestamp({ withTimezone: true }).onCreateNow(),
        updated_at: col.timestamp({ withTimezone: true }).onUpdateNow(),
        authorId: col.uuid(),
        __order: col.text()
    },
    relations: {
        author: rel.belongsTo(() => authors),
        tags: rel.manyToMany(() => tags)
    },
    history: true
});
const orderItems = defineTable("order_items", {
    rls: "admin-only",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        orderId: col.uuid(),
        productId: col.uuid(),
        product_name: col.text(),
        sku: col.text(),
        quantity: col.numeric().notNull().validate({ min: 1 }),
        unit_price: col.numeric(),
        line_total: col.numeric()
    },
    relations: {
        order: rel.belongsTo(() => orders, { onDelete: "cascade" }),
        product: rel.belongsTo(() => products, { onDelete: "restrict" })
    }
});

const projected = new Map(
    collectionsFromTables(compileTables([authors, products, orders, tags, posts, orderItems]))
        .map(collection => [collection.slug, collection])
);
const projectedOf = (slug: string): AdminCollection => {
    const collection = projected.get(slug);
    if (!collection) throw new Error(`"${slug}" was not projected`);
    return collection;
};

// ── The same tables as `main`-style collections with no presentation keys ────

const mainAuthors: PostgresCollectionConfig = {
    slug: "authors", name: "Authors", table: "authors",
    properties: { id: { name: "ID", type: "string", isId: "uuid" }, name: { name: "Name", type: "string", validation: { required: true } } }
};
const mainProducts: PostgresCollectionConfig = {
    slug: "products", name: "Products", table: "products",
    properties: { id: { name: "ID", type: "string", isId: "uuid" }, name: { name: "Name", type: "string", validation: { required: true } } }
};
const mainOrders: PostgresCollectionConfig = {
    slug: "orders", name: "Orders", table: "orders",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        total: { name: "Total", type: "number" },
        items: { name: "Items", type: "relation", relation: { kind: "hasMany", target: () => mainOrderItems, foreignKeyOnTarget: "order_id" } }
    }
};
const mainTags: PostgresCollectionConfig = {
    slug: "tags", name: "Tags", singularName: "Tag", table: "tags",
    history: true,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Name", type: "string", validation: { required: true } },
        posts: { name: "Posts", type: "relation", relation: { kind: "manyToMany", target: () => mainPosts } }
    }
};
// `main`'s posts.ts listed `tags` before `__order`; a table declares its
// relations after its columns, so the literal that is *equivalent* to the
// table does too (a project keeps `main`'s order with `fieldOrder`).
const mainPosts: PostgresCollectionConfig = {
    slug: "posts", name: "Posts", singularName: "Post", table: "posts",
    history: true,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string", validation: { required: true } },
        slug: { name: "Slug", type: "string", validation: { required: true, unique: true } },
        hero_image: { name: "Hero Image", type: "string", storage: { storagePath: "posts/hero/" } },
        excerpt: { name: "Excerpt", type: "string", validation: { max: 300 } },
        content: {
            name: "Content",
            type: "array",
            oneOf: {
                typeField: "type",
                valueField: "value",
                properties: {
                    text: { name: "Text", type: "string" },
                    image: { name: "Image", type: "string", storage: { storagePath: "posts/content/" } }
                }
            }
        },
        status: {
            name: "Status",
            type: "string",
            validation: { required: true },
            defaultValue: "draft",
            enum: [
                { id: "draft", label: "Draft" },
                { id: "needs_review", label: "Needs Review" },
                { id: "published", label: "Published" },
                { id: "archived", label: "Archived" }
            ]
        },
        publish_date: { name: "Publish Date", type: "date", mode: "date_time" },
        // §6.1: stamps are read-only and out of the default columns.
        created_at: { name: "Created At", type: "date", autoValue: "on_create", admin: { readOnly: true, hideFromCollection: true } },
        updated_at: { name: "Updated At", type: "date", autoValue: "on_update", admin: { readOnly: true, hideFromCollection: true } },
        author: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: () => mainAuthors } },
        __order: { name: "Order", type: "string" },
        tags: { name: "Tags", type: "relation", relation: { kind: "manyToMany", target: () => mainTags } }
    }
};
const mainOrderItems: PostgresCollectionConfig = {
    slug: "order_items", name: "Order Items", singularName: "Order Item", table: "order_items",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        order: { name: "Order", type: "relation", relation: { kind: "belongsTo", target: () => mainOrders, onDelete: "cascade" } },
        product: { name: "Product", type: "relation", relation: { kind: "belongsTo", target: () => mainProducts, onDelete: "restrict" } },
        product_name: { name: "Product Name", type: "string" },
        sku: { name: "SKU", type: "string" },
        quantity: { name: "Quantity", type: "number", validation: { required: true, min: 1 } },
        unit_price: { name: "Unit Price", type: "number" },
        line_total: { name: "Line Total", type: "number" }
    }
};

// ── What the panel resolves from a collection to draw it ─────────────────────

/** The collection-level presentation keys: none may be stated by either side. */
const PRESENTATION_KEYS = [
    "defaultViewMode", "openEntityMode", "enabledViews", "customViews", "entityViews", "entityActions",
    "display", "form", "propertiesOrder", "kanban", "orderProperty", "icon", "group",
    "hideFromNavigation", "hideFromEntityViews", "hideIdFromCollection", "hideIdFromForm", "includeJsonView",
    "previewProperties", "listProperties", "filterPresets", "defaultSize", "sort"
] as const;

function viewConfig(collection: AdminCollection) {
    const viewMode = resolveViewMode({ collection });
    const fieldKeys = getFormFieldKeys(collection);
    const layout = resolveFormLayout({ collection, fieldKeys, status: "existing" });
    const { result: columns } = renderHook(() => useColumnIds(collection, true));
    return {
        viewMode,
        openEntityMode: resolveOpenEntityMode({ collection, viewMode }),
        presentation: Object.fromEntries(PRESENTATION_KEYS.map(key => [key, collection[key]])),
        columns: columns.current.map(column => ({ key: column.key, disabled: column.disabled })),
        form: {
            fieldKeys,
            sections: layout.sections.map(section => ({ key: section.key, fields: section.fields.map(field => field.key) })),
            sidebar: layout.sidebar.map(field => field.key),
            showRecordMeta: layout.showRecordMeta
        },
        tabs: getAdminEntityChildViews(collection)
            .filter(view => !view.collection.hideFromEntityViews)
            .map(view => ({ key: view.key, source: view.source.kind }))
    };
}

describe("a projected table resolves to the view config of an unconfigured main collection", () => {
    it.each([
        ["tags", mainTags],
        ["order_items", mainOrderItems],
        ["posts", mainPosts]
    ])("%s", (slug, main) => {
        expect(viewConfig(projectedOf(slug))).toEqual(viewConfig(main));
    });

    it("opens as the list, a record in the split view — the CMS's own defaults", () => {
        for (const slug of ["tags", "order_items", "posts"]) {
            const config = viewConfig(projectedOf(slug));
            expect(config.viewMode).toBe("list");
            expect(config.openEntityMode).toBe("split");
        }
    });
});
