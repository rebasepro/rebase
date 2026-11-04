/**
 * The logical replication wire format, as far as change capture needs it.
 *
 * A `START_REPLICATION … LOGICAL` stream is a COPY in both directions. The
 * server sends CopyData frames that are either a keepalive or a chunk of WAL;
 * with the built-in `pgoutput` plugin each WAL chunk is one message — a
 * transaction's begin and commit, a table's description, a row inserted,
 * updated or deleted, a truncate. The client answers with standby status
 * updates naming how far it has read, which is what lets the server recycle
 * the WAL behind it.
 *
 * Everything here is a pure function of bytes, so it is tested against frames
 * built by hand; the connection that carries them is `WalCdcListener`.
 *
 * Formats: https://www.postgresql.org/docs/current/protocol-replication.html
 * and https://www.postgresql.org/docs/current/protocol-logicalrep-message-formats.html
 * (protocol version 1, the only one this asks for).
 */
import type { CdcChangeEvent } from "./CdcListener";

/** Microseconds between the Unix epoch and Postgres's, 2000-01-01. */
const PG_EPOCH_OFFSET_US = 946_684_800_000_000n;

/** A column of a table as `pgoutput` describes it. */
export interface PgoutputColumn {
    name: string;
    /** Part of the replica identity: present in the old tuple of an update or delete. */
    isKey: boolean;
    typeOid: number;
}

export interface PgoutputRelation {
    id: number;
    schema: string;
    table: string;
    /** `d` default (the primary key), `n` nothing, `f` full, `i` index. */
    replicaIdentity: string;
    columns: PgoutputColumn[];
}

/**
 * One column of a row. `undefined` is an unchanged TOASTed value: the server
 * did not send it because the update did not touch it.
 */
export type TupleValue = string | null | undefined;

export type PgoutputMessage =
    | { tag: "begin"; finalLsn: bigint; xid: number }
    | { tag: "commit"; commitLsn: bigint; endLsn: bigint }
    | { tag: "relation"; relation: PgoutputRelation }
    | { tag: "insert"; relationId: number; newTuple: TupleValue[] }
    | { tag: "update"; relationId: number; oldTuple?: TupleValue[]; oldIsKeyOnly?: boolean; newTuple: TupleValue[] }
    | { tag: "delete"; relationId: number; oldTuple: TupleValue[]; oldIsKeyOnly: boolean }
    | { tag: "truncate"; relationIds: number[] }
    /** Origin, type and logical messages: nothing capture acts on. */
    | { tag: "other"; type: string };

export type ReplicationFrame =
    | { kind: "xlog"; walStart: bigint; walEnd: bigint; data: Buffer }
    | { kind: "keepalive"; walEnd: bigint; replyRequested: boolean };

/** A cursor over one message. Reading past the end throws, which the caller treats as a malformed frame. */
class Reader {
    private offset = 0;

    constructor(private readonly buf: Buffer) {}

    byte(): string {
        this.need(1);
        return String.fromCharCode(this.buf[this.offset++]);
    }

    int8(): number {
        this.need(1);
        return this.buf.readInt8(this.offset++);
    }

    int16(): number {
        this.need(2);
        const value = this.buf.readInt16BE(this.offset);
        this.offset += 2;
        return value;
    }

    int32(): number {
        this.need(4);
        const value = this.buf.readInt32BE(this.offset);
        this.offset += 4;
        return value;
    }

    uint32(): number {
        this.need(4);
        const value = this.buf.readUInt32BE(this.offset);
        this.offset += 4;
        return value;
    }

    uint64(): bigint {
        this.need(8);
        const value = this.buf.readBigUInt64BE(this.offset);
        this.offset += 8;
        return value;
    }

    /** A NUL-terminated string. */
    cstring(): string {
        const end = this.buf.indexOf(0, this.offset);
        if (end < 0) throw new Error("unterminated string");
        const value = this.buf.toString("utf8", this.offset, end);
        this.offset = end + 1;
        return value;
    }

    bytes(length: number): Buffer {
        this.need(length);
        const value = this.buf.subarray(this.offset, this.offset + length);
        this.offset += length;
        return value;
    }

    rest(): Buffer {
        return this.buf.subarray(this.offset);
    }

    private need(length: number): void {
        if (this.offset + length > this.buf.length) throw new Error("message ends early");
    }
}

/** The payload of one CopyData frame from a replication stream. */
export function parseReplicationFrame(payload: Buffer): ReplicationFrame {
    const reader = new Reader(payload);
    const kind = reader.byte();
    if (kind === "w") {
        const walStart = reader.uint64();
        const walEnd = reader.uint64();
        reader.uint64(); // the server's clock
        return { kind: "xlog", walStart, walEnd, data: reader.rest() };
    }
    if (kind === "k") {
        const walEnd = reader.uint64();
        reader.uint64(); // the server's clock
        return { kind: "keepalive", walEnd, replyRequested: reader.byte() === "\u0001" };
    }
    throw new Error(`unknown replication frame '${kind}'`);
}

