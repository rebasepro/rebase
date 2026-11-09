/**
 * E2E: `rebase.sql(text, { params })` binds `$n` the way `pg` does, against a
 * real Postgres (`utils/positional-params.ts`).
 *
 * Each occurrence of a `$n` used to be bound as a parameter of its own, so a
 * parameter reused without a cast failed with `could not determine data type
 * of parameter $2`, and a `'$1'` inside a literal was bound too. What must
 * hold, on the unswitched path and the role-switched one:
 *
 * - an uncast parameter used several times is one parameter, and runs;
 * - `'$1'` in a literal and `$1` in a comment stay text.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { openRebase, type OpenedRebase } from "../../src/index.js";

const REUSED = "SELECT $1 AS a, upper($1) AS b, coalesce($1, 'none') AS c, $1 = 'se' AS same, '$1' AS literal /* $2 */";

describe("rebase.sql positional parameters (E2E)", () => {
    let container: PgContainer;
    let rebase: OpenedRebase;

    beforeAll(async () => {
        container = await startPgContainer();
        const client = new pg.Client({ connectionString: container.connectionString });
        await client.connect();
        await client.query("CREATE ROLE params_reader NOLOGIN; GRANT params_reader TO CURRENT_USER");
        await client.end();
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [] });
    }, 180_000);

    afterAll(async () => {
        await rebase?.close();
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("runs what pg runs: a reused uncast parameter is one parameter, and a literal stays text", async () => {
        const client = new pg.Client({ connectionString: container.connectionString });
        await client.connect();
        const expected = (await client.query(REUSED, ["se"])).rows;
        await client.end();
        expect(expected).toEqual([{ a: "se", b: "SE", c: "se", same: true, literal: "$1" }]);

        expect(await rebase.sql(REUSED, { params: ["se"] })).toEqual(expected);
    });

    it("does the same on the role-switched path", async () => {
        expect(await rebase.sql(REUSED, { params: ["se"], role: "params_reader" })).toEqual([
            { a: "se", b: "SE", c: "se", same: true, literal: "$1" }
        ]);
    });
});
