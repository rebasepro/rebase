import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import path from "node:path";
import { Hono } from "hono";
import type { DatabaseAdmin, TableDescriptor, UnmappedTable } from "@rebasepro/types";

import { TableSourceEditor, TableSourceEditError } from "../src/api/table-source-editor";
import { createSchemaEditorRoutes } from "../src/api/schema-editor-routes";
import type { HonoEnv } from "../src/api/types";
import { readSchemaFile, writeSchemaFixture } from "./helpers/schema-source-fixture";

/**
 * "Import an existing table": the editor adopts a table the database has and
 * `backend/schema` does not declare, writing its source from the description
 * introspection serves — never a guess made in the browser.
 */

let fixture: ReturnType<typeof writeSchemaFixture>;
let editor: TableSourceEditor;

beforeEach(() => {
    fixture = writeSchemaFixture();
    editor = new TableSourceEditor(fixture.dir);
});

afterEach(() => fixture.cleanup());

/** A table as `describeUnmappedTables` describes it: uuid key, numeric, enum, a type Rebase does not create, a foreign key. */
const comments: TableDescriptor = {
    name: "comments", slug: "comments", table: "comments", schema: "public", kind: "table",
    columns: [
        { key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true, default: { kind: "random-uuid" } },
        { key: "body", column: "body", type: { kind: "text" }, nullable: false },
        { key: "score", column: "score", type: { kind: "numeric", precision: 10, scale: 2 }, nullable: true },
        { key: "mood", column: "mood", type: { kind: "enum", values: ["calm", "angry"], name: "comment_mood" }, nullable: false, default: { kind: "literal", value: "calm" } },
        { key: "span", column: "span", type: { kind: "other", sqlType: "tstzrange" }, nullable: true },
        { key: "post_id", column: "post_id", type: { kind: "uuid" }, nullable: true, foreignKeyOf: "post" }
    ],
    primaryKey: ["id"],
    relations: [{ name: "post", kind: "belongsTo", target: "posts", cardinality: "one", localKey: "post_id", localField: "post_id", onDelete: "cascade", index: true, constraint: true }],
    rls: { posture: "rules", rules: [{ name: "comments_read", operation: "select", access: "public" }], defaultPolicies: false }
};

describe("adopting a table", () => {
    it("writes its file from the description through the printer, and exports it", async () => {
        const edit = await editor.preview([{ op: "adoptTable", table: comments }]);
        const file = edit.files.find(each => each.path === path.join(fixture.dir, "comments.ts"))?.contents ?? "";
        expect(file).toContain("export const comments = defineTable(\"comments\"");
        expect(file).toMatch(/pgEnum\("comment_mood", \["calm", "angry"\]\)/);
        expect(file).toContain("col.custom({ dataType: \"tstzrange\" })");
        expect(file).toMatch(/rel\.belongsTo\(\(\) => posts/);
        expect(file).toContain("import { posts } from \"./posts\"");
        expect(edit.files.find(each => each.path === path.join(fixture.dir, "index.ts"))?.contents).toContain("export { comments } from \"./comments\"");

        // What it compiles to is the table as described.
        const adopted = edit.schema.descriptors.find(descriptor => descriptor.slug === "comments");
        expect(adopted?.columns.map(column => `${column.column}:${column.type.kind}`)).toEqual(
            ["id:uuid", "body:text", "score:numeric", "mood:enum", "span:other", "post_id:uuid"]
        );
        expect(adopted?.relations.map(relation => `${relation.name}:${relation.kind}:${relation.target}`)).toEqual(["post:belongsTo:posts"]);
        expect(adopted?.rls.rules.map(rule => rule.name)).toEqual(["comments_read"]);
    });

    it("takes the person's edits on top of it in the same list", async () => {
        const edit = await editor.preview([
            { op: "adoptTable", table: comments },
            { op: "setOption", table: "comments", option: "description", value: "Reader comments." }
        ]);
        expect(edit.schema.descriptors.find(descriptor => descriptor.slug === "comments")?.description).toBe("Reader comments.");
    });

    it("refuses a table backend/schema already declares, or a relation to a table it does not", async () => {
        const clash = await editor.preview([{ op: "adoptTable", table: { ...comments, name: "tags", slug: "tags", table: "tags" } }]).catch((error: unknown) => error);
        expect(clash).toBeInstanceOf(TableSourceEditError);
        const dangling = await editor.preview([{
            op: "adoptTable",
            table: { ...comments, relations: [{ ...comments.relations[0], target: "nowhere" }] }
        }]).catch((error: unknown) => error);
        expect(dangling).toBeInstanceOf(TableSourceEditError);
        expect(String(dangling)).toMatch(/nowhere/);
    });

    it("is written on apply", async () => {
        await editor.apply([{ op: "adoptTable", table: comments }]);
        expect(readSchemaFile(fixture.dir, "comments.ts")).toContain("defineTable(\"comments\"");
    });
});

describe("GET /unmapped-tables", () => {
    /** An admin that describes `comments` (pointing at the SQL table `posts`) and a keyless `audit`, and records what it was told is declared. */
    function routes(mappedSeen: string[][]) {
        const admin: DatabaseAdmin = {
            describeUnmappedTables: async (schema, mapped) => {
                mappedSeen.push([...mapped].sort());
                const tables: UnmappedTable[] = [
                    { schema, table: "comments", rlsEnabled: true, policies: 1, descriptor: comments, notes: [] },
                    { schema, table: "audit", rlsEnabled: false, policies: 0, notes: [], unimportable: "it has no primary key." }
                ];
                return tables;
            }
        };
        const app = new Hono<HonoEnv>();
        app.route("/", createSchemaEditorRoutes(editor, { getAdmin: () => admin }));
        return app;
    }

    it("lists the tables backend/schema does not declare, telling the driver which ones it does", async () => {
        const seen: string[][] = [];
        const res = await routes(seen).request("/unmapped-tables");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            tables: [
                { schema: "public", table: "comments", rlsEnabled: true, policies: 1 },
                { schema: "public", table: "audit", rlsEnabled: false, policies: 0, unimportable: "it has no primary key." }
            ]
        });
        expect(seen).toEqual([["archived", "posts", "tags", "users"]]);
    });

    it("serves one as its descriptor, each belongsTo naming its target by the declared table's slug", async () => {
        const res = await routes([]).request("/unmapped-tables/public/comments");
        expect(res.status).toBe(200);
        const body = await res.json() as { table: UnmappedTable };
        expect(body.table.descriptor?.columns.map(column => column.key)).toEqual(["id", "body", "score", "mood", "span", "post_id"]);
        expect(body.table.descriptor?.relations[0].target).toBe("posts");
    });

    it("answers 404 for a declared or missing table, and says why one cannot be imported", async () => {
        const app = routes([]);
        expect((await app.request("/unmapped-tables/public/posts")).status).toBe(404);
        const keyless = await app.request("/unmapped-tables/public/audit");
        expect(keyless.status).toBe(400);
        expect(await keyless.json()).toMatchObject({ error: { code: "SCHEMA_EDIT_REFUSED", message: expect.stringMatching(/no primary key/) } });
    });

    it("answers 503 over a driver that cannot describe its tables", async () => {
        const app = new Hono<HonoEnv>();
        app.route("/", createSchemaEditorRoutes(editor, { getAdmin: () => ({}) }));
        const res = await app.request("/unmapped-tables");
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ error: { code: "SCHEMA_EDITING_UNSUPPORTED" } });
    });
});
