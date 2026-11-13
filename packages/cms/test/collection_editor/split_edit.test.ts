/**
 * `splitEdit`: one save of the collection editor, as the schema edit it makes
 * (`TablePatch[]` for `backend/schema`) and the presentation delta it makes
 * (a UI preference). Every row of the editor's capability table, against the
 * collection the projector really makes of a served table.
 */
import { describe, expect, it } from "@jest/globals";
import type { AdminCollection, AdminPostgresCollection } from "@rebasepro/cms-types";
import { FIELD_CUSTOMIZATION_KEYS, TABLE_CUSTOMIZATION_KEYS } from "@rebasepro/cms-types";
import type { Property, SecurityRule, TableDescriptor, TablePatch } from "@rebasepro/types";
import {
    UI_PREFERENCE_FIELD_KEYS,
    UI_PREFERENCE_TABLE_KEYS,
    tablePatchProblems,
    uiTablePreferencesProblems
} from "@rebasepro/types";

import { collectionFromTable } from "../../src/tables";
import { splitEdit, SplitEditError, sameValue } from "../../src/collection_editor/split_edit";
import { wireColumnOfDescriptor } from "../../src/collection_editor/property_column";
import { column, posts, rules, table, tags, users, uuidId } from "../tables/fixtures";
import { productsCollectionTemplate } from "../../src/collection_editor/ui/collection_editor/templates/products_template";
import { blogCollectionTemplate } from "../../src/collection_editor/ui/collection_editor/templates/blog_template";
import { usersCollectionTemplate } from "../../src/collection_editor/ui/collection_editor/templates/users_template";
import { pagesCollectionTemplate } from "../../src/collection_editor/ui/collection_editor/templates/pages_template";

const all = [posts, users, tags];
const project = (t: TableDescriptor): AdminPostgresCollection => collectionFromTable(t, { tables: [...all, t] });

/** A deep copy of the projected collection, so an edit never touches `before`. Thunks are kept. */
function clone(collection: AdminPostgresCollection): AdminPostgresCollection {
    const properties: Record<string, Property> = {};
    for (const [key, property] of Object.entries(collection.properties)) properties[key] = structuredCloneProperty(property);
    return { ...collection, properties, securityRules: (collection.securityRules ?? []).map(rule => ({ ...rule })) };
}

function structuredCloneProperty(property: Property): Property {
    if (property.type === "relation") return { ...property, relation: property.relation ? { ...property.relation } : undefined };
    return JSON.parse(JSON.stringify(property, (_key, value: unknown) => value instanceof RegExp ? value.source : value), (_key, value: unknown) => value);
}

function edit(t: TableDescriptor, change: (after: AdminPostgresCollection) => void) {
    const before = project(t);
    const after = clone(before);
    change(after);
    return splitEdit({ before, after, table: t });
}

const ops = (patches: TablePatch[]) => patches.map(p => p.op);

describe("an untouched collection", () => {
    it.each(all.map(t => [t.slug, t] as const))("%s splits into nothing", (_slug, t) => {
        const result = edit(t, () => undefined);
        expect(result.schema).toEqual([]);
        expect(result.presentation).toEqual({});
    });
});

