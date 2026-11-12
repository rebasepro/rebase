import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A `backend/schema` directory written the way the spec writes one, for the
 * schema editor's suites: comments, hooks and transforms that must survive an
 * edit, a pair of tables that point at each other, a table with a list of
 * rules, and one whose config is spread from a variable (read-only).
 */
export const SCHEMA_FILES: Record<string, string> = {
    "index.ts": [
        "// The tables this backend serves.",
        "export { users } from \"./users\";",
        "export { posts } from \"./posts\";",
        "export { tags } from \"./tags\";",
        "export { archived } from \"./archived\";",
        ""
    ].join("\n"),
    "users.ts": [
        "import { defineTable, col, rel } from \"@rebasepro/server/schema\";",
        "import { posts } from \"./posts\";",
        "",
        "export const users = defineTable(\"users\", {",
        "    columns: {",
        "        id: col.uuid().primaryKey().defaultRandom(),",
        "        email: col.text().notNull().unique()",
        "    },",
        "    relations: {",
        "        posts: rel.hasMany(() => posts, { foreignKey: \"author_id\" })",
        "    },",
        "    rls: \"admin-only\"",
        "});",
        ""
    ].join("\n"),
    "posts.ts": [
        "import { defineTable, col, rel } from \"@rebasepro/server/schema\";",
        "import { users } from \"./users\";",
        "",
        "/**",
        " * Blog posts. Kept exactly as written by every edit that does not touch it.",
        " */",
        "export const posts = defineTable(\"posts\", {",
        "    columns: {",
        "        id: col.uuid().primaryKey().defaultRandom(),",
        "        // The headline, trimmed before it is stored.",
        "        title: col.text().notNull().transform({ beforeSave: ({ value }) => value.trim() }),",
        "        status: col.enum([\"draft\", \"published\"]).notNull().default(\"draft\"),",
        "        authorId: col.uuid().column(\"author_id\")",
        "    },",
        "    relations: {",
        "        author: rel.belongsTo(() => users, { localKey: \"author_id\" })",
        "    },",
        "    rls: [",
        "        { operation: \"select\", access: \"public\", condition: { status: \"published\" } },",
        "        // Editors write.",
        "        { operations: [\"insert\", \"update\"], roles: [\"editor\"] },",
        "        { operation: \"delete\", roles: [\"admin\"] }",
        "    ],",
        "    history: true,",
        "    hooks: {",
        "        beforeSave: ({ values }) => {",
        "            // Never published without a title.",
        "            return values;",
        "        }",
        "    }",
        "});",
        ""
    ].join("\n"),
    "tags.ts": [
        "import { defineTable, col } from \"@rebasepro/server/schema\";",
        "",
        "export const tags = defineTable(\"tags\", {",
        "    columns: {",
        "        id: col.uuid().primaryKey().defaultRandom(),",
        "        label: col.text().notNull()",
        "    },",
        "    rls: \"admin-only\"",
        "});",
        ""
    ].join("\n"),
    "archived.ts": [
        "import { defineTable, col } from \"@rebasepro/server/schema\";",
        "",
        "const shared = {",
        "    columns: { id: col.uuid().primaryKey().defaultRandom() },",
        "    rls: \"admin-only\" as const",
        "};",
        "",
        "export const archived = defineTable(\"archived\", { ...shared });",
        ""
    ].join("\n")
};

/** A fresh schema directory holding {@link SCHEMA_FILES}, under a project root. */
export function writeSchemaFixture(files: Record<string, string> = SCHEMA_FILES): { root: string; dir: string; cleanup: () => void } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "table-source-editor-"));
    const dir = path.join(root, "backend", "schema");
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    return { root, dir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Read a file of the fixture. */
export const readSchemaFile = (dir: string, name: string): string => fs.readFileSync(path.join(dir, name), "utf8");
