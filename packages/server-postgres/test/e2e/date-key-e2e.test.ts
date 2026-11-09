/**
 * E2E: a calendar day in a composite primary key — `(day, sid)` with `day` a
 * `date` property on a `date` column (`isId: "manual"`).
 *
 * A key like that was declared as a string, so `db push` planned the column as
 * `text` and an application that had a `date` column had to ALTER it back at
 * runtime. What must hold, in any time zone the process runs in (the e2e lane
 * runs this under America/Los_Angeles, where a day read through a `Date` comes
 * back as the day before):
 *
 * - the schema keys the table on a `date` column;
 * - a row's day reads back as `YYYY-MM-DD`, from a create, a find and a get by
 *   id, in-process and over REST;
 * - the address is `YYYY-MM-DD:::sid`, and update and delete by it reach the row;
 * - a filter on the day is a day.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";
import { generatePostgresDdl } from "../../src/schema/generate-postgres-ddl-logic.js";

const scores: CollectionConfig = {
    name: "Scores",
    slug: "scores",
    table: "scores",
    properties: {
        day: { name: "Day", type: "date", columnType: "date", isId: "manual" },
        sid: { name: "Player", type: "string", isId: "manual" },
        hype: { name: "Hype", type: "number" }
    }
};

describe("a date in a composite key (E2E)", () => {
    let container: PgContainer;
    let rebase: OpenedRebase;
    const quiet: Array<{ mockRestore(): void }> = [];

    beforeAll(async () => {
        container = await startPgContainer();
        quiet.push(vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "info").mockImplementation(() => undefined));
        const conn = createPostgresDatabaseConnection(container.connectionString);
        try {
            const bootstrapper = createPostgresBootstrapper({ connectionString: container.connectionString, connection: conn.db });
            const driverResult = await bootstrapper.initializeDriver({ collections: [scores], realtime: { subscribe: false, provision: false } });
            await bootstrapper.ensureCollectionSchema!([scores], driverResult);
            await bootstrapper.ensureRlsRuntime!(driverResult);
            await bootstrapper.ensureCollectionPolicies!([scores], driverResult);
            await bootstrapper.finalizeSecurityPosture!(driverResult);
        } finally {
            await conn.pool.end();
        }
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [scores] });
    }, 180_000);

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await rebase?.close();
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("keys the table on a date column, in the DDL and in the database", async () => {
        expect(generatePostgresDdl([scores], { includePolicies: false })).toMatch(/"day" DATE NOT NULL/i);
        const rows = await rebase.sql(`SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type
            FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = 'public.scores'::regclass AND i.indisprimary ORDER BY a.attname`);
        expect(rows).toEqual([{ attname: "day", type: "date" }, { attname: "sid", type: "text" }]);
    });

    it("reads a day back as YYYY-MM-DD and addresses the row by it", async () => {
        const created = await rebase.dataAsAdmin.scores.create({ day: "2026-11-09", sid: "a", hype: 1 });
        expect(created.day).toBe("2026-11-09");

        const found = await rebase.dataAsAdmin.scores.findById("2026-11-09:::a");
        expect(found).toMatchObject({ day: "2026-11-09", sid: "a", hype: 1 });

        const { data } = await rebase.dataAsAdmin.scores.find({ where: { day: ["==", "2026-11-09"] }, count: "none" });
        expect(data.map(row => row.day)).toEqual(["2026-11-09"]);

        const updated = await rebase.dataAsAdmin.scores.update("2026-11-09:::a", { hype: 2 });
        expect(updated).toMatchObject({ day: "2026-11-09", hype: 2 });
        expect(await rebase.sql("SELECT day::text AS day, hype::int AS hype FROM public.scores")).toEqual([{ day: "2026-11-09", hype: 2 }]);

        await rebase.dataAsAdmin.scores.delete("2026-11-09:::a");
        expect(await rebase.sql("SELECT count(*)::int AS n FROM public.scores")).toEqual([{ n: 0 }]);
    });

    it("takes a day sent as a timestamp or a Date as that day, not a neighbour", async () => {
        const fromInstant = await rebase.dataAsAdmin.scores.create({ day: "2026-12-31T00:00:00.000Z", sid: "b", hype: 1 } as never);
        expect(fromInstant.day).toBe("2026-12-31");
        const fromDate = await rebase.dataAsAdmin.scores.upsert({ day: new Date(Date.UTC(2027, 0, 1)), sid: "b", hype: 1 } as never);
        expect(fromDate.day).toBe("2027-01-01");
        expect(await rebase.sql("SELECT day::text AS day FROM public.scores WHERE sid = 'b' ORDER BY day")).toEqual([{ day: "2026-12-31" }, { day: "2027-01-01" }]);
    });
});
