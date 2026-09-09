import {
    parseColumnMutations,
    findGeneratedColumnConflicts,
    partitionByOwnership,
    dropGeneratedColumnStatements,
    migrationDropPreamble,
    describeConflict,
    type GeneratedColumnDependency
} from "../src/schema/generated-column-conflicts";

/** The dependency rows `posts.search_vector` produces in the catalogue. */
const POSTS_SEARCH: GeneratedColumnDependency[] = ["title", "excerpt", "content"].map(dependsOn => ({
    schema: "public",
    table: "posts",
    column: "search_vector",
    dependsOn
}));

describe("parseColumnMutations", () => {
    it("reads every ALTER COLUMN … TYPE clause out of one statement", () => {
        // The exact shape Atlas emits, and the one that took `db push` down:
        // three clauses, one table, one statement.
        const plan = 'ALTER TABLE "public"."posts" ALTER COLUMN "title" TYPE text, '
            + 'ALTER COLUMN "slug" TYPE text, ALTER COLUMN "hero_image" TYPE text;';
        expect(parseColumnMutations(plan)).toEqual([
            { schema: "public", table: "posts", column: "title", kind: "type" },
            { schema: "public", table: "posts", column: "slug", kind: "type" },
            { schema: "public", table: "posts", column: "hero_image", kind: "type" }
        ]);
    });

    it("reads DROP COLUMN, which Postgres refuses for the same reason", () => {
        expect(parseColumnMutations('ALTER TABLE "public"."posts" DROP COLUMN "excerpt";')).toEqual([
            { schema: "public", table: "posts", column: "excerpt", kind: "drop" }
        ]);
    });

    it("reads DROP COLUMN IF EXISTS — the form the migration preamble writes", () => {
        expect(parseColumnMutations('ALTER TABLE "public"."posts" DROP COLUMN IF EXISTS "search_vector";'))
            .toEqual([{ schema: "public", table: "posts", column: "search_vector", kind: "drop" }]);
    });

    it("accepts SET DATA TYPE, unquoted identifiers and ONLY", () => {
        expect(parseColumnMutations("ALTER TABLE ONLY public.posts ALTER COLUMN title SET DATA TYPE text;"))
            .toEqual([{ schema: "public", table: "posts", column: "title", kind: "type" }]);
    });

    it("leaves the schema undefined when the plan did not qualify the table", () => {
        expect(parseColumnMutations('ALTER TABLE "posts" ALTER COLUMN "title" TYPE text;'))
            .toEqual([{ schema: undefined, table: "posts", column: "title", kind: "type" }]);
    });

    it("ignores clauses that are not a retype or a drop", () => {
        const plan = 'ALTER TABLE "public"."posts" ALTER COLUMN "title" SET NOT NULL, '
            + 'ALTER COLUMN "slug" SET DEFAULT \'x\', ADD COLUMN "note" text;';
        expect(parseColumnMutations(plan)).toEqual([]);
    });

    it("reads the plan Atlas actually prints, arrows and headings and all", () => {
        // `schema apply --dry-run` renders a plan, not a SQL file: every
        // statement is indented under a heading and prefixed with `-> `. An
        // anchored `^ALTER TABLE` matches none of it, and the failure mode is
        // silence — the exact bug this test exists to catch.
        const plan = [
            "       -- planned migration:",
            "",
            '         -- modify "posts" table',
            '           -> ALTER TABLE "public"."posts" ALTER COLUMN "title" TYPE text, ALTER COLUMN "slug" TYPE text;',
            "         -- ok (12µs)",
            "",
            "         -------------------------",
            "         -- 1 migration"
        ].join("\n");
        expect(parseColumnMutations(plan)).toEqual([
            { schema: "public", table: "posts", column: "title", kind: "type" },
            { schema: "public", table: "posts", column: "slug", kind: "type" }
        ]);
    });

    it("ignores statements that are not ALTER TABLE", () => {
        expect(parseColumnMutations('CREATE INDEX i ON "public"."posts" ("title");')).toEqual([]);
    });

    it("returns nothing for an empty plan", () => {
        expect(parseColumnMutations("")).toEqual([]);
    });
});

