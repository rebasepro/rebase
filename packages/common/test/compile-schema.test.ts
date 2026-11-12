import { describe, expect, it } from "@jest/globals";
import { col, defineAuthTable, defineTable, defineView, json, rel } from "@rebasepro/types";
import type { ColumnTransform, TableHooks } from "@rebasepro/types";

import { compileSchema, compileDescribedTables, listTransforms } from "../src/schema/compile-schema";
import { compileTables } from "../src/schema/compile-tables";
import { isSchemaDefinitionError } from "../src/schema/errors";

/**
 * `compileSchema`: the descriptors `compileTables` makes, each with the
 * server-only half of its definition — hooks, field-level hooks addressed by
 * column and path, the auth table's lifecycle hooks — so the server holds one
 * value per table from compile to the driver.
 */

const trim: ColumnTransform<string | null> = { beforeSave: ({ value }) => value?.trim() ?? null };
const mask: ColumnTransform = { afterRead: () => "•••" };
const nestedTrim: ColumnTransform = { beforeSave: ({ value }) => typeof value === "string" ? value.trim() : value };
const caption: ColumnTransform = { afterRead: ({ value }) => value };
const tag: ColumnTransform = { beforeSave: ({ value }) => value };

const auditHooks: TableHooks = {
    beforeSave: ({ values }) => values,
    afterDelete: () => undefined
};

const users = defineAuthTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique()
    },
    rls: "admin-only",
    auth: {
        personalKeys: true,
        onCreateUser: async () => ({ values: {} }),
        onResetPassword: async () => ({})
    }
});

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull().transform(trim),
        secret: col.text().transform(mask),
        plain: col.text(),
        tags: col.array(col.text().transform(tag)),
        content: col.jsonb(json.object({
            seo: json.object({ title: json.string().transform(nestedTrim), untouched: json.string() }),
            blocks: json.array(json.oneOf({
                text: json.string(),
                image: json.object({ caption: json.string().transform(caption) })
            }))
        }))
    },
    relations: { author: rel.belongsTo(() => users) },
    rls: "inherit",
    hooks: auditHooks
});

const recent = defineView("recent_posts", {
    query: "SELECT id, title FROM posts",
    columns: { id: col.uuid().primaryKey(), title: col.text() },
    hooks: { afterRead: ({ values }) => values }
});

describe("compileSchema", () => {
    const defs = [users, posts, recent];
    const compiled = compileSchema(defs, { defaultRls: "admin-only" });

    it("returns exactly the descriptors compileTables returns, in order, each beside its definition", () => {
        expect(compiled.map(table => table.descriptor)).toEqual(compileTables(defs, { defaultRls: "admin-only" }));
        expect(compiled.map(table => table.def)).toEqual(defs);
        expect(compiled[1].def).toBe(posts);
    });

    it("carries the table's hooks, and nothing for a table without", () => {
        expect(compiled[1].hooks?.beforeSave).toBe(auditHooks.beforeSave);
        expect(compiled[1].hooks?.afterDelete).toBe(auditHooks.afterDelete);
        expect(compiled[0].hooks).toBeUndefined();
    });

    it("carries a view's read hooks", () => {
        expect(typeof compiled[2].hooks?.afterRead).toBe("function");
        expect(compiled[2].descriptor.kind).toBe("view");
    });

    it("carries defineAuthTable's lifecycle hooks, and none on any other table", () => {
        expect(typeof compiled[0].auth?.onCreateUser).toBe("function");
        expect(typeof compiled[0].auth?.onResetPassword).toBe("function");
        expect(compiled[1].auth).toBeUndefined();
    });

    it("addresses each field-level hook by column key and the path inside the value", () => {
        const transforms = compiled[1].transforms;
        expect(transforms?.title?.transform).toBe(trim);
        expect(transforms?.secret?.transform).toBe(mask);
        expect(transforms?.tags?.items?.transform).toBe(tag);
        expect(transforms?.content?.fields?.seo?.fields?.title?.transform).toBe(nestedTrim);
        expect(transforms?.content?.fields?.blocks?.items?.variants?.image?.fields?.caption?.transform).toBe(caption);
    });

    it("keeps only the branches that lead to a hook", () => {
        const transforms = compiled[1].transforms ?? {};
        expect(Object.keys(transforms).sort()).toEqual(["content", "secret", "tags", "title"]);
        expect(transforms.content?.transform).toBeUndefined();
        expect(Object.keys(transforms.content?.fields?.seo?.fields ?? {})).toEqual(["title"]);
        expect(Object.keys(transforms.content?.fields?.blocks?.items?.variants ?? {})).toEqual(["image"]);
        expect(compiled[0].transforms).toBeUndefined();
    });

    it("lists every hook with its full path, columns in physical order", () => {
        expect(listTransforms(compiled[1]).map(({ column, path, transform }) => ({ column, path, transform }))).toEqual([
            { column: "title", path: [], transform: trim },
            { column: "secret", path: [], transform: mask },
            { column: "tags", path: [{ items: true }], transform: tag },
            { column: "content", path: [{ field: "seo" }, { field: "title" }], transform: nestedTrim },
            {
                column: "content",
                path: [{ field: "blocks" }, { items: true }, { variant: "image" }, { field: "caption" }],
                transform: caption
            }
        ]);
        expect(listTransforms(compiled[0])).toEqual([]);
    });

    it("leaves the descriptor wire-safe: it only flags which hooks exist", () => {
        const descriptor = compiled[1].descriptor;
        expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
        expect(descriptor.columns.find(column => column.key === "title")?.transforms).toEqual({ beforeSave: true });
        expect(descriptor.hooks).toEqual({ beforeSave: true, afterDelete: true });
    });

    it("refuses what compileTables refuses, every problem at once", () => {
        const noKey = defineTable("no_key", { columns: { name: col.text() }, rls: "admin-only" });
        const inherits = defineTable("inherits", { columns: { id: col.serial().primaryKey() }, rls: "inherit" });
        let caught: unknown;
        try {
            compileSchema([noKey, inherits]);
        } catch (error) {
            caught = error;
        }
        expect(isSchemaDefinitionError(caught)).toBe(true);
        if (!isSchemaDefinitionError(caught)) return;
        expect(caught.problems.map(problem => problem.table).sort()).toEqual(["inherits", "no_key"]);
    });
});

describe("compileDescribedTables", () => {
    it("keeps each descriptor as given, beside a definition that states it", () => {
        const descriptors = compileTables([users, posts], { defaultRls: "admin-only" })
            .filter(descriptor => !descriptor.auth)
            .map(descriptor => ({
                ...descriptor,
                hooks: undefined,
                relations: [],
                columns: descriptor.columns.filter(column => !column.derived).map(column => ({ ...column, transforms: undefined })),
                rls: { posture: "rules" as const, rules: [], defaultPolicies: false }
            }));
        const compiled = compileDescribedTables(descriptors, { rls: () => "admin-only" });
        expect(compiled).toHaveLength(1);
        expect(compiled[0].descriptor).toBe(descriptors[0]);
        expect(compiled[0].def.name).toBe("posts");
        expect(compiled[0].hooks).toBeUndefined();
        expect(compiled[0].transforms).toBeUndefined();
    });
});