describe("columns", () => {
    it("a new field is addColumn, required → notNull", () => {
        const result = edit(posts, after => {
            after.properties.subtitle = { type: "string", name: "Subtitle", validation: { required: true, max: 80 } };
        });
        expect(result.schema).toEqual([{
            op: "addColumn", table: "posts", key: "subtitle",
            column: { type: { kind: "text" }, notNull: true, validate: { max: 80 } }
        }]);
        // Its label is presentation.
        expect(result.presentation.fields?.subtitle).toEqual({ name: "Subtitle" });
        expect(tablePatchProblems(result.schema)).toEqual([]);
    });

    it("a validation change is changeColumn, keeping what the column states", () => {
        const result = edit(posts, after => {
            const title = after.properties.title;
            if (title.type === "string") title.validation = { ...title.validation, max: 120 };
        });
        expect(result.schema).toEqual([{
            op: "changeColumn", table: "posts", key: "title",
            column: { type: { kind: "text" }, notNull: true, validate: { min: 3, max: 120 } }
        }]);
    });

    it("keeps the exact type while the type choice is unchanged (varchar length)", () => {
        const result = edit(posts, after => {
            const slug = after.properties.slug;
            if (slug.type === "string") slug.validation = { ...slug.validation, trim: true };
        });
        expect(result.schema).toHaveLength(1);
        const patch = result.schema[0];
        expect(patch.op === "changeColumn" && patch.column.type).toEqual({ kind: "varchar", length: 160 });
        expect(patch.op === "changeColumn" && patch.column.unique).toBe(true);
    });

    it("a type change is changeColumn with the new type", () => {
        const result = edit(posts, after => {
            after.properties.publishDate = { type: "date", name: "Publish Date", columnType: "date", mode: "date" };
        });
        const patch = result.schema[0];
        expect(ops(result.schema)).toEqual(["changeColumn"]);
        expect(patch.op === "changeColumn" && patch.column.type).toEqual({ kind: "date" });
    });

    it("a new enum value is changeColumn with the values; a relabel alone is presentation", () => {
        const added = edit(posts, after => {
            const status = after.properties.status;
            if (status.type === "string" && Array.isArray(status.enum)) status.enum = [...status.enum, { id: "scheduled", label: "Scheduled" }];
        });
        const patch = added.schema[0];
        expect(patch.op === "changeColumn" && patch.column.type).toEqual({
            kind: "enum", values: ["draft", "needs_review", "published", "archived", "scheduled"]
        });
        expect(patch.op === "changeColumn" && patch.column.default).toEqual({ kind: "literal", value: "draft" });

        const relabelled = edit(posts, after => {
            const status = after.properties.status;
            if (status.type === "string" && Array.isArray(status.enum)) {
                status.enum = status.enum.map(v => v.id === "draft" ? { ...v, label: "Work in progress", color: "grayLight" } : v);
            }
        });
        expect(relabelled.schema).toEqual([]);
        expect(relabelled.presentation).toEqual({
            fields: { status: { enumLabels: { draft: { label: "Work in progress", color: "grayLight" } } } }
        });
    });

    it("reordering enum values is presentation (enumOrder)", () => {
        const result = edit(posts, after => {
            const status = after.properties.status;
            if (status.type === "string" && Array.isArray(status.enum)) status.enum = [...status.enum].reverse();
        });
        expect(result.schema).toEqual([]);
        expect(result.presentation.fields?.status?.enumOrder).toEqual(["archived", "published", "needs_review", "draft"]);
    });

    it("storage rules are schema", () => {
        const result = edit(posts, after => {
            const hero = after.properties.heroImage;
            if (hero.type === "string" && hero.storage) hero.storage = { ...hero.storage, maxSize: 5 * 1024 * 1024 };
        });
        const patch = result.schema[0];
        expect(patch.op === "changeColumn" && patch.column.storage).toEqual({ path: "posts/heroes/", accept: ["image/*"], maxBytes: 5 * 1024 * 1024 });
    });

    it("a default is schema", () => {
        const result = edit(posts, after => {
            const status = after.properties.status;
            if (status.type === "string") status.defaultValue = "needs_review";
        });
        const patch = result.schema[0];
        expect(patch.op === "changeColumn" && patch.column.default).toEqual({ kind: "literal", value: "needs_review" });
    });

    it("a vector column's index survives an edit of the column", () => {
        const result = edit(posts, after => {
            const embedding = after.properties.embedding;
            if (embedding.type === "vector") embedding.validation = { required: true };
        });
        const patch = result.schema[0];
        expect(patch.op === "changeColumn" && patch.column.vectorIndex).toEqual({ method: "hnsw", metric: "cosine" });
        expect(patch.op === "changeColumn" && patch.column.notNull).toBe(true);
    });

    it("a removed field is removeColumn", () => {
        const result = edit(posts, after => { delete after.properties.publishDate; });
        expect(result.schema).toEqual([{ op: "removeColumn", table: "posts", key: "publishDate" }]);
    });

    it("a stamp keeps its nullability", () => {
        const result = edit(posts, after => {
            const created = after.properties.createdAt;
            if (created.type === "date") created.description = "When the post was written";
        });
        expect(result.schema).toEqual([{
            op: "changeColumn", table: "posts", key: "createdAt",
            column: { type: { kind: "timestamptz" }, notNull: true, stamp: { on: "create", value: "now" }, description: "When the post was written" }
        }]);
    });

    it("a view-model property with no column on a table is refused", () => {
        expect(() => edit(posts, after => {
            after.properties.weird = { type: "vector", dimensions: 0 };
        })).toThrow(SplitEditError);
    });
});

