import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import { getGeneratedPolicyNames } from "@rebasepro/common";
import type { LegacyPostgresCollectionConfig } from "@rebasepro/common/migrate";

import { TableSourceEditor, TableSourceEditError } from "../src/api/table-source-editor";
import { SCHEMA_FILES, readSchemaFile, writeSchemaFixture } from "./helpers/schema-source-fixture";

/**
 * The schema editor over `backend/schema`: every edit writes text the printer
 * produced, at the place of what it replaces, and leaves everything else as
 * it was written.
 */

let fixture: ReturnType<typeof writeSchemaFixture>;
let editor: TableSourceEditor;

beforeEach(() => {
    fixture = writeSchemaFixture();
    editor = new TableSourceEditor(fixture.dir);
});

afterEach(() => fixture.cleanup());

/** The new text of one file of an edit. */
function fileOf(edit: { files: { path: string; contents: string }[] }, name: string): string {
    const found = edit.files.find(file => file.path === path.join(fixture.dir, name));
    if (!found) throw new Error(`${name} was not changed by the edit`);
    return found.contents;
}

/** The text with one line removed — what an edit of that line should leave the rest as. */
const withoutLine = (text: string, line: string): string => text.split("\n").filter(each => each !== line).join("\n");

async function refusalOf(work: Promise<unknown>): Promise<TableSourceEditError> {
    try {
        await work;
    } catch (error) {
        if (error instanceof TableSourceEditError) return error;
        throw error;
    }
    throw new Error("the edit was not refused");
}

describe("columns", () => {
    it("adds a column printed by printColumn, leaving every other byte of the file", async () => {
        const edit = await editor.preview([{
            op: "addColumn",
            table: "posts",
            key: "subtitle",
            column: { type: { kind: "varchar", length: 160 }, notNull: true },
            before: "status"
        }]);
        const text = fileOf(edit, "posts.ts");
        expect(text).toContain("        subtitle: col.varchar({ length: 160 }).notNull(),\n        status:");
        expect(withoutLine(text, "        subtitle: col.varchar({ length: 160 }).notNull(),")).toBe(SCHEMA_FILES["posts.ts"]);
        expect(edit.files).toHaveLength(1);
        expect(edit.schema.descriptors.find(d => d.slug === "posts")?.columns.map(c => c.key))
            .toEqual(["id", "title", "subtitle", "status", "authorId"]);
    });

    it("appends a column last when no position is given", async () => {
        const edit = await editor.preview([{ op: "addColumn", table: "tags", key: "color", column: { type: { kind: "text" } } }]);
        expect(fileOf(edit, "tags.ts")).toContain("        label: col.text().notNull(),\n        color: col.text()\n    },");
    });

    it("rewrites one column's chain and keeps the transform written on it", async () => {
        const edit = await editor.preview([{
            op: "changeColumn",
            table: "posts",
            key: "title",
            column: { type: { kind: "varchar", length: 200 }, notNull: true, validate: { min: 3 } }
        }]);
        const text = fileOf(edit, "posts.ts");
        expect(text).toContain(
            "        // The headline, trimmed before it is stored.\n" +
            "        title: col.varchar({ length: 200 }).notNull().validate({ min: 3 }).transform({ beforeSave: ({ value }) => value.trim() }),"
        );
        // The hooks and the other columns, as written.
        expect(text).toContain(SCHEMA_FILES["posts.ts"].slice(SCHEMA_FILES["posts.ts"].indexOf("        status:")));
    });

    it("removes and moves a column with its comment", async () => {
        const moved = await editor.preview([{ op: "moveColumn", table: "posts", key: "title" }]);
        expect(fileOf(moved, "posts.ts")).toContain(
            "        authorId: col.uuid(\"author_id\"),\n" +
            "        // The headline, trimmed before it is stored.\n" +
            "        title: col.text().notNull().transform({ beforeSave: ({ value }) => value.trim() })\n    },"
        );
        const removed = await editor.preview([{ op: "removeColumn", table: "tags", key: "label" }]);
        expect(fileOf(removed, "tags.ts")).toContain("        id: col.uuid().primaryKey().defaultRandom(),\n    },");
    });

    it("renames a column in place", async () => {
        const edit = await editor.preview([{
            op: "renameColumn", table: "tags", key: "label", to: "name",
            column: { type: { kind: "text" }, notNull: true, column: "label" }
        }]);
        expect(fileOf(edit, "tags.ts")).toContain("        name: col.text(\"label\").notNull()\n");
    });
});

