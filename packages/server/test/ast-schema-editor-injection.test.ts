import { AstSchemaEditor } from "../src/api/ast-schema-editor";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

jest.setTimeout(30_000);

/**
 * The schema editor writes TypeScript, and `rebase dev` re-imports the file it
 * writes the moment it changes. So anything that reaches the file as SOURCE
 * rather than as data is code the server will run — which makes two places in
 * this editor the whole of its threat model:
 *
 *  - a top-level key, which ts-morph emits verbatim as a property name;
 *  - a relation's `target`, which has to be `() => otherCollection` and is
 *    therefore deliberately not quoted.
 */
describe("what the schema editor refuses to write as code", () => {
    let dir: string;
    let editor: AstSchemaEditor;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "ast-injection-"));
        editor = new AstSchemaEditor(dir);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const read = (slug: string) => fs.readFileSync(path.join(dir, `${slug}.ts`), "utf8");

    /**
     * An existing collection file, because the interesting paths are the UPDATE
     * ones: creating a file serializes the whole payload through the JSON
     * converter, which quotes; updating one adds and replaces individual
     * properties, and that is where the two unescaped sites were.
     */
    function seed(slug: string, varName: string, body: string): void {
        fs.writeFileSync(path.join(dir, `${slug}.ts`), `import type { CollectionConfig } from "@rebasepro/types";

const ${varName}: CollectionConfig = ${body};

export default ${varName};
`);
    }

    it("quotes a top-level key that would otherwise close the property and open an expression", async () => {
        const payload = "injected: (() => { throw new Error('rce') })(), tail";
        seed("posts", "postsCollection", `{
    name: "Posts",
    slug: "posts",
    properties: { id: { type: "string" } }
}`);

        await editor.saveCollection("posts", {
            name: "Posts",
            slug: "posts",
            properties: { id: { type: "string" } },
            [payload]: true
        } as never);

        const source = read("posts");
        // The dangerous shape is the key appearing bare. Quoted, it is a string
        // key with a boolean value and nothing executes.
        expect(source).not.toMatch(/^\s*injected:/m);
        expect(source).toContain(JSON.stringify(payload));
    });

    it("keeps writing an ordinary key unquoted", async () => {
        seed("posts", "postsCollection", `{
    name: "Posts",
    slug: "posts",
    properties: { id: { type: "string" } }
}`);
        await editor.saveCollection("posts", {
            name: "Posts",
            slug: "posts",
            singularName: "Post",
            properties: { id: { type: "string" } }
        } as never);

        expect(read("posts")).toMatch(/singularName: "Post"/);
    });

    /**
     * "Contains an arrow" was the test, and `() => { require(…) }` contains
     * one. Anything that is not an arrow returning a single identifier is
     * treated as a collection NAME instead — which is resolved against the
     * collections directory, so a payload cannot even be mistaken for one.
     */
    it("refuses a relation target that is an arrow with a body", async () => {
        seed("posts", "postsCollection", `{
    name: "Posts",
    slug: "posts",
    properties: { id: { type: "string" } },
    relations: []
}`);
        await expect(editor.saveCollection("posts", {
            name: "Posts",
            slug: "posts",
            properties: { id: { type: "string" } },
            relations: [{
                relationName: "author",
                kind: "belongsTo",
                target: "() => { require('child_process').execSync('id'); return x; }"
            }]
        } as never)).rejects.toThrow(/Invalid collection ID|Cannot link to collection/);

        expect(read("posts")).not.toContain("child_process");
    });

    it("refuses an immediately-invoked target", async () => {
        seed("posts", "postsCollection", `{
    name: "Posts",
    slug: "posts",
    properties: { id: { type: "string" } },
    relations: []
}`);
        await expect(editor.saveCollection("posts", {
            name: "Posts",
            slug: "posts",
            properties: { id: { type: "string" } },
            relations: [{
                relationName: "author",
                kind: "belongsTo",
                target: "(() => { throw new Error('rce') })()"
            }]
        } as never)).rejects.toThrow(/Invalid collection ID|Cannot link to collection/);
    });

    it("still accepts a target named by its slug, and the thunk it already wrote", async () => {
        seed("authors", "authorsCollection", `{
    name: "Authors",
    slug: "authors",
    properties: { id: { type: "string" } }
}`);
        seed("posts", "postsCollection", `{
    name: "Posts",
    slug: "posts",
    properties: { id: { type: "string" } },
    relations: []
}`);

        await editor.saveCollection("posts", {
            name: "Posts",
            slug: "posts",
            properties: { id: { type: "string" } },
            relations: [{ relationName: "author", kind: "belongsTo", target: "authors" }]
        } as never);

        const written = read("posts");
        expect(written).toMatch(/target: \(\) => authorsCollection/);

        // And re-saving the file the editor itself produced round-trips.
        await editor.saveCollection("posts", {
            name: "Posts",
            slug: "posts",
            properties: { id: { type: "string" } },
            relations: [{ relationName: "author", kind: "belongsTo", target: "() => authorsCollection" }]
        } as never);

        expect(read("posts")).toMatch(/target: \(\) => authorsCollection/);
    });
});