describe("relations", () => {
    it("changing a relation's onDelete is changeRelation with every other option kept", () => {
        const result = edit(posts, after => {
            const author = after.properties.author;
            if (author.type === "relation" && author.relation?.kind === "belongsTo") author.relation = { ...author.relation, onDelete: "cascade" };
        });
        expect(result.schema).toEqual([{
            op: "changeRelation", table: "posts", name: "author",
            relation: { kind: "belongsTo", target: "users", localKey: "author_id", onDelete: "cascade" }
        }]);
    });

    it("removing a relation is removeRelation; adding one is addRelation by target slug", () => {
        const removed = edit(posts, after => { delete after.properties.tags; });
        expect(removed.schema).toEqual([{ op: "removeRelation", table: "posts", name: "tags" }]);

        const usersCollection = project(users);
        const added = edit(posts, after => {
            after.properties.reviewer = {
                type: "relation",
                name: "Reviewer",
                relation: { kind: "belongsTo", relationName: "reviewer", target: () => usersCollection, localKey: "reviewer_id" }
            };
        });
        expect(added.schema).toEqual([{
            op: "addRelation", table: "posts", name: "reviewer",
            relation: { kind: "belongsTo", target: "users", localKey: "reviewer_id" }
        }]);
    });
});

describe("rules", () => {
    const editorAt = (list: readonly SecurityRule[]) => list.findIndex(rule => rule.roles?.includes("editor"));

    it("editing one rule replaces only that rule, by its declared position; the others are not sent", () => {
        const result = edit(posts, after => {
            const list = after.securityRules ?? [];
            const at = editorAt(list);
            list[at] = { ...list[at], roles: ["editor", "reviewer"] };
        });
        expect(result.schema).toEqual([{
            op: "replaceRule", table: "posts", index: 1,
            rule: { operations: ["select", "insert", "update"], roles: ["editor", "reviewer"] }
        }]);
    });

    it("an added rule is addRule after the declared ones; an injected rule is never written", () => {
        const result = edit(posts, after => {
            after.securityRules = [...(after.securityRules ?? []), { operation: "select", roles: ["auditor"] }];
        });
        expect(result.schema).toEqual([{ op: "addRule", table: "posts", index: 3, rule: { operation: "select", roles: ["auditor"] } }]);
    });

    it("removing every declared rule is the admin-only posture, never an empty list", () => {
        const result = edit(tags, after => { after.securityRules = []; });
        expect(result.schema).toEqual([{ op: "setRls", table: "tags", rls: "admin-only" }]);
    });

    it("rules on an admin-only table are setRls with the list", () => {
        const result = edit(users, after => {
            after.securityRules = [...(after.securityRules ?? []), { operation: "select", access: "authenticated" }];
        });
        expect(result.schema).toEqual([{ op: "setRls", table: "users", rls: [{ operation: "select", access: "authenticated" }] }]);
    });

    it("rules inherited from defaultRls detach only with the caller's say-so", () => {
        const inherited = table("notes", {
            columns: [uuidId(), column("body", { kind: "text" })],
            rls: { posture: "rules", inherited: true, rules: [{ operation: "select", access: "authenticated" }], defaultPolicies: true }
        });
        const result = edit(inherited, after => {
            after.securityRules = [...(after.securityRules ?? []), { operation: "insert", access: "authenticated" }];
        });
        expect(result.detachesInheritedRules).toBe(true);
        expect(ops(result.schema)).toEqual(["setRls"]);
    });

    it("redacted rules are not written back", () => {
        const redacted = table("secrets", {
            columns: [uuidId()],
            rls: rules([{ redacted: true, operation: "select", roles: ["admin"] }])
        });
        expect(() => edit(redacted, after => { after.securityRules = []; }))
            .toThrow(expect.objectContaining({ code: "REDACTED_RULES" }));
    });
});

