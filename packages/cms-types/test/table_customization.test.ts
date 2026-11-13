import { col, defineTable, json, rel } from "@rebasepro/types";
import {
    FIELD_COMPONENT_KEYS,
    FIELD_CUSTOMIZATION_KEYS,
    isTableCustomization,
    TABLE_CUSTOMIZATION_BRAND,
    TABLE_CUSTOMIZATION_KEYS,
    type AnyFieldCustomization,
    type FieldCustomization,
    type TableCustomization,
    type TableCustomizationOptions,
    type TableEntityActionProps,
    type TableFormValues,
    type TableRow
} from "../src/table_customization";
import type { EntityRelation } from "@rebasepro/cms-types";
import type { FieldProps } from "../src/types/plugins";

/**
 * The typed half of `customizeTable`: every guarantee its options make about
 * `typeof table`, against tables written with the real builders.
 *
 * Most assertions here are `@ts-expect-error` lines, so this file is only worth
 * anything because `tsconfig.tests.json` puts `packages/cms-types/test` in the
 * `pnpm typecheck` program: a directive tsc never reads asserts nothing.
 * The runtime tests at the bottom keep jest honest about the data exports.
 */

const users = defineTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull(),
        email: col.text()
    },
    rls: "admin-only"
});

const tags = defineTable("tags", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        label: col.text().notNull()
    },
    rls: "admin-only"
});

/** The spec's `posts` (§6.2), with the column kinds the customization reaches. */
const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug: col.text(),
        heroImage: col.storage({ path: "posts/hero/", accept: ["image/*"] }),
        excerpt: col.text(),
        content: col.jsonb(json.array(json.oneOf({ text: json.string(), image: json.storage({ path: "posts/content/" }) }))),
        seo: col.jsonb(json.object({ title: json.string(), canonical: json.string(), level: json.string().oneOf(["low", "high"]) })),
        status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft"),
        priority: col.integer().oneOf([1, 2, 3]),
        labels: col.text({ enum: ["hot", "cold"] }).array(),
        views: col.integer(),
        featured: col.boolean(),
        publishDate: col.timestamp({ withTimezone: true }),
        orgId: col.uuid(),
        firestoreDocId: col.text(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        __order: col.text()
    },
    relations: {
        author: rel.belongsTo(() => users),
        tags: rel.manyToMany(() => tags)
    },
    rls: "admin-only"
});

type Posts = typeof posts;

/** A by-value custom field, written against a narrower props type than the slot hands it. */
function CustomMarkdownEditor(props: FieldProps): string {
    return String(props.value ?? "");
}

// ── The spec's block, verbatim, type-checks ──────────────────────────────────

const specBlock: TableCustomizationOptions<Posts> = {
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
        onClick: async () => undefined
    }]
};

// ── Field keys are the table's columns and relations ─────────────────────────

const relationKeys: TableCustomizationOptions<Posts> = {
    fields: { author: { previewFields: ["name"], widget: "dialog" }, tags: { renderInForm: true } }
};

const unknownField: TableCustomizationOptions<Posts> = {
    fields: {
        // @ts-expect-error `heroimage` is not a column or relation of posts
        heroimage: { hidden: true }
    }
};

// ── Display slots, kanban, lists and form are checked the same way ──────────

const badDisplay: TableCustomizationOptions<Posts> = {
    // @ts-expect-error `cover` is not a field of posts
    display: { image: "cover" }
};

const dottedDisplay: TableCustomizationOptions<Posts> = {
    // A dotted path into a field is accepted; only its root is checked.
    display: { subtitle: "seo.title", tags: ({ row }) => row.labels ?? [] }
};

const badDottedDisplay: TableCustomizationOptions<Posts> = {
    // @ts-expect-error the root `meta` is not a field of posts
    display: { subtitle: "meta.title" }
};

// @ts-expect-error a kanban groups by a closed set of strings; `title` is free text
const kanbanByText: TableCustomizationOptions<Posts> = { kanban: { columnField: "title" } };

// @ts-expect-error a kanban cannot group by a list (`labels` is an array)
const kanbanByArray: TableCustomizationOptions<Posts> = { kanban: { columnField: "labels" } };

// @ts-expect-error the order key lives in a text column; `views` is an integer
const kanbanOrderInNumber: TableCustomizationOptions<Posts> = { kanban: { columnField: "status", orderField: "views" } };

