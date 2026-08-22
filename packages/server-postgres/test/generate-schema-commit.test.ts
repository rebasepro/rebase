/**
 * Generating the commit a schema change has to write.
 *
 * The property worth proving is the one the plan names as the acceptance
 * criterion: **a database built from the commit matches the one the change
 * describes.** Expressed without a database, that is
 *
 *     plan(before) ∪ additiveStatements(before, after) === plan(after)
 *
 * as sets — everything the after-state needs is either already there or in the
 * delta, and the delta adds nothing the after-state does not want. A generator
 * that dropped a statement, or emitted one belonging to neither side, fails it.
 *
 * The rest is refusal behaviour, because a commit describing a schema the
 * ensure path will not produce is a commit that makes the repository lie about
 * the database.
 */
import type { CollectionConfig } from "@rebasepro/types";
import {
    generateSchemaCommit,
    additiveStatements,
    commitMessage,
    SchemaCommitError,
    DEFAULT_COMMIT_PATHS
} from "../src/schema/generate-schema-commit";
import { classifyCollectionChanges } from "../src/schema/classify-change";
import { planCollectionSchemaEnsure } from "../src/schema/ensure-collection-tables";

const collection = (slug: string, properties: Record<string, unknown> = {}): CollectionConfig =>
    ({
        slug,
        name: slug,
        properties: {
            id: { type: "string", name: "Id", isId: true },
            ...properties
        }
    }) as unknown as CollectionConfig;

const str = (over: Record<string, unknown> = {}) => ({ type: "string", name: "S", ...over });

const planOf = (collections: CollectionConfig[]) =>
    planCollectionSchemaEnsure(collections, { tables: new Map(), enums: new Set() }).statements;

describe("additiveStatements — the delta between two ensure plans", () => {
    it("a new collection brings its CREATE TABLE", () => {
        const statements = additiveStatements([], [collection("posts", { title: str() })]);
        expect(statements.some(s => /CREATE TABLE[\s\S]*posts/i.test(s))).toBe(true);
    });

    it("a new property brings only its ADD COLUMN, not the table again", () => {
        const statements = additiveStatements(
            [collection("posts", {})],
            [collection("posts", { subtitle: str() })]
        );
        expect(statements.some(s => /ADD COLUMN[\s\S]*subtitle/i.test(s))).toBe(true);
        expect(statements.some(s => /CREATE TABLE/i.test(s))).toBe(false);
    });

    it("is empty when nothing changed", () => {
        const same = [collection("posts", { title: str() })];
        expect(additiveStatements(same, same)).toEqual([]);
    });

    it("preserves the planner's dependency order", () => {
        const after = [collection("posts", { status: str({ enum: ["draft", "live"] }) })];
        const statements = additiveStatements([], after);
        const enumAt = statements.findIndex(s => /CREATE TYPE/i.test(s));
        const tableAt = statements.findIndex(s => /CREATE TABLE/i.test(s));
        // The column's type has to exist before the table that uses it.
        expect(enumAt).toBeGreaterThanOrEqual(0);
        expect(enumAt).toBeLessThan(tableAt);
    });

    describe("round trip: before ∪ delta === after", () => {
        const cases: Array<[string, CollectionConfig[], CollectionConfig[]]> = [
            ["a first collection", [], [collection("posts", { title: str() })]],
            ["a second collection", [collection("posts")], [collection("posts"), collection("tags")]],
            ["a new property", [collection("posts")], [collection("posts", { subtitle: str() })]],
            [
                "several properties at once",
                [collection("posts")],
                [collection("posts", { a: str(), b: str(), c: str() })]
            ],
            [
                "a property on one of two collections",
                [collection("posts"), collection("tags")],
                [collection("posts", { subtitle: str() }), collection("tags")]
            ],
            [
                "a collection carrying an enum",
                [collection("posts")],
                [collection("posts"), collection("orders", { status: str({ enum: ["new", "paid"] }) })]
            ]
        ];

        it.each(cases)("%s", (_label, before, after) => {
            const reached = new Set([...planOf(before), ...additiveStatements(before, after)]);
            const wanted = new Set(planOf(after));

            // Nothing the after-state needs is missing.
            for (const statement of wanted) expect(reached.has(statement)).toBe(true);
            // And the delta introduced nothing the after-state does not want.
            for (const statement of additiveStatements(before, after)) {
                expect(wanted.has(statement)).toBe(true);
            }
        });
    });
});

