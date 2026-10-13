import { describe, it, expect } from "@jest/globals";
import { resolveSourceUrls } from "../src/PostgresBootstrapper";

/**
 * Which read replica and which direct URL one source's driver opens.
 *
 * `DATABASE_DIRECT_URL` and `DATABASE_READ_URL` are the default source's. Read
 * bare for every source, they put a second database's change-capture LISTEN on
 * the default database — where its notifications never arrive — and its reads
 * on the default's replica. The two-database behaviour is pinned end to end in
 * `e2e/multi-source-listen-e2e.test.ts`; this is the rule itself.
 */
describe("resolveSourceUrls", () => {
    const env = {
        DATABASE_DIRECT_URL: "postgres://db/app",
        DATABASE_READ_URL: "postgres://replica/app"
    };

    it("gives the default source the environment's URLs when its config names none", () => {
        expect(resolveSourceUrls({ connectionString: "postgres://pooler/app" }, "(default)", env)).toEqual({
            readUrl: "postgres://replica/app",
            directUrl: "postgres://db/app"
        });
    });

    it("never gives a keyed source the default's URLs", () => {
        expect(resolveSourceUrls({ connectionString: "postgres://pooler/analytics" }, "analytics", env)).toEqual({
            readUrl: undefined,
            directUrl: "postgres://pooler/analytics"
        });
    });

    it("prefers the URLs the config names, for any source", () => {
        const config = {
            connectionString: "postgres://pooler/analytics",
            directConnectionString: "postgres://db/analytics",
            readConnectionString: "postgres://replica/analytics"
        };
        const expected = { readUrl: "postgres://replica/analytics", directUrl: "postgres://db/analytics" };
        expect(resolveSourceUrls(config, "analytics", env)).toEqual(expected);
        expect(resolveSourceUrls(config, "(default)", env)).toEqual(expected);
    });

    it("falls back to the default's own connection when nothing names a direct URL", () => {
        expect(resolveSourceUrls({ connectionString: "postgres://db/app" }, "(default)", {})).toEqual({
            readUrl: undefined,
            directUrl: "postgres://db/app"
        });
        expect(resolveSourceUrls({}, "(default)", {})).toEqual({ readUrl: undefined, directUrl: undefined });
    });
});
