/**
 * Each database is judged by its own connection string.
 *
 * `rebase status` asks the runtime's resolver about every declared database.
 * With no dev database standing in for the default — a production `.env` with
 * no `DATABASE_URL` — a bound `database("analytics")` with its own
 * `DATABASE_URL__ANALYTICS` was marked ✗ with the default's message, "Data
 * source "(default)" has no connection string": the resolver judged a set of
 * one source through the function that resolves a whole project, which adds
 * the implicit default to any set that does not declare one.
 */
import { describe, expect, it } from "@jest/globals";
import type { ResourceDeclaration } from "@rebasepro/types";
import { resourceResolver } from "../src/boot/resource-resolvers";
import { resolveDataSources } from "../src/boot/sources";

const context = { production: true, defaultBasePath: "/tmp" };
const analytics: ResourceDeclaration = {
    kind: "database",
    key: "analytics",
    engine: "postgres",
    transport: "server",
    options: Object.freeze({})
};

describe("the database resolver", () => {
    const resolver = resourceResolver("database")!;

    it("binds a database that has its own string, though the default has none", () => {
        expect(resolver.resolve(analytics, { DATABASE_URL__ANALYTICS: "postgres://warehouse/analytics" }, context))
            .toEqual({ state: "ready" });
    });

    it("refuses one that has none, naming its own variable", () => {
        const verdict = resolver.resolve(analytics, { DATABASE_URL: "postgres://primary/app" }, context);
        expect(verdict.state).toBe("blocked");
        expect(verdict.detail).toContain('Data source "analytics" has no connection string');
        expect(verdict.detail).toContain("DATABASE_URL__ANALYTICS");
    });
});

describe("a whole project's sources", () => {
    it("still needs the default, which every project has", () => {
        expect(() => resolveDataSources({ DATABASE_URL__ANALYTICS: "postgres://warehouse/analytics" }, [{ key: "analytics", engine: "postgres" }]))
            .toThrow('Data source "(default)" has no connection string');
    });
});
