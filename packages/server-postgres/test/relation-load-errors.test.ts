import { reachedDatabase } from "../src/utils/pg-error-utils";

/**
 * A relation that failed to load is not a relation that is absent.
 *
 * Eight `catch` blocks around relation loading in `FetchService` logged a
 * warning and carried on, so `?include=tags` answered 200 with `tags` quietly
 * missing. Four other catches in the same file already rethrew anything that
 * reached the database — the guard existed, it just was not applied here.
 *
 * The compounding is what makes it more than a missing field: a Postgres error
 * poisons the surrounding transaction, so every later relation in the same
 * request fails too and is swallowed too. One failure becomes a response
 * missing several fields, none of them reported.
 *
 * Asserted structurally: the property is "no relation-loading catch swallows a
 * database error", and a test that named one call site would not have caught
 * the other seven.
 */
describe("relation load failures are not silent", () => {
    const source = require("fs").readFileSync(
        require("path").join(__dirname, "../src/services/FetchService.ts"),
        "utf8"
    ) as string;

    it("guards every catch that logs a relation-loading warning", () => {
        const lines = source.split("\n");
        const unguarded: string[] = [];

        lines.forEach((line, i) => {
            const warns = /logger\.warn\(`(\[include\] Failed to (load|batch load)|Could not (resolve|batch resolve|batch load))/.test(line);
            if (!warns) return;
            // The guard must be the statement immediately before the warning.
            const previous = lines.slice(Math.max(0, i - 10), i).join("\n");
            if (!previous.includes("reachedDatabase(e)")) unguarded.push(line.trim());
        });

        expect(unguarded).toEqual([]);
    });

    it("the guard rethrows a real Postgres error", () => {
        // The control: a predicate that answered false for everything would
        // satisfy the structural test above while changing nothing.
        const pgError = Object.assign(new Error("permission denied"), { code: "42501" });
        expect(reachedDatabase(pgError)).toBe(true);
    });

    it("and does not rethrow a local programming error", () => {
        // The other half — this is why the catches exist at all: a relation the
        // schema cannot describe should stay a warning, not a 500.
        expect(reachedDatabase(new TypeError("x is not a function"))).toBe(false);
    });
});
