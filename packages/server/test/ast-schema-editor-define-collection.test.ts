import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { nestAdminPropertyKeys } from "@rebasepro/types";

import { AstSchemaEditor, nestAdminKeysDeep } from "../src/api/ast-schema-editor";
import { findCollectionConfigProblems } from "../src/collections/validate-config";

/**
 * The schema editor against the files `rebase init` actually writes.
 *
 * Every other fixture in this suite declares a collection as
 * `const x: CollectionConfig = { … }` — the shape `rebase introspect` emits. The
 * scaffold, and the idiom the docs recommend, is `defineCollection({ … })`: a
 * call expression. The editor could not open one, so on a stock project
 * `saveProperty` threw, `deleteProperty` reported success and did nothing, and
 * `saveCollection` recreated the file from the panel's JSON — losing the wrapper,
 * the imports, the callbacks and the relation thunks in one click. The whole
 * defect survived because no test wrote a fixture the way the product does.
 *
 * These fixtures are copies of `packages/cli/templates/template/config/collections`.
 */

jest.setTimeout(30_000);

const POSTS = `import { defineCollection } from "@rebasepro/cms-types";
import authorsCollection from "./authors.js";

const postsCollection = defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: {
            name: "Title",
            type: "string"
        },
        author: {
            name: "Author",
            type: "relation",
            relation: {
                kind: "belongsTo",
                target: () => authorsCollection,
                relationName: "author"
            }
        }
    },
    securityRules: [
        {
            operation: "select",
            ownerField: "author_id"
        }
    ],
    callbacks: {
        onPreSave: async (entity) => entity
    },
    admin: {
        icon: "Article",
        group: "Content",
        listProperties: ["title"]
    }
});

export default postsCollection;
`;

const AUTHORS = `import { defineCollection } from "@rebasepro/cms-types";

const authorsCollection = defineCollection({
    name: "Authors",
    slug: "authors",
    table: "authors",
    properties: {
        name: {
            name: "Name",
            type: "string"
        }
    }
});

export default authorsCollection;
`;

describe("AstSchemaEditor on a defineCollection() file", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ast-define-"));
        fs.writeFileSync(path.join(dir, "posts.ts"), POSTS);
        fs.writeFileSync(path.join(dir, "authors.ts"), AUTHORS);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const read = (slug: string) => fs.readFileSync(path.join(dir, `${slug}.ts`), "utf8");

    it("patches the collection in place instead of rewriting the file", async () => {
        const editor = new AstSchemaEditor(dir);
        await editor.saveCollection("posts", {
            name: "Blog posts",
            slug: "posts",
            table: "posts",
            properties: { title: { name: "Title", type: "string" } },
            securityRules: [{ operation: "select", ownerField: "author_id" }],
            icon: "Article"
        });

        const written = read("posts");
        expect(written).toContain('name: "Blog posts"');
        // Everything JSON cannot carry has to survive the write.
        expect(written).toContain("defineCollection({");
        expect(written).toContain('import authorsCollection from "./authors.js"');
        expect(written).toContain("onPreSave");
        expect(written).toContain("export default postsCollection");
    });

    it("saves a property", async () => {
        const editor = new AstSchemaEditor(dir);
        await editor.saveProperty("posts", "subtitle", { name: "Subtitle", type: "string" });

        const written = read("posts");
        expect(written).toContain("subtitle:");
        expect(written).toContain('name: "Subtitle"');
        expect(written).toContain("defineCollection({");
    });

    it("nests a flat property presentation key into the property's admin block", async () => {
        // The panel's property forms bind to the flat names. Written flat, `readOnly`
        // is not merely ignored: the boot validator treats a moved key as fatal.
        const editor = new AstSchemaEditor(dir);
        await editor.saveProperty("posts", "title", {
            name: "Title",
            type: "string",
            readOnly: true,
            hideFromCollection: true
        });

        const written = read("posts");
        expect(written).toMatch(/admin:\s*\{[^}]*readOnly: true/);
        expect(written).toMatch(/admin:\s*\{[^}]*hideFromCollection: true/);
        expect(written).not.toMatch(/^\s{12}readOnly: true/m);
    });

    it("deletes a property", async () => {
        const editor = new AstSchemaEditor(dir);
        await editor.deleteProperty("posts", "title");

        const written = read("posts");
        expect(written).not.toContain("title:");
        expect(written).toContain("author:");
    });

    it("refuses rather than overwriting a file whose collection it cannot find", async () => {
        const opaque = `import { somethingElse } from "./helpers.js";

const productsCollection = somethingElse({
    name: "Products",
    slug: "products"
});

export default productsCollection;
`;
        fs.writeFileSync(path.join(dir, "products.ts"), opaque);

        const editor = new AstSchemaEditor(dir);
        await expect(editor.saveCollection("products", { name: "Renamed", slug: "products" }))
            .rejects.toThrow(/Could not find the collection object/);
        expect(read("products")).toBe(opaque);
    });

    it("refuses a property delete it cannot perform instead of reporting success", async () => {
        fs.writeFileSync(path.join(dir, "products.ts"), `const productsCollection = 42;

export default productsCollection;
`);

        const editor = new AstSchemaEditor(dir);
        await expect(editor.deleteProperty("products", "title"))
            .rejects.toThrow(/Could not find the collection object/);
    });
});

