import { describe, it, expect } from "@jest/globals";
import type { DatabaseAdmin } from "@rebasepro/types";
import { ApiError } from "@rebasepro/server";
import {
    classifyRows,
    columnDefinitionSql,
    diffCatalogs,
    diffDatabaseBranch,
    diffSchemaObjects,
    mergeDatabaseBranch,
    pickSamples,
    policySql,
    type Catalog,
    type RowState,
    type SchemaObjectFacts,
    type SchemaObjects,
    type TableFacts
} from "../src/branching/branch-diff";

/**
 * The parts of the branch diff that are decisions rather than SQL: who changed
 * a row, which rows are shown, how a change is written. The SQL itself runs in
 * `e2e/branch-diff-e2e.test.ts`, against a real branch.
 */

const row = (key: string, hash: string, young = false): RowState => ({ key, hash, young });

describe("classifyRows", () => {
    // What the target and the branch hold for each key, and whether each side
    // wrote its row after the branch was made.
    const target = [
        row("[1]", "a"),            // the branch updates it
        row("[2]", "b"),            // the branch deletes it
        row("[3]", "c2", true),     // the target updates it
        row("[4]", "d2", true),     // both update it
        row("[5]", "e"),            // nobody touches it
        row("[6]", "f", true)       // the target inserts it
    ];
    const branch = [
        row("[1]", "a2", true),
        row("[3]", "c"),
        row("[4]", "d3", true),
        row("[5]", "e"),
        row("[7]", "g", true),      // the branch inserts it
        row("[8]", "h")             // the target deleted it; the branch never touched it
    ];

    it("gives each difference its author when the fork point is known", () => {
        expect(classifyRows(target, branch, true)).toEqual({
            inserted: ["[7]"],
            updated: ["[1]"],
            deleted: ["[2]"],
            conflicts: ["[4]"],
            targetChanges: 3 // [3], [6], [8]
        });
    });

    it("counts every difference as the branch's when it is not", () => {
        expect(classifyRows(target, branch, false)).toEqual({
            inserted: ["[7]", "[8]"],
            updated: ["[1]", "[3]", "[4]"],
            deleted: ["[2]", "[6]"],
            conflicts: [],
            targetChanges: 0
        });
    });

    it("calls a difference neither side wrote since the fork a conflict, not a guess", () => {
        // An `ALTER DATABASE` on the branch moves its fork point later than the
        // copy: a row the target changed in between reads as old on both sides.
        expect(classifyRows([row("[1]", "x")], [row("[1]", "y")], true).conflicts).toEqual(["[1]"]);
    });
});

describe("pickSamples", () => {
    it("takes from each kind in turn up to the limit", () => {
        expect(pickSamples([["c1"], ["i1", "i2", "i3"], ["u1", "u2"], []], 4)).toEqual([["c1"], ["i1", "i2"], ["u1"], []]);
    });

    it("takes everything under the limit, and nothing at zero", () => {
        expect(pickSamples([["a"], ["b"]], 100)).toEqual([["a"], ["b"]]);
        expect(pickSamples([["a"], ["b"]], 0)).toEqual([[], []]);
    });
});

function table(overrides: Partial<TableFacts> & { table: string }): TableFacts {
    return {
        schema: "public",
        rls: false,
        forceRls: false,
        primaryKey: ["id"],
        policies: [],
        columns: [{ name: "id", type: "integer", notNull: true, defaultExpression: null, generated: "", identity: "a", sequence: null }],
        ...overrides
    };
}

const catalog = (...tables: TableFacts[]): Catalog => new Map(tables.map((facts) => [JSON.stringify([facts.schema, facts.table]), facts]));

