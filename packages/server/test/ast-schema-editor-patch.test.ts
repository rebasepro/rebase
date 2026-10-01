/**
 * A panel save writes what the person changed, and nothing else.
 *
 * The editor used to write the whole collection the panel posted — JSON, which
 * cannot carry a handler, a shared property or an imported enum — so renaming a
 * collection deleted its entity actions' `onClick`, its computed fields'
 * `value`, inlined its shared `statusProperty` without the custom `Field` (and
 * left the import dead), froze a copy of `LOCALE_ENUM`, dropped every comment
 * inside the blocks it rewrote and reformatted the file. A save is now the
 * difference between what the editor loaded and what it saves
 * (`diffCollections`), and `applyPatch` writes only those keys.
 */
import { AstSchemaEditor } from "../src/api/ast-schema-editor";
import { diffCollections } from "@rebasepro/types";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import ts from "typescript";

jest.setTimeout(60_000);

const BOOKS = `import { defineCollection } from "@rebasepro/cms-types";
import { statusProperty } from "./shared";
import { LOCALE_ENUM } from "../locales";

// The catalogue. Edited from the panel and by hand.
const booksCollection = defineCollection({
    name: "Books",
    slug: "books",
    table: "books",
    properties: {
        title: { name: "Title", type: "string" }, // shown in lists
        status: statusProperty,
        locale: {
            name: "Locale",
            type: "string",
            enum: LOCALE_ENUM
        },
        author: {
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo", target: () => authorsCollection }
        }
    },
    admin: {
        icon: "Book",
        entityActions: [
            {
                key: "publish",
                name: "Publish",
                // Runs on the server.
                onClick: async ({ entity }) => { await publish(entity); }
            }
        ],
        additionalFields: [
            { key: "shout", name: "Shout", value: ({ entity }) => String(entity.values.title).toUpperCase() }
        ]
    }
});

export default booksCollection;
`;

const AUTHORS = `import { defineCollection } from "@rebasepro/cms-types";

const authorsCollection = defineCollection({
    name: "Authors",
    slug: "authors",
    table: "authors",
    properties: {
        name: { name: "Name", type: "string" }
    }
});

export default authorsCollection;
`;

/** What the panel holds for `books`: the same collection, through JSON. */
const loadedBooks = () => JSON.parse(JSON.stringify({
    name: "Books",
    slug: "books",
    table: "books",
    properties: {
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string", enum: [{ id: "draft", label: "Draft", color: "grayLight" }] },
        locale: { name: "Locale", type: "string", enum: [{ id: "en", label: "English" }, { id: "it", label: "Italian" }] },
        author: { name: "Author", type: "relation", relation: { kind: "belongsTo" } }
    },
    icon: "Book",
    admin: {
        icon: "Book",
        entityActions: [{ key: "publish", name: "Publish" }],
        additionalFields: [{ key: "shout", name: "Shout" }]
    }
})) as Record<string, any>;

/** Lines that differ between two texts, as `-old` / `+new`. */
function changedLines(before: string, after: string): string[] {
    const a = before.split("\n");
    const b = after.split("\n");
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }
    return [...a.slice(start, endA + 1).map(l => `-${l}`), ...b.slice(start, endB + 1).map(l => `+${l}`)];
}