describe("relations", () => {
    it("adds a relation and the import of its target", async () => {
        const edit = await editor.preview([{ op: "addRelation", table: "posts", name: "tags", relation: { kind: "manyToMany", target: "tags" } }]);
        const text = fileOf(edit, "posts.ts");
        expect(text).toContain("import { users } from \"./users\";\nimport { tags } from \"./tags\";\n");
        expect(text).toContain(
            "        author: rel.belongsTo(() => users, { localKey: \"author_id\" }),\n" +
            "        tags: rel.manyToMany(() => tags)\n    },"
        );
        expect(edit.schema.descriptors.find(d => d.slug === "posts")?.relations.map(r => r.name)).toEqual(["author", "tags"]);
    });

    it("removes a relation and the import nothing else uses", async () => {
        const edit = await editor.preview([{ op: "removeRelation", table: "users", name: "posts" }]);
        const text = fileOf(edit, "users.ts");
        expect(text).not.toContain("import { posts }");
        expect(text).not.toContain("rel.hasMany");
    });

    it("refuses a relation to a table that does not exist", async () => {
        const refused = await refusalOf(editor.preview([{ op: "addRelation", table: "posts", name: "x", relation: { kind: "belongsTo", target: "nope" } }]));
        expect(refused.code).toBe("SCHEMA_EDIT_REFUSED");
        expect(refused.message).toMatch(/"nope", which is not a table/);
    });
});

describe("rls", () => {
    const policyNames = (collections: LegacyPostgresCollectionConfig[]) =>
        [...getGeneratedPolicyNames(collections.find(collection => collection.slug === "posts")!)].sort();

    it("replaces one rule and leaves every other rule's text — and its policy's name — as it was", async () => {
        const before = await editor.compile(new Map(Object.entries(SCHEMA_FILES).map(([name, text]) => [path.join(fixture.dir, name), text])));
        const edit = await editor.preview([{ op: "replaceRule", table: "posts", index: 2, rule: { operation: "delete", roles: ["admin", "owner"] } }]);
        const text = fileOf(edit, "posts.ts");
        expect(text).toContain("        { operation: \"delete\", roles: [\"admin\", \"owner\"] }\n    ],");
        expect(withoutLine(withoutLine(text, "        { operation: \"delete\", roles: [\"admin\", \"owner\"] }"), ""))
            .toBe(withoutLine(withoutLine(SCHEMA_FILES["posts.ts"], "        { operation: \"delete\", roles: [\"admin\"] }"), ""));

        const namesBefore = policyNames(before.collections);
        const namesAfter = policyNames(edit.schema.collections);
        const changed = namesBefore.filter(name => !namesAfter.includes(name));
        // Only the delete rule's policy is renamed; select, insert and update keep theirs.
        expect(changed).toHaveLength(1);
        expect(changed[0]).toMatch(/delete/);
        expect(namesAfter.filter(name => !namesBefore.includes(name))).toHaveLength(1);
    });

    it("adds and removes a rule", async () => {
        const added = await editor.preview([{ op: "addRule", table: "posts", index: 0, rule: { operation: "select", ownerField: "authorId" } }]);
        expect(fileOf(added, "posts.ts")).toContain("    rls: [\n        { operation: \"select\", ownerField: \"authorId\" },\n        { operation: \"select\", access: \"public\"");
        const removed = await editor.preview([{ op: "removeRule", table: "posts", index: 1 }]);
        const text = fileOf(removed, "posts.ts");
        expect(text).not.toContain("Editors write.");
        expect(text).not.toContain("roles: [\"editor\"]");
    });

    it("sets a posture", async () => {
        const edit = await editor.preview([{ op: "setRls", table: "tags", rls: [{ operation: "select", access: "public" }] }]);
        expect(fileOf(edit, "tags.ts")).toContain("    rls: [\n        { operation: \"select\", access: \"public\" }\n    ]\n");
    });

    it("refuses to remove the last rule", async () => {
        const users = await refusalOf(editor.preview([{ op: "removeRule", table: "users", index: 0 }]));
        expect(users.message).toMatch(/not a list of rules/);
    });
});

