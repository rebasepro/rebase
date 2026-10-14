import { forAtlas, forLibpq } from "../src/utils/connection-string";

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

/**
 * Atlas connects through lib/pq, whose default `sslmode` is `require`, while
 * node-postgres — the app, and the CLI's own steps — asks for no SSL when the
 * URL names none. A hand-written URL for a local Postgres without SSL worked
 * for the app and failed every schema command with `pq: SSL is not enabled on
 * the server`. Only a database on this machine is given the app's default.
 */
describe("forAtlas", () => {
    it.each([
        ["postgres://u:p@localhost:5432/db", "postgres://u:p@localhost:5432/db?sslmode=disable"],
        ["postgresql://u:p@127.0.0.1:55432/shop", "postgresql://u:p@127.0.0.1:55432/shop?sslmode=disable"],
        ["postgres://u:p@127.12.0.1/db", "postgres://u:p@127.12.0.1/db?sslmode=disable"],
        ["postgres://u:p@[::1]:5432/db", "postgres://u:p@[::1]:5432/db?sslmode=disable"],
        ["postgres://u:p@0.0.0.0:5432/db", "postgres://u:p@0.0.0.0:5432/db?sslmode=disable"]
    ])("gives a loopback URL that names no sslmode the app's default: %s", (url, expected) => {
        expect(forAtlas(url)).toBe(expected);
    });

    it("keeps the other parameters percent-encoded", () => {
        expect(forAtlas("postgres://u:p@127.0.0.1:55432/shop?options=-c%20search_path%3Dpublic"))
            .toBe("postgres://u:p@127.0.0.1:55432/shop?options=-c%20search_path%3Dpublic&sslmode=disable");
    });

    it.each([
        // An sslmode asked for is kept, whatever it is.
        "postgres://u:p@localhost/db?sslmode=require",
        "postgres://u:p@localhost/db?sslmode=verify-full",
        // As is any other way of saying something about SSL or the host.
        "postgres://u:p@localhost/db?ssl=true",
        "postgres://u:p@localhost/db?host=/var/run/postgresql",
        "postgres://u:p@localhost/db?hostaddr=10.0.0.5",
        // Not this machine, or only pretending to be.
        "postgres://u:p@db.example.com/db",
        "postgres://u:p@localhost.example.com/db",
        "postgres://u:p@192.168.1.20/db",
        // Not a URL.
        "host=localhost port=5432 dbname=rebase"
    ])("leaves %s as written", (url) => {
        expect(forAtlas(url)).toBe(url);
    });

    it("still makes a node-postgres sslmode one libpq takes", () => {
        expect(forAtlas("postgres://u:p@db.example.com/db?sslmode=no-verify")).toBe("postgres://u:p@db.example.com/db?sslmode=require");
    });
});