function parses(text: string): boolean {
    const file = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return (file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length === 0;
}

describe("AstSchemaEditor.applyPatch", () => {
    let dir: string;
    let editor: AstSchemaEditor;
    const read = (name = "books") => fs.readFileSync(path.join(dir, `${name}.ts`), "utf8");

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "ast-patch-"));
        fs.writeFileSync(path.join(dir, "books.ts"), BOOKS);
        fs.writeFileSync(path.join(dir, "authors.ts"), AUTHORS);
        editor = new AstSchemaEditor(dir);
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("renaming a collection changes its name and nothing else — the auditor's reproduction", async () => {
        const loaded = loadedBooks();
        const patch = diffCollections(loaded, { ...loaded, name: "Books (renamed)" });

        await editor.applyPatch("books", patch);

        expect(changedLines(BOOKS, read())).toEqual([
            "-    name: \"Books\",",
            "+    name: \"Books (renamed)\","
        ]);
        expect(parses(read())).toBe(true);
    });

    it("an empty patch leaves the file byte-identical", async () => {
        await editor.applyPatch("books", diffCollections(loadedBooks(), loadedBooks()));
        expect(read()).toBe(BOOKS);
    });

    it("changes a presentation field inside `admin` without touching its siblings", async () => {
        const loaded = loadedBooks();
        await editor.applyPatch("books", diffCollections(loaded, { ...loaded, icon: "Library" }));
        expect(changedLines(BOOKS, read())).toEqual([
            "-        icon: \"Book\",",
            "+        icon: \"Library\","
        ]);
    });

    it("creates the `admin` keys a patch needs", async () => {
        await editor.applyPatch("books", [
            { op: "set", path: ["admin", "defaultFilter"], value: { status: ["==", "draft"] } },
            { op: "set", path: ["admin", "sort"], value: ["title", "asc"] }
        ]);
        const after = read();
        expect(after).toMatch(/defaultFilter: \{\n\s+status: \[\n?\s*"==",\s*"draft"/);
        expect(after).toContain("onClick: async ({ entity }) => { await publish(entity); }");
        expect(parses(after)).toBe(true);
    });

    it("adds a property, linking a relation picked by slug", async () => {
        const loaded = loadedBooks();
        const saving = JSON.parse(JSON.stringify(loaded));
        saving.properties.editor = { name: "Editor", type: "relation", relation: { kind: "belongsTo", target: "authors" } };
        await editor.applyPatch("books", diffCollections(loaded, saving));

        const after = read();
        expect(after).toMatch(/editor: \{[\s\S]*target: \(\) => authorsCollection/);
        expect(after).toContain("import authorsCollection from \"./authors.js\"");
        expect(after).toContain("status: statusProperty,");
        expect(parses(after)).toBe(true);
    });

    it("removes a property, and only that property", async () => {
        const loaded = loadedBooks();
        const saving = JSON.parse(JSON.stringify(loaded));
        delete saving.properties.locale;
        await editor.applyPatch("books", diffCollections(loaded, saving));

        const after = read();
        expect(after).not.toContain("locale:");
        expect(after).toContain("title: { name: \"Title\", type: \"string\" }, // shown in lists");
        expect(after).toContain("status: statusProperty");
        expect(parses(after)).toBe(true);
    });

    it("keeps each entity action's handler when the list of actions changes", async () => {
        const loaded = loadedBooks();
        const saving = JSON.parse(JSON.stringify(loaded));
        saving.admin.entityActions = [...saving.admin.entityActions, { key: "archive", name: "Archive" }];
        await editor.applyPatch("books", diffCollections(loaded, saving));

        const after = read();
        expect(after).toContain("onClick: async ({ entity }) => { await publish(entity); }");
        expect(after).toMatch(/key: "archive"/);
        expect(after).toContain("value: ({ entity }) => String(entity.values.title).toUpperCase()");
        expect(parses(after)).toBe(true);
    });

    it("refuses to edit inside a property shared from code, and names it", async () => {
        const loaded = loadedBooks();
        const saving = JSON.parse(JSON.stringify(loaded));
        saving.properties.status.name = "State";

        await expect(editor.applyPatch("books", diffCollections(loaded, saving)))
            .rejects.toThrow(/properties\.status.*statusProperty/);
        expect(read()).toBe(BOOKS);
    });

    it("refuses to overwrite an enum imported from code, and names it", async () => {
        const loaded = loadedBooks();
        const saving = JSON.parse(JSON.stringify(loaded));
        saving.properties.locale.enum.push({ id: "de", label: "German" });

        await expect(editor.applyPatch("books", diffCollections(loaded, saving)))
            .rejects.toThrow(/LOCALE_ENUM/);
        expect(read()).toBe(BOOKS);
    });

    it("lets a shared property be removed from the collection as a whole", async () => {
        await editor.applyPatch("books", [{ op: "remove", path: ["properties", "status"] }]);
        expect(read()).not.toContain("status: statusProperty");
    });

    it("refuses a key that comes from a spread rather than pretend to remove it", async () => {
        fs.writeFileSync(path.join(dir, "books.ts"), BOOKS.replace(
            "properties: {\n        title:",
            "properties: {\n        ...sharedProperties,\n        title:"
        ));
        await expect(editor.applyPatch("books", [{ op: "remove", path: ["properties", "isbn"] }]))
            .rejects.toThrow(/sharedProperties/);
    });

    it("refuses the runtime's resolved relation", async () => {
        await expect(editor.applyPatch("books", [
            { op: "set", path: ["properties", "author", "resolvedRelation"], value: { kind: "belongsTo" } }
        ])).rejects.toThrow(/resolvedRelation/);
        expect(read()).toBe(BOOKS);
    });

    it("does not leave half a patch behind when a later operation is refused", async () => {
        await expect(editor.applyPatch("books", [
            { op: "set", path: ["name"], value: "Renamed" },
            { op: "set", path: ["properties", "status", "name"], value: "State" }
        ])).rejects.toThrow();
        expect(read()).toBe(BOOKS);
        // And the next edit does not carry the refused one's first half.
        await editor.applyPatch("books", [{ op: "set", path: ["slug"], value: "books" }]);
        expect(read()).toContain("name: \"Books\",");
    });
});

/**
 * Every collection this repository ships, renamed through the patch path: the
 * file must differ from before in its `name` line alone and still parse. To see
 * this fail, have `applyPatch` format the whole file again.
 */
describe("a rename through the patch path, on every shipped collection", () => {
    const root = path.resolve(__dirname, "../../..");
    const sources = [
        path.join(root, "app/config/collections"),
        path.join(root, "packages/cli/templates/template/config/collections"),
        path.join(root, "packages/cli/templates/template/config/collections/presets/ecommerce")
    ];
    const files = sources.flatMap(dir => fs.readdirSync(dir)
        .filter(name => name.endsWith(".ts") && name !== "index.ts")
        .map(name => path.join(dir, name)));

    it.each(files.map(file => [path.relative(root, file), file]))("%s", async (_label, file) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ast-patch-shipped-"));
        try {
            const id = path.basename(file, ".ts");
            const before = fs.readFileSync(file, "utf8");
            fs.writeFileSync(path.join(dir, `${id}.ts`), before);
            const name = /\n {4}name: "([^"]*)"/.exec(before)?.[1];
            expect(name).toBeDefined();

            await new AstSchemaEditor(dir).applyPatch(id, [{ op: "set", path: ["name"], value: `${name} (renamed)` }]);

            const after = fs.readFileSync(path.join(dir, `${id}.ts`), "utf8");
            expect(changedLines(before, after)).toEqual([
                `-    name: "${name}",`,
                `+    name: "${name} (renamed)",`
            ]);
            expect(parses(after)).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("POST /schema-editor/collection/save with a patch", () => {
    it("writes the patch, the same way the live door does", async () => {
        const { createSchemaEditorRoutes } = await import("../src/api/schema-editor-routes");
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ast-patch-route-"));
        try {
            fs.writeFileSync(path.join(dir, "books.ts"), BOOKS);
            const app = createSchemaEditorRoutes(dir);
            const response = await app.request("/collection/save", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ collectionId: "books", patch: [{ op: "set", path: ["name"], value: "Renamed" }] })
            });
            expect(response.status).toBe(200);
            expect(changedLines(BOOKS, fs.readFileSync(path.join(dir, "books.ts"), "utf8"))).toEqual([
                "-    name: \"Books\",",
                "+    name: \"Renamed\","
            ]);

            const refused = await app.request("/collection/save", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ collectionId: "books", patch: [{ op: "set", path: ["properties", "status", "name"], value: "x" }] })
            });
            expect(refused.status).toBe(400);
            expect(await refused.text()).toMatch(/statusProperty/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
