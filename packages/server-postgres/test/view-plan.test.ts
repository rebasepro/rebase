/**
 * How view collections are planned and rendered (`planViews`,
 * `renderViewsDdl`): no table, policy or enum for them; created after the
 * views they read and dropped before them; recreated only when the plan's hash
 * changes.
 */
import { describe, it, expect } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { planSchema } from "../src/schema/plan/plan-schema";
import { renderViewsDdl, viewCreateStatements } from "../src/schema/plan/render-ddl";

const songs = {
    slug: "songs", name: "Songs", table: "songs",
    securityRules: [{ operation: "select", roles: ["admin"] }],
    properties: { id: { type: "number", name: "Id", isId: "increment" }, artist: { type: "string", name: "Artist" } }
} as unknown as CollectionConfig;

const view = (slug: string, query: string, materialized = false) => ({
    slug, name: slug, table: slug,
    view: { query, materialized },
    properties: { artist: { type: "string", name: "Artist", isId: true } }
}) as unknown as CollectionConfig;

describe("view plans", () => {
    // Declared before the view it reads.
    const top = view("top_artists", "SELECT artist FROM artist_stats ORDER BY artist LIMIT 10", true);
    const stats = view("artist_stats", "SELECT artist FROM songs GROUP BY artist;");
    const plan = planSchema([songs, top, stats]);

    it("plans no table, policy or enum for a view", () => {
        expect(plan.tables.map(table => table.table)).toEqual(["songs"]);
    });

    it("orders a view after the view its query reads", () => {
        expect(plan.views.map(v => v.name)).toEqual(["artist_stats", "top_artists"]);
        expect(plan.views[1].dependsOn).toEqual(["public.artist_stats"]);
        expect(plan.views[0].query).toBe("SELECT artist FROM songs GROUP BY artist");
    });

    it("hashes the plan, so the same config hashes the same and a changed query does not", () => {
        expect(planSchema([songs, top, stats]).views.map(v => v.hash)).toEqual(plan.views.map(v => v.hash));
        const changed = planSchema([songs, top, view("artist_stats", "SELECT lower(artist) AS artist FROM songs GROUP BY 1")]);
        expect(changed.views[0].hash).not.toBe(plan.views[0].hash);
        expect(changed.views[1].hash).toBe(plan.views[1].hash);
    });

    it("creates a plain view as security_invoker and a materialized one with a unique id index", () => {
        expect(viewCreateStatements(plan.views[0])[0]).toMatch(/^CREATE VIEW "public"\."artist_stats" WITH \(security_invoker = true\) AS/);
        expect(viewCreateStatements(plan.views[1])).toEqual([
            expect.stringMatching(/^CREATE MATERIALIZED VIEW "public"\."top_artists" AS\n.*\nWITH DATA$/),
            "CREATE UNIQUE INDEX \"top_artists_rebase_id\" ON \"public\".\"top_artists\" (\"artist\")",
            `COMMENT ON MATERIALIZED VIEW "public"."top_artists" IS 'rebase:view:${plan.views[1].hash}'`
        ]);
    });

    it("drops a view whose dependency is stale before the dependency, and creates them the other way round", () => {
        const ddl = renderViewsDdl(plan);
        const dropTop = ddl.indexOf("DROP MATERIALIZED VIEW \"public\".\"top_artists\"");
        const dropStats = ddl.indexOf("DROP VIEW \"public\".\"artist_stats\"");
        const createStats = ddl.indexOf("CREATE VIEW \"public\".\"artist_stats\"");
        const createTop = ddl.indexOf("CREATE MATERIALIZED VIEW \"public\".\"top_artists\"");
        expect(dropTop).toBeLessThan(dropStats);
        expect(dropStats).toBeLessThan(createStats);
        expect(createStats).toBeLessThan(createTop);
        // The view that reads artist_stats is dropped when artist_stats is stale too.
        expect(ddl.slice(0, dropTop)).toMatch(/rebase:view:[0-9a-f]{16}'\)\s+OR .*artist_stats/s);
    });

    it("quotes a query holding the default dollar tag", () => {
        const odd = planSchema([songs, view("odd", "SELECT '$rebase_view$' AS artist")]);
        expect(renderViewsDdl(odd)).toContain("EXECUTE $rebase_view_1$CREATE VIEW");
    });

    it("renders nothing without a view", () => {
        expect(renderViewsDdl(planSchema([songs]))).toBe("");
    });
});
