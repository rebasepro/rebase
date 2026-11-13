import { describe, it, expect } from "@jest/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as ts from "typescript";
import { compileTables } from "@rebasepro/common";
import { col, defineTable, json, rel, type TableDescriptor } from "@rebasepro/types";
import { generateTypedefs, CodegenError } from "../src/generate-types";
import { rawTable } from "./helpers/tables";

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

function expectCompiles(tables: TableDescriptor[]): string {
    const source = generateTypedefs(tables);
    expect(compile(source)).toEqual([]);
    return source;
}

/** A key column every hand-written table below shares. */
const ID = { key: "id", column: "id", type: { kind: "uuid" as const }, nullable: false, primaryKey: true as const };

describe("the generated file compiles", () => {
    it("for a realistic schema with relations, enums, JSON documents and arrays", () => {
        const authors = defineTable("authors", {
            columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), name: col.text().notNull() },
            rls: "admin-only"
        });
        const tags = defineTable("tags", { columns: { id: col.uuid().primaryKey().defaultRandom() }, rls: "admin-only" });
        const posts = defineTable("posts", {
            columns: {
                id: col.uuid().primaryKey().defaultRandom(),
                title: col.text().notNull(),
                status: col.enum(["draft", "published"]),
                level: col.integer().oneOf([1, 2]),
                meta: col.jsonb(json.object({ views: json.number(), blocks: json.array(json.oneOf({ text: json.string() })) })),
                labels: col.text().array(),
                geo: col.geopoint(),
                createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow()
            },
            relations: {
                author: rel.belongsTo(() => authors, { notNull: true }),
                tags: rel.manyToMany(() => tags, { pivot: { position: col.integer() } })
            },
            rls: "admin-only"
        });
        expectCompiles(compileTables([posts, authors, tags]));
    });

    it("for column keys that are not identifiers", () => {
        // A column key is not required to be a JS identifier. Renaming it into
        // one described a field the wire does not serve; quoting keeps both the
        // real name and a file that compiles.
        const source = expectCompiles([rawTable("rows", [
            ID,
            { key: "user id", column: "user_id", type: { kind: "text" } },
            { key: "order", column: "order", type: { kind: "integer" } },
            { key: "créé_à", column: "cree_a", type: { kind: "timestamptz" } },
            { key: "my-field", column: "my_field_a", type: { kind: "text" } },
            { key: "my_field", column: "my_field_b", type: { kind: "integer" } }
        ])]);
        expect(source).toContain('"user id"?: string | null;');
        expect(source).toContain('"créé_à"?: string | null;');
        expect(source).toContain('"my-field"');
        expect(source).toContain("my_field?: number | null;");
    });

    it("for a slug that is not an identifier", () => {
        const source = expectCompiles([rawTable("my-notes", [ID])]);
        expect(source).toContain('myNotes: "my-notes",');
    });

    it("for a slug that begins with a digit", () => {
        // `2faCodes: {` is a syntax error in both the interface and the object
        // literal. Quoting it keeps the accessor reachable as `data["2faCodes"]`.
        const source = expectCompiles([rawTable("2fa_codes", [ID])]);
        expect(source).toContain('"2faCodes"');
    });

    it("for TypeScript keywords used as slugs and column keys", () => {
        expectCompiles([
            rawTable("default", [ID, { key: "class", column: "class" }, { key: "function", column: "function", type: { kind: "integer" } }]),
            rawTable("import", [ID, { key: "a", column: "a" }])
        ]);
    });

    it("when an enum value contains quotes, backslashes and newlines", () => {
        const source = expectCompiles([rawTable("posts", [
            ID,
            { key: "status", column: "status", type: { kind: "enum", values: ['a"b', "c\\d", "e\nf", "`${x}`"] } },
            { key: "kind", column: "kind", oneOf: ["a-1", 'b"2'] }
        ])]);
        expect(source).toContain('"a\\"b"');
        expect(source).toContain('"e\\nf"');
    });

    it("when a JSON field's key or a block's discriminator is not an identifier", () => {
        expectCompiles([rawTable("docs", [ID, {
            key: "body", column: "body", type: { kind: "jsonb" },
            json: {
                kind: "object",
                fields: {
                    "a-b": { kind: "string" },
                    'c"d': { kind: "array", of: { kind: "oneOf", typeField: "the type", valueField: "v-v", variants: { 'x"': { kind: "number" } } } }
                }
            }
        }])]);
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
    "Database", "TableName", "tablesDictionary", "TablesDictionary",
    "RelationsOf", "RelationKeys", "RelationTarget", "Prev",
    "IncludeOptionsFor", "IncludeFor", "IncludedKeys", "RowWith"
];

describe("untrusted input cannot inject TypeScript", () => {
    /**
     * `--from <url>` generates from a remote contract, so slugs, property names
     * and enum values are whatever that server said. They were interpolated
     * raw. A slug closing the string literal in `tablesDictionary`
     * produced a file that compiled *cleanly* and carried an attacker-authored
     * module-level initializer into the developer's bundle.
     *
     * The invariant is not "the payload text is absent" — escaped, it is still
     * there as inert string content. It is that untrusted input cannot add a
     * declaration to the file, and cannot stop it compiling.
     */
    const hostile = 'x"; }; }; };\nexport const OWNED = 1;\ninterface I { y: "';
    const target = rawTable("authors", [ID]);
    const cases: Array<[string, TableDescriptor[]]> = [
        ["a slug", [rawTable('posts", OWNED: globalThis, x: "', [ID])]],
        ["an enum value", [rawTable("posts", [ID, { key: "status", column: "status", type: { kind: "enum", values: [hostile] } }])]],
        ["a oneOf value", [rawTable("posts", [ID, { key: "status", column: "status", oneOf: [hostile] }])]],
        ["a column key", [rawTable("posts", [ID, { key: `a: string; }; }; };\nexport const OWNED = 1;\ninterface I { b`, column: "b" }])]],
        ["a JSON field key and variant", [rawTable("posts", [ID, {
            key: "doc", column: "doc", type: { kind: "jsonb" },
            json: { kind: "oneOf", typeField: hostile, valueField: hostile, variants: { [hostile]: { kind: "object", fields: { [hostile]: { kind: "string" } } } } }
        }])]],
        ["a relation's name and foreign key", [target, rawTable("posts", [
            ID,
            { key: hostile, column: "author_id", type: { kind: "uuid" }, foreignKeyOf: hostile }
        ], [{
            name: hostile, kind: "belongsTo", target: "authors", cardinality: "one",
            localKey: "author_id", localField: hostile, index: true, constraint: true
        }])]],
        ["a relation's target", [rawTable("posts", [ID], [{
            name: "tags", kind: "hasMany", target: hostile, cardinality: "many", foreignKey: "post_id"
        }])]]
    ];

    for (const [what, tables] of cases) {
        it(`through ${what}`, () => {
            const source = generateTypedefs(tables);
            expect(topLevelDeclarations(source)).toEqual(EXPECTED_DECLARATIONS);
            expect(compile(source)).toEqual([]);
        });
    }

    it("leaves a hostile slug intact as the wire value, merely escaped", () => {
        // The slug still has to reach `tablesDictionary` verbatim — it is
        // what the request path uses. Escaping is the fix; sanitising the value
        // would generate a client that asks for a collection that is not there.
        const slug = 'posts", OWNED: 1, x: "';
        const source = generateTypedefs([rawTable(slug, [ID])]);
        expect(source).toContain(`: ${JSON.stringify(slug)},`);
    });
});

describe("schemas that cannot be generated are rejected, not emitted", () => {
    it("refuses two slugs that produce the same accessor", () => {
        // The interface would not compile, and `tablesDictionary` — an
        // object literal — would silently keep only the last, sending one
        // table's reads to the other's.
        const clash = [rawTable("my-notes", [ID]), rawTable("my_notes", [ID])];
        expect(() => generateTypedefs(clash)).toThrow(CodegenError);
        expect(() => generateTypedefs(clash)).toThrow(/my-notes.*my_notes|my_notes.*my-notes/);
    });

    it("refuses a table with no slug", () => {
        expect(() => generateTypedefs([rawTable("", [ID])])).toThrow(CodegenError);
    });

    it("refuses a slug with nothing an accessor can be built from", () => {
        expect(() => generateTypedefs([rawTable("!!!", [ID])])).toThrow(CodegenError);
    });
});

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
    const authors = defineTable("authors", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
        rls: "admin-only"
    });
    const comments = defineTable("comments", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), body: col.text().notNull() },
        relations: { author: rel.belongsTo(() => authors) },
        rls: "admin-only"
    });
    const posts = defineTable("posts", {
        columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text().notNull() },
        relations: {
            author: rel.belongsTo(() => authors),
            comments: rel.hasMany(() => comments, { foreignKey: "post_id" })
        },
        rls: "admin-only"
    });

    const schema = () => generateTypedefs(compileTables([authors, comments, posts]));

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

