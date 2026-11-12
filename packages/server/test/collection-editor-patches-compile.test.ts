/**
 * What the collection editor sends, against the real schema editor.
 *
 * `splitEdit` (in `@rebasepro/cms`) turns one save of the collection editor
 * into `TablePatch` operations. Its own suite checks each operation's shape;
 * this one hands them to `TableSourceEditor` over a real `backend/schema`
 * directory and checks that every edit the editor makes is one the server
 * applies and compiles, and that an untouched rule's text is untouched.
 *
 * The view model is built here the way the projector builds it, by hand, so
 * this suite does not load the panel's UI kit.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import type { AdminPostgresCollection } from "@rebasepro/cms-types";
import type { TableDescriptor } from "@rebasepro/types";

import { TableSourceEditor } from "../src/api/table-source-editor";
import { splitEdit } from "../../cms/src/collection_editor/split_edit";
import { readSchemaFile, writeSchemaFixture } from "./helpers/schema-source-fixture";

let fixture: ReturnType<typeof writeSchemaFixture>;
let editor: TableSourceEditor;
let posts: TableDescriptor;

/** `posts` as the panel's view model holds it (what `collectionFromTable` makes of the descriptor). */
const postsCollection = (): AdminPostgresCollection => ({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "string", columnType: "uuid", isId: "uuid", name: "Id" },
        title: { type: "string", columnType: "text", name: "Title", validation: { required: true } },
        status: {
            type: "string",
            name: "Status",
            enum: [{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }],
            defaultValue: "draft",
            validation: { required: true }
        }
    },
    securityRules: posts.rls.rules,
    history: true
});

beforeEach(async () => {
    fixture = writeSchemaFixture();
    editor = new TableSourceEditor(fixture.dir);
    // The descriptors the server serves, from the fixture as written.
    const described = await editor.preview([{ op: "setOption", table: "tags", option: "description", value: "Labels" }]);
    const found = described.schema.descriptors.find(d => d.slug === "posts");
    if (!found) throw new Error("the fixture serves no posts table");
    posts = found;
});

afterEach(() => fixture.cleanup());

describe("the collection editor's edits, applied by the schema editor", () => {
    it("adds a column and changes another; the transform on the changed column stays", async () => {
        const before = postsCollection();
        const after = postsCollection();
        after.properties.subtitle = { type: "string", columnType: "varchar", name: "Subtitle", validation: { max: 120 } };
        after.properties.status = {
            type: "string",
            name: "Status",
            enum: [{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }, { id: "archived", label: "Archived" }],
            defaultValue: "draft",
            validation: { required: true }
        };
        const { schema, presentation } = splitEdit({ before, after, table: posts });
        expect(schema.map(p => p.op)).toEqual(["changeColumn", "addColumn"]);
        expect(presentation).toEqual({ fields: { subtitle: { name: "Subtitle" } } });

        const edit = await editor.apply(schema);
        const text = readSchemaFile(fixture.dir, "posts.ts");
        expect(text).toContain("subtitle: col.varchar(120)");
        expect(text).toContain("\"archived\"");
        expect(text).toContain(".transform({ beforeSave: ({ value }) => value.trim() })");
        const served = edit.schema.descriptors.find(d => d.slug === "posts");
        expect(served?.columns.map(c => c.key)).toEqual(["id", "title", "status", "authorId", "subtitle"]);
    });

    it("edits one rule: the others keep their text, byte for byte", async () => {
        const before = postsCollection();
        const after = postsCollection();
        const rules = [...(after.securityRules ?? [])];
        rules[1] = { operations: ["insert", "update"], roles: ["editor", "reviewer"] };
        after.securityRules = rules;
        const { schema } = splitEdit({ before, after, table: posts });
        expect(schema).toEqual([{ op: "replaceRule", table: "posts", index: 1, rule: { operations: ["insert", "update"], roles: ["editor", "reviewer"] } }]);

        const original = readSchemaFile(fixture.dir, "posts.ts");
        await editor.apply(schema);
        const text = readSchemaFile(fixture.dir, "posts.ts");
        expect(text).toContain("{ operation: \"select\", access: \"public\", condition: { status: \"published\" } },");
        expect(text).toContain("{ operation: \"delete\", roles: [\"admin\"] }");
        expect(text).toContain("// Editors write.");
        expect(text).not.toBe(original);
    });

    it("creates a new table from the editor's form", async () => {
        const { schema } = splitEdit({
            after: {
                slug: "invoices",
                name: "Invoices",
                properties: {
                    number: { type: "number", columnType: "integer", name: "Number", validation: { required: true } },
                    paid: { type: "boolean", name: "Paid", defaultValue: false },
                    issuedOn: { type: "date", columnType: "date", name: "Issued on" }
                }
            }
        });
        const edit = await editor.apply(schema);
        const created = edit.schema.descriptors.find(d => d.slug === "invoices");
        expect(created?.columns.map(c => c.key)).toEqual(["id", "number", "paid", "issuedOn"]);
        expect(created?.primaryKey).toEqual(["id"]);
        expect(readSchemaFile(fixture.dir, "index.ts")).toContain("invoices");
    });

    it("turning history off and describing the table are table options", async () => {
        const before = postsCollection();
        const after = { ...postsCollection(), history: false, description: "What we publish" };
        const { schema } = splitEdit({ before, after, table: posts });
        const edit = await editor.apply(schema);
        const served = edit.schema.descriptors.find(d => d.slug === "posts");
        expect(served?.history).toBeFalsy();
        expect(served?.description).toBe("What we publish");
    });
});
