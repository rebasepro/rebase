/**
 * The boot's drift check sees the views a collection serves.
 *
 * It read only `BASE TABLE`s, so every boot of a project with a view or
 * materialized-view collection warned "SCHEMA DRIFT — the database is missing
 * tables this backend serves" for each of them, right after the ensure step
 * had created them, and told the operator to run a `db push` that had nothing
 * to do. A materialized view's collection is served by a plain view of the
 * collection's name over its stored rows, so plain views cover both.
 */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { DRIFT_CHECK_RELATIONS_SQL } from "../src/PostgresBootstrapper";

let db: PGlite;

beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
        CREATE TABLE songs (id int PRIMARY KEY, artist text);
        CREATE VIEW by_artist WITH (security_invoker = true) AS SELECT artist, count(*) AS songs FROM songs GROUP BY artist;
        CREATE MATERIALIZED VIEW top_artists_rebase_rows AS SELECT artist FROM songs GROUP BY artist;
        CREATE VIEW top_artists AS SELECT rows.*, rows.xmin AS xmin FROM top_artists_rebase_rows rows;
        CREATE SCHEMA reports;
        CREATE VIEW reports.weekly AS SELECT 1 AS id;
    `);
});

afterAll(async () => {
    await db.close();
});

describe("the boot's drift check", () => {
    it("lists tables and the views that view collections serve, with their schemas", async () => {
        const { rows } = await db.query<{ table_name: string; table_schema: string }>(DRIFT_CHECK_RELATIONS_SQL);
        const found = rows.map(row => `${row.table_schema}.${row.table_name}`);
        expect(found).toEqual(expect.arrayContaining([
            "public.songs", "public.by_artist", "public.top_artists", "reports.weekly"
        ]));
    });
});
