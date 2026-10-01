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
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const SRC = join(__dirname, "..", "src");

/** File → the channel it notifies, and why its payload is safe to publish. */
const NOTIFY_SITES: Record<string, string> = {
    "services/cdc/trigger-cdc.ts":
        "rebase_cdc — { schema, table, op, row } where row is the key and nothing else (cdc-payload-identity.test.ts)",
    "services/realtimeService.ts":
        "rebase_entity_changes — { sid, p, eid, db }: an address, never a row (pinned below)",
    "services/channel-bus/PostgresChannelBus.ts":
        "rebase_channel_bus — channel broadcast and presence frames, which clients put on the channel to share"
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
});