describe("generateSchemaCommit", () => {
    it("writes every generated artifact a deploy depends on", async () => {
        const commit = await generateSchemaCommit({
            before: [],
            after: [collection("posts", { title: str() })]
        });

        expect(commit.files.map(f => f.path).sort()).toEqual([
            DEFAULT_COMMIT_PATHS.ddlFile,
            DEFAULT_COMMIT_PATHS.policiesFile,
            DEFAULT_COMMIT_PATHS.schemaFile,
            DEFAULT_COMMIT_PATHS.searchFile
        ].sort());
    });

    it("generates the real artifacts, not placeholders", async () => {
        const commit = await generateSchemaCommit({
            before: [],
            after: [collection("posts", { title: str() })]
        });
        const ddl = commit.files.find(f => f.path === DEFAULT_COMMIT_PATHS.ddlFile)!;
        const schema = commit.files.find(f => f.path === DEFAULT_COMMIT_PATHS.schemaFile)!;

        expect(ddl.contents).toMatch(/CREATE TABLE[\s\S]*posts/i);
        expect(schema.contents).toContain("posts");
        expect(schema.contents.length).toBeGreaterThan(50);
    });

    it("carries the caller's source files through unchanged", async () => {
        const source = { path: "config/collections/posts.ts", contents: "export const posts = {};" };
        const commit = await generateSchemaCommit({
            before: [],
            after: [collection("posts")],
            sourceFiles: [source]
        });

        expect(commit.files[0]).toEqual(source);
        expect(commit.files).toHaveLength(5);
    });

    it("honours custom paths", async () => {
        const commit = await generateSchemaCommit({
            before: [],
            after: [collection("posts")],
            paths: { schemaFile: "src/generated/schema.ts" }
        });
        expect(commit.files.some(f => f.path === "src/generated/schema.ts")).toBe(true);
        // The unnamed ones keep their defaults.
        expect(commit.files.some(f => f.path === DEFAULT_COMMIT_PATHS.ddlFile)).toBe(true);
    });

    it("reports the statements alongside the files", async () => {
        const commit = await generateSchemaCommit({
            before: [collection("posts")],
            after: [collection("posts", { subtitle: str() })]
        });
        expect(commit.statements.some(s => /ADD COLUMN[\s\S]*subtitle/i.test(s))).toBe(true);
    });

    it("still writes the artifacts when the change needs no DDL", async () => {
        const same = [collection("posts", { title: str() })];
        const commit = await generateSchemaCommit({ before: same, after: same });
        expect(commit.statements).toEqual([]);
        expect(commit.files).toHaveLength(4);
    });
});

describe("refusing a change the ensure path will not produce", () => {
    const refuse = async (before: CollectionConfig[], after: CollectionConfig[]) => {
        await expect(generateSchemaCommit({ before, after })).rejects.toThrow(SchemaCommitError);
        return generateSchemaCommit({ before, after }).catch(err => err as SchemaCommitError);
    };

    it("refuses a removed property rather than committing a lie", async () => {
        const err = await refuse(
            [collection("posts", { subtitle: str() })],
            [collection("posts", {})]
        );
        expect(err.message).toContain("cannot be applied");
        expect(err.message).toContain("subtitle");
    });

    it("refuses a required property added to a live collection", async () => {
        const err = await refuse(
            [collection("posts", {})],
            [collection("posts", { subtitle: str({ validation: { required: true } }) })]
        );
        expect(err.message).toContain("NOT NULL");
    });

    it("puts the remedy in the message, not just the problem", async () => {
        const err = await refuse(
            [collection("posts", { title: str() })],
            [collection("posts", { title: { type: "number", name: "T" } })]
        );
        expect(err.message).toContain("migration");
    });

    it("carries the classification, so a caller can show which change was the problem", async () => {
        const err = await refuse([collection("posts")], []);
        expect(err.classified.verdict).toBe("needs-migration");
        expect(err.classified.changes[0].kind).toBe("remove-collection");
    });
});

describe("commitMessage", () => {
    const message = (before: CollectionConfig[], after: CollectionConfig[]) =>
        commitMessage(classifyCollectionChanges(before, after));

    it("names a single new collection", () => {
        expect(message([], [collection("posts")])).toContain("add the posts collection");
    });

    it("names a single new property and where it went", () => {
        expect(message([collection("posts")], [collection("posts", { subtitle: str() })]))
            .toContain("add subtitle to posts");
    });

    it("counts when there are several, and says which collection", () => {
        const subject = message(
            [collection("posts")],
            [collection("posts", { a: str(), b: str() })]
        );
        expect(subject).toContain("2 change(s) to posts");
    });

    it("counts collections when the change spans them", () => {
        expect(message([], [collection("posts"), collection("tags")]))
            .toContain("across 2 collections");
    });

    it("puts every change in the body, so the commit explains itself", () => {
        const body = message([collection("posts")], [collection("posts", { a: str(), b: str() })]);
        expect(body).toContain("- New optional property \"a\"");
        expect(body).toContain("- New optional property \"b\"");
    });

    it("says so when nothing changed", () => {
        expect(message([], [])).toBe("chore(schema): no change");
    });
});
