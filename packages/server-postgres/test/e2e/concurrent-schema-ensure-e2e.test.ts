/**
 * E2E: several instances provisioning the same fresh database at once.
 *
 * ## Why a real database
 *
 * The unit tests for this inject a wrapped SQLSTATE, which proves the handling
 * is right but assumes the premise. The premise is the surprising part:
 * `CREATE … IF NOT EXISTS` reads the catalog and then writes to it as two
 * separate steps, so simultaneous callers do not quietly no-op — the loser gets
 * a duplicate key on a *catalog* index. That was measured at 8 losses in 10 with
 * five instances, and it is a claim about Postgres, not about our code. Only a
 * real Postgres can keep it honest.
 *
 * ## What must hold
 *
 * Every instance completes, and the schema ends up whole. The failure this
 * replaced was not "a table is missing" — one instance always finishes — it was
 * that the losing instance THREW, abandoning every remaining action in its plan.
 * So the assertion that matters is that no caller rejects.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureCollectionTables, type Queryable } from "../../src/schema/ensure-collection-tables.js";

/** Enough collections, columns and enums that a plan has many steps to lose. */
function collections(): CollectionConfig[] {
    const make = (slug: string): CollectionConfig => ({
        name: slug,
        slug,
        table: slug,
        schema: "public",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            title: { name: "Title", type: "string" },
            views: { name: "Views", type: "number" },
            // An enum, because `CREATE TYPE` has no `IF NOT EXISTS` at all and is
            // therefore the statement most likely to lose a race.
            status: {
                name: "Status",
                type: "string",
                enum: [
                    { id: "draft", label: "Draft" },
                    { id: "published", label: "Published" }
                ]
            }
        }
    } as unknown as CollectionConfig);

    return ["race_posts", "race_notes", "race_pages", "race_tags"].map(make);
}

const INSTANCES = 5;

let container: PgContainer;
const clients: pg.Client[] = [];

/** One connection per "instance", so they genuinely contend in the catalog. */
async function instance(): Promise<Queryable> {
    const client = new pg.Client({ connectionString: container.connectionString });
    await client.connect();
    clients.push(client);
    return {
        query: async <T>(sql: string) => {
            const result = await client.query(sql);
            return { rows: result.rows as T[] };
        }
    };
}

beforeAll(async () => {
    container = await startPgContainer();
}, 180_000);

afterAll(async () => {
    await Promise.all(clients.map(client => client.end().catch(() => { /* already gone */ })));
    if (container) await stopPgContainer(container);
}, 120_000);

describe("five instances booting into one empty database", () => {
    it("all complete, and none abandons its plan", async () => {
        const configs = collections();
        const instances = await Promise.all(Array.from({ length: INSTANCES }, () => instance()));

        const results = await Promise.allSettled(
            instances.map(client => ensureCollectionTables(client, configs))
        );

        const rejected = results.filter(r => r.status === "rejected");
        // Named in the failure message: "3 of 5 rejected" with no reason is the
        // least useful thing this test could say when it goes red.
        expect(
            rejected.map(r => String((r as PromiseRejectedResult).reason?.message ?? r))
        ).toEqual([]);
    }, 180_000);

    it("leaves every table, column and enum in place", async () => {
        const probe = new pg.Client({ connectionString: container.connectionString });
        await probe.connect();
        try {
            for (const config of collections()) {
                const { rows } = await probe.query(
                    `SELECT column_name FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = $1`,
                    [config.table]
                );
                const columns = rows.map(r => r.column_name).sort();

                // Every column of every collection: the abandoned-plan bug shows
                // up here as a table that exists with only the columns that came
                // before the losing statement.
                expect(columns).toEqual(["id", "status", "title", "views"]);
            }

            const { rows: enums } = await probe.query(
                "SELECT typname FROM pg_type WHERE typname LIKE 'race_%_status'"
            );
            expect(enums.length).toBe(collections().length);
        } finally {
            await probe.end();
        }
    }, 120_000);

    it("is a no-op when run again against the finished schema", async () => {
        // Re-running is what every restart does. It must apply nothing rather
        // than treat the existing schema as a race it lost.
        const client = await instance();

        const plan = await ensureCollectionTables(client, collections());

        expect(plan.actions).toEqual([]);
    }, 120_000);
});