describe("findGeneratedColumnConflicts", () => {
    it("finds the generated column reading a retyped column", () => {
        const plan = 'ALTER TABLE "public"."posts" ALTER COLUMN "title" TYPE text;';
        expect(findGeneratedColumnConflicts(parseColumnMutations(plan), POSTS_SEARCH)).toEqual([
            {
                schema: "public",
                table: "posts",
                column: "search_vector",
                blocking: [{ column: "title", kind: "type" }]
            }
        ]);
    });

    it("reports one conflict per generated column, listing every column it reads", () => {
        const plan = 'ALTER TABLE "public"."posts" ALTER COLUMN "title" TYPE text, '
            + 'ALTER COLUMN "excerpt" TYPE text;';
        const conflicts = findGeneratedColumnConflicts(parseColumnMutations(plan), POSTS_SEARCH);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].blocking).toEqual([
            { column: "excerpt", kind: "type" },
            { column: "title", kind: "type" }
        ]);
    });

    it("does not flag a column the generated expression never reads", () => {
        const plan = 'ALTER TABLE "public"."posts" ALTER COLUMN "slug" TYPE text;';
        expect(findGeneratedColumnConflicts(parseColumnMutations(plan), POSTS_SEARCH)).toEqual([]);
    });

    it("does not flag another table with the same column name", () => {
        const plan = 'ALTER TABLE "public"."drafts" ALTER COLUMN "title" TYPE text;';
        expect(findGeneratedColumnConflicts(parseColumnMutations(plan), POSTS_SEARCH)).toEqual([]);
    });

    it("keeps schemas apart when the plan names one", () => {
        const plan = 'ALTER TABLE "archive"."posts" ALTER COLUMN "title" TYPE text;';
        expect(findGeneratedColumnConflicts(parseColumnMutations(plan), POSTS_SEARCH)).toEqual([]);
    });

    it("matches on table name alone when the plan named no schema", () => {
        // `search_path` decides at execution time and we cannot know it here.
        // Erring towards a rebuild costs seconds; erring the other way costs
        // the whole push.
        const plan = "ALTER TABLE posts ALTER COLUMN title TYPE text;";
        expect(findGeneratedColumnConflicts(parseColumnMutations(plan), POSTS_SEARCH)).toHaveLength(1);
    });

    it("is empty when the database has no generated columns at all", () => {
        const plan = 'ALTER TABLE "public"."posts" ALTER COLUMN "title" TYPE text;';
        expect(findGeneratedColumnConflicts(parseColumnMutations(plan), [])).toEqual([]);
    });
});

describe("partitionByOwnership", () => {
    const conflict = {
        schema: "public",
        table: "posts",
        column: "search_vector",
        blocking: [{ column: "title", kind: "type" as const }]
    };

    it("treats an excluded column as Rebase's, because that list is why it is hidden from Atlas", () => {
        const { managed, foreign } = partitionByOwnership(
            [conflict],
            ["public.posts.search_vector", "public.posts.posts_search_vector_gin"]
        );
        expect(managed).toEqual([conflict]);
        expect(foreign).toEqual([]);
    });

    it("treats anything else as somebody's hand-written column — there is no copy to rebuild from", () => {
        const { managed, foreign } = partitionByOwnership([conflict], []);
        expect(managed).toEqual([]);
        expect(foreign).toEqual([conflict]);
    });

    it("does not match an index pattern that merely shares the table", () => {
        const { foreign } = partitionByOwnership([conflict], ["public.posts.some_index"]);
        expect(foreign).toEqual([conflict]);
    });
});

describe("dropGeneratedColumnStatements", () => {
    it("quotes every part, so a reserved word or mixed case survives", () => {
        expect(dropGeneratedColumnStatements([
            { schema: "public", table: "posts", column: "search_vector", blocking: [] },
            { schema: "shop", table: "Order", column: "search_vector", blocking: [] }
        ])).toEqual([
            'ALTER TABLE "public"."posts" DROP COLUMN "search_vector";',
            'ALTER TABLE "shop"."Order" DROP COLUMN "search_vector";'
        ]);
    });

    it("emits nothing for no conflicts", () => {
        expect(dropGeneratedColumnStatements([])).toEqual([]);
    });
});

describe("migrationDropPreamble", () => {
    const conflict = {
        schema: "public",
        table: "posts",
        column: "search_vector",
        blocking: [{ column: "title", kind: "type" as const }]
    };

    it("drops IF EXISTS, because the migration runs against a database it cannot inspect", () => {
        // Fresh database: the table is created by this same migration and the
        // column is not there yet. Live database: it is. One file, both.
        const preamble = migrationDropPreamble([conflict]);
        expect(preamble).toContain('ALTER TABLE "public"."posts" DROP COLUMN IF EXISTS "search_vector";');
    });

    it("says which column forced it, so the migration explains itself", () => {
        expect(migrationDropPreamble([conflict])).toContain("public.posts.search_vector reads title (type)");
    });

    it("is empty when nothing conflicts, so an ordinary migration is untouched", () => {
        expect(migrationDropPreamble([])).toBe("");
    });

    it("comes out before the statements it unblocks", () => {
        const migration = 'ALTER TABLE "public"."posts" ALTER COLUMN "title" TYPE text;';
        const file = `${migrationDropPreamble([conflict])}\n${migration}`;
        expect(file.indexOf("DROP COLUMN IF EXISTS")).toBeLessThan(file.indexOf("ALTER COLUMN \"title\" TYPE"));
    });

    it("survives a round trip through the parser without flagging itself", () => {
        // The preamble is a DROP COLUMN, and the parser reads DROP COLUMN. If
        // it matched its own drop the migration would grow one every time.
        const conflicts = findGeneratedColumnConflicts(
            parseColumnMutations(migrationDropPreamble([conflict])),
            POSTS_SEARCH
        );
        expect(conflicts).toEqual([]);
    });
});

describe("describeConflict", () => {
    it("names a column the way every message here does", () => {
        expect(describeConflict({ schema: "public", table: "posts", column: "search_vector", blocking: [] }))
            .toBe("public.posts.search_vector");
    });
});
