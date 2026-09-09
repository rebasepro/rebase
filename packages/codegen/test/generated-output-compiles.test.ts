import { describe, it, expect } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ts from "typescript";
import { generateTypedefs, CodegenError } from "../src/generate-types";
import { CollectionConfig } from "@rebasepro/types";

/**
 * The generator writes TypeScript by concatenating strings, and every test
 * around it asserts on substrings — which cannot tell a valid file from a
 * broken one. Six separate defects shipped behind that gap: duplicate
 * identifiers from two slugs that safed to the same name, a slug starting with
 * a digit, an empty slug, two properties that collided, and quotes inside an
 * enum value closing the string literal early.
 *
 * So this compiles the output. It is the only test here that can fail for a
 * reason nobody thought of in advance.
 */
function compile(source: string): string[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-codegen-"));
    const file = path.join(dir, "database.types.ts");
    try {
        fs.writeFileSync(file, source, "utf-8");

        const program = ts.createProgram([file], {
            noEmit: true,
            strict: true,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            skipLibCheck: true,
            lib: ["lib.esnext.d.ts"]
        });

        const source0 = program.getSourceFile(file)!;
        return [
            ...program.getSyntacticDiagnostics(source0),
            ...program.getSemanticDiagnostics(source0)
        ].map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function expectCompiles(collections: unknown[]): string {
    const source = generateTypedefs(collections as CollectionConfig[]);
    expect(compile(source)).toEqual([]);
    return source;
}

describe("the generated file compiles", () => {
    it("for a realistic schema with relations, enums, maps and arrays", () => {
        const authors = {
            slug: "authors",
            properties: {
                id: { type: "number", isId: "increment" },
                name: { type: "string", validation: { required: true } }
            }
        };
        const posts = {
            slug: "posts",
            properties: {
                id: { type: "string", isId: "uuid" },
                title: { type: "string", validation: { required: true } },
                status: { type: "string", enum: ["draft", "published"] },
                meta: { type: "map", properties: { views: { type: "number" } } },
                tags: { type: "array", of: { type: "string" } },
                author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } }
            }
        };
        expectCompiles([posts, authors]);
    });

    it("for property names that are not identifiers", () => {
        // A column is not required to be a JS identifier. Renaming it into one
        // described a field the wire does not serve; quoting keeps both the
        // real name and a file that compiles.
        const source = expectCompiles([{
            slug: "rows",
            properties: {
                "user id": { type: "string" },
                "order": { type: "number" },
                "créé_à": { type: "date" }
            }
        }]);
        expect(source).toContain('"user id"?: string | null;');
        expect(source).toContain('"créé_à"?: string | null;');
    });

    it("for a slug that is not an identifier", () => {
        const source = expectCompiles([{ slug: "my-notes", properties: { a: { type: "string" } } }]);
        expect(source).toContain('myNotes: "my-notes",');
    });

    it("for a slug that begins with a digit", () => {
        // `2faCodes: {` is a syntax error in both the interface and the object
        // literal. Quoting it keeps the accessor reachable as `data["2faCodes"]`.
        const source = expectCompiles([{ slug: "2fa_codes", properties: { id: { type: "string", isId: true } } }]);
        expect(source).toContain('"2faCodes"');
    });

    it("for TypeScript keywords used as slugs and property names", () => {
        expectCompiles([
            { slug: "default", properties: { class: { type: "string" }, function: { type: "number" } } },
            { slug: "import", properties: { a: { type: "string" } } }
        ]);
    });

    it("for two properties that differ only by separator", () => {
        // `my-field` and `my_field` both camel-cased to `myField`, so the row
        // declared the same key twice with two different types.
        const source = expectCompiles([{
            slug: "posts",
            properties: {
                "my-field": { type: "string" },
                "my_field": { type: "number" }
            }
        }]);
        expect(source).toContain('"my-field"');
        expect(source).toContain("my_field");
    });

    it("when an enum value contains quotes, backslashes and newlines", () => {
        const source = expectCompiles([{
            slug: "posts",
            properties: {
                status: { type: "string", enum: ['a"b', "c\\d", "e\nf", "`${x}`"] }
            }
        }]);
        expect(source).toContain('"a\\"b"');
        expect(source).toContain('"e\\nf"');
    });

    it("when an enum is declared as an object whose keys contain quotes", () => {
        expectCompiles([{
            slug: "kinds",
            properties: { kind: { type: "string", enum: { "a-1": "A one", 'b"2': "B two" } } }
        }]);
    });
});

/**
 * Every top-level declaration the generated file introduces.
 *
 * Read off the AST rather than by substring, because an injected declaration
 * and an escaped string containing the same words look identical to `indexOf` —
 * and it is exactly the difference between the two that matters here.
 */
