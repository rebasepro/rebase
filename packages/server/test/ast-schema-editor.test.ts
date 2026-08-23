import { AstSchemaEditor } from "../src/api/ast-schema-editor";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import ts from "typescript";
import os from "node:os";

/**
 * `saveCollection` builds a ts-morph Project, which loads the TypeScript
 * compiler and resolves a tsconfig — seconds of work, not milliseconds, and all
 * of it charged to whichever test touches the editor first. Jest's 5s default
 * fits on an idle machine and not on a loaded one, so these suites failed
 * whenever they shared a machine with a build. The work is genuinely slow; the
 * timeout was the wrong number.
 */
jest.setTimeout(30_000);

describe("AstSchemaEditor", () => {
    let testDir: string;
    let editor: AstSchemaEditor;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), "ast-schema-editor-test-"));
        editor = new AstSchemaEditor(testDir);
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true,
force: true });
    });

    it("should merge properties while preserving existing functions when saving a collection", async () => {
        // Setup initial file
        const fileContent = `import { CollectionConfig } from "@rebasepro/types";

const productsCollection: CollectionConfig = {
    name: "Products",
    slug: "products",
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        category: {
            type: "reference",
            target: () => categoriesCollection
        }
    }
};

export default productsCollection;
`;
        fs.writeFileSync(path.join(testDir, "products.ts"), fileContent);

        // We want to update the collection data, simulating what the frontend sends
        const updatedData = {
            name: "Updated Products",
            slug: "products",
            properties: {
                id: { type: "string" },
                name: { type: "string",
description: "Product name" },
                category: {
                    type: "reference"
                    // Notice target is dropped since the frontend REST payload wouldn't have it serialized
                }
            }
        };

        await editor.saveCollection("products", updatedData);

        const newContent = fs.readFileSync(path.join(testDir, "products.ts"), "utf-8");
        expect(newContent).toContain('name: "Updated Products"');
        expect(newContent).toContain("target: () => categoriesCollection");
        expect(newContent).toContain('description: "Product name"');
    });

    it("should safely escape string values containing quotes and prevent code injection", async () => {
        // Setup initial file
        const fileContent = `import { CollectionConfig } from "@rebasepro/types";
const productsCollection: CollectionConfig = {
    name: "Products",
    slug: "products",
    properties: {}
};
export default productsCollection;
`;
        fs.writeFileSync(path.join(testDir, "products.ts"), fileContent);

        // Payload attempting breakout
        const maliciousData = {
            name: 'Products", description: "Injected description", breakout: "true',
            slug: "products",
            properties: {}
        };

        await editor.saveCollection("products", maliciousData);

        const newContent = fs.readFileSync(path.join(testDir, "products.ts"), "utf-8");
        // Verify that the quote was safely escaped and did not break out to create a new property
        expect(newContent).toContain('name: "Products\\", description: \\"Injected description\\", breakout: \\"true"');
    });
});

describe("a slug that is a legal filename and not a legal identifier", () => {
    /**
     * `sanitizeCollectionId` guards the FILENAME and permits hyphens and a
     * leading digit. The variable name was interpolated from the same string,
     * so creating `my-notes` from the admin panel — the documented slug shape —
     * wrote `const my-notesCollection`, the panel reported success, and the next
     * boot failed for EVERY collection in the directory, because the loader
     * imports all of them. The editor could not parse the file it had just
     * written either, so it could not fix itself.
     */
    const parsesCleanly = (source: string) => {
        const sf = ts.createSourceFile("c.ts", source, ts.ScriptTarget.ES2022, true);
        return ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length === 0;
    };

    const created = async (slug: string) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ast-varname-"));
        await new AstSchemaEditor(dir).saveCollection(slug, {
            name: slug, singularName: "Item", slug, properties: {}
        } as never);
        return fs.readFileSync(path.join(dir, `${slug}.ts`), "utf-8");
    };

    it.each(["my-notes", "2024_archive", "a-b-c", "1"])(
        "%s produces a file that parses", async (slug) => {
            expect(parsesCleanly(await created(slug))).toBe(true);
        });

    it("keeps an ordinary slug's variable name unchanged", async () => {
        // The no-op property: only slugs that produced a syntax error change.
        expect(await created("posts")).toContain("const postsCollection");
    });

    it("does not collapse two slugs that differ only by separator", async () => {
        // Dropping separators instead of camel-casing them would map both of
        // these onto `mynotesCollection`, and the default export would name a
        // variable from the wrong collection in a file that then compiles.
        expect(await created("my-notes")).toContain("const myNotesCollection");
        expect(await created("my_notes")).toContain("const myNotesCollection");
        expect(await created("mynotes")).toContain("const mynotesCollection");
    });

    it("exports the same name it declares", async () => {
        // The failure this would otherwise become: a file that parses and whose
        // default export is undefined.
        const source = await created("2024_archive");
        const declared = source.match(/const (\w+): CollectionConfig/)?.[1];
        expect(declared).toBeTruthy();
        expect(source).toContain(`export default ${declared};`);
    });
});
