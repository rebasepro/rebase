/**
 * Every NOTIFY this package sends, and what it is allowed to carry.
 *
 * Postgres puts no privilege on `LISTEN`: a NOTIFY payload is published to
 * every role that can connect to the database, whatever it may `SELECT`. The
 * change-capture trigger forgot that and put whole rows on `rebase_cdc` — the
 * auth table's password hashes included — for any BI login to read. So a
 * NOTIFY is not an internal detail, it is a broadcast to the database's every
 * login, and each one is listed here with what it carries. A new one fails
 * this file until someone has decided what it may say.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { ChannelHistoryStore } from "../src/services/channel-history";
import { CHANNEL_BUS_NOTIFY_CHANNEL, parseChannelBusPayload } from "../src/services/channel-bus/PostgresChannelBus";

const SRC = join(__dirname, "..", "src");

/** File → the channel it notifies, and why its payload is safe to publish. */
const NOTIFY_SITES: Record<string, string> = {
    "services/cdc/trigger-cdc.ts":
        "rebase_cdc — { schema, table, op, row } where row is the key and nothing else (cdc-payload-identity.test.ts)",
    "services/realtimeService.ts":
        "rebase_entity_changes — { sid, p, eid, db }: an address, never a row (pinned below)",
    "services/channel-bus/PostgresChannelBus.ts":
        "rebase_channel_bus — channel broadcast and presence frames, which clients put on the channel to share",
    "services/channel-history.ts":
        "rebase_channel_bus — a retained message's address { kind: broadcast_ref, sid, channel, seq }, never its event, " +
        "body or sender, whatever its size: the body stays in rebase.channel_messages and receivers read it back (pinned below)"
};

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return path.endsWith(".ts") ? [path] : [];
    });
}

/** Lines that call pg_notify, with comments stripped. */
function notifyCalls(text: string): string[] {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/^\s*--.*$/, "").replace(/\/\/.*$/, ""))
        .filter((line) => /pg_notify\s*\(/i.test(line));
}

describe("the NOTIFY surface", () => {
    it("is exactly the sites listed here", () => {
        const found = sourceFiles(SRC)
            .filter((file) => notifyCalls(readFileSync(file, "utf8")).length > 0)
            .map((file) => relative(SRC, file).split("\\").join("/"))
            .sort();
        expect(found).toEqual(Object.keys(NOTIFY_SITES).sort());
    });

    it("carries an address, not a row, on the cross-instance entity channel", async () => {
        const executed: unknown[] = [];
        const db = {
            execute: jest.fn(async (query: unknown) => { executed.push(query); return { rows: [] }; })
        } as unknown as NodePgDatabase<Record<string, never>>;
        const realtime = new RealtimeService(db, new PostgresCollectionRegistry());

        await Reflect.apply(Reflect.get(realtime, "broadcastChange"), realtime, ["posts", "42", undefined]);

        // drizzle's `sql` keeps its interpolated values on `queryChunks`.
        const chunks = (executed[0] as { queryChunks: unknown[] }).queryChunks;
        const payload = chunks.find((chunk): chunk is string => typeof chunk === "string" && chunk.startsWith("{"));
        expect(payload).toBeDefined();
        expect(Object.keys(JSON.parse(payload!)).sort()).toEqual(["db", "eid", "p", "sid"]);
    });

    it("carries a retained message's address, not the message, on the channel bus", async () => {
        const pglite = new PGlite();
        await pglite.waitReady;
        try {
            const store = new ChannelHistoryStore(drizzle(pglite) as never, [{ match: "doc:*", limit: 10 }]);
            await store.ensureTables();
            const payloads: string[] = [];
            await pglite.listen(CHANNEL_BUS_NOTIFY_CHANNEL, (payload) => { payloads.push(payload); });

            const announce = { notifyChannel: CHANNEL_BUS_NOTIFY_CHANNEL, sid: "instance-a" };
            await store.append("doc:1", "op", { text: "draft body" }, "client_sender", announce);
            // One too large for a NOTIFY travels the same way, not as a refusal.
            await store.append("doc:1", "op", { text: "x".repeat(20_000) }, "client_sender", announce);
            for (let i = 0; i < 100 && payloads.length < 2; i++) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }

            expect(payloads.map((payload) => JSON.parse(payload))).toEqual([
                { kind: "broadcast_ref", sid: "instance-a", channel: "doc:1", seq: 1 },
                { kind: "broadcast_ref", sid: "instance-a", channel: "doc:1", seq: 2 }
            ]);
            for (const payload of payloads) {
                for (const secret of ["draft body", "xxxx", "client_sender", "\"op\""]) {
                    expect(payload).not.toContain(secret);
                }
            }
            // And it is a frame the bus understands — the body is one read away.
            expect(parseChannelBusPayload(payloads[0])).toEqual([
                { kind: "broadcast_ref", sid: "instance-a", channel: "doc:1", from: undefined, seq: 1 }
            ]);
            await expect(store.getBySeq("doc:1", 1)).resolves.toMatchObject({
                event: "op", payload: { text: "draft body" }, senderId: "client_sender"
            });
        } finally {
            await pglite.close();
        }
    });
});
