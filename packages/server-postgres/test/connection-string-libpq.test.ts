import { forLibpq } from "../src/utils/connection-string";

/**
 * `sslmode=no-verify` is a node-postgres invention. libpq does not have it and
 * does not degrade gracefully — `psql`, `pg_dump`, `pg_restore` and Atlas all
 * refuse to start with `invalid sslmode value: "no-verify"`, so a DATABASE_URL
 * that runs the app perfectly makes every one of those tools unusable.
 */
describe("forLibpq", () => {

    it("rewrites no-verify to the mode libpq spells the same thing", () => {
        expect(forLibpq("postgres://u:p@host:5432/db?sslmode=no-verify"))
            .toBe("postgres://u:p@host:5432/db?sslmode=require");
    });

    it("leaves the modes libpq accepts exactly as written", () => {
        // Notably `verify-full`: the rewrite must never be able to turn
        // certificate verification off.
        for (const mode of ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]) {
            const url = `postgres://u:p@host/db?sslmode=${mode}`;
            expect(forLibpq(url)).toBe(url);
        }
    });

    it("leaves a URL with no sslmode alone", () => {
        expect(forLibpq("postgres://u:p@host/db")).toBe("postgres://u:p@host/db");
    });

    it("keeps the other parameters, and keeps them percent-encoded", () => {
        // The scaffolded .env pins search_path through `options`, whose space
        // libpq reads as `%20` and not as `+`.
        const out = forLibpq("postgres://u:p@host/db?options=-c%20search_path%3Dpublic&sslmode=no-verify");
        expect(out).toContain("sslmode=require");
        expect(out).toContain("options=-c%20search_path%3Dpublic");
        expect(out).not.toContain("+");
    });

    it("returns a DSN it cannot parse untouched", () => {
        // Key/value DSNs put `sslmode` in a space-separated list rather than a
        // query string. Rewriting one by regex is how a password containing
        // "sslmode=" gets mangled — a connection that works unverified beats
        // one this corrupted.
        const dsn = "host=localhost port=5432 dbname=rebase sslmode=no-verify";
        expect(forLibpq(dsn)).toBe(dsn);
    });

    it("ignores non-postgres URLs", () => {
        expect(forLibpq("mysql://u:p@host/db?sslmode=no-verify"))
            .toBe("mysql://u:p@host/db?sslmode=no-verify");
    });
});
