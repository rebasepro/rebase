/**
 * A query Postgres refused, as `rebase console -e`, `rebase doctor` and
 * `rebase schema generate` print it.
 *
 * Drizzle reports one as `Failed query: <sql>` and a `params:` line, and keeps
 * the error Postgres raised in `cause`. `describeFailure` printed the message,
 * so `rebase console -e "rebase.sql('select * from nope_table')"` said
 * "Failed query: select * from nope_table / params:" and never which relation
 * was missing, `--debug` included.
 *
 * The errors are the classes the driver really throws: drizzle's
 * `DrizzleQueryError` around node-postgres' `DatabaseError`.
 */
import { DrizzleQueryError } from "drizzle-orm/errors";
import pg from "pg";

import { describeFailure } from "../src/cli-output";

/** What node-postgres raises for `select * from nope_table`, fields as the wire carries them. */
function relationMissing(): pg.DatabaseError {
    const error = new pg.DatabaseError("relation \"nope_table\" does not exist", 105, "error");
    error.severity = "ERROR";
    error.code = "42P01";
    error.position = "15";
    return error;
}

describe("describeFailure, for a query Postgres refused", () => {
    const previous = process.env.REBASE_DEBUG;
    afterEach(() => {
        if (previous === undefined) delete process.env.REBASE_DEBUG;
        else process.env.REBASE_DEBUG = previous;
    });

    it("leads with Postgres' reason and its SQLSTATE, then the query", () => {
        delete process.env.REBASE_DEBUG;
        const text = describeFailure(new DrizzleQueryError("select * from nope_table", [], relationMissing()));
        expect(text.split("\n")).toEqual([
            "relation \"nope_table\" does not exist (42P01)",
            "  Failed query: select * from nope_table",
            "  Re-run with --debug for the stack trace."
        ]);
    });

    it("never prints the values the query ran with", () => {
        delete process.env.REBASE_DEBUG;
        const error = new DrizzleQueryError("select * from nope_table where token = $1", ["s3cret-token"], relationMissing());
        const text = describeFailure(error);
        expect(text).toContain("Failed query: select * from nope_table where token = $1");
        expect(text).not.toContain("s3cret-token");
        expect(text).not.toContain("params:");
    });

    it("keeps the reason, and still not the values, under --debug", () => {
        process.env.REBASE_DEBUG = "1";
        const error = new DrizzleQueryError("select * from nope_table where token = $1", ["s3cret-token"], relationMissing());
        const text = describeFailure(error);
        const lines = text.split("\n");
        expect(lines[0]).toBe("relation \"nope_table\" does not exist (42P01)");
        expect(lines[1]).toBe("  Error: Failed query: select * from nope_table where token = $1");
        expect(lines[2]).toMatch(/^\s+at /);
        expect(text).not.toContain("s3cret-token");
    });

    it("finds the reason under a wrapper of its own", () => {
        delete process.env.REBASE_DEBUG;
        const wrapped = new Error("transaction failed", { cause: relationMissing() });
        const text = describeFailure(new DrizzleQueryError("select * from nope_table", [], wrapped));
        expect(text.split("\n")[0]).toBe("relation \"nope_table\" does not exist (42P01)");
    });

    it("leads with the driver's reason for a query Postgres never answered", () => {
        delete process.env.REBASE_DEBUG;
        const error = new DrizzleQueryError("select $1", ["s3cret-token"], new Error("Connection terminated unexpectedly"));
        expect(describeFailure(error).split("\n")).toEqual([
            "Connection terminated unexpectedly",
            "  Failed query: select $1",
            "  Re-run with --debug for the stack trace."
        ]);
    });

    it("leaves any other error as it was", () => {
        delete process.env.REBASE_DEBUG;
        expect(describeFailure(new Error("Collections directory not found"))).toBe(
            "Collections directory not found\n  Re-run with --debug for the stack trace."
        );
    });
});