function topLevelDeclarations(source: string): string[] {
    const file = ts.createSourceFile("d.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    const names: string[] = [];
    for (const statement of file.statements) {
        if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
            names.push(statement.name.text);
        } else if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                names.push(declaration.name.getText(file));
            }
        } else {
            names.push(ts.SyntaxKind[statement.kind]);
        }
    }
    return names;
}

/**
 * Every top-level declaration the generated file is allowed to have.
 *
 * The guard is the *exact set*, not a subset: an injected slug that closes a
 * string literal produces a file which still compiles cleanly and carries an
 * attacker-authored module-level declaration into the bundle. So a new
 * declaration here has to be added deliberately, which is the point.
 *
 * The last eight are the `include` type machinery — see "the generated include
 * types" below. `Prev` and `IncludedKeys` are internal to it and unexported;
 * they are still declarations, so they are still listed.
 */
const EXPECTED_DECLARATIONS = [
    "Database", "CollectionName", "collectionsDictionary", "CollectionsDictionary",
    "RelationsOf", "RelationKeys", "RelationTarget", "Prev",
    "IncludeOptionsFor", "IncludeFor", "IncludedKeys", "RowWith"
];

describe("untrusted input cannot inject TypeScript", () => {
    /**
     * `--from <url>` generates from a remote contract, so slugs, property names
     * and enum values are whatever that server said. They were interpolated
     * raw. A slug closing the string literal in `collectionsDictionary`
     * produced a file that compiled *cleanly* and carried an attacker-authored
     * module-level initializer into the developer's bundle.
     *
     * The invariant is not "the payload text is absent" — escaped, it is still
     * there as inert string content. It is that untrusted input cannot add a
     * declaration to the file, and cannot stop it compiling.
     */
    const cases: Array<[string, unknown]> = [
        ["a slug", {
            slug: 'posts", OWNED: (globalThis as any).process?.env, x: "',
            properties: { title: { type: "string" } }
        }],
        ["an enum value", {
            slug: "posts",
            properties: {
                status: { type: "string", enum: ['a"; }; }; };\nexport const OWNED = 1;\ninterface I { x: "'] }
            }
        }],
        ["a property name", {
            slug: "posts",
            properties: { 'a: string; }; }; };\nexport const OWNED = 1;\ninterface I { b': { type: "string" } }
        }],
        ["a relation's foreign-key column", {
            slug: "posts",
            properties: { id: { type: "string", isId: "uuid" } },
            relations: [{
                kind: "belongsTo",
                relationName: "author",
                target: () => ({ slug: "authors", properties: { id: { type: "string", isId: "uuid" } } }),
                localKey: 'author_id?: string; }; }; };\nexport const OWNED = 1;\ninterface I { x'
            }]
        }]
    ];

    for (const [what, collection] of cases) {
        it(`through ${what}`, () => {
            const source = generateTypedefs([collection] as CollectionConfig[]);
            expect(topLevelDeclarations(source)).toEqual(EXPECTED_DECLARATIONS);
            expect(compile(source)).toEqual([]);
        });
    }

    it("leaves a hostile slug intact as the wire value, merely escaped", () => {
        // The slug still has to reach `collectionsDictionary` verbatim — it is
        // what the request path uses. Escaping is the fix; sanitising the value
        // would generate a client that asks for a collection that is not there.
        const slug = 'posts", OWNED: 1, x: "';
        const source = generateTypedefs([{ slug, properties: {} }] as unknown as CollectionConfig[]);
        expect(source).toContain(`: ${JSON.stringify(slug)},`);
    });
});

describe("schemas that cannot be generated are rejected, not emitted", () => {
    it("refuses two slugs that produce the same accessor", () => {
        // The interface would not compile, and `collectionsDictionary` — an
        // object literal — would silently keep only the last, sending one
        // collection's reads to the other's table.
        expect(() => generateTypedefs([
            { slug: "my-notes", properties: {} },
            { slug: "my_notes", properties: {} }
        ] as unknown as CollectionConfig[])).toThrow(CodegenError);

        expect(() => generateTypedefs([
            { slug: "my-notes", properties: {} },
            { slug: "my_notes", properties: {} }
        ] as unknown as CollectionConfig[])).toThrow(/my-notes.*my_notes|my_notes.*my-notes/);
    });

    it("refuses a collection with no slug", () => {
        expect(() => generateTypedefs([{ properties: {} }] as unknown as CollectionConfig[]))
            .toThrow(CodegenError);
        expect(() => generateTypedefs([{ slug: "", properties: {} }] as unknown as CollectionConfig[]))
            .toThrow(CodegenError);
    });

    it("refuses a slug with nothing an accessor can be built from", () => {
        expect(() => generateTypedefs([{ slug: "!!!", properties: {} }] as unknown as CollectionConfig[]))
            .toThrow(CodegenError);
    });
});