/**
 * What a write may name, for each relation kind — asserted by compiling a
 * consumer, as the include types are, because whether a create compiles is the
 * whole question and a substring cannot answer it.
 *
 * The same seams are crossed against the real client in
 * `tests/e2e/baas-typecheck/src/typed-sdk/probes.ts`.
 */
describe("the generated write types, per relation kind", () => {
    const profiles = defineTable("profiles", { columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity() }, rls: "admin-only" });
    const authors = defineTable("authors", {
        columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), name: col.text().notNull() },
        relations: {
            profile: rel.hasOne(() => profiles, { foreignKey: "author_id" }),
            profileVia: rel.via(() => profiles, { cardinality: "one", steps: [{ table: "profiles", on: { from: "id", to: "author_id" } }] }),
            teamProfile: rel.via(() => profiles, {
                cardinality: "one",
                steps: [
                    { table: "teams", on: { from: "team_id", to: "id" } },
                    { table: "profiles", on: { from: "id", to: "team_id" } }
                ]
            }),
            commentsVia: rel.via(() => comments, {
                cardinality: "many",
                steps: [
                    { table: "authors_comments", on: { from: "id", to: "author_id" } },
                    { table: "comments", on: { from: "comment_id", to: "id" } }
                ]
            }),
            roleComments: rel.via(() => comments, {
                cardinality: "many",
                steps: [
                    { table: "author_roles", on: { from: "id", to: "author_id" } },
                    { table: "roles_comments", on: { from: "role_id", to: "role_id" } },
                    { table: "comments", on: { from: "comment_id", to: "id" } }
                ]
            })
        },
        rls: "admin-only"
    });
    const comments = defineTable("comments", {
        columns: { id: col.integer().primaryKey().generatedByDefaultAsIdentity(), body: col.text().notNull() },
        relations: {
            post: rel.belongsTo(() => posts, { localKey: "post_id", notNull: true }),
            author: rel.belongsTo(() => authors, { localKey: "author_id", notNull: true })
        },
        rls: "admin-only"
    });
    // The table model closes the foreign-key column, and the relation follows
    // it: `moderator`'s key is private, `reviewer`'s nobody may write.
    const posts = defineTable("posts", {
        columns: {
            id: col.uuid().primaryKey().defaultRandom(),
            title: col.text().notNull(),
            moderatorId: col.integer("moderator_id").private(),
            reviewerId: col.integer("reviewer_id").readOnly()
        },
        relations: {
            moderator: rel.belongsTo(() => authors, { localKey: "moderator_id" }),
            reviewer: rel.belongsTo(() => authors, { localKey: "reviewer_id" })
        },
        rls: "admin-only"
    });

    const schema = () => generateTypedefs(compileTables([authors, comments, posts, profiles]));

    it("satisfies a required belongsTo with either spelling, and with neither refuses", () => {
        // The server's required check reads both the foreign key and the
        // relation. Both used to be required keys, so only a create that named
        // the same row twice compiled.
        expect(compileWithConsumer(schema(), `
            import type { Database } from "./database.types";
            type Insert = Database["comments"]["Insert"];
            const byKey: Insert = { body: "b", postId: "p", authorId: 1 };
            const byRelation: Insert = { body: "b", post: "p", author: 1 };
            const mixed: Insert = { body: "b", postId: "p", author: 1 };
            const both: Insert = { body: "b", postId: "p", post: "p", authorId: 1 };
            // @ts-expect-error neither spelling of the post
            const noPost: Insert = { body: "b", authorId: 1 };
            // @ts-expect-error a required link cannot be null
            const nullPost: Insert = { body: "b", postId: null, authorId: 1 };
            // @ts-expect-error a post's id is a string
            const wrongType: Insert = { body: "b", post: 1, authorId: 1 };
            // Both names stay keys of the type.
            const keys: Array<keyof Insert> = ["postId", "post", "authorId", "author"];
            // An update may name neither.
            const update: Database["comments"]["Update"] = { body: "c" };
            export { byKey, byRelation, mixed, both, noPost, nullPost, wrongType, keys, update };
        `)).toEqual([]);
    });

    it("takes a closed foreign key's relation with it", () => {
        // A closed foreign key takes its relation with it: `moderatorId` is
        // stripped from every read and refused on every write, and so is
        // `moderator`; `reviewerId` is readable and refused on every write,
        // and `reviewer` is includable and refused on every write.
        expect(compileWithConsumer(schema(), `
            import type { Database, IncludeFor } from "./database.types";
            declare const row: Database["posts"]["Row"];
            const reviewer: number | null | undefined = row.reviewerId;
            // @ts-expect-error stripped from every read
            void row.moderatorId;
            // @ts-expect-error refused on a create
            const hidden: Database["posts"]["Insert"] = { title: "t", moderatorId: 1 };
            // @ts-expect-error refused on an update
            const closed: Database["posts"]["Update"] = { reviewerId: 1 };
            // @ts-expect-error nor under the relation's name
            const closedByName: Database["posts"]["Update"] = { reviewer: 1 };
            // @ts-expect-error a hidden relation cannot be included (UNKNOWN_RELATION)
            const include: IncludeFor<"posts"> = ["moderator"];
            const readable: IncludeFor<"posts"> = ["reviewer"];
            export { reviewer, hidden, closed, closedByName, include, readable };
        `)).toEqual([]);
    });

    it("writes a hasOne by naming the target row, and unlinks it with null", () => {
        // The server points the target's foreign key at this row
        // (`inverseRelationUpdates`); the resolved relation says
        // `writable: true`. Only belongsTo and the to-many kinds were emitted.
        expect(compileWithConsumer(schema(), `
            import type { Database } from "./database.types";
            const link: Database["authors"]["Update"] = { profile: 9 };
            const unlink: Database["authors"]["Update"] = { profile: null };
            const onCreate: Database["authors"]["Insert"] = { name: "a", profile: 9 };
            const optional: Database["authors"]["Insert"] = { name: "a" };
            // @ts-expect-error a profile's id is a number
            const wrongType: Database["authors"]["Update"] = { profile: "9" };
            export { link, unlink, onCreate, optional, wrongType };
        `)).toEqual([]);
    });

    it("writes a single-hop via as the server does, and leaves a multi-hop one read-only", () => {
        // To-one in one step: the target holds the key, written as a hasOne.
        // To-many through one junction: written as its rows. Anything longer
        // is refused with RELATION_NOT_WRITABLE, so it is on neither type.
        expect(compileWithConsumer(schema(), `
            import type { Database } from "./database.types";
            type Update = Database["authors"]["Update"];
            const toOne: Update = { profileVia: 9 };
            const unlink: Update = { profileVia: null };
            const toMany: Update = { commentsVia: [1, { id: 2 }] };
            // @ts-expect-error a multi-hop to-one via is read-only
            const multiOne: Update = { teamProfile: 9 };
            // @ts-expect-error a multi-hop to-many via is read-only
            const multiMany: Update = { roleComments: [1] };
            // @ts-expect-error a via declares no junction payload
            const pivot: Update = { commentsVia: [{ id: 1, _pivot: { position: 1 } }] };
            export { toOne, unlink, toMany, multiOne, multiMany, pivot };
        `)).toEqual([]);
    });
});
