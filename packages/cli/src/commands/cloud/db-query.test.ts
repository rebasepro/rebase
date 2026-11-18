/**
 * `rebase cloud db query`: which SQL it runs, what it refuses before opening
 * anything, and how results are reported.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { QueryResult } from "pg";
import { querySql, summarizeResults } from "./db-query";

function exits(fn: () => unknown): string {
    const errors: string[] = [];
    const err = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.join(" ")); });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    try {
        fn();
    } catch (e) {
        if (!(e instanceof Error) || !e.message.startsWith("exit")) throw e;
    } finally {
        err.mockRestore();
        exit.mockRestore();
    }
    return errors.join("\n");
}

afterEach(() => vi.restoreAllMocks());

describe("querySql", () => {
    it("takes the argument, or the file", () => {
        expect(querySql(undefined, "select 1")).toBe("select 1");
        expect(querySql("extras.sql", undefined, () => "create function f() returns int language sql as $$ select 1 $$;")).toContain("create function");
    });

    it("refuses both, neither, an empty script and COPY FROM STDIN", () => {
        expect(exits(() => querySql("a.sql", "select 1", () => "x"))).toContain("not both");
        expect(exits(() => querySql(undefined, undefined))).toContain("needs SQL");
        expect(exits(() => querySql(undefined, "   "))).toContain("empty");
        expect(exits(() => querySql(undefined, "COPY t (a) FROM STDIN;"))).toContain("COPY");
        expect(exits(() => querySql("missing.sql", undefined, () => { throw new Error("ENOENT"); }))).toContain("Could not read missing.sql");
    });
});

describe("summarizeResults", () => {
    const one = (command: string, rows: Record<string, unknown>[]): QueryResult =>
        ({ command, rowCount: rows.length, rows, oid: 0, fields: [] }) as QueryResult;

    it("reports one entry per statement, whether pg answered one result or several", () => {
        expect(summarizeResults(one("SELECT", [{ n: 1 }]))).toEqual([{ command: "SELECT", rowCount: 1, rows: [{ n: 1 }] }]);
        expect(summarizeResults([one("CREATE", []), one("SELECT", [{ n: 2 }])]).map((s) => s.command)).toEqual(["CREATE", "SELECT"]);
    });
});