describe("diffCatalogs", () => {
    it("reports tables, columns, primary keys, row-level security and policies", () => {
        const title = { name: "title", type: "text", notNull: false, defaultExpression: null, generated: "", identity: "", sequence: null };
        const read = { name: "read", permissive: "PERMISSIVE", roles: ["public"], command: "SELECT", using: "true", withCheck: null };
        const before = catalog(
            table({ table: "posts", columns: [...table({ table: "x" }).columns, title], policies: [read] }),
            table({ table: "old" })
        );
        const after = catalog(
            table({
                table: "posts",
                rls: true,
                columns: [...table({ table: "x" }).columns, { ...title, notNull: true }, { ...title, name: "body" }],
                policies: [{ ...read, using: "(owner = rebase.uid())" }, { ...read, name: "write", command: "INSERT", using: null, withCheck: "true" }]
            }),
            table({ table: "new", primaryKey: [] })
        );
        const changes = diffCatalogs(before, after).map((change) => `${change.change} ${change.object} ${change.table}${change.name ? `.${change.name}` : ""}`);
        expect(changes).toEqual([
            "added table new",
            "dropped table old",
            "altered column posts.title",
            "added column posts.body",
            "altered rls posts",
            "altered policy posts.read",
            "added policy posts.write"
        ]);
    });

    it("reports constraints, indexes and triggers, and the ones a new table brings", () => {
        const unique = { name: "posts_slug_key", definition: "UNIQUE (slug)" };
        const index = { name: "posts_title_idx", definition: "CREATE INDEX posts_title_idx ON public.posts USING btree (title)" };
        const before = catalog(table({ table: "posts", indexes: [index] }));
        const after = catalog(
            table({ table: "posts", constraints: [unique], triggers: [{ name: "touch", definition: "CREATE TRIGGER touch BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION touch()" }] }),
            table({ table: "tags", constraints: [{ name: "tags_label_check", definition: "CHECK ((label <> ''::text))" }] })
        );
        const changes = diffCatalogs(before, after);
        expect(changes.map((change) => `${change.change} ${change.object} ${change.table}${change.name ? `.${change.name}` : ""}`)).toEqual([
            "added constraint posts.posts_slug_key",
            "dropped index posts.posts_title_idx",
            "added trigger posts.touch",
            "added table tags",
            "added constraint tags.tags_label_check"
        ]);
        expect(changes[0].after).toBe("ALTER TABLE \"public\".\"posts\" ADD CONSTRAINT \"posts_slug_key\" UNIQUE (slug);");
    });

    it("reports enum labels, views and functions", () => {
        const objects = (...facts: SchemaObjectFacts[]): SchemaObjects => new Map(facts.map((item) => [JSON.stringify([item.object, item.schema, item.name]), item]));
        const before = objects(
            { object: "enum", schema: "public", name: "mood", definition: "CREATE TYPE \"public\".\"mood\" AS ENUM ('happy');" },
            { object: "function", schema: "public", name: "gone()", definition: "CREATE FUNCTION gone() …" }
        );
        const after = objects(
            { object: "enum", schema: "public", name: "mood", definition: "CREATE TYPE \"public\".\"mood\" AS ENUM ('happy', 'angry');" },
            { object: "view", schema: "public", name: "recent", definition: "CREATE VIEW \"public\".\"recent\" AS SELECT 1" }
        );
        expect(diffSchemaObjects(before, after).map((change) => `${change.change} ${change.object} ${change.table}`)).toEqual([
            "altered enum mood",
            "dropped function gone()",
            "added view recent"
        ]);
        expect(diffSchemaObjects(after, after)).toEqual([]);
    });

    it("says nothing about identical catalogues", () => {
        const same = table({ table: "t", policies: [{ name: "p", permissive: "PERMISSIVE", roles: ["app"], command: "ALL", using: "true", withCheck: null }] });
        expect(diffCatalogs(catalog(same), catalog({ ...same }))).toEqual([]);
    });
});

describe("the SQL a change is shown as", () => {
    it("declares a column the way CREATE TABLE would", () => {
        expect(columnDefinitionSql({ name: "id", type: "integer", notNull: true, defaultExpression: "nextval('t_id_seq'::regclass)", generated: "", identity: "", sequence: "public.t_id_seq" }))
            .toBe("\"id\" integer NOT NULL DEFAULT nextval('t_id_seq'::regclass)");
        expect(columnDefinitionSql({ name: "total", type: "numeric", notNull: false, defaultExpression: "(price * qty)", generated: "s", identity: "", sequence: null }))
            .toBe("\"total\" numeric GENERATED ALWAYS AS ((price * qty)) STORED");
    });

    it("writes a policy as CREATE POLICY, quoting every role but public", () => {
        expect(policySql("public", "posts", { name: "own", permissive: "RESTRICTIVE", roles: ["rebase_user", "public"], command: "UPDATE", using: "(a = b)", withCheck: "(c)" }))
            .toBe([
                "CREATE POLICY \"own\" ON \"public\".\"posts\"",
                "    AS RESTRICTIVE",
                "    FOR UPDATE",
                "    TO \"rebase_user\", public",
                "    USING ((a = b))",
                "    WITH CHECK ((c));"
            ].join("\n"));
    });
});

describe("refusals before any SQL runs", () => {
    const noSql: DatabaseAdmin = { listBranches: async () => [] };

    it("refuses a data source without SQL or branching, as 501", async () => {
        const error = await diffDatabaseBranch(noSql, "feature").catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ code: "BRANCH_DIFF_UNSUPPORTED", statusCode: 501 });
    });

    const admin: DatabaseAdmin = {
        executeSql: async () => { throw new Error("no SQL expected"); },
        createBranch: async () => { throw new Error("unused"); },
        deleteBranch: async () => undefined,
        listBranches: async () => [],
        getBranchInfo: async () => undefined
    };

    it("refuses a merge with no fingerprint, or an unknown conflict rule, as 400", async () => {
        await expect(mergeDatabaseBranch(admin, "feature", { expectedFingerprint: "" }))
            .rejects.toMatchObject({ code: "INVALID_INPUT", statusCode: 400 });
        await expect(mergeDatabaseBranch(admin, "feature", { expectedFingerprint: "f", onConflict: "ours" as "branch" }))
            .rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("refuses a negative sample limit", async () => {
        await expect(diffDatabaseBranch(admin, "feature", { sampleLimit: -1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    it("answers 404 for a branch that is not there", async () => {
        await expect(diffDatabaseBranch(admin, "feature")).rejects.toMatchObject({ code: "BRANCH_NOT_FOUND", statusCode: 404 });
    });
});
