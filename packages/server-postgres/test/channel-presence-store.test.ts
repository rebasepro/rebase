/**
 * The shared presence roster's own table, against a real database.
 *
 * A socket closing removes its client from every channel with one
 * `DELETE … WHERE client_id = $1`. The table's keys are `(channel, client_id)`
 * and `last_seen`, neither of which leads with the client, so every close
 * scanned the roster — and a deploy closes every socket at once (measured: a
 * 20k-row roster, 1.16 ms per close against 0.034 ms with an index; 1,000
 * closes 615 ms against 3 ms).
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { ChannelPresenceStore } from "../src/services/channel-presence";

describe("the presence roster table", () => {
    let pglite: PGlite;
    let store: ChannelPresenceStore;

    beforeAll(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        // The store issues `execute` and nothing else, which both drivers share.
        store = new ChannelPresenceStore(drizzle(pglite) as unknown as NodePgDatabase<Record<string, unknown>>, "inst_a");
        await store.ensureTables();
    }, 60_000);

    afterAll(async () => {
        await pglite.close();
    });

    it("finds a closing socket's rows by an index, not by reading the roster", async () => {
        await pglite.exec("SET enable_seqscan = off");
        const { rows } = await pglite.query<{ "QUERY PLAN": string }>(
            "EXPLAIN DELETE FROM rebase.channel_presence WHERE client_id = 'c1'"
        );
        const plan = rows.map(row => row["QUERY PLAN"]).join("\n");
        expect(plan).toContain("idx_channel_presence_client");
    });

    it("is created again without complaint by a second instance", async () => {
        const second = new ChannelPresenceStore(drizzle(pglite) as unknown as NodePgDatabase<Record<string, unknown>>, "inst_b");
        await expect(second.ensureTables()).resolves.toBe(true);
        await store.track("doc:1", "c1", { name: "Ada" });
        await store.removeClient("c1");
        expect(await store.roster("doc:1")).toEqual({});
    });
});

describe("the presence roster table, on a backend that changes nothing in its database", () => {
    let pglite: PGlite;

    beforeEach(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
    }, 60_000);

    afterEach(async () => {
        await pglite.close();
    });

    const storeOn = (db: PGlite, sent: string[]) => {
        const handle = drizzle(db);
        const execute = handle.execute.bind(handle);
        // Every statement the store sends, for the assertion below.
        handle.execute = ((query: Parameters<typeof execute>[0]) => {
            const chunks = (query as unknown as { queryChunks?: Array<{ value?: string[] }> }).queryChunks ?? [];
            sent.push(chunks.flatMap(chunk => chunk.value ?? []).join(""));
            return execute(query);
        }) as typeof handle.execute;
        return new ChannelPresenceStore(handle as unknown as NodePgDatabase<Record<string, unknown>>, "inst_a");
    };

    it("uses a roster table a provisioning run made, and creates and revokes nothing", async () => {
        await new ChannelPresenceStore(drizzle(pglite) as unknown as NodePgDatabase<Record<string, unknown>>, "setup").ensureTables();
        const sent: string[] = [];

        await expect(storeOn(pglite, sent).ensureTables({ provision: false })).resolves.toBe(true);

        // The capture sees the probe, so an empty list below means something.
        expect(sent.some(statement => statement.includes("rebase.channel_presence"))).toBe(true);
        expect(sent.filter(statement => /^\s*(CREATE|ALTER|DO|REVOKE|GRANT)\b/i.test(statement))).toEqual([]);
    });

    it("reports a missing one as not ready rather than making it", async () => {
        const sent: string[] = [];

        await expect(storeOn(pglite, sent).ensureTables({ provision: false })).resolves.toBe(false);

        const { rows } = await pglite.query<{ present: boolean }>("SELECT to_regclass('rebase.channel_presence') IS NOT NULL AS present");
        expect(rows[0].present).toBe(false);
    });
});
