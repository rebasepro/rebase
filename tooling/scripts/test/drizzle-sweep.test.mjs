/**
 * The Drizzle-alignment sweep's transformer (`tooling/scripts/drizzle-sweep.mts`):
 * one case per retired spelling in `drizzle-alignment-renames.json`, plus the
 * tricky ones — array item rules, enum reuse, an already-converted file, a chain
 * split across lines with comments, and the things it must refuse to guess.
 *
 * The semantic proof (old and new build the same column, the same compiled
 * table) is the tool's own `--verify`; this pins the text it writes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformMarkdown, transformSource } from "../drizzle-sweep.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HEADER = "import { defineTable, col } from \"@rebasepro/server/schema\";\n";

/** Convert one column expression inside a table and return the converted expression. */
function column(expression) {
    const source = `${HEADER}export const t = defineTable("t", { columns: { c: ${expression} }, rls: "admin-only" });\n`;
    const result = transformSource(source, "t.ts");
    assert.deepEqual(result.problems, []);
    const match = /columns: \{ c: (.*) \}, rls/s.exec(result.text);
    assert.ok(match, result.text);
    return { expression: match[1], text: result.text };
}

const CASES = [
    [".column(name)", "col.text().column(\"legacy_title\")", "col.text(\"legacy_title\")"],
    [".column(name) on an array", "col.array(col.text()).column(\"tag_list\")", "col.text(\"tag_list\").array()"],
    ["col.varchar(n)", "col.varchar(160)", "col.varchar({ length: 160 })"],
    ["col.varchar()", "col.varchar()", "col.varchar({ length: 255 })"],
    ["col.char(n)", "col.char(2)", "col.char({ length: 2 })"],
    ["col.char()", "col.char()", "col.char({ length: 255 })"],
    ["col.text().oneOf()", "col.text().oneOf([\"a\", \"b\"])", "col.text({ enum: [\"a\", \"b\"] })"],
    ["col.varchar(n).oneOf()", "col.varchar(20).notNull().oneOf([\"a\"])", "col.varchar({ length: 20, enum: [\"a\"] }).notNull()"],
    ["col.bigint()", "col.bigint()", "col.bigint({ mode: \"number\" })"],
    ["col.bigserial()", "col.bigserial()", "col.bigserial({ mode: \"number\" })"],
    ["col.numeric(p)", "col.numeric(5)", "col.numeric({ precision: 5 })"],
    ["col.numeric(p, s)", "col.numeric(10, 2)", "col.numeric({ precision: 10, scale: 2 })"],
    ["col.timestamptz()", "col.timestamptz().notNull()", "col.timestamp({ withTimezone: true }).notNull()"],
    ["col.vector(d)", "col.vector(3)", "col.vector({ dimensions: 3 })"],
    ["col.vector(d, { index })", "col.vector(1536, { index: false })", "col.vector({ dimensions: 1536, index: false })"],
    ["col.jsonb<T>()", "col.jsonb<{ a?: string }>()", "col.jsonb().$type<{ a?: string }>()"],
    ["col.json<T>()", "col.json<string[]>()", "col.json().$type<string[]>()"],
    ["col.array(inner)", "col.array(col.integer()).notNull().default([])", "col.integer().array().notNull().default([])"],
    ["col.custom(type)", "col.custom(\"inet\")", "col.custom({ dataType: \"inet\" })"],
    ["col.custom<T>(type)", "col.custom<number>(\"money\")", "col.custom({ dataType: \"money\" }).$type<number>()"],
    [".generatedAs(expr)", "col.text().generatedAs(\"lower(email)\")", "col.text().generatedAlwaysAs(sql`lower(email)`)"],
    [".identity()", "col.integer().primaryKey().identity()", "col.integer().primaryKey().generatedByDefaultAsIdentity()"],
    [".defaultSql(expr)", "col.text().defaultSql(\"gen_short_id()\")", "col.text().default(sql`gen_short_id()`)"],
    [".defaultSql(\"now()\") on a timestamp", "col.timestamptz().defaultSql(\"now()\")", "col.timestamp({ withTimezone: true }).defaultNow()"],
    [".defaultSql(\"now()\") off a temporal column", "col.text().defaultSql(\"now()\")", "col.text().default(sql`now()`)"],
    ["col.enum(values, {})", "col.enum([\"a\"], {})", "col.enum([\"a\"])"],
    ["col.enum(values).column(name)", "col.enum([\"a\", \"b\"]).column(\"kind\")", "col.enum(\"kind\", [\"a\", \"b\"])"]
];

