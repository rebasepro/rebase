/**
 * The resolution order, which is the user-facing promise of this feature.
 *
 * The managed database is a convenience; the override is a contract. Someone
 * who points Rebase at their own Postgres — a staging box, a Neon branch, a
 * container they manage themselves — must reach exactly that database, and the
 * failure this pins is the one that would be worst: a project that *has* a
 * `DATABASE_URL` being quietly served a local PGlite instead, so migrations
 * appear to apply and the real database never changes.
 */

import { describe, expect, it } from "vitest";

import { describeDevDatabase, resolveDevDatabase } from "./resolve";

const URL_A = "postgresql://user:pw@staging.example.com:5432/app";
const URL_B = "postgresql://user:pw@localhost:5433/other";

describe("resolveDevDatabase", () => {
    it("uses the managed database when nothing has been said", () => {
        expect(resolveDevDatabase()).toEqual({ kind: "managed", source: "managed" });
        expect(resolveDevDatabase({ env: {}, envFile: {} })).toEqual({ kind: "managed", source: "managed" });
    });

    it("prefers --database-url over everything else", () => {
        const resolved = resolveDevDatabase({
            flagUrl: URL_A,
            flagDocker: true,
            env: { DATABASE_URL: URL_B },
            envFile: { DATABASE_URL: URL_B },
            manifestPreference: "docker"
        });

        expect(resolved).toEqual({ kind: "external", url: URL_A, source: "flag" });
    });

    it("prefers the environment over the .env file", () => {
        const resolved = resolveDevDatabase({ env: { DATABASE_URL: URL_A }, envFile: { DATABASE_URL: URL_B } });

        expect(resolved).toEqual({ kind: "external", url: URL_A, source: "environment" });
    });

    it("uses the .env file when the environment is silent", () => {
        const resolved = resolveDevDatabase({ env: {}, envFile: { DATABASE_URL: URL_B } });

        expect(resolved).toEqual({ kind: "external", url: URL_B, source: "env-file" });
    });

    it("never redirects a project that has a DATABASE_URL to the managed database", () => {
        for (const input of [
            { env: { DATABASE_URL: URL_A } },
            { envFile: { DATABASE_URL: URL_A } },
            { flagUrl: URL_A }
        ]) {
            expect(resolveDevDatabase(input).kind).toBe("external");
        }
    });

    it("passes the connection string through byte for byte", () => {
        // Query parameters, unusual ports and encoded passwords have all been
        // mangled by well-meaning URL round-trips before. This never parses it.
        const awkward = "postgresql://u%3Aser:p%40ss@host:6543/db?sslmode=require&options=-c%20search_path%3Dapp";
        const resolved = resolveDevDatabase({ flagUrl: awkward });

        expect(resolved).toEqual({ kind: "external", url: awkward, source: "flag" });
    });

    describe("empty values", () => {
        it("treats an empty DATABASE_URL as absent rather than as a connection string", () => {
            // `DATABASE_URL=` is what someone writes to mean "not this one".
            // Honouring it literally hands libpq an empty string and produces an
            // error about a missing host, which explains nothing.
            expect(resolveDevDatabase({ envFile: { DATABASE_URL: "" } }).kind).toBe("managed");
            expect(resolveDevDatabase({ env: { DATABASE_URL: "   " } }).kind).toBe("managed");
            expect(resolveDevDatabase({ flagUrl: "" }).kind).toBe("managed");
        });

        it("trims surrounding whitespace off a real value", () => {
            expect(resolveDevDatabase({ envFile: { DATABASE_URL: `  ${URL_A}  ` } })).toEqual({
                kind: "external",
                url: URL_A,
                source: "env-file"
            });
        });
    });

    describe("docker", () => {
        it("is chosen by the flag when no connection string exists", () => {
            expect(resolveDevDatabase({ flagDocker: true })).toEqual({ kind: "docker", source: "docker" });
        });

        it("is chosen by a manifest preference", () => {
            expect(resolveDevDatabase({ manifestPreference: "docker" })).toEqual({ kind: "docker", source: "docker" });
        });

        it("loses to an explicit connection string", () => {
            // Asking for Docker says *how* to get a database, not which one, so
            // a DATABASE_URL that already names one outranks it.
            expect(resolveDevDatabase({ flagDocker: true, env: { DATABASE_URL: URL_A } })).toEqual({
                kind: "external",
                url: URL_A,
                source: "environment"
            });
        });

        it("is overridden back to managed by an explicit manifest preference", () => {
            expect(resolveDevDatabase({ manifestPreference: "managed" }).kind).toBe("managed");
        });
    });
});

describe("describeDevDatabase", () => {
    it("names both the database and where the choice came from", () => {
        expect(describeDevDatabase({ kind: "external", url: URL_A, source: "flag" })).toContain("--database-url");
        expect(describeDevDatabase({ kind: "external", url: URL_A, source: "environment" })).toContain("environment");
        expect(describeDevDatabase({ kind: "external", url: URL_A, source: "env-file" })).toContain(".env");
        expect(describeDevDatabase({ kind: "docker", source: "docker" })).toContain("Docker");
        expect(describeDevDatabase({ kind: "managed", source: "managed" })).toContain("PGlite");
    });

    it("never puts the connection string in the banner", () => {
        // It carries a password. The banner is what people paste into issues.
        const described = describeDevDatabase({ kind: "external", url: URL_A, source: "env-file" });

        expect(described).not.toContain("pw");
        expect(described).not.toContain("staging.example.com");
    });
});

describe("the branch a checkout is switched to", () => {
    const branch = { name: "feature_auth", url: "postgresql://h/rb_feature_auth" };

    it("outranks DATABASE_URL in .env", () => {
        // Without this the switch silently does nothing on every project that
        // sets DATABASE_URL — which is every project not on the managed database.
        const chosen = resolveDevDatabase({ envFile: { DATABASE_URL: "postgresql://h/main" }, branch });

        expect(chosen).toMatchObject({ kind: "external", url: branch.url, source: "branch" });
    });

    it("loses to DATABASE_URL in the shell", () => {
        // A variable in this shell is more immediate than a switch made yesterday.
        const chosen = resolveDevDatabase({ env: { DATABASE_URL: "postgresql://h/ci" }, branch });

        expect(chosen).toMatchObject({ source: "environment", url: "postgresql://h/ci" });
    });

    it("loses to --database-url", () => {
        const chosen = resolveDevDatabase({ flagUrl: "postgresql://h/flag", branch });

        expect(chosen).toMatchObject({ source: "flag" });
    });

    it("outranks --docker", () => {
        const chosen = resolveDevDatabase({ flagDocker: true, branch });

        expect(chosen).toMatchObject({ source: "branch" });
    });

    it("carries the branch name so diagnostics can say which one", () => {
        const chosen = resolveDevDatabase({ branch });

        expect(chosen).toMatchObject({ branch: "feature_auth" });
        expect(describeDevDatabase(chosen)).toContain("feature_auth");
    });

    it("changes nothing when no branch is active", () => {
        const chosen = resolveDevDatabase({ envFile: { DATABASE_URL: "postgresql://h/main" }, branch: null });

        expect(chosen).toMatchObject({ source: "env-file" });
    });

    it("is ignored when its URL could not be derived", () => {
        // `resolveActiveBranch` hands null through for an unparseable base
        // rather than a half-built string.
        const chosen = resolveDevDatabase({
            envFile: { DATABASE_URL: "postgresql://h/main" },
            branch: { name: "x", url: "" }
        });

        expect(chosen).toMatchObject({ source: "env-file" });
    });
});