describe("table-level keys", () => {
    it("sets, replaces and removes a key in its canonical place", async () => {
        const edit = await editor.preview([
            { op: "setOption", table: "posts", option: "description", value: "What the blog publishes." },
            { op: "setOption", table: "posts", option: "history", value: null },
            { op: "setOption", table: "tags", option: "history", value: true }
        ]);
        const posts = fileOf(edit, "posts.ts");
        expect(posts).toContain("export const posts = defineTable(\"posts\", {\n    description: \"What the blog publishes.\",\n    columns: {");
        expect(posts).not.toContain("history: true");
        expect(posts).toContain("    hooks: {\n        beforeSave: ({ values }) => {\n            // Never published without a title.");
        expect(fileOf(edit, "tags.ts")).toContain("    rls: \"admin-only\",\n    history: true\n});");
    });
});

describe("what the editor does not write", () => {
    it("reports a table whose config is spread as edited in code, and refuses to write it", async () => {
        const summaries = await editor.describe();
        expect(summaries.find(summary => summary.slug === "archived")?.editedInCode).toMatch(/spreads `shared`/);
        expect(summaries.find(summary => summary.slug === "posts")?.editedInCode).toBeUndefined();

        const refused = await refusalOf(editor.preview([{ op: "addColumn", table: "archived", key: "note", column: { type: { kind: "text" } } }]));
        expect(refused.code).toBe("SCHEMA_EDIT_REFUSED");
        expect(refused.message).toMatch(/edited in code: its config spreads `shared`/);
    });

    it("refuses a column built by a helper", async () => {
        const files = {
            ...SCHEMA_FILES,
            "tags.ts": SCHEMA_FILES["tags.ts"].replace("label: col.text().notNull()", "label: labelColumn()")
                .replace("export const tags", "const labelColumn = () => col.text().notNull();\n\nexport const tags")
        };
        fixture.cleanup();
        fixture = writeSchemaFixture(files);
        editor = new TableSourceEditor(fixture.dir);
        const refused = await refusalOf(editor.preview([{ op: "changeColumn", table: "tags", key: "label", column: { type: { kind: "text" } } }]));
        expect(refused.message).toMatch(/not a `col\.\*` chain/);
        expect((await editor.describe()).find(s => s.slug === "tags")?.columns.find(c => c.key === "label")?.editedInCode).toMatch(/labelColumn/);
    });

    it("refuses an edit whose result does not compile, and writes nothing", async () => {
        const refused = await refusalOf(editor.apply([{ op: "removeColumn", table: "tags", key: "id" }]));
        expect(refused.code).toBe("SCHEMA_EDIT_DOES_NOT_COMPILE");
        expect(refused.problems.some(problem => problem.table === "tags")).toBe(true);
        expect(readSchemaFile(fixture.dir, "tags.ts")).toBe(SCHEMA_FILES["tags.ts"]);
    });
});

describe("tables", () => {
    it("creates a table file and exports it from the index", async () => {
        const edit = await editor.apply([{
            op: "createTable",
            table: {
                name: "comments",
                columns: { id: { type: { kind: "uuid" }, primaryKey: true, default: { kind: "random-uuid" } }, body: { type: { kind: "text" }, notNull: true } },
                relations: { post: { kind: "belongsTo", target: "posts", onDelete: "cascade" } },
                rls: "admin-only"
            }
        }]);
        expect(readSchemaFile(fixture.dir, "comments.ts")).toBe([
            "import { defineTable, col, rel } from \"@rebasepro/server/schema\";",
            "import { posts } from \"./posts\";",
            "",
            "export const comments = defineTable(\"comments\", {",
            "    columns: {",
            "        id: col.uuid().primaryKey().defaultRandom(),",
            "        body: col.text().notNull()",
            "    },",
            "    relations: {",
            "        post: rel.belongsTo(() => posts, { onDelete: \"cascade\" })",
            "    },",
            "    rls: \"admin-only\"",
            "});",
            ""
        ].join("\n"));
        expect(readSchemaFile(fixture.dir, "index.ts")).toBe(SCHEMA_FILES["index.ts"].replace(
            "export { archived } from \"./archived\";",
            "export { archived } from \"./archived\";\nexport { comments } from \"./comments\";"
        ));
        expect(edit.schema.descriptors.map(d => d.slug)).toContain("comments");
    });

    it("deletes a table nothing points at: its file and its export", async () => {
        await editor.apply([{ op: "deleteTable", table: "tags" }]);
        expect(fs.existsSync(path.join(fixture.dir, "tags.ts"))).toBe(false);
        expect(readSchemaFile(fixture.dir, "index.ts")).toBe(withoutLine(SCHEMA_FILES["index.ts"], "export { tags } from \"./tags\";"));
    });

    it("refuses to delete a table another table's relation targets, naming it", async () => {
        const refused = await refusalOf(editor.preview([{ op: "deleteTable", table: "users" }]));
        expect(refused.message).toMatch(/relations target it: posts\.author/);
    });

    it("compiles a pair of tables that point at each other", async () => {
        const edit = await editor.preview([{ op: "addColumn", table: "users", key: "name", column: { type: { kind: "text" } } }]);
        const users = edit.schema.descriptors.find(d => d.slug === "users");
        expect(users?.relations.map(r => `${r.name}:${r.target}`)).toEqual(["posts:posts"]);
        expect(edit.schema.descriptors.find(d => d.slug === "posts")?.relations.map(r => `${r.name}:${r.target}`)).toEqual(["author:users"]);
    });
});

