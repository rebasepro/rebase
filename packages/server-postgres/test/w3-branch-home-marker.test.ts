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
import { describe, it, expect } from "@jest/globals";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { BranchService } from "../src/services/BranchService";
import { DatabasePoolManager } from "../src/databasePoolManager";
import { planPrune } from "../src/branch-prune";

const dialect = new PgDialect();

function textOf(statement: unknown): string {
    return dialect.sqlToQuery(statement as never).sql.replace(/\s+/g, " ").trim();
}

function poolManagerFor(mainDatabase: string): DatabasePoolManager {
    return {
        defaultDatabaseName: mainDatabase,
        disconnectDatabase: jest.fn().mockResolvedValue(undefined),
        servesOneDatabase: jest.fn().mockResolvedValue(false)
    } as unknown as DatabasePoolManager;
}

describe("a branch database says which registry it belongs to", () => {
    it("is commented with its main database before its registry row is written", async () => {
        const statements: string[] = [];
        const db = {
            execute: jest.fn(async (statement: unknown) => {
                statements.push(textOf(statement));
                return { rows: [] };
            })
        } as unknown as NodePgDatabase;

        await new BranchService(db, poolManagerFor("shop's_app")).createBranch("feat");

        const created = statements.findIndex(text => text.startsWith("CREATE DATABASE"));
        const commented = statements.findIndex(text => text.startsWith("COMMENT ON DATABASE"));
        const recorded = statements.findIndex(text => text.startsWith("INSERT INTO rebase.branches"));
        expect(statements[commented]).toBe(`COMMENT ON DATABASE "rb_feat" IS 'rebase:branch-of:shop''s_app'`);
        expect(created).toBeLessThan(commented);
        expect(commented).toBeLessThan(recorded);
    });

    it("is still created when the comment cannot be written", async () => {
        const db = {
            execute: jest.fn(async (statement: unknown) => {
                if (textOf(statement).startsWith("COMMENT ON DATABASE")) throw new Error("must be owner of database");
                return { rows: [] };
            })
        } as unknown as NodePgDatabase;

        const branch = await new BranchService(db, poolManagerFor("shop")).createBranch("feat");
        expect(branch.database).toBe("rb_feat");
    });
});

describe("prune on a server two projects share", () => {
    function serviceOn(main: string, databases: { datname: string; comment: string | null }[], rows: { name: string; db_name: string }[]) {
        const db = {
            execute: jest.fn(async (statement: unknown) => {
                const text = textOf(statement);
                if (text.includes("FROM rebase.branches")) {
                    return { rows: rows.map(row => ({ ...row, created_at: "2026-01-01T00:00:00Z" })) };
                }
                if (text.includes("FROM pg_database")) return { rows: databases };
                return { rows: [] };
            })
        } as unknown as NodePgDatabase;
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
