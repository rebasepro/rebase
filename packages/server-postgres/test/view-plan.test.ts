/**
 * How view collections are planned and rendered (`planViews`,
 * `renderViewsDdl`): no table, policy or enum for them; created after the
 * views they read and dropped before them; recreated only when the plan's hash
 * changes.
 */
import { describe, it, expect } from "@jest/globals";
import type { LegacyCollectionConfig, LegacyPostgresCollectionConfig } from "@rebasepro/common/migrate";
import { planSchema } from "../src/schema/plan/plan-schema";
import { renderViewsDdl, viewCreateStatements } from "../src/schema/plan/render-ddl";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { compileSet, planCollections } from "./helpers/plan-tables";

const songs: LegacyCollectionConfig = {
    slug: "songs", name: "Songs", table: "songs",
    securityRules: [{ operation: "select", roles: ["admin"] }],
    properties: { id: { type: "number", name: "Id", isId: "increment" }, artist: { type: "string", name: "Artist" } }
};

const view = (slug: string, query: string, materialized = false, roles?: string[]): LegacyCollectionConfig => ({
    slug, name: slug, table: slug,
    view: { query, materialized, ...(roles ? { roles } : {}) },
    properties: { artist: { type: "string", name: "Artist", isId: true } }
});

describe("view plans", () => {
    // Declared before the view it reads.
    const top = view("top_artists", "SELECT artist FROM artist_stats ORDER BY artist LIMIT 10", true);
    const stats = view("artist_stats", "SELECT artist FROM songs GROUP BY artist;");
    const plan = planCollections([songs, top, stats]);

    it("plans no table, policy or enum for a view", () => {
        expect(plan.tables.map(table => table.table)).toEqual(["songs"]);
    });

    it("orders a view after the view its query reads", () => {
        expect(plan.views.map(v => v.name)).toEqual(["artist_stats", "top_artists"]);
        expect(plan.views[1].dependsOn).toEqual(["public.artist_stats"]);
        expect(plan.views[0].query).toBe("SELECT artist FROM songs GROUP BY artist");
    });

    it("hashes the plan, so the same config hashes the same and a changed query does not", () => {
        expect(planCollections([songs, top, stats]).views.map(v => v.hash)).toEqual(plan.views.map(v => v.hash));
        const changed = planCollections([songs, top, view("artist_stats", "SELECT lower(artist) AS artist FROM songs GROUP BY 1")]);
        expect(changed.views[0].hash).not.toBe(plan.views[0].hash);
        expect(changed.views[1].hash).toBe(plan.views[1].hash);
    });

    it("creates a plain view as security_invoker, and a materialized one as owner-only rows behind a gate", () => {
        expect(viewCreateStatements(plan.views[0])[0]).toMatch(/^CREATE VIEW "public"\."artist_stats" WITH \(security_invoker = true\) AS/);
        expect(viewCreateStatements(plan.views[1])).toEqual([
            expect.stringMatching(/^CREATE MATERIALIZED VIEW "public"\."top_artists_rebase_rows" AS\n.*\nWITH DATA$/),
            "CREATE UNIQUE INDEX \"top_artists_rebase_id\" ON \"public\".\"top_artists_rebase_rows\" (\"artist\")",
            `COMMENT ON MATERIALIZED VIEW "public"."top_artists_rebase_rows" IS 'rebase:view-rows:${plan.views[1].hash}'`,
            "REVOKE ALL ON \"public\".\"top_artists_rebase_rows\" FROM PUBLIC",
            expect.stringMatching(/^CREATE VIEW "public"\."top_artists" WITH \(security_barrier = true\) AS\nSELECT rows\.\*, rows\.xmin AS xmin FROM "public"\."top_artists_rebase_rows" rows\n.*&& ARRAY\['admin'\]::text\[\]$/s),
            `COMMENT ON VIEW "public"."top_artists" IS 'rebase:view:${plan.views[1].hash}'`
        ]);
        expect(renderViewsDdl(plan)).toContain("EXECUTE 'REVOKE ALL ON \"public\".\"top_artists_rebase_rows\" FROM rebase_user'");
    });

    it("puts a materialized view's declared indexes on its stored rows", () => {
        const indexed: LegacyCollectionConfig = {
            slug: "top_artists", name: "top_artists", table: "top_artists",
            view: { query: "SELECT artist, count(*) AS plays FROM songs GROUP BY artist", materialized: true },
            indexes: [{ on: ["plays"], reason: "rank by plays" }],
            properties: { artist: { type: "string", name: "Artist", isId: true }, plays: { type: "number", name: "Plays" } }
        };
        const [top] = planCollections([songs, indexed, view("artist_stats", "SELECT artist FROM songs GROUP BY artist")]).views.filter(v => v.materialized);
        expect(top.indexes).toEqual([expect.stringMatching(/^CREATE INDEX "[^"]+" ON "public"\."top_artists_rebase_rows" \("plays"\)$/)]);
        expect(viewCreateStatements(top)).toContain(top.indexes[0]);
    });

    it("re-gates a materialized view whose roles change", () => {
        const regated = planCollections([songs, view("top_artists", "SELECT artist FROM artist_stats ORDER BY artist LIMIT 10", true, ["analyst"]), stats]);
        expect(regated.views[1].hash).not.toBe(plan.views[1].hash);
        expect(viewCreateStatements(regated.views[1])[4]).toContain("ARRAY['analyst']::text[]");
    });

    it("drops a view whose dependency is stale before the dependency, and creates them the other way round", () => {
        const ddl = renderViewsDdl(plan);
        const dropTop = ddl.indexOf("DROP MATERIALIZED VIEW \"public\".\"top_artists\"");
        const dropStats = ddl.indexOf("DROP VIEW \"public\".\"artist_stats\"");
        const createStats = ddl.indexOf("CREATE VIEW \"public\".\"artist_stats\"");
        const createTop = ddl.indexOf("CREATE MATERIALIZED VIEW \"public\".\"top_artists_rebase_rows\"");
        expect(dropTop).toBeLessThan(dropStats);
        expect(dropStats).toBeLessThan(createStats);
        expect(createStats).toBeLessThan(createTop);
        // The view that reads artist_stats is dropped when artist_stats is stale too.
        expect(ddl.slice(0, dropTop)).toMatch(/rebase:view:[0-9a-f]{16}'\)\s+OR .*artist_stats/s);
    });

    it("quotes a query holding the default dollar tag", () => {
        const odd = planCollections([songs, view("odd", "SELECT '$rebase_view$' AS artist")]);
        expect(renderViewsDdl(odd)).toContain("EXECUTE $rebase_view_1$CREATE VIEW");
    });

    it("renders nothing without a view", () => {
        expect(renderViewsDdl(planCollections([songs]))).toBe("");
    });
});

// A view is not a table: Postgres refuses `REFERENCES` into one ("referenced
// relation is not a table"), and the generated drizzle file declares no
// variable for it. A link into a view collection is read through the runtime's
// relations, which see views in the catalogue; it plans no constraint and no
// generated relation.
describe("links into a view collection", () => {
    const byArtist: LegacyPostgresCollectionConfig = {
        slug: "by_artist", name: "By artist", table: "by_artist",
        view: { query: "SELECT artist, count(*)::int AS songs FROM songs GROUP BY artist" },
        properties: { artist: { type: "string", name: "Artist", isId: true }, songs: { type: "number", name: "Songs" } }
    };
    const linked: LegacyPostgresCollectionConfig = {
        slug: "tracks", name: "Tracks", table: "tracks",
        properties: {
            id: { type: "number", name: "Id", isId: "increment" },
            artist: { type: "string", name: "Artist" },
            stats: { type: "relation", name: "Stats", relation: { kind: "belongsTo", target: () => byArtist, localKey: "artist" } },
            similar: {
                type: "relation", name: "Similar",
                relation: {
                    kind: "manyToMany", target: () => byArtist, relationName: "similar",
                    through: { table: "tracks_similar", sourceColumn: "track_id", targetColumn: "artist" }
                }
            }
        }
    };
    const collections = [songs, linked, byArtist];
    const plan = planCollections(collections);
    const table = (name: string) => plan.tables.find(t => t.table === name);

    it("keeps the belongsTo column, with no foreign key into the view", () => {
        const tracks = table("tracks");
        expect(tracks?.columns.filter(c => c.column === "artist" && !c.columnOwnedByProperty)).toHaveLength(1);
        expect(tracks?.columns.filter(c => c.foreignKey)).toEqual([]);
    });

    it("keys a junction into a view without a foreign key on the view's side", () => {
        const junction = table("tracks_similar");
        expect(junction?.columns.map(c => [c.column, c.foreignKey?.targetTable])).toEqual([
            ["track_id", "tracks"],
            ["artist", undefined]
        ]);
    });

    it("renders no REFERENCES into the view", () => {
        expect(generatePostgresDdl(compileSet(collections))).not.toMatch(/REFERENCES "public"\."by_artist"/);
    });

    it("generates no drizzle relation naming the view, which the file does not declare", () => {
        const schema = generateSchema(compileSet(collections));
        expect(schema).not.toMatch(/\bbyArtist\b/);
        expect(schema).toMatch(/export const tracksSimilar\b/);
    });
});