/**
 * `include`, typed against the relations a project actually declares.
 *
 * `IncludeSpec` in `@rebasepro/types` is deliberately unconstrained — a
 * hand-written row type has no relations in it to check against — so a typo in
 * an `include` was a runtime 400 (and, before that, a silently missing field).
 * The generated file is the one place the *graph* is known, so the narrowing
 * lives there: `IncludeFor<"posts">` refuses a name that is not a relation, at
 * every level, and `RowWith` makes an included relation non-optional.
 *
 * Asserted by compiling a *consumer* of the generated file rather than by
 * matching substrings: what matters is whether the wrong include is a compile
 * error, which no amount of string-matching can establish. Every
 * `@ts-expect-error` below is load-bearing in both directions — an unfired one
 * is itself an error, so these prove the refusals refuse *and* that everything
 * beside them still compiles.
 */
describe("the generated include types", () => {
    /** Compile the generated file together with a snippet that uses it. */
    function compileWithConsumer(source: string, consumer: string): string[] {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-codegen-include-"));
        const dbFile = path.join(dir, "database.types.ts");
        const useFile = path.join(dir, "use.ts");
        try {
            fs.writeFileSync(dbFile, source, "utf-8");
            fs.writeFileSync(useFile, consumer, "utf-8");
            const program = ts.createProgram([dbFile, useFile], {
                noEmit: true,
                strict: true,
                target: ts.ScriptTarget.ESNext,
                module: ts.ModuleKind.ESNext,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                skipLibCheck: true,
                lib: ["lib.esnext.d.ts"]
            });
            return [dbFile, useFile].flatMap(f => {
                const sf = program.getSourceFile(f)!;
                return [
                    ...program.getSyntacticDiagnostics(sf),
                    ...program.getSemanticDiagnostics(sf)
                ].map(d => `${path.basename(f)} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
            });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    const authors: Record<string, unknown> = {
        slug: "authors",
        properties: {
            id: { type: "string", isId: "uuid" },
            name: { type: "string", validation: { required: true } }
        }
    };
    const comments: Record<string, unknown> = {
        slug: "comments",
        properties: {
            id: { type: "string", isId: "uuid" },
            body: { type: "string", validation: { required: true } },
            author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } }
        }
    };
    const posts: Record<string, unknown> = {
        slug: "posts",
        properties: {
            id: { type: "string", isId: "uuid" },
            title: { type: "string", validation: { required: true } },
            author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } },
            comments: {
                type: "relation",
                relation: { kind: "hasMany", target: () => comments, foreignKeyOnTarget: "post_id" }
            }
        }
    };

    const schema = () => generateTypedefs([authors, comments, posts] as unknown as CollectionConfig[]);

    it("names each relation's target collection", () => {
        // The graph, as accessor names rather than the target's `Row` — a
        // self-referencing relation is then a finite string instead of a type
        // that expands forever.
        const source = schema();
        expect(source).toContain("Relations: {");
        expect(source).toContain("author: \"authors\";");
        expect(source).toContain("comments: \"comments\";");
    });

    it("accepts every include the server accepts", () => {
        expect(compileWithConsumer(schema(), `
            import type { IncludeFor } from "./database.types";
            const flat: IncludeFor<"posts"> = ["author", "comments"];
            const wildcard: IncludeFor<"posts"> = ["*"];
            const tree: IncludeFor<"posts"> = { author: true };
            const parametrised: IncludeFor<"posts"> = { comments: { limit: 5, include: { author: true } } };
            export { flat, wildcard, tree, parametrised };
        `)).toEqual([]);
    });

    it("refuses a name that is not a relation, at every level", () => {
        expect(compileWithConsumer(schema(), `
            import type { IncludeFor } from "./database.types";
            // @ts-expect-error 'authr' is not a relation of 'posts'
            const typo: IncludeFor<"posts"> = ["authr"];
            // @ts-expect-error 'title' is a column, not a relation
            const column: IncludeFor<"posts"> = { title: true };
            // @ts-expect-error 'authr' is not a relation of 'comments'
            const nested: IncludeFor<"posts"> = { comments: { include: { authr: true } } };
            export { typo, column, nested };
        `)).toEqual([]);
    });

    it("makes an included relation present, and leaves the rest optional", () => {
        expect(compileWithConsumer(schema(), `
            import type { IncludeFor, RowWith } from "./database.types";
            declare function find<I extends IncludeFor<"posts">>(include: I): RowWith<"posts", I>;

            // Present: no '?.' after asking for it.
            const withAuthor = find(["author"] as const);
            const name: string = withAuthor.author.name;

            const withComments = find({ comments: true });
            const body: string = withComments.comments[0].body;

            // Not included, so still optional.
            // @ts-expect-error 'comments' may be absent on this read
            const bodies: string = find(["author"] as const).comments[0].body;

            // Columns are untouched either way.
            const title: string = withAuthor.title;
            export { name, body, bodies, title };
        `)).toEqual([]);
    });
});
