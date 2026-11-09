/**
 * Prune leaves alone a branch database another project on the same server
 * registered.
 *
 * Two projects on one Postgres server each keep `rebase.branches` in their own
 * main database. Prune read every `rb_*` database without a row in *its*
 * registry as an orphan, so project A's prune listed — and with `--yes`
 * dropped — every branch of project B. A branch database now carries, as its
 * comment, the main database that registers it, written before the registry
 * row; prune leaves out one that names another.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { BranchService } from "../src/services/BranchService";
import { DatabasePoolManager } from "../src/databasePoolManager";
import { planPrune } from "../src/branch-prune";
import { recordingDb, type RecordedStatement } from "./helpers/spg-c-db";


function textOf(statement: RecordedStatement): string {
    return statement.text.replace(/\s+/g, " ").trim();
}

/** A pool manager for `mainDatabase` that connects to nothing. */
function poolManagerFor(mainDatabase: string): DatabasePoolManager {
    const manager = new DatabasePoolManager(`postgres://test@localhost/${encodeURI(mainDatabase)}`);
    jest.spyOn(manager, "disconnectDatabase").mockResolvedValue(undefined);
    jest.spyOn(manager, "servesOneDatabase").mockResolvedValue(false);
    return manager;
}

describe("a branch database says which registry it belongs to", () => {
    it("is commented with its main database before its registry row is written", async () => {
        const recording = recordingDb();

        await new BranchService(recording.db, poolManagerFor("shop's_app")).createBranch("feat");
        const statements = recording.statements.map(textOf);

        const created = statements.findIndex(text => text.startsWith("CREATE DATABASE"));
        const commented = statements.findIndex(text => text.startsWith("COMMENT ON DATABASE"));
        const recorded = statements.findIndex(text => text.startsWith("INSERT INTO rebase.branches"));
        expect(statements[commented]).toBe(`COMMENT ON DATABASE "rb_feat" IS 'rebase:branch-of:shop''s_app'`);
        expect(created).toBeLessThan(commented);
        expect(commented).toBeLessThan(recorded);
    });

    it("is still created when the comment cannot be written", async () => {
        const { db } = recordingDb((statement) => {
            if (textOf(statement).startsWith("COMMENT ON DATABASE")) throw new Error("must be owner of database");
            return [];
        });

        const branch = await new BranchService(db, poolManagerFor("shop")).createBranch("feat");
        expect(branch.database).toBe("rb_feat");
    });
});

describe("prune on a server two projects share", () => {
    function serviceOn(main: string, databases: { datname: string; comment: string | null }[], rows: { name: string; db_name: string }[]) {
        const { db } = recordingDb((statement) => {
            const text = textOf(statement);
            if (text.includes("FROM rebase.branches")) return rows.map(row => ({ ...row, created_at: "2026-01-01T00:00:00Z" }));
            if (text.includes("FROM pg_database")) return databases;
            return [];
        });
        return new BranchService(db, poolManagerFor(main));
    }

    const server = [
        { datname: "shop", comment: null },
        { datname: "blog", comment: null },
        { datname: "rb_shop_feat", comment: "rebase:branch-of:shop" },
        { datname: "rb_blog_draft", comment: "rebase:branch-of:blog" },
        { datname: "rb_crashed", comment: "rebase:branch-of:shop" },
        { datname: "rb_unmarked", comment: null }
    ];

    it("does not offer another project's branch as an orphan", async () => {
        const service = serviceOn("shop", server, [{ name: "shop_feat", db_name: "rb_shop_feat" }]);
        const { rows, databases } = await service.pruneCandidates();
        const plan = planPrune({ rows, databases, branchPrefix: "rb_" });

        expect(plan.orphanDatabases).toEqual(["rb_crashed", "rb_unmarked"]);
        expect(plan.staleRows).toEqual([]);
    });

    it("and the other project's prune does not offer this one's", async () => {
        const service = serviceOn("blog", server, [{ name: "blog_draft", db_name: "rb_blog_draft" }]);
        const { rows, databases } = await service.pruneCandidates();
        const plan = planPrune({ rows, databases, branchPrefix: "rb_" });

        expect(plan.orphanDatabases).toEqual(["rb_unmarked"]);
    });

    it("keeps a database its own registry names, whatever its comment says", async () => {
        const service = serviceOn("shop", server, [{ name: "adopted", db_name: "rb_blog_draft" }]);
        const { rows, databases } = await service.pruneCandidates();
        const plan = planPrune({ rows, databases, branchPrefix: "rb_" });

        expect(plan.staleRows).toEqual([]);
        expect(databases).toContain("rb_blog_draft");
    });
});
