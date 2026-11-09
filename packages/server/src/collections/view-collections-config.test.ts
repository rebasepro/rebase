/**
 * A collection that serves a SQL view (`view`): what its config must say, and
 * what it may not — everything only a table can do.
 */
import { findCollectionConfigProblems } from "./validate-config";

const view = (extra: Record<string, unknown> = {}, properties: Record<string, unknown> = { artist: { type: "string", name: "Artist", isId: true } }) =>
    findCollectionConfigProblems([{
        slug: "artists",
        name: "Artists",
        view: { query: "SELECT artist FROM songs GROUP BY artist" },
        properties,
        ...extra
    }]).filter(problem => problem.severity === "error");

describe("a view collection's config", () => {
    it("is valid with a query and an id property", () => {
        expect(view()).toEqual([]);
        expect(view({ view: { query: "SELECT 1 AS id", materialized: true, roles: ["admin", "analyst"] }, indexes: [] }, { id: { type: "number", name: "Id", isId: true } })).toEqual([]);
    });

    it("needs a query", () => {
        expect(view({ view: { query: " " } }).map(p => p.path)).toEqual(["artists.view"]);
    });

    it("needs a property marked isId", () => {
        expect(view({}, { artist: { type: "string", name: "Artist" } })[0].message).toMatch(/isId/);
    });

    it.each(["securityRules", "history", "softDelete", "tenant", "search"])("refuses %s, which only a table has", key => {
        const value = key === "securityRules" ? [{ operation: "select", roles: ["admin"] }] : key === "tenant" ? { field: "org" } : key === "search" ? { fields: ["artist"] } : true;
        expect(view({ [key]: value }).some(p => p.path === `artists.${key}` && /cannot be declared on a view/.test(p.message))).toBe(true);
    });

    it("refuses indexes on a plain view, whose tables carry them", () => {
        expect(view({ indexes: [] }).some(p => p.path === "artists.indexes")).toBe(true);
    });
});