describe("writing", () => {
    it("refuses to write over a file changed since the preview", async () => {
        const edit = await editor.preview([{ op: "addColumn", table: "tags", key: "color", column: { type: { kind: "text" } } }]);
        fs.writeFileSync(path.join(fixture.dir, "tags.ts"), `${SCHEMA_FILES["tags.ts"]}// saved by the IDE\n`);
        const refused = await refusalOf(editor.write(edit));
        // A code of its own, which the editor's "Reload" keys on.
        expect(refused.code).toBe("SCHEMA_EDIT_STALE_FILE");
        expect(refused.message).toMatch(/changed since the edit was prepared/);
        expect(readSchemaFile(fixture.dir, "tags.ts")).toContain("saved by the IDE");
    });
});

describe("the Drizzle spelling", () => {
    it("reads a file written the Drizzle way, pgEnum columns included, and writes a column the same way", async () => {
        fs.writeFileSync(path.join(fixture.dir, "issues.ts"), [
            "import { defineTable, col, pgEnum, sql } from \"@rebasepro/server/schema\";",
            "",
            "const issueStatusEnum = pgEnum(\"issue_status\", [\"open\", \"closed\"]);",
            "",
            "export const issues = defineTable(\"issues\", {",
            "    columns: {",
            "        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),",
            "        status: issueStatusEnum().notNull().default(\"open\"),",
            "        code: col.text().notNull().default(sql`gen_short_id()`),",
            "        openedAt: col.timestamp({ withTimezone: true }).notNull().defaultNow()",
            "    },",
            "    rls: \"admin-only\"",
            "});",
            ""
        ].join("\n"));
        fs.appendFileSync(path.join(fixture.dir, "index.ts"), "export { issues } from \"./issues\";\n");
        const summary = await editor.describe();
        const issues = summary.find(table => table.slug === "issues");
        expect(issues?.columns.every(column => column.editedInCode === undefined)).toBe(true);

        const edit = await editor.preview([
            { op: "changeColumn", table: "issues", key: "status", column: { type: { kind: "enum", values: ["open", "closed"], name: "issue_status" } } },
            { op: "addColumn", table: "issues", key: "previous", column: { type: { kind: "enum", values: ["open", "closed"], name: "issue_status" } } },
            { op: "addColumn", table: "issues", key: "closedAt", column: { type: { kind: "timestamptz" }, default: { kind: "sql", expression: "now()" } } }
        ]);
        const text = fileOf(edit, "issues.ts");
        expect(text).toContain("        status: issueStatusEnum(),\n");
        expect(text).toContain("        previous: issueStatusEnum(),\n");
        expect(text).toContain("        closedAt: col.timestamp({ withTimezone: true }).defaultNow()\n");
        expect(text.match(/pgEnum\(/g)).toHaveLength(1);
    });

    it("declares a pgEnum above the table, and imports pgEnum and sql, when a column needs them", async () => {
        const edit = await editor.preview([
            { op: "addColumn", table: "tags", key: "kind", column: { type: { kind: "enum", values: ["a", "b"], name: "tag_kind" }, notNull: true } },
            { op: "addColumn", table: "tags", key: "slug", column: { type: { kind: "text" }, default: { kind: "sql", expression: "gen_short_id()" } } }
        ]);
        const text = fileOf(edit, "tags.ts");
        expect(text).toContain("const tagKindEnum = pgEnum(\"tag_kind\", [\"a\", \"b\"]);\n\nexport const tags = defineTable(");
        expect(text).toContain("        kind: tagKindEnum().notNull(),\n");
        expect(text).toContain("        slug: col.text().default(sql`gen_short_id()`)\n");
        expect(text).toMatch(/^import \{ defineTable, col, pgEnum, sql \} from/);
        expect(edit.schema.descriptors.find(d => d.slug === "tags")?.columns.find(c => c.key === "kind")).toBeDefined();
    });
});