describe("table options and migrations", () => {
    it("description and history are setOption", () => {
        const result = edit(posts, after => {
            after.description = "What we publish";
            after.history = false;
        });
        expect(result.schema).toEqual([
            { op: "setOption", table: "posts", option: "description", value: "What we publish" },
            { op: "setOption", table: "posts", option: "history", value: null }
        ]);
        expect(result.presentation).toEqual({});
    });

    it.each([["slug", "articles"], ["table", "blog_posts"]] as const)("changing the %s is a migration", (key, value) => {
        expect(() => edit(posts, after => { Reflect.set(after, key, value); }))
            .toThrow(expect.objectContaining({ code: "MIGRATION_REQUIRED", key }));
    });
});

describe("presentation", () => {
    it("labels, icon, view mode, order, kanban and field options are a preference delta, never a schema edit", () => {
        const result = edit(posts, after => {
            after.name = "Articles";
            after.icon = "Article";
            after.defaultViewMode = "kanban";
            after.kanban = { columnProperty: "status" };
            after.orderProperty = "__order";
            after.propertiesOrder = ["title", "status", "author"];
            after.openEntityMode = "full_screen";
            const title = after.properties.title;
            title.name = "Headline";
            title.admin = { ...title.admin, columnWidth: 320, hideFromCollection: false };
            const metadata = after.properties.metadata;
            metadata.admin = { ...metadata.admin, hideFromCollection: true };
        });
        expect(result.schema).toEqual([]);
        expect(result.presentation).toEqual({
            name: "Articles",
            icon: "Article",
            defaultViewMode: "kanban",
            kanban: { columnField: "status", orderField: "__order" },
            fieldOrder: ["title", "status", "author"],
            openEntityMode: "full_screen",
            fields: {
                title: { name: "Headline", hidden: false, columnWidth: 320 },
                metadata: { hidden: true }
            }
        });
        expect(uiTablePreferencesProblems(result.presentation)).toEqual([]);
    });

    it("code-valued options (an action object) are not data and never stored", () => {
        const result = edit(posts, after => {
            after.entityActions = ["archive", { key: "publish", name: "Publish", onClick: async () => undefined }];
        });
        expect(result.presentation).toEqual({ entityActions: ["archive"] });
    });
});

describe("a new table", () => {
    const fresh = (): AdminCollection => ({
        slug: "invoices",
        name: "Invoices",
        icon: "Receipt",
        properties: {
            id: { type: "string", columnType: "uuid", isId: "uuid", name: "Id" },
            number: { type: "number", columnType: "integer", name: "Number", validation: { required: true } },
            paid: { type: "boolean", name: "Paid", defaultValue: false }
        }
    });

    it("is createTable with its columns, and its presentation", () => {
        const result = splitEdit({ after: fresh() });
        expect(result.schema).toEqual([{
            op: "createTable",
            table: {
                name: "invoices",
                columns: {
                    id: { type: { kind: "uuid" }, primaryKey: true, notNull: true, default: { kind: "random-uuid" } },
                    number: { type: { kind: "integer" }, notNull: true },
                    paid: { type: { kind: "boolean" }, default: { kind: "literal", value: false } }
                },
                rls: "admin-only"
            }
        }]);
        expect(tablePatchProblems(result.schema)).toEqual([]);
        expect(result.presentation).toEqual({
            name: "Invoices",
            icon: "Receipt",
            fields: { id: { name: "Id" }, number: { name: "Number" }, paid: { name: "Paid" } }
        });
    });

    it("gets a uuid id when it names no primary key (a template, a blank form)", () => {
        const noKey = fresh();
        delete noKey.properties.id;
        const [patch] = splitEdit({ after: noKey }).schema;
        expect(patch.op === "createTable" && Object.keys(patch.table.columns)).toEqual(["id", "number", "paid"]);
        expect(patch.op === "createTable" && patch.table.columns.id).toEqual({ type: { kind: "uuid" }, primaryKey: true, notNull: true, default: { kind: "random-uuid" } });
    });

    it("refuses an id field that is not the primary key", () => {
        const notKey = fresh();
        notKey.properties.id = { type: "string", name: "Id" };
        expect(() => splitEdit({ after: notKey })).toThrow(expect.objectContaining({ code: "NO_PRIMARY_KEY", key: "id" }));
    });

    it.each([
        ["products", productsCollectionTemplate],
        ["blog", blogCollectionTemplate],
        ["users", usersCollectionTemplate],
        ["pages", pagesCollectionTemplate]
    ])("the %s template is a createTable the server accepts, and a presentation that validates", (_name, template) => {
        const result = splitEdit({ after: template });
        expect(ops(result.schema)).toEqual(["createTable"]);
        expect(tablePatchProblems(result.schema)).toEqual([]);
        expect(uiTablePreferencesProblems(result.presentation)).toEqual([]);
    });
});

