/**
 * The logical replication format, read from frames built byte by byte.
 *
 * WAL capture hands `RealtimeService` the same events the trigger listener
 * does, so what matters is that a stream turns into exactly those: the key a
 * row is addressed by, for each row a committed transaction changed, and
 * never a value the trigger would not have sent.
 */
import { describe, expect, it } from "@jest/globals";

import {
    PgoutputChanges,
    copyDataFrame,
    encodeStandbyStatus,
    formatLsn,
    parsePgoutputMessage,
    parseReplicationFrame,
    type PgoutputMessage
} from "../src/services/cdc/pgoutput";

// ── Frame builders ─────────────────────────────────────────────────────

const byte = (c: string) => Buffer.from(c, "latin1");
const int8 = (n: number) => { const b = Buffer.alloc(1); b.writeInt8(n); return b; };
const int16 = (n: number) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const int32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const uint32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const uint64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(n); return b; };
const cstring = (s: string) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);

type Cell = string | null | "UNCHANGED";
const tuple = (cells: Cell[]) => Buffer.concat([
    int16(cells.length),
    ...cells.map((cell) => {
        if (cell === null) return byte("n");
        if (cell === "UNCHANGED") return byte("u");
        const text = Buffer.from(cell, "utf8");
        return Buffer.concat([byte("t"), int32(text.length), text]);
    })
]);

interface Col { name: string; key?: boolean; oid?: number }
const relation = (id: number, schema: string, table: string, cols: Col[], identity = "d") => Buffer.concat([
    byte("R"), uint32(id), cstring(schema), cstring(table), byte(identity), int16(cols.length),
    ...cols.map((c) => Buffer.concat([int8(c.key ? 1 : 0), cstring(c.name), uint32(c.oid ?? 25), int32(-1)]))
]);
const begin = (finalLsn: bigint, xid: number) => Buffer.concat([byte("B"), uint64(finalLsn), uint64(0n), uint32(xid)]);
const commit = (commitLsn: bigint, endLsn: bigint) => Buffer.concat([byte("C"), int8(0), uint64(commitLsn), uint64(endLsn), uint64(0n)]);
const insert = (rel: number, cells: Cell[]) => Buffer.concat([byte("I"), uint32(rel), byte("N"), tuple(cells)]);
const update = (rel: number, cells: Cell[], old?: { kind: "K" | "O"; cells: Cell[] }) => Buffer.concat([
    byte("U"), uint32(rel), ...(old ? [byte(old.kind), tuple(old.cells)] : []), byte("N"), tuple(cells)
]);
const del = (rel: number, kind: "K" | "O", cells: Cell[]) => Buffer.concat([byte("D"), uint32(rel), byte(kind), tuple(cells)]);
const truncate = (rels: number[]) => Buffer.concat([byte("T"), int32(rels.length), int8(0), ...rels.map(uint32)]);
const xlog = (data: Buffer, walStart = 0x10n, walEnd = 0x20n) => Buffer.concat([byte("w"), uint64(walStart), uint64(walEnd), uint64(0n), data]);
const keepalive = (walEnd: bigint, reply: boolean) => Buffer.concat([byte("k"), uint64(walEnd), uint64(0n), int8(reply ? 1 : 0)]);

/** Every message through one decoder, in order, as the listener feeds it. */
function eventsOf(messages: Buffer[], identity: Record<string, string[]> = {}) {
    const changes = new PgoutputChanges((schema, table) => identity[`${schema}.${table}`]);
    return messages.flatMap((m) => changes.apply(parsePgoutputMessage(m)));
}

const POSTS: Col[] = [{ name: "id", key: true, oid: 20 }, { name: "title" }, { name: "body" }];

// ── Tests ──────────────────────────────────────────────────────────────

describe("replication frames", () => {
    it("reads a WAL chunk's positions and keeps its data", () => {
        const data = begin(0x1234n, 7);
        const frame = parseReplicationFrame(xlog(data, 0x16b374d848n, 0x16b374d900n));
        expect(frame).toEqual({ kind: "xlog", walStart: 0x16b374d848n, walEnd: 0x16b374d900n, data });
    });

    it("reads a keepalive and whether it wants an answer", () => {
        expect(parseReplicationFrame(keepalive(99n, true))).toEqual({ kind: "keepalive", walEnd: 99n, replyRequested: true });
        expect(parseReplicationFrame(keepalive(99n, false))).toEqual({ kind: "keepalive", walEnd: 99n, replyRequested: false });
    });

    it("throws on a frame it does not know, so the listener reconnects rather than guesses", () => {
        expect(() => parseReplicationFrame(byte("z"))).toThrow(/unknown replication frame/);
        expect(() => parseReplicationFrame(byte("w"))).toThrow(/ends early/);
    });
});