const lists: TableCustomizationOptions<Posts> = {
    fieldOrder: ["title", "status", "author", "subcollection:tags"],
    listFields: ["title", "publishDate"],
    previewFields: ["title"],
    form: {
        sidebar: ["status", "publishDate", "author", "tags"],
        sections: [{ key: "post", fields: ["title", "slug", "heroImage", "excerpt"] }]
    },
    sort: ["publishDate", "desc"],
    filterPresets: [{ label: "Published", filterValues: { status: ["==", "published"] } }]
};

// @ts-expect-error `subcollection:` names a relation; `orgId` is a column
const badSubcollection: TableCustomizationOptions<Posts> = { fieldOrder: ["subcollection:orgId"] };

// @ts-expect-error `body` is not a field of posts
const badOrder: TableCustomizationOptions<Posts> = { fieldOrder: ["title", "body"] };

// @ts-expect-error a form section entry is checked too
const badSection: TableCustomizationOptions<Posts> = { form: { sections: [{ key: "x", fields: ["bodyText"] }] } };

// @ts-expect-error a sort key is checked too
const badSort: TableCustomizationOptions<Posts> = { sort: ["published_at", "desc"] };

// A relation's target is a `TableThunk` (`() => void`) — what lets two tables
// point at each other without an annotation — so its type is not known here:
// a relation's preview fields are any strings. (Before relation thunks became
// `TableThunk`, this line was a compile error.)
const badRelationPreview: TableCustomizationOptions<Posts> = { fields: { author: { previewFields: ["title"] } } };

// ── Enum labels are keyed by the column's values ─────────────────────────────

const badEnumValue: TableCustomizationOptions<Posts> = {
    fields: {
        status: {
            enumLabels: {
                draft: "Draft",
                // @ts-expect-error `deleted` is not a value of `status`
                deleted: "Deleted"
            }
        }
    }
};

const oneOfLabels: TableCustomizationOptions<Posts> = {
    fields: {
        priority: { enumLabels: { 1: "Low", 2: "Medium", 3: { label: "High", color: "red" } }, enumOrder: [3, 2, 1] },
        labels: { enumLabels: { hot: { label: "Hot", color: "orange" } } }
    }
};

// @ts-expect-error `4` is not one of `priority`'s values
const badOneOf: TableCustomizationOptions<Posts> = { fields: { priority: { enumLabels: { 4: "Urgent" } } } };

// @ts-expect-error `title` is free text: it has no values to label
const labelsOnText: TableCustomizationOptions<Posts> = { fields: { title: { enumLabels: { a: "A" } } } };

// @ts-expect-error `enumOrder` lists the column's values
const badEnumOrder: TableCustomizationOptions<Posts> = { fields: { status: { enumOrder: ["draft", "gone"] } } };

// ── Options follow the column type ───────────────────────────────────────────

const typedOptions: TableCustomizationOptions<Posts> = {
    fields: {
        views: { format: { style: "decimal" }, clearable: true },
        publishDate: { mode: "date", timezone: "Europe/Madrid", clearable: true },
        heroImage: { storage: { path: ({ propertyKey }) => `posts/${propertyKey}/`, previewUrl: name => `https://cdn/${name}` } },
        firestoreDocId: { referenceTo: "fs_events" },
        orgId: { previewAsTag: true },
        seo: {
            spreadChildren: true,
            fieldOrder: ["title", "canonical"],
            fields: { title: { multiline: true }, level: { enumLabels: { low: "Low" } } }
        },
        content: { oneOf: { text: { markdown: true } }, of: { expanded: true } }
    }
};

// @ts-expect-error a user picker is `.userId()` on the column in the schema, not a customization
const userSelectField: TableCustomizationOptions<Posts> = { fields: { orgId: { userSelect: true } } };

// @ts-expect-error `multiline` is a text option; `views` is a number
const multilineOnNumber: TableCustomizationOptions<Posts> = { fields: { views: { multiline: true } } };

// @ts-expect-error `format` is a number option; `featured` is a boolean
const formatOnBoolean: TableCustomizationOptions<Posts> = { fields: { featured: { format: { style: "percent" } } } };

// @ts-expect-error `referenceTo` decorates a text or uuid column; `publishDate` is a timestamp
const referenceOnDate: TableCustomizationOptions<Posts> = { fields: { publishDate: { referenceTo: "events" } } };

// @ts-expect-error `seo` has no key `keywords`
const badNestedKey: TableCustomizationOptions<Posts> = { fields: { seo: { fields: { keywords: { hidden: true } } } } };