function readTuple(reader: Reader): TupleValue[] {
    const count = reader.int16();
    const values: TupleValue[] = [];
    for (let i = 0; i < count; i++) {
        const kind = reader.byte();
        if (kind === "n") {
            values.push(null);
        } else if (kind === "u") {
            values.push(undefined);
        } else if (kind === "t") {
            values.push(reader.bytes(reader.int32()).toString("utf8"));
        } else if (kind === "b") {
            // Only sent when the binary option is asked for, and it is not.
            reader.bytes(reader.int32());
            values.push(undefined);
        } else {
            throw new Error(`unknown tuple column kind '${kind}'`);
        }
    }
    return values;
}

/** One `pgoutput` message: the data of an `xlog` frame. */
export function parsePgoutputMessage(data: Buffer): PgoutputMessage {
    const reader = new Reader(data);
    const type = reader.byte();
    switch (type) {
        case "B": {
            const finalLsn = reader.uint64();
            reader.uint64(); // commit time
            return { tag: "begin", finalLsn, xid: reader.uint32() };
        }
        case "C": {
            reader.int8(); // flags, unused
            const commitLsn = reader.uint64();
            const endLsn = reader.uint64();
            return { tag: "commit", commitLsn, endLsn };
        }
        case "R": {
            const id = reader.uint32();
            const schema = reader.cstring();
            const table = reader.cstring();
            const replicaIdentity = String.fromCharCode(reader.int8());
            const count = reader.int16();
            const columns: PgoutputColumn[] = [];
            for (let i = 0; i < count; i++) {
                const flags = reader.int8();
                const name = reader.cstring();
                const typeOid = reader.uint32();
                reader.int32(); // type modifier
                columns.push({ name, isKey: (flags & 1) === 1, typeOid });
            }
            // An empty namespace is pg_catalog.
            return { tag: "relation", relation: { id, schema: schema || "pg_catalog", table, replicaIdentity, columns } };
        }
        case "I": {
            const relationId = reader.uint32();
            if (reader.byte() !== "N") throw new Error("insert without a new tuple");
            return { tag: "insert", relationId, newTuple: readTuple(reader) };
        }
        case "U": {
            const relationId = reader.uint32();
            let marker = reader.byte();
            let oldTuple: TupleValue[] | undefined;
            let oldIsKeyOnly: boolean | undefined;
            if (marker === "K" || marker === "O") {
                oldIsKeyOnly = marker === "K";
                oldTuple = readTuple(reader);
                marker = reader.byte();
            }
            if (marker !== "N") throw new Error("update without a new tuple");
            return { tag: "update", relationId, oldTuple, oldIsKeyOnly, newTuple: readTuple(reader) };
        }
        case "D": {
            const relationId = reader.uint32();
            const marker = reader.byte();
            if (marker !== "K" && marker !== "O") throw new Error("delete without an old tuple");
            return { tag: "delete", relationId, oldIsKeyOnly: marker === "K", oldTuple: readTuple(reader) };
        }
        case "T": {
            const count = reader.int32();
            reader.int8(); // CASCADE / RESTART IDENTITY
            const relationIds: number[] = [];
            for (let i = 0; i < count; i++) relationIds.push(reader.uint32());
            return { tag: "truncate", relationIds };
        }
        default:
            return { tag: "other", type };
    }
}

/**
 * A standby status update: everything up to `lsn` is written, flushed and
 * applied. Capture keeps nothing, so the three positions are the same — the
 * end of the last transaction handed on.
 *
 * @param replyRequested Ask the server to answer at once with a keepalive,
 *        which is how the connection proves it is still alive.
 */
export function encodeStandbyStatus(lsn: bigint, replyRequested: boolean, nowMs: number = Date.now()): Buffer {
    const buf = Buffer.alloc(34);
    buf.write("r", 0, "latin1");
    buf.writeBigUInt64BE(lsn, 1);
    buf.writeBigUInt64BE(lsn, 9);
    buf.writeBigUInt64BE(lsn, 17);
    buf.writeBigUInt64BE(BigInt(nowMs) * 1000n - PG_EPOCH_OFFSET_US, 25);
    buf.writeUInt8(replyRequested ? 1 : 0, 33);
    return buf;
}

/** A frontend CopyData message around `payload`: `d`, a length that counts itself, the bytes. */
export function copyDataFrame(payload: Buffer): Buffer {
    const header = Buffer.alloc(5);
    header.write("d", 0, "latin1");
    header.writeUInt32BE(payload.length + 4, 1);
    return Buffer.concat([header, payload]);
}