describe("pgoutput messages", () => {
    it("reads begin and commit", () => {
        expect(parsePgoutputMessage(begin(0xabcn, 42))).toEqual({ tag: "begin", finalLsn: 0xabcn, xid: 42 });
        expect(parsePgoutputMessage(commit(0x100n, 0x180n))).toEqual({ tag: "commit", commitLsn: 0x100n, endLsn: 0x180n });
    });

    it("reads a relation's columns and which of them are its key", () => {
        const message = parsePgoutputMessage(relation(16385, "public", "posts", POSTS));
        expect(message).toEqual({
            tag: "relation",
            relation: {
                id: 16385,
                schema: "public",
                table: "posts",
                replicaIdentity: "d",
                columns: [
                    { name: "id", isKey: true, typeOid: 20 },
                    { name: "title", isKey: false, typeOid: 25 },
                    { name: "body", isKey: false, typeOid: 25 }
                ]
            }
        });
    });

    it("reads nulls, unchanged TOAST values and UTF-8 text in a tuple", () => {
        const message = parsePgoutputMessage(update(1, ["7", null, "UNCHANGED"]));
        expect(message).toEqual({ tag: "update", relationId: 1, newTuple: ["7", null, undefined] });
        const unicode = parsePgoutputMessage(insert(1, ["8", "héllo ✓", null]));
        expect(unicode).toEqual({ tag: "insert", relationId: 1, newTuple: ["8", "héllo ✓", null] });
    });

    it("reads an update's old key and a delete's old tuple, and says which kind each is", () => {
        expect(parsePgoutputMessage(update(1, ["8", "t", "b"], { kind: "K", cells: ["7", null, null] }))).toEqual({
            tag: "update", relationId: 1, oldTuple: ["7", null, null], oldIsKeyOnly: true, newTuple: ["8", "t", "b"]
        });
        expect(parsePgoutputMessage(del(1, "O", ["7", "t", "b"]))).toEqual({
            tag: "delete", relationId: 1, oldIsKeyOnly: false, oldTuple: ["7", "t", "b"]
        });
    });

    it("reads a truncate of several tables", () => {
        expect(parsePgoutputMessage(truncate([10, 11]))).toEqual({ tag: "truncate", relationIds: [10, 11] });
    });

    it("passes over messages capture does not act on", () => {
        expect(parsePgoutputMessage(Buffer.concat([byte("O"), uint64(1n), cstring("origin")]))).toEqual({ tag: "other", type: "O" });
    });
});