// @ts-expect-error a nested closed set is checked too
const badNestedEnum: TableCustomizationOptions<Posts> = { fields: { seo: { fields: { level: { enumLabels: { mid: "Mid" } } } } } };

// ── Components are values ────────────────────────────────────────────────────

// @ts-expect-error a string path is not a component: import it and pass it by value
const stringField: TableCustomizationOptions<Posts> = { fields: { content: { Field: "../components/CustomMarkdownEditor" } } };

const thunkField: TableCustomizationOptions<Posts> = {
    fields: {
        content: {
            // @ts-expect-error a lazy import thunk is not a component either
            Field: () => import("../src/types/plugins")
        }
    }
};

// ── An entity action's `row` is the table's row ─────────────────────────────

const typedRow: TableCustomizationOptions<Posts> = {
    entityActions: [{
        name: "Archive",
        // `status` is the column's union, not `unknown`.
        isEnabled: ({ row }) => row?.status === "published" || row?.status === "draft",
        onClick: ({ row }) => {
            const title: string | undefined = row?.title;
            void title;
        }
    }]
};

const misspeltRowKey: TableCustomizationOptions<Posts> = {
    entityActions: [{
        name: "Archive",
        // @ts-expect-error a status the column cannot hold
        isEnabled: ({ row }) => row?.status === "deleted",
        onClick: () => undefined
    }]
};

const unknownRowKey: TableCustomizationOptions<Posts> = {
    entityActions: [{
        name: "Archive",
        // @ts-expect-error `published` is not a column of posts
        isEnabled: ({ row }) => row?.published === true,
        onClick: () => undefined
    }]
};

/** `row` is `InferRow<typeof posts>`, its relations optional beside it. */
type ActionRow = NonNullable<TableEntityActionProps<TableRow<Posts>>["row"]>;
const rowIsInferRow: ActionRow = { id: "1", title: "t", status: "draft", createdAt: "2026-01-01", slug: null, heroImage: null, excerpt: null, content: null, seo: null, priority: null, labels: null, views: null, featured: null, publishDate: null, orgId: null, firestoreDocId: null, __order: null };
const inferRowIsRow: TableRow<Posts> = rowIsInferRow;

// ── A row carries the relations the panel loaded, untyped beyond their shape ──

const customers = defineTable("customers", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    rls: "admin-only"
});

const orderLines = defineTable("order_lines", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), sku: col.text() },
    rls: "admin-only"
});

const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        total: col.numeric({ precision: 10, scale: 2 }),
        placedAt: col.timestamp({ withTimezone: true })
    },
    relations: {
        customer: rel.belongsTo(() => customers),
        invoice: rel.hasOne(() => orderLines),
        lines: rel.hasMany(() => orderLines),
        tags: rel.manyToMany(() => customers),
        route: rel.via(() => customers, { steps: [{ table: "order_lines", on: { from: "id", to: "order_id" } }] })
    },
    rls: "admin-only"
});

type Orders = typeof orders;

/** The repro: a display resolver reading a loaded `belongsTo`. */
const relationInDisplay: TableCustomizationOptions<Orders> = {
    display: {
        // Reading `row.customer` was TS2551 ("does not exist") while the row was only `InferRow`.
        subtitle: ({ row }) => row.customer ? String(row.customer.name) : undefined,
        title: ({ row }) => typeof row.customer?.name === "string" ? row.customer.name : undefined,
        tags: ({ row }) => (row.lines ?? []).map(line => typeof line === "object" ? String(line.sku) : String(line))
    }
};

const relationInAction: TableCustomizationOptions<Orders> = {
    entityActions: [{
        name: "Remind",
        isEnabled: ({ row }) => row?.customer !== undefined && row.invoice !== null,
        onClick: ({ row }) => {
            const lines: Record<string, unknown>[] | (string | number)[] | undefined = row?.lines;
            void lines;
        }
    }]
};

/** The honest shapes: a loaded belongsTo is a row (never an id or `null`: its key is the foreign-key column). */
type OrderRow = TableRow<Orders>;
const belongsToShape: OrderRow["customer"] = { name: "Ada" };
// @ts-expect-error a belongsTo is never its id under the relation's name
const belongsToNotId: OrderRow["customer"] = "c1";
const hasOneShapes: OrderRow["invoice"][] = [{ sku: "x" }, "i1", 7, null, undefined];
const manyShapes: OrderRow["lines"][] = [[{ sku: "x" }], ["l1", 2], undefined];
// @ts-expect-error a to-many relation is a list
const manyNotOne: OrderRow["tags"] = { name: "x" };
const viaEither: OrderRow["route"][] = [{ name: "x" }, [{ name: "y" }], "r1", null];