describe("the partition", () => {
    const COLUMN_KEYS = new Set(["type", "column", "notNull", "primaryKey", "unique", "default", "generatedAs", "readOnly", "private",
        "access", "stamp", "validate", "oneOf", "description", "storage", "semantic", "vectorIndex", "json", "element"]);

    it("every preference key is a customizeTable key", () => {
        for (const key of UI_PREFERENCE_TABLE_KEYS) expect(TABLE_CUSTOMIZATION_KEYS).toContain(key);
        for (const key of UI_PREFERENCE_FIELD_KEYS) expect(FIELD_CUSTOMIZATION_KEYS).toContain(key);
    });

    it("no schema fact is a preference: the validator refuses them", () => {
        expect(uiTablePreferencesProblems({ columns: {}, rls: "admin-only", history: true, description: "x" }).map(p => p.path))
            .toEqual(["columns", "rls", "history", "description"]);
        expect(uiTablePreferencesProblems({ fields: { title: { validation: { required: true }, enum: [], type: "string", description: "x" } } }).map(p => p.path))
            .toEqual(["fields.title.validation", "fields.title.enum", "fields.title.type", "fields.title.description"]);
    });

    it("no presentation key reaches a schema edit", () => {
        const result = edit(posts, after => {
            after.name = "Articles";
            after.properties.subtitle = { type: "string", name: "Subtitle", admin: { columnWidth: 200, multiline: true } };
            const title = after.properties.title;
            if (title.type === "string") {
                title.name = "Headline";
                title.validation = { ...title.validation, max: 99 };
                title.admin = { ...title.admin, multiline: true };
            }
        });
        for (const patch of result.schema) {
            if (patch.op === "addColumn" || patch.op === "changeColumn") {
                for (const key of Object.keys(patch.column)) expect(COLUMN_KEYS.has(key)).toBe(true);
            }
        }
        expect(result.presentation).toEqual({
            name: "Articles",
            fields: { subtitle: { name: "Subtitle", columnWidth: 200, multiline: true }, title: { name: "Headline", multiline: true } }
        });
    });

    it("sameValue compares deeply", () => {
        expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }], c: undefined })).toBe(true);
        expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    });
});

describe("a JSON document column keeps the rules the editor did not change", () => {
    // Every nested rule a JSON shape can state: array bounds, unique items,
    // `uniqueBy`, nested required fields, string, number and date rules, a
    // nested default, a user stamp, an open object.
    const lines = column("lines", { kind: "jsonb" }, {
        json: {
            kind: "array",
            validate: { minItems: 1, maxItems: 20, uniqueBy: ["sku"] },
            of: {
                kind: "object",
                additional: true,
                fields: {
                    sku: { kind: "string", required: true, validate: { min: 3, max: 12, matches: "^[A-Z0-9-]+$", requiredMessage: "Every line needs a SKU" } },
                    quantity: { kind: "number", required: true, default: 1, validate: { min: 1, integer: true } },
                    note: { kind: "string", validate: { trim: true } },
                    addedBy: { kind: "string", stamp: "createUser", semantic: "user" },
                    shipBy: { kind: "date", validate: { min: "2020-01-01T00:00:00.000Z" } },
                    labels: { kind: "array", of: { kind: "string" }, validate: { uniqueItems: true, maxItems: 5 } }
                }
            }
        }
    });
    const orders = table("orders", { columns: [uuidId(), lines] });

    it("a label change alone sends no schema edit", () => {
        const result = edit(orders, after => { after.properties.lines.name = "Order lines"; });
        expect(result.schema).toEqual([]);
    });

    it("a schema edit of the column carries its JSON shape unchanged", () => {
        const result = edit(orders, after => { after.properties.lines.description = "What was ordered"; });
        expect(result.schema).toHaveLength(1);
        const [patch] = result.schema;
        expect(patch.op).toBe("changeColumn");
        if (patch.op !== "changeColumn") return;
        expect(patch.column).toEqual({ ...wireColumnOfDescriptor(lines), description: "What was ordered" });
    });
});