for (const [name, before, after] of CASES) {
    test(`retired spelling ${name}`, () => {
        assert.equal(column(before).expression, after);
    });
}

test("a server stamp is never turned into .defaultNow()", () => {
    assert.equal(column("col.timestamptz().notNull().onCreateNow()").expression, "col.timestamp({ withTimezone: true }).notNull().onCreateNow()");
});

test("sql and pgEnum are added to the import that brings col", () => {
    const { text } = column("col.text().defaultSql(\"x()\")");
    assert.match(text, /^import \{ defineTable, col, sql \} from "@rebasepro\/server\/schema";/);
});

test("a multi-line import gets one name per line", () => {
    const source = "import {\n    defineTable,\n    col\n} from \"@rebasepro/types\";\nexport const t = defineTable(\"t\", { columns: { id: col.integer().identity() , s: col.text().defaultSql(\"x()\") }, rls: \"admin-only\" });\n";
    const { text } = transformSource(source, "t.ts");
    assert.match(text, /^import \{\n {4}defineTable,\n {4}col,\n {4}sql\n\} from "@rebasepro\/types";/);
});

test("the defaultSql text survives backslashes, backticks and ${", () => {
    assert.equal(column("col.text().defaultSql(\"a\\\\b `c` ${d}\")").expression, "col.text().default(sql`a\\\\b \\`c\\` \\${d}`)");
});

test("array item rules stay before .array(), column modifiers after it", () => {
    assert.equal(column("col.array(col.text().oneOf([\"admin\", \"editor\"]).userId()).notNull()").expression,
        "col.text({ enum: [\"admin\", \"editor\"] }).userId().array().notNull()");
    assert.equal(column("col.array(col.integer().validate({ min: 0 })).validate({ maxItems: 3 })").expression,
        "col.integer().validate({ min: 0 }).array().validate({ maxItems: 3 })");
});

test("a column modifier on an array item is reported, not guessed", () => {
    const source = `${HEADER}export const t = defineTable("t", { columns: { c: col.array(col.text().notNull()) }, rls: "admin-only" });\n`;
    const result = transformSource(source, "t.ts");
    assert.equal(result.changed, false);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0].reason, /notNull/);
    assert.equal(result.problems[0].line, 2);
});

