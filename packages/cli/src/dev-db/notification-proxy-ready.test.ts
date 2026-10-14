/**
 * The bookkeeping that keeps a managed-database connection's ReadyForQuery
 * messages one to a request — see `ReadyForQueryLedger`, and
 * `notification-proxy-ready.integration.test.ts` for the same cases against
 * PGlite itself.
 */
import { describe, expect, it } from "vitest";

import { FrontendMessageParser, ReadyForQueryLedger } from "./notification-proxy";

/** A typed message: type byte, Int32 length counting itself, body. */
function frame(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
    const message = Buffer.alloc(5 + body.length);
    message.write(type, 0, "ascii");
    message.writeInt32BE(4 + body.length, 1);
    body.copy(message, 5);
    return message;
}

/** An untyped opening packet: Int32 length counting itself, Int32 code, rest. */
function opening(code: number, rest: Buffer = Buffer.alloc(0)): Buffer {
    const message = Buffer.alloc(8 + rest.length);
    message.writeInt32BE(8 + rest.length, 0);
    message.writeInt32BE(code, 4);
    rest.copy(message, 8);
    return message;
}

const SSL_REQUEST = opening(80877103);
const STARTUP = opening(196608, Buffer.from("user\0postgres\0database\0postgres\0\0", "utf8"));

/** Send `types` through a ledger and return which of `replies` reach the client. */
function play(sent: string[], replies: string[]): string[] {
    const ledger = new ReadyForQueryLedger();
    for (const type of sent) ledger.sent(type);
    return replies.filter((type) => ledger.deliver(frame(type)));
}

describe("FrontendMessageParser", () => {
    it("reads the SSL request and the startup packet untyped, and typed messages after them", () => {
        const parser = new FrontendMessageParser();
        expect(parser.push(SSL_REQUEST)).toEqual([]);
        expect(parser.push(Buffer.concat([STARTUP, frame("Q", Buffer.from("select 1\0"))]))).toEqual(["startup", "Q"]);
        expect(parser.push(Buffer.concat([frame("P"), frame("B"), frame("D"), frame("E"), frame("S")])))
            .toEqual(["P", "B", "D", "E", "S"]);
    });

    it("holds a message that arrives in pieces until it is whole", () => {
        const parser = new FrontendMessageParser();
        parser.push(STARTUP);
        const query = frame("Q", Buffer.from("select 1\0"));
        expect(parser.push(query.subarray(0, 3))).toEqual([]);
        expect(parser.push(query.subarray(3))).toEqual(["Q"]);
    });
});

describe("ReadyForQueryLedger", () => {
    it("drops the ReadyForQuery PGlite sends with a failed message, and keeps the Sync's", () => {
        expect(play(["P", "B", "D", "E", "S"], ["1", "2", "n", "E", "Z", "Z"])).toEqual(["1", "2", "n", "E", "Z"]);
    });

    it("drops it for a message that fails before any was answered", () => {
        expect(play(["P", "B", "D", "E", "S"], ["E", "Z", "Z"])).toEqual(["E", "Z"]);
    });

    it("keeps the one ReadyForQuery of an error the Sync raised", () => {
        // A deferred constraint fails as the implicit transaction commits.
        expect(play(["P", "B", "D", "E", "S"], ["1", "2", "n", "C", "E", "Z"])).toEqual(["1", "2", "n", "C", "E", "Z"]);
    });

    it("keeps a simple Query's, failed or not", () => {
        expect(play(["Q", "Q"], ["E", "Z", "T", "D", "C", "Z"])).toEqual(["E", "Z", "T", "D", "C", "Z"]);
    });

    it("keeps each request apart when the first of two fails", () => {
        expect(play(["P", "B", "E", "S", "P", "B", "E", "S"], ["E", "Z", "Z", "1", "2", "C", "Z"]))
            .toEqual(["E", "Z", "1", "2", "C", "Z"]);
    });

    it("holds the drop until the Sync when the client flushed instead", () => {
        const ledger = new ReadyForQueryLedger();
        ledger.sent("P");
        ledger.sent("H");
        expect(ledger.deliver(frame("E"))).toBe(true);
        expect(ledger.deliver(frame("Z"))).toBe(false);
        ledger.sent("S");
        expect(ledger.deliver(frame("Z"))).toBe(true);
    });

    it("lets through what answers no request: the startup's, notices, notifications", () => {
        expect(play(["startup"], ["R", "S", "K", "Z", "N", "A"])).toEqual(["R", "S", "K", "Z", "N", "A"]);
    });
});
