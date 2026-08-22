/**
 * The pool-size ceiling, which exists for one reason and must not apply for any
 * other.
 *
 * The managed development database is PGlite behind a multiplexing socket
 * server: a single session, where two pooled clients holding overlapping
 * transactions deadlock rather than error. A request-per-transaction server
 * produces exactly that the moment two requests overlap, so the CLI sets
 * `REBASE_DB_POOL_MAX=1` and the deadlock becomes ordinary queueing.
 *
 * The risk this pins is the opposite one: a malformed or hostile value
 * silently serializing a *production* pool down to one connection would be a
 * severe, hard-to-diagnose performance regression. So anything that is not a
 * positive integer is ignored rather than interpreted.
 */

import { cappedPoolMax, poolMaxCeiling } from "../src/connection";

describe("poolMaxCeiling", () => {
    it("is absent when the variable is unset", () => {
        expect(poolMaxCeiling({})).toBeNull();
    });

    it("reads a positive integer", () => {
        expect(poolMaxCeiling({ REBASE_DB_POOL_MAX: "1" })).toBe(1);
        expect(poolMaxCeiling({ REBASE_DB_POOL_MAX: "8" })).toBe(8);
    });

    it.each(["", "   ", "0", "-1", "1.5", "many", "1e3", "01x"])(
        "ignores %o rather than guessing what it meant",
        (value) => {
            expect(poolMaxCeiling({ REBASE_DB_POOL_MAX: value })).toBeNull();
        }
    );
});

describe("cappedPoolMax", () => {
    it("leaves the requested size alone when no ceiling is set", () => {
        expect(cappedPoolMax(20, {})).toBe(20);
    });

    it("lowers a request that exceeds the ceiling", () => {
        expect(cappedPoolMax(20, { REBASE_DB_POOL_MAX: "1" })).toBe(1);
        expect(cappedPoolMax(10, { REBASE_DB_POOL_MAX: "4" })).toBe(4);
    });

    it("never raises a request", () => {
        // A ceiling is a maximum, not a target: a caller that asked for a small
        // pool had a reason, and this must not overrule it.
        expect(cappedPoolMax(2, { REBASE_DB_POOL_MAX: "16" })).toBe(2);
    });

    it("does not serialize a production pool because of a malformed value", () => {
        for (const value of ["", "nonsense", "0", "-4"]) {
            expect(cappedPoolMax(20, { REBASE_DB_POOL_MAX: value })).toBe(20);
        }
    });
});