describe("pgoutput → change events", () => {
    it("names an inserted, updated and deleted row by its key and nothing else", () => {
        const events = eventsOf([
            relation(1, "public", "posts", POSTS),
            begin(1n, 1),
            insert(1, ["7", "secret title", "secret body"]),
            update(1, ["7", "changed", "UNCHANGED"]),
            del(1, "K", ["7", null, null]),
            commit(1n, 2n)
        ]);
        expect(events).toEqual([
            { schema: "public", table: "posts", op: "INSERT", row: { id: "7" }, truncated: false },
            { schema: "public", table: "posts", op: "UPDATE", row: { id: "7" }, truncated: false },
            { schema: "public", table: "posts", op: "DELETE", row: { id: "7" }, truncated: false }
        ]);
        expect(JSON.stringify(events)).not.toMatch(/secret|changed/);
    });

    it("adds the columns provisioning asked for to the primary key, as the trigger does", () => {
        const cols: Col[] = [{ name: "id", key: true }, { name: "user_id" }, { name: "note" }];
        const events = eventsOf([relation(2, "public", "profiles", cols), insert(2, ["1", "u-9", "x"])], { "public.profiles": ["user_id"] });
        expect(events[0].row).toEqual({ id: "1", user_id: "u-9" });
    });

    it("leaves out a requested column the table does not have", () => {
        const events = eventsOf([relation(1, "public", "posts", POSTS), insert(1, ["7", "t", "b"])], { "public.posts": ["id", "gone"] });
        expect(events[0].row).toEqual({ id: "7" });
    });

    it("drops a composite key it can only half read, rather than address the wrong row", () => {
        const cols: Col[] = [{ name: "a", key: true }, { name: "b", key: true }, { name: "ref" }];
        const events = eventsOf([relation(7, "public", "pairs", cols), update(7, ["1", "UNCHANGED", "r-1"])], { "public.pairs": ["ref"] });
        expect(events[0].row).toEqual({ ref: "r-1" });
    });

    it("names a junction row by its two ids", () => {
        const cols: Col[] = [{ name: "post_id", key: true, oid: 23 }, { name: "tag_id", key: true, oid: 23 }];
        const events = eventsOf([relation(3, "public", "posts_tags", cols), del(3, "K", ["1", "5"])], { "public.posts_tags": ["post_id", "tag_id"] });
        expect(events).toEqual([{ schema: "public", table: "posts_tags", op: "DELETE", row: { post_id: "1", tag_id: "5" }, truncated: false }]);
    });

    it("falls back to the replica identity when an old key-only tuple cannot supply the wanted columns", () => {
        // A junction keyed by a surrogate id: its delete carries `id` only,
        // with post_id/tag_id sent as nulls they never were.
        const cols: Col[] = [{ name: "id", key: true }, { name: "post_id" }, { name: "tag_id" }];
        const events = eventsOf([relation(4, "public", "links", cols), del(4, "K", ["99", null, null])], { "public.links": ["post_id", "tag_id"] });
        expect(events[0].row).toEqual({ id: "99" });
        expect(events[0].truncated).toBe(false);
    });

    it("announces an unaddressable row as a change to the whole table", () => {
        // No key at all, and an unchanged (unsent) value where one was wanted.
        const cols: Col[] = [{ name: "a" }, { name: "b" }];
        const events = eventsOf([relation(5, "public", "keyless", cols), update(5, ["UNCHANGED", "2"])], { "public.keyless": ["a"] });
        expect(events).toEqual([{ schema: "public", table: "keyless", op: "UPDATE", row: {}, truncated: true }]);
    });

    it("announces both addresses when an update changes the key", () => {
        const events = eventsOf([
            relation(1, "public", "posts", POSTS),
            update(1, ["8", "t", "b"], { kind: "K", cells: ["7", null, null] })
        ]);
        expect(events.map((e) => e.row)).toEqual([{ id: "8" }, { id: "7" }]);
    });

    it("announces one address when a full old tuple shows the key did not change", () => {
        const events = eventsOf([
            relation(1, "public", "posts", POSTS, "f"),
            update(1, ["7", "new", "b"], { kind: "O", cells: ["7", "old", "b"] })
        ]);
        expect(events.map((e) => e.row)).toEqual([{ id: "7" }]);
    });

    it("writes a boolean key the way the trigger's JSON did", () => {
        const cols: Col[] = [{ name: "flag", key: true, oid: 16 }];
        const events = eventsOf([relation(6, "public", "flags", cols), insert(6, ["t"]), insert(6, ["f"])]);
        expect(events.map((e) => e.row)).toEqual([{ flag: "true" }, { flag: "false" }]);
    });

    it("turns a truncate into one event per table it names", () => {
        const events = eventsOf([
            relation(1, "public", "posts", POSTS),
            relation(3, "public", "posts_tags", [{ name: "post_id", key: true }, { name: "tag_id", key: true }]),
            truncate([1, 3])
        ]);
        expect(events).toEqual([
            { schema: "public", table: "posts", op: "TRUNCATE", row: {}, truncated: false },
            { schema: "public", table: "posts_tags", op: "TRUNCATE", row: {}, truncated: false }
        ]);
    });

    it("reads a relation described again after its schema changed", () => {
        const events = eventsOf([
            relation(1, "public", "posts", POSTS),
            relation(1, "public", "posts", [{ name: "slug", key: true }, ...POSTS.slice(1)]),
            insert(1, ["hello", "t", "b"])
        ]);
        expect(events[0].row).toEqual({ slug: "hello" });
    });

    it("throws on a row for a relation the stream never described", () => {
        expect(() => eventsOf([insert(77, ["1"])])).toThrow(/never described/);
    });

    it("ignores begin, commit and other messages", () => {
        const changes = new PgoutputChanges(() => undefined);
        const quiet: PgoutputMessage[] = [
            { tag: "begin", finalLsn: 1n, xid: 1 },
            { tag: "commit", commitLsn: 1n, endLsn: 2n },
            { tag: "other", type: "Y" }
        ];
        expect(quiet.flatMap((m) => changes.apply(m))).toEqual([]);
    });
});

describe("standby status and framing", () => {
    it("reports one position as written, flushed and applied, in Postgres's epoch", () => {
        const unixMs = Date.UTC(2000, 0, 1, 0, 0, 1); // one second after Postgres's epoch
        const status = encodeStandbyStatus(0x16b374d848n, true, unixMs);
        expect(status.length).toBe(34);
        expect(status.toString("latin1", 0, 1)).toBe("r");
        expect(status.readBigUInt64BE(1)).toBe(0x16b374d848n);
        expect(status.readBigUInt64BE(9)).toBe(0x16b374d848n);
        expect(status.readBigUInt64BE(17)).toBe(0x16b374d848n);
        expect(status.readBigUInt64BE(25)).toBe(1_000_000n);
        expect(status.readUInt8(33)).toBe(1);
        expect(encodeStandbyStatus(1n, false, unixMs).readUInt8(33)).toBe(0);
    });

    it("frames CopyData with a length that counts itself", () => {
        const frame = copyDataFrame(Buffer.from("abc"));
        expect(frame.toString("latin1", 0, 1)).toBe("d");
        expect(frame.readUInt32BE(1)).toBe(7);
        expect(frame.subarray(5).toString()).toBe("abc");
    });

    it("writes an LSN the way Postgres does", () => {
        expect(formatLsn(0x16b374d848n)).toBe("16/B374D848");
        expect(formatLsn(0n)).toBe("0/0");
    });
});
