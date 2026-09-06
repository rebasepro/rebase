import { describe, it, expect } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ts from "typescript";

/**
 * What `defineCollection` says when you get it wrong.
 *
 * Every other test here asserts with `@ts-expect-error`, which proves an error
 * exists somewhere on that line and nothing about what the author reads. That
 * is not enough for this function, because its failure mode was never "no
 * error" — it was three overloads, one per engine, and TypeScript's rule for a
 * failed overload set: **one** diagnostic at the call site listing each
 * overload's *first* failure. A misspelled `validaton` on a Postgres collection
 * came back as three paragraphs pointing at `defineCollection(` and quoting
 * `MongoDBCollectionConfig` at an author who had named no such engine.
 *
 * So these assert on the diagnostics themselves: how many, which code, and that
 * the text names nothing the project did not mention. `cms-types` got the
 * single signature first; this is the same builder for a headless project, and
 * it is the one the `--headless` scaffold, `rebase schema introspect` output
 * and the example app's collections import.
 */

const BUILDERS = path.resolve(__dirname, "..", "src", "util", "builders");

interface Diagnostic {
    code: number;
    text: string;
    /** 1-based line within the snippet, so a test can say where it landed. */
    line: number;
}

function diagnose(snippet: string): Diagnostic[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-define-collection-"));
    const file = path.join(dir, "collection.ts");
    // A relative specifier rather than the package name: this compiles the
    // WORKSPACE source, so the test cannot pass against a stale build.
    const importPath = path.relative(dir, BUILDERS).split(path.sep).join("/");
    const header = `import { defineCollection } from "${importPath}";\n`;
    try {
        fs.writeFileSync(file, header + snippet, "utf-8");
        const program = ts.createProgram([file], {
            noEmit: true,
            strict: true,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            skipLibCheck: true
        });
        const source = program.getSourceFile(file)!;
        return [
            ...program.getSyntacticDiagnostics(source),
            ...program.getSemanticDiagnostics(source)
        ].map(d => ({
            code: d.code,
            text: ts.flattenDiagnosticMessageText(d.messageText, " "),
            // Minus the header line, so a snippet's own line 1 is line 1.
            line: source.getLineAndCharacterOfPosition(d.start ?? 0).line
        }));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const POSTS = `
export default defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", validation: { required: true } },
        views: { name: "Views", type: "number" }
    }
});
`;

describe("defineCollection from @rebasepro/common", () => {
    it("accepts a plain Postgres collection", () => {
        expect(diagnose(POSTS)).toEqual([]);
    });

    it("reports a misspelled property key once, at the key", () => {
        const diagnostics = diagnose(`
export default defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", validaton: { required: true } }
    }
});
`);

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].code).toBe(2322);
        // Line 7 of the snippet is the property, not line 2 (`defineCollection(`).
        expect(diagnostics[0].line).toBe(7);
    });

    it("never quotes an engine the collection did not name", () => {
        // The three-overload wall. `MongoDBCollectionConfig` and
        // `FirebaseCollectionConfig` appeared in the error for a Postgres
        // collection, and the author's first move was to go looking for the
        // MongoDB dependency they had never installed.
        for (const snippet of [
            `export default defineCollection({ slug: "posts", name: "Posts", properties: { title: { name: "T", type: "string", validaton: true } } });`,
            `export default defineCollection({ slug: "posts", name: "Posts", properties: { title: { name: "T", type: "string", multiline: true } } });`,
            `export default defineCollection({ slug: "posts", name: "Posts", properties: { c: { name: "C", type: "number", storage: { storagePath: "p/" } } } });`
        ]) {
            const text = diagnose(snippet).map(d => d.text).join("\n");
            expect(text).not.toContain("MongoDBCollectionConfig");
            expect(text).not.toContain("FirebaseCollectionConfig");
            expect(text).not.toContain("No overload matches this call");
        }
    });

    it("gates a property against the engine the collection declares", () => {
        // `vector` is Postgres-only. Under the overloads this was one of the
        // three "first failures"; now it is reported where it is written.
        const diagnostics = diagnose(`
export default defineCollection({
    name: "Docs",
    slug: "docs",
    engine: "mongodb",
    properties: {
        embedding: { name: "Embedding", type: "vector", dimensions: 3 }
    }
});
`);

        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics.map(d => d.text).join("\n")).not.toContain("No overload matches this call");
    });

    it("still infers the property keys after a bad property", () => {
        // A constraint TypeScript cannot satisfy is one it falls back from, and
        // the fallback widened every key that names a property to `string`, so
        // a collection with two mistakes reported one and revealed the second
        // only after the first was fixed — one per edit-compile cycle.
        const diagnostics = diagnose(`
export default defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", validaton: { required: true } },
        author: { name: "Author", type: "string" }
    },
    indexes: [{ name: "posts_autor_idx", on: ["autor"] }]
});
`);

        expect(diagnostics).toHaveLength(2);
        expect(diagnostics.map(d => d.line)).toEqual([7, 10]);
        // The index key still knows the collection's real property names.
        expect(diagnostics[1].text).toContain("Did you mean '\"author\"'");
    });
});
