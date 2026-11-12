import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import { TableSourceEditor } from "../src/api/table-source-editor";
import { SCHEMA_FILES, readSchemaFile, writeSchemaFixture } from "./helpers/schema-source-fixture";

/**
 * What the schema editor writes is data, printed — never text a request
 * carried — and one edit at a time, each against the files as they are on
 * disk when it starts.
 */

let fixture: ReturnType<typeof writeSchemaFixture>;
let editor: TableSourceEditor;

beforeEach(() => {
    fixture = writeSchemaFixture();
    editor = new TableSourceEditor(fixture.dir);
});

afterEach(() => fixture.cleanup());

describe("what a request cannot smuggle into the source", () => {
    it("quotes a column key that would otherwise close the property and open an expression", async () => {
        const key = "x: 1 }); process.exit(1); ({ y";
        const edit = await editor.preview([{ op: "addColumn", table: "tags", key, column: { type: { kind: "text" } } }]);
        const text = edit.files[0].contents;
        expect(text).toContain(`${JSON.stringify(key)}: col.text()`);
        expect(edit.schema.descriptors.find(d => d.slug === "tags")?.columns.map(c => c.key)).toContain(key);
    });

    it("escapes a string value, so a quote ends nothing", async () => {
        const description = "Tags\"); require(\"child_process\").execSync(\"touch pwned\"); (\"";
        const edit = await editor.preview([{ op: "setOption", table: "tags", option: "description", value: description }]);
        expect(edit.schema.descriptors.find(d => d.slug === "tags")?.description).toBe(description);
        expect(fs.existsSync(path.join(process.cwd(), "pwned"))).toBe(false);
    });

    it("writes a relation's target only as the table a slug names, never as code", async () => {
        const edit = await editor.preview([{
            op: "addRelation", table: "posts", name: "evil",
            relation: { kind: "belongsTo", target: "tags", localKey: "tag_id" }
        }]);
        expect(edit.files[0].contents).toContain("evil: rel.belongsTo(() => tags, { localKey: \"tag_id\" })");
        await expect(editor.preview([{
            op: "addRelation", table: "posts", name: "evil",
            relation: { kind: "belongsTo", target: "() => { require(\"child_process\") }" }
        }])).rejects.toThrow(/which is not a table in backend\/schema/);
    });
});

describe("edits through one editor", () => {
    it("run one at a time, in the order they arrived, a refused one included", async () => {
        const results = await Promise.allSettled([
            editor.apply([{ op: "addColumn", table: "tags", key: "a", column: { type: { kind: "text" } } }]),
            editor.apply([{ op: "removeColumn", table: "tags", key: "id" }]),
            editor.apply([{ op: "addColumn", table: "tags", key: "b", column: { type: { kind: "text" } } }])
        ]);
        expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
        const text = readSchemaFile(fixture.dir, "tags.ts");
        expect(text).toContain("        a: col.text(),\n        b: col.text()\n");
    });

    it("all land when many arrive at once", async () => {
        const keys = Array.from({ length: 6 }, (_, index) => `c${index}`);
        await Promise.all(keys.map(key => editor.apply([{ op: "addColumn", table: "tags", key, column: { type: { kind: "text" } } }])));
        const text = readSchemaFile(fixture.dir, "tags.ts");
        for (const key of keys) expect(text).toContain(`${key}: col.text()`);
    });

    it("read the disk at the start of each edit: a change made in the IDE between two is kept", async () => {
        await editor.apply([{ op: "addColumn", table: "tags", key: "a", column: { type: { kind: "text" } } }]);
        const edited = `// edited in the IDE\n${readSchemaFile(fixture.dir, "tags.ts")}`;
        fs.writeFileSync(path.join(fixture.dir, "tags.ts"), edited);
        await editor.apply([{ op: "addColumn", table: "tags", key: "b", column: { type: { kind: "text" } } }]);
        const text = readSchemaFile(fixture.dir, "tags.ts");
        expect(text.startsWith("// edited in the IDE\n")).toBe(true);
        expect(text).toContain("b: col.text()");
    });

    it("see a table file created on disk after the editor was built", async () => {
        fs.writeFileSync(path.join(fixture.dir, "notes.ts"), SCHEMA_FILES["tags.ts"].replace(/tags/g, "notes"));
        fs.writeFileSync(path.join(fixture.dir, "index.ts"), `${SCHEMA_FILES["index.ts"]}export { notes } from "./notes";\n`);
        const edit = await editor.apply([{ op: "setOption", table: "notes", option: "history", value: true }]);
        expect(edit.files.map(file => path.basename(file.path))).toEqual(["notes.ts"]);
    });
});