test("a named enum becomes one pgEnum declaration above the table, reused by every column of that name", () => {
    const source = `${HEADER}
/** Posts. */
export const posts = defineTable("posts", {
    columns: {
        status: col.enum(["draft", "published"], { name: "post_status" }).notNull().default("draft"),
        previous: col.enum(["draft", "published"], { name: "post_status" }),
        history: col.array(col.enum(["draft", "published"], { name: "post_status" }))
    },
    rls: "admin-only"
});
`;
    const { text, problems } = transformSource(source, "posts.ts");
    assert.deepEqual(problems, []);
    assert.equal(text.match(/pgEnum\("post_status"/g)?.length, 1);
    assert.match(text, /^import \{ defineTable, col, pgEnum \} from/);
    assert.match(text, /\nconst postStatusEnum = pgEnum\("post_status", \["draft", "published"\]\);\n\n\/\*\* Posts\. \*\/\nexport const posts/);
    assert.match(text, /status: postStatusEnum\(\)\.notNull\(\)\.default\("draft"\)/);
    assert.match(text, /previous: postStatusEnum\(\),/);
    assert.match(text, /history: postStatusEnum\(\)\.array\(\)/);
});

test("an existing pgEnum declaration of the same name is reused, other labels are reported", () => {
    const source = `import { defineTable, col, pgEnum } from "@rebasepro/server/schema";
export const kind = pgEnum("kind", ["a", "b"]);
export const t = defineTable("t", { columns: { k: col.enum(["a", "b"], { name: "kind" }), j: col.enum(["a", "c"], { name: "kind" }) }, rls: "admin-only" });
`;
    const { text, problems } = transformSource(source, "t.ts");
    assert.match(text, /k: kind\(\)/);
    assert.equal(problems.length, 1);
    assert.match(problems[0].reason, /other labels/);
});

test("a chain split across lines keeps its comments and layout", () => {
    const source = `${HEADER}export const t = defineTable("t", {
    columns: {
        legacy: col.text()
            // the name the old service used
            .column("legacy_ref")
            .notNull() // required
            .describe("x"),
    },
    rls: "admin-only"
});
`;
    const { text } = transformSource(source, "t.ts");
    assert.match(text, /legacy: col\.text\("legacy_ref"\)\n {12}\/\/ the name the old service used\n {12}\.notNull\(\) \/\/ required\n {12}\.describe\("x"\),/);
});

test("an already-converted file is left byte for byte", () => {
    const source = `import { defineTable, col, pgEnum, sql } from "@rebasepro/server/schema";
export const postStatus = pgEnum("post_status", ["draft", "published"]);
export const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        slug: col.varchar({ length: 160 }).notNull().unique(),
        status: postStatus().notNull().default("draft"),
        kind: col.text({ enum: ["news", "guide"] }),
        tags: col.text().array().notNull().default([]),
        views: col.bigint({ mode: "number" }).notNull().default(0),
        price: col.numeric({ precision: 10, scale: 2 }),
        embedding: col.vector({ dimensions: 1536, index: { method: "hnsw", metric: "cosine" } }),
        metadata: col.jsonb().$type<{ seoTitle?: string }>(),
        legacyRef: col.text("legacy_ref_code"),
        shortId: col.text().notNull().default(sql\`gen_short_id()\`),
        search: col.custom({ dataType: "tsvector" }).generatedAlwaysAs(sql\`to_tsvector('english', title)\`),
        ip: col.custom("ip", { dataType: "inet" }),
        createdAt: col.timestamp({ withTimezone: true }).notNull().defaultNow(),
        score: col.integer().oneOf([1, 2, 3])
    },
    rls: [{ operation: "select", access: "public" }]
});
`;
    const result = transformSource(source, "posts.ts");
    assert.equal(result.changed, false);
    assert.deepEqual(result.problems, []);
});

test("converting twice is converting once", () => {
    const once = column("col.array(col.enum([\"a\"], { name: \"k\" })).column(\"ks\").notNull()").text;
    assert.equal(transformSource(once, "t.ts").changed, false);
});

test("a dynamic .defaultSql() argument is reported, not guessed", () => {
    const source = `${HEADER}const expr = "x()";\nexport const t = defineTable("t", { columns: { c: col.text().defaultSql(expr) }, rls: "admin-only" });\n`;
    const result = transformSource(source, "t.ts");
    assert.equal(result.changed, false);
    assert.match(result.problems[0].reason, /not a string literal/);
});

test("a .identity() outside a schema file is not touched", () => {
    const source = "export const id = matrix.identity();\n";
    assert.equal(transformSource(source, "m.ts").changed, false);
});

test("Markdown: only ts/tsx fences are converted, indentation kept", () => {
    const source = [
        "# Columns",
        "",
        "Write `col.timestamptz()` in prose — prose is not touched.",
        "",
        "```ts",
        "import { defineTable, col } from \"@rebasepro/server/schema\";",
        "const at = col.timestamptz().notNull();",
        "```",
        "",
        "- a list item:",
        "",
        "  ```tsx",
        "  const v = col.varchar(10);",
        "  ```",
        "",
        "```bash",
        "echo col.varchar(10)",
        "```",
        ""
    ].join("\n");
    const { text } = transformMarkdown(source, "doc.md");
    assert.match(text, /Write `col\.timestamptz\(\)` in prose/);
    assert.match(text, /const at = col\.timestamp\(\{ withTimezone: true \}\)\.notNull\(\);/);
    assert.match(text, /\n {2}const v = col\.varchar\(\{ length: 10 \}\);\n/);
    assert.match(text, /echo col\.varchar\(10\)/);
});

test("every retired spelling in the renames list has a case here", () => {
    const renames = JSON.parse(readFileSync(path.join(ROOT, "tooling/scripts/drizzle-alignment-renames.json"), "utf8"));
    assert.equal(renames.RETIRED_SPELLINGS.length, 20);
    const covered = CASES.map(([name]) => name).join("\n") + "\nnamed enum\n";
    const keyOf = old => old.replace(/\(.*$/s, "").replace(/^col\.<builder>…/, "").replace(/<T>$/, "");
    for (const entry of renames.RETIRED_SPELLINGS) {
        const key = entry.old.startsWith("col.enum(") ? "named enum" : keyOf(entry.old.replace("col.<builder>(…)", ""));
        assert.ok(covered.includes(key), `no case for ${entry.old}`);
    }
});