describe("what the property editor writes, the boot validator accepts", () => {
    const collection = (title: Record<string, unknown>) => ({
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: { title }
    });

    const errors = (property: Record<string, unknown>) =>
        findCollectionConfigProblems([collection(property)], { unknownKeys: "warn" })
            .filter(p => p.severity === "error");

    it("accepts a property presentation key inside the block", () => {
        // `nestAdminPropertyKeys` is what `saveProperty` runs the payload through.
        expect(errors(nestAdminPropertyKeys({ name: "Title", type: "string", readOnly: true }))).toHaveLength(0);
    });

    it("still rejects the shapes the panel used to write", () => {
        // `ui` was renamed to `admin` in 0.11, and the validator treats the old
        // name as a removed key. The panel wrote `ui.readOnly` until this fix, so
        // ticking "Read only" left a project that would not boot.
        expect(errors({ name: "Title", type: "string", ui: { readOnly: true } })).not.toHaveLength(0);
        expect(errors({ name: "Title", type: "string", readOnly: true })).not.toHaveLength(0);
    });
});

/**
 * The other half of the same rule, for the other entry point.
 *
 * `saveProperty` nested a property's presentation keys; `saveCollection` nested
 * only the COLLECTION's, and passed `properties` through untouched. Creating a
 * collection is a `saveCollection` — so every collection the panel created from
 * a template wrote `markdown: true` at the top level of a property, which the
 * boot validator treats as fatal. One such file stops the whole project: the
 * loader imports every collection in the directory, so `rebase dev` reported
 * "Could not regenerate the database schema" and the backend never started.
 *
 * The assertion is deliberately the boot validator itself rather than a shape
 * check. The two had drifted apart once already; nothing but running one against
 * the other keeps them together.
 */
