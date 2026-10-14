import { closedDatabaseName, diagnoseDbError } from "../src/cli-errors";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";

/**
 * A database closed to new connections has to say so, and say how to open it.
 *
 * `rebase db branch create --force` closes its source with `ALLOW_CONNECTIONS
 * false` for the copy. One killed before it opened it again left the project's
 * main database refusing every connection: `rebase console` printed
 * `Cannot connect to PostgreSQL … is not currently accepting connections
 * (55000)`, `db push` aborted, `rebase dev` could not boot, and nothing named
 * the one statement that fixes it.
 */
const URL_ = "postgresql://app:secret@db.internal:6543/shop";

/** What node-postgres raises for a connection to a closed database. */
const closed = (database: string) =>
    Object.assign(new Error(`database "${database}" is not currently accepting connections`), {
        code: "55000",
        severity: "FATAL"
    });

describe("closedDatabaseName", () => {
    it("reads the database out of Postgres's refusal", () => {
        expect(closedDatabaseName(closed("shop"))).toBe("shop");
    });

    it("finds it under Drizzle's wrapper and inside a dual-stack AggregateError", () => {
        expect(closedDatabaseName(new Error("Failed query: SELECT 1", { cause: closed("rb_feature") }))).toBe("rb_feature");
        expect(closedDatabaseName(new AggregateError([closed("shop")], ""))).toBe("shop");
    });

    it("finds it in a tool's text, as Atlas's stderr is handed over", () => {
        expect(closedDatabaseName({ message: 'Error: pq: database "shop" is not currently accepting connections' })).toBe("shop");
    });

    it("is not every 55000", () => {
        const other = Object.assign(new Error("lastval is not yet defined in this session"), { code: "55000" });
        expect(closedDatabaseName(other)).toBeNull();
        expect(closedDatabaseName(undefined)).toBeNull();
    });
});

describe("the closed-database banner", () => {
    const original = process.env.REBASE_DATABASE_SOURCE;
    afterEach(() => {
        if (original === undefined) delete process.env.REBASE_DATABASE_SOURCE;
        else process.env.REBASE_DATABASE_SOURCE = original;
    });
    const banner = (source?: string): string => {
        if (source === undefined) delete process.env.REBASE_DATABASE_SOURCE;
        else process.env.REBASE_DATABASE_SOURCE = source;
        return diagnoseDbError(new Error("Failed query: SELECT 1", { cause: closed("shop") }), URL_) ?? "";
    };

    it("says what happened, where", () => {
        expect(banner()).toContain('Database "shop" at db.internal:6543 is closed to new connections');
        expect(banner()).toContain("ALLOW_CONNECTIONS false");
        expect(banner()).toContain("rebase db branch create --force");
        expect(banner()).toContain("is not currently accepting connections (55000)");
    });

    it("names the command that opens it, and the statement", () => {
        expect(banner()).toContain("rebase db branch list");
        expect(banner()).toContain("postgres database");
        expect(banner()).toContain('ALTER DATABASE "shop" ALLOW_CONNECTIONS true;');
    });

    it("keeps --database-url in the command when that is what named the database", () => {
        expect(banner("flag")).toContain("rebase db branch list --database-url <the same URL>");
    });

    it("never prints the connection string", () => {
        expect(banner()).not.toContain("secret");
    });
});

/** `rebase dev` boots through `verifyConnection`, and has to say the same. */
describe("a boot against a closed database", () => {
    it("fails naming the database and the command that opens it", async () => {
        const bootstrapper = createPostgresBootstrapper({
            connectionString: URL_,
            connection: { execute: async () => { throw new Error("Failed query: SELECT 1", { cause: closed("shop") }); } }
        } as never);

        await expect(bootstrapper.verifyConnection!(undefined))
            .rejects.toThrow(/Database "shop" at db\.internal:6543 is closed to new connections.*rebase db branch list/s);
    });
});
