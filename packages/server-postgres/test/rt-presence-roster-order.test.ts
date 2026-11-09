/**
 * A client's roster writes land in the order they were made.
 *
 * With a channel bus on, every `presence_track` — the first one and each
 * heartbeat — upserts the client's row in `rebase.channel_presence`, and a
 * leave or a disconnect deletes it. Each was its own statement on the pool,
 * sent without waiting for the one before, so a disconnect that arrived while
 * the client's upsert was still on its way could delete first and be followed
 * by the upsert. The row that came back belongs to this instance, and nothing
 * reaps one of those: the stale-roster sweep leaves an instance's own rows to
 * its in-process sweep, which only knows the clients it still holds. Every
 * `presence_state` answered with the departed client, and its last state, for
 * as long as the instance ran.
 *
 * Against a real database (PGlite), with the client's upsert held back the way
 * a busy pool holds it.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import type { ChannelBus, ChannelBusHandler } from "../src/services/channel-bus";
import { fakeRealtimeSocket } from "./helpers/spg-c-socket";
import { PgDialect } from "drizzle-orm/pg-core";

/** A bus that carries nothing: only its being on matters, since that is what brings the shared roster up. */
class SilentBus implements ChannelBus {
    readonly kind = "test-transport";
    maxFrameBytes = 8000;
    async start(_handler: ChannelBusHandler): Promise<void> { /* nothing to start */ }
    async publish(): Promise<void> { /* nowhere to send */ }
    async stop(): Promise<void> { /* nothing to stop */ }
}

function socket() {
    return fakeRealtimeSocket();
}

async function settle(): Promise<void> {
    for (let i = 0; i < 50; i++) await new Promise(resolve => setImmediate(resolve));
}

describe("the shared presence roster", () => {
    let pglite: PGlite;
    let service: RealtimeService;
    /** Upserts of the roster wait on this while it is set. */
    let gate: Promise<void> | undefined;

    beforeEach(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        const handle = drizzle(pglite);
        const execute = handle.execute.bind(handle);
        handle.execute = (async (query: Parameters<typeof execute>[0]) => {
            const text = typeof query === "string" ? query : new PgDialect().sqlToQuery(query.getSQL()).sql;
            if (gate && text.includes("INSERT INTO rebase.channel_presence")) await gate;
            return execute(query);
        }) as typeof handle.execute;
        // PGlite's drizzle database stands in for node-postgres's: the service names NodePgDatabase,
        // whose `$client` is a pg pool, and no typed bridge between the two exists.
        service = new RealtimeService(handle as unknown as NodePgDatabase<Record<string, unknown>>, new PostgresCollectionRegistry());
        await service.configureChannelBus(new SilentBus());
    }, 60_000);

    afterEach(async () => {
        await service.destroy();
        await pglite.close();
    });

    const rosterRows = async () =>
        (await pglite.query<{ client_id: string }>("SELECT client_id FROM rebase.channel_presence ORDER BY client_id")).rows
            .map(row => row.client_id);

    it("keeps no row for a client that disconnected while its presence was being written", async () => {
        const leaver = socket();
        service.addClient("leaver", leaver);
        await service.handleClientMessage("leaver", { type: "presence_track", payload: { channel: "doc:1", state: { name: "Ada" } } });

        let release!: () => void;
        gate = new Promise<void>(resolve => { release = resolve; });
        // A heartbeat, held on its way to the database…
        await service.handleClientMessage("leaver", { type: "presence_track", payload: { channel: "doc:1", state: { name: "Ada" } } });
        await settle();
        // …while the socket closes.
        const removal = service.removeClient("leaver");
        await settle();
        release();
        await removal;
        await settle();

        expect(await rosterRows()).toEqual([]);

        // And the roster a member who joins later is answered with does not name it.
        const reader = socket();
        service.addClient("reader", reader);
        await service.handleClientMessage("reader", { type: "join_channel", payload: { channel: "doc:1" } });
        await service.handleClientMessage("reader", { type: "presence_state", payload: { channel: "doc:1" } });
        await settle();
        const roster = reader.send.mock.calls
            .map(([frame]) => JSON.parse(frame) as { type: string; presences?: Record<string, unknown> })
            .find(frame => frame.type === "presence_state");
        expect(roster?.presences).toEqual({});
    });

    it("keeps no row for a client that left the channel while its presence was being written", async () => {
        const leaver = socket();
        service.addClient("leaver", leaver);

        let release!: () => void;
        gate = new Promise<void>(resolve => { release = resolve; });
        await service.handleClientMessage("leaver", { type: "presence_track", payload: { channel: "doc:1", state: { name: "Ada" } } });
        await settle();
        await service.handleClientMessage("leaver", { type: "leave_channel", payload: { channel: "doc:1" } });
        await settle();
        release();
        await settle();

        expect(await rosterRows()).toEqual([]);
    });

    it("still records the presence of a client that stays", async () => {
        const stayer = socket();
        service.addClient("stayer", stayer);
        await service.handleClientMessage("stayer", { type: "presence_track", payload: { channel: "doc:1", state: { name: "Ada" } } });
        await settle();
        expect(await rosterRows()).toEqual(["stayer"]);
    });
});