describe("what the collection editor writes, the boot validator accepts", () => {
    const errorsIn = (collection: Record<string, unknown>) =>
        findCollectionConfigProblems([nestAdminKeysDeep(collection)], { unknownKeys: "warn" })
            .filter(p => p.severity === "error");

    /** The shape of the panel's own "Products" template, before this fix. */
    const template = {
        slug: "products",
        name: "Products",
        table: "products",
        icon: "ShoppingCart",
        defaultSize: "l",
        properties: {
            description: { name: "Description", type: "string", markdown: true },
            tags: { name: "Tags", type: "array", of: { type: "string", previewAsTag: true } },
            metadata: {
                name: "Metadata",
                type: "map",
                properties: { note: { name: "Note", type: "string", multiline: true } }
            }
        }
    };

    it("nests a property's presentation, not just the collection's", () => {
        expect(errorsIn(template)).toHaveLength(0);
    });

    it("nests presentation inside a `oneOf` block", () => {
        // The blog and pages templates are built out of `oneOf` blocks, and the
        // walk did not know that container: `properties` and `of` were followed,
        // `oneOf.properties` was not. Every block in them kept its flat key.
        expect(errorsIn({
            slug: "blog",
            name: "Blog",
            table: "blog",
            properties: {
                content: {
                    name: "Content",
                    type: "array",
                    oneOf: {
                        typeField: "type",
                        valueField: "value",
                        propertiesOrder: ["text"],
                        properties: {
                            text: { name: "Text", type: "string", markdown: true }
                        }
                    }
                }
            }
        })).toHaveLength(0);
    });

    it("keeps the rest of the `oneOf` block", () => {
        const nested = nestAdminKeysDeep({
            slug: "blog",
            properties: {
                content: {
                    name: "Content",
                    type: "array",
                    oneOf: {
                        typeField: "kind",
                        valueField: "body",
                        propertiesOrder: ["text"],
                        properties: { text: { name: "Text", type: "string", markdown: true } }
                    }
                }
            }
        });
        const oneOf = (nested.properties as any).content.oneOf;
        expect(oneOf.typeField).toBe("kind");
        expect(oneOf.valueField).toBe("body");
        expect(oneOf.propertiesOrder).toEqual(["text"]);
        expect(oneOf.properties.text).toEqual({ name: "Text", type: "string", admin: { markdown: true } });
    });

    it("writes the nested shape to the file it creates", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ast-template-"));
        try {
            await new AstSchemaEditor(dir).saveCollection("products", template);
            const written = fs.readFileSync(path.join(dir, "products.ts"), "utf8");
            // Eight spaces is a property's own level; the key belongs one deeper,
            // inside its block.
            expect(written).not.toMatch(/^ {12}markdown:/m);
            expect(written).toMatch(/admin: \{\s*\n?\s*markdown: true/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("AstSchemaEditor partial saves", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ast-partial-"));
        fs.writeFileSync(path.join(dir, "posts.ts"), POSTS);
        fs.writeFileSync(path.join(dir, "authors.ts"), AUTHORS);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const read = () => fs.readFileSync(path.join(dir, "posts.ts"), "utf8");

    it("keeps securityRules that the patch does not mention", async () => {
        // Adding a column from the data table posts exactly this. Read as a
        // whole-collection save it deletes the rules, and the loader then hands
        // the collection the directory default — `access: "public"` in the scaffold.
        const editor = new AstSchemaEditor(dir);
        await editor.saveCollection("posts", { propertiesOrder: ["title", "author"] }, { partial: true });

        const written = read();
        expect(written).toContain("securityRules");
        expect(written).toContain('ownerField: "author_id"');
    });

    it("merges into the admin block instead of replacing it", async () => {
        const editor = new AstSchemaEditor(dir);
        await editor.saveCollection("posts", { propertiesOrder: ["title", "author"] }, { partial: true });

        const written = read();
        expect(written).toContain('icon: "Article"');
        expect(written).toContain('group: "Content"');
        expect(written).toContain("listProperties");
        expect(written).toContain("propertiesOrder");
        expect(written.match(/admin:/g)).toHaveLength(1);
    });

    it("still clears securityRules on a full save that omits them", async () => {
        // The delete-on-absent rule is right for a save that claims to be the
        // whole collection — clearing the rules in the panel has to reach the file.
        const editor = new AstSchemaEditor(dir);
        await editor.saveCollection("posts", {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: { title: { name: "Title", type: "string" } }
        });

        expect(read()).not.toContain("securityRules");
    });

    it("refuses a patch for a collection that has no file", async () => {
        const editor = new AstSchemaEditor(dir);
        await expect(editor.saveCollection("ghosts", { propertiesOrder: ["a"] }, { partial: true }))
            .rejects.toThrow(/no collection file yet/);
    });
});

describe("AstSchemaEditor relations", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ast-relations-"));
        fs.writeFileSync(path.join(dir, "authors.ts"), AUTHORS);
        fs.writeFileSync(path.join(dir, "comments.ts"), AUTHORS
            .replace(/authors/g, "comments")
            .replace(/Authors/g, "Comments"));
        fs.writeFileSync(path.join(dir, "posts.ts"), `import { defineCollection } from "@rebasepro/cms-types";
import commentsCollection from "./comments.js";

const postsCollection = defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: {
            name: "Title",
            type: "string"
        }
    },
    relations: [
        {
            relationName: "comments",
            kind: "hasMany",
            target: () => commentsCollection,
            foreignKeyOnTarget: "post_id"
        }
    ]
});

export default postsCollection;
`);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("writes a relation added in the panel, thunk and import included", async () => {
        // The Relations tab stores the target as a slug; the file wants a thunk.
        // An untouched relation arrives with no target at all — `JSON.stringify`
        // drops the function — so its thunk has to come from the file.
        const editor = new AstSchemaEditor(dir);
        await editor.saveCollection("posts", {
            name: "Posts",
            slug: "posts",
            table: "posts",
            properties: { title: { name: "Title", type: "string" } },
            relations: [
                { relationName: "comments", kind: "hasMany", foreignKeyOnTarget: "post_id" },
                { relationName: "author", kind: "belongsTo", target: "authors", localKey: "author_id" }
            ]
        });

        const written = fs.readFileSync(path.join(dir, "posts.ts"), "utf8");
        expect(written).toContain("target: () => commentsCollection");
        expect(written).toContain("target: () => authorsCollection");
        expect(written).toContain('import authorsCollection from "./authors.js"');
        expect(written).toContain('relationName: "author"');
    });

    it("refuses a relation with no target instead of writing a broken one", async () => {
        const editor = new AstSchemaEditor(dir);
        await expect(editor.saveCollection("posts", {
            slug: "posts",
            relations: [{ relationName: "unnamed", kind: "hasMany" }]
        })).rejects.toThrow(/has no target collection/);
    });
});