const unloadedRelation: TableCustomizationOptions<Orders> = {
    display: {
        // @ts-expect-error a loaded relation may be absent: read it optionally
        title: ({ row }) => String(row.customer.name)
    }
};

const unknownRelation: TableCustomizationOptions<Orders> = {
    display: {
        // @ts-expect-error `supplier` is not a relation of orders
        title: ({ row }) => String(row.supplier)
    }
};

/** `dynamicProps` reads the form's view model: a date is a `Date`, a relation an `EntityRelation`. */
const formValues: TableCustomizationOptions<Orders> = {
    fields: {
        total: {
            dynamicProps: ({ values }) => {
                const placed: Date | string | null | undefined = values.placedAt;
                const customer: EntityRelation | null | undefined = values.customer;
                const lines: EntityRelation[] | undefined = values.lines;
                void placed;
                void lines;
                return customer ? { readOnly: true } : undefined;
            }
        }
    }
};
type OrderForm = TableFormValues<Orders>;
// @ts-expect-error in the form a relation is an `EntityRelation`, not the loaded row
const formRelationNotRow: OrderForm["customer"] = { name: "Ada" };

// ── Without a type parameter, anything goes, loosely typed ──────────────────

const loose: TableCustomizationOptions = {
    kanban: { columnField: "anything" },
    fields: { whatever: { enumLabels: { a: "A", 1: "One" }, multiline: true, format: { style: "percent" } } },
    entityActions: [{ name: "Go", isEnabled: ({ row }) => row?.anything !== undefined, onClick: () => undefined }]
};

/** A typed customization is usable wherever an untyped one is expected: `<RebaseCMS tableCustomizations>`. */
function asLoose(customization: TableCustomization<Posts>): TableCustomization {
    return customization;
}
const typedFieldIsAnyField: AnyFieldCustomization = {} satisfies FieldCustomization<Posts["config"]["columns"]["status"]>;

void [specBlock, relationKeys, unknownField, badDisplay, dottedDisplay, badDottedDisplay, kanbanByText, kanbanByArray,
    kanbanOrderInNumber, lists, badSubcollection, badOrder, badSection, badSort, badRelationPreview, badEnumValue, oneOfLabels,
    badOneOf, labelsOnText, badEnumOrder, typedOptions, multilineOnNumber, formatOnBoolean, referenceOnDate, badNestedKey,
    badNestedEnum, stringField, thunkField, typedRow, misspeltRowKey, unknownRowKey, inferRowIsRow, loose, asLoose,
    typedFieldIsAnyField, relationInDisplay, relationInAction, belongsToShape, belongsToNotId, hasOneShapes, manyShapes,
    manyNotOne, viaEither, unloadedRelation, unknownRelation, formValues, formRelationNotRow];

// ── The data exports ─────────────────────────────────────────────────────────

describe("customizeTable's keys, as data", () => {
    it("lists every top-level key once, sorted", () => {
        expect(new Set(TABLE_CUSTOMIZATION_KEYS).size).toBe(TABLE_CUSTOMIZATION_KEYS.length);
        const sorted = [...TABLE_CUSTOMIZATION_KEYS].sort((a, b) => a.localeCompare(b, "en", { caseFirst: "upper" }));
        expect(new Set(sorted)).toEqual(new Set(TABLE_CUSTOMIZATION_KEYS));
    });

    it("lists every field key once, and the component slots among them", () => {
        expect(new Set(FIELD_CUSTOMIZATION_KEYS).size).toBe(FIELD_CUSTOMIZATION_KEYS.length);
        for (const key of FIELD_COMPONENT_KEYS) expect(FIELD_CUSTOMIZATION_KEYS).toContain(key);
        // A user picker is a schema fact (`.userId()`), never a customization.
        expect(new Set<string>(FIELD_CUSTOMIZATION_KEYS).has("userSelect")).toBe(false);
    });

    it("recognises a customization by its brand", () => {
        expect(isTableCustomization({ brand: TABLE_CUSTOMIZATION_BRAND, table: "posts" })).toBe(true);
        expect(isTableCustomization({ table: "posts" })).toBe(false);
        expect(isTableCustomization(null)).toBe(false);
    });
});