/** `16/B374D848`, the way Postgres writes an LSN. */
export function formatLsn(lsn: bigint): string {
    return `${(lsn >> 32n).toString(16).toUpperCase()}/${(lsn & 0xffffffffn).toString(16).toUpperCase()}`;
}

const BOOL_OID = 16;

/**
 * A key value as the trigger would have sent it, for the cases where text and
 * JSON differ. Addresses are built with `String()`, so an integer or a uuid
 * reads the same either way; a boolean is `t` as text and `true` as JSON.
 */
function keyValue(column: PgoutputColumn, value: string | null): string | null {
    if (value !== null && column.typeOid === BOOL_OID) return value === "t" ? "true" : "false";
    return value;
}

/**
 * The columns that name a row, read from one tuple: the replica identity (the
 * primary key, by default) and each requested column the table has — the
 * trigger's rule, so both name a row with the same columns (see
 * `resolveIdentityColumns` in trigger-cdc.ts).
 *
 * `wanted` is what provisioning asked for: the collection's key, or a
 * junction's two ids. A column the tuple cannot supply is left out — an old
 * key-only tuple carries the replica identity and sends every other column as
 * a null it never had. The key goes whole or not at all, because half a
 * composite key addresses the wrong row. With nothing left the row is
 * unaddressable, and the change is announced as one to the whole table, as the
 * trigger does with a key too large to send.
 */
function identityOf(
    relation: PgoutputRelation,
    tuple: TupleValue[],
    wanted: readonly string[] | undefined,
    keyOnly: boolean
): Record<string, unknown> | undefined {
    const read = (name: string): { value: string | null } | undefined => {
        const index = relation.columns.findIndex((column) => column.name === name);
        if (index < 0) return undefined;
        const column = relation.columns[index];
        if (keyOnly && !column.isKey) return undefined;
        const value = tuple[index];
        return value === undefined ? undefined : { value: keyValue(column, value) };
    };
    const row: Record<string, unknown> = {};
    const key = relation.columns.filter((column) => column.isKey).map((column) => column.name);
    const keyValues = key.map(read);
    if (keyValues.every((cell) => cell !== undefined)) {
        key.forEach((name, i) => { row[name] = keyValues[i]?.value; });
    }
    for (const name of wanted ?? []) {
        if (name in row) continue;
        const cell = read(name);
        if (cell) row[name] = cell.value;
    }
    return Object.keys(row).length > 0 ? row : undefined;
}

/**
 * Turns a `pgoutput` stream into the change events the trigger listener emits,
 * so `RealtimeService` cannot tell which one it is reading.
 *
 * Holds the relation descriptions the stream sends ahead of a table's first
 * row (and again after its schema changes). The stream only ever carries
 * committed transactions, so a change can be handed on as soon as it arrives.
 */
export class PgoutputChanges {
    private readonly relations = new Map<number, PgoutputRelation>();

    /**
     * @param identityColumns The columns a table's rows are addressed by, as
     *        provisioning attaches them; `undefined` for the replica identity.
     */
    constructor(private readonly identityColumns: (schema: string, table: string) => readonly string[] | undefined) {}

    /** The changes one message describes — none for anything but a row change. */
    apply(message: PgoutputMessage): CdcChangeEvent[] {
        switch (message.tag) {
            case "relation":
                this.relations.set(message.relation.id, message.relation);
                return [];
            case "insert":
                return this.change("INSERT", message.relationId, message.newTuple, false);
            case "update": {
                const events = this.change("UPDATE", message.relationId, message.newTuple, false);
                // The key changed: whoever watches the old address needs to
                // hear the row left it. The trigger, seeing NEW only, missed this.
                if (message.oldTuple) {
                    const before = this.change("UPDATE", message.relationId, message.oldTuple, message.oldIsKeyOnly === true);
                    if (before.length && JSON.stringify(before[0].row) !== JSON.stringify(events[0]?.row)) events.push(...before);
                }
                return events;
            }
            case "delete":
                return this.change("DELETE", message.relationId, message.oldTuple, message.oldIsKeyOnly);
            case "truncate":
                return message.relationIds.flatMap((id) => {
                    const relation = this.relations.get(id);
                    return relation ? [{ schema: relation.schema, table: relation.table, op: "TRUNCATE" as const, row: {}, truncated: false }] : [];
                });
            default:
                return [];
        }
    }

    private change(op: "INSERT" | "UPDATE" | "DELETE", relationId: number, tuple: TupleValue[], keyOnly: boolean): CdcChangeEvent[] {
        const relation = this.relations.get(relationId);
        // The protocol sends a table's description before its first row, so
        // this means a broken stream; the listener reconnects on a throw.
        if (!relation) throw new Error(`row for relation ${relationId}, which the stream never described`);
        const row = identityOf(relation, tuple, this.identityColumns(relation.schema, relation.table), keyOnly);
        return [{ schema: relation.schema, table: relation.table, op, row: row ?? {}, truncated: row === undefined }];
    }
}
