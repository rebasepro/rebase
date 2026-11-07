import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@rebasepro/server", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

import {
    isReplicaFallbackError,
    parseReadRoutingMs,
    ReadRouter,
    readRoutingOptionsFromEnv,
    sameDatabaseTarget
} from "../src/read-routing";
import { pinSearchPath } from "../src/connection";

/**
 * The read router's rules, on a fake clock: read-your-writes, the lag guard,
 * no routing without a recent sample, a cooldown after a failure. The routing
 * itself, through a real driver, is in `read-routing-driver.test.ts`; against a
 * real standby, in `e2e/pooler-replica-e2e.test.ts`.
 */
function routerAt(lag: number | null, options: { stickyMs?: number; maxLagMs?: number } = {}) {
    let now = 1_000_000;
    let currentLag: number | null = lag;
    const router = new ReadRouter("replica-db", async () => currentLag, {
        stickyMs: options.stickyMs ?? 5000,
        maxLagMs: options.maxLagMs ?? 1000,
        sampleIntervalMs: 1000,
        failureCooldownMs: 10_000,
        maxPinnedPrincipals: 3,
        now: () => now
    });
    return {
        router,
        advance: (ms: number) => { now += ms; },
        setLag: (value: number | null) => { currentLag = value; }
    };
}

describe("ReadRouter", () => {
    it("sends nothing to the replica before its first sample", () => {
        const { router } = routerAt(0);
        expect(router.route("u1")).toEqual({ target: "primary", reason: "no-sample" });
    });

    it("routes to the replica when it is caught up", async () => {
        const { router } = routerAt(200);
        await router.sample();
        expect(router.route("u1")).toEqual({ target: "replica" });
        expect(router.route(undefined)).toEqual({ target: "replica" });
        expect(router.lagSeconds).toBe(0.2);
    });

    it("pins a principal that wrote to the primary for the sticky window, and only that one", async () => {
        const { router, advance } = routerAt(0);
        await router.sample();
        router.notePrimaryWrite("writer");
        expect(router.route("writer")).toEqual({ target: "primary", reason: "sticky" });
        expect(router.route("someone-else")).toEqual({ target: "replica" });
        advance(4999);
        await router.sample();
        expect(router.route("writer").target).toBe("primary");
        advance(2);
        await router.sample();
        expect(router.route("writer")).toEqual({ target: "replica" });
    });

    it("pins nobody with a sticky window of 0", async () => {
        const { router } = routerAt(0, { stickyMs: 0 });
        await router.sample();
        router.notePrimaryWrite("writer");
        expect(router.route("writer")).toEqual({ target: "replica" });
    });

    it("forgets the oldest writer past its cap rather than growing without bound", async () => {
        const { router } = routerAt(0);
        await router.sample();
        for (const p of ["a", "b", "c", "d"]) router.notePrimaryWrite(p);
        expect(router.route("a")).toEqual({ target: "replica" });
        expect(router.route("d").target).toBe("primary");
    });

    it("sends every read to the primary while the replica is behind the limit", async () => {
        const { router, setLag } = routerAt(1500);
        await router.sample();
        expect(router.route("u1")).toEqual({ target: "primary", reason: "lag" });
        setLag(1000);
        await router.sample();
        expect(router.route("u1")).toEqual({ target: "replica" });
    });

    it("treats a replica that cannot say its lag as behind", async () => {
        const { router } = routerAt(null);
        await router.sample();
        expect(router.route("u1")).toEqual({ target: "primary", reason: "no-sample" });
        expect(router.lagSeconds).toBeUndefined();
    });

    it("stops trusting a sample that has gone stale", async () => {
        const { router, advance } = routerAt(0);
        await router.sample();
        advance(3001);
        expect(router.route("u1")).toEqual({ target: "primary", reason: "no-sample" });
    });

    it("leaves the replica alone for the cooldown after it failed", async () => {
        const { router, advance } = routerAt(0);
        await router.sample();
        router.noteReplicaFailure(new Error("connection refused"));
        expect(router.route("u1")).toEqual({ target: "primary", reason: "unavailable" });
        advance(10_001);
        await router.sample();
        expect(router.route("u1")).toEqual({ target: "replica" });
    });

    it("counts a failed sample as a failure", async () => {
        let now = 0;
        const router = new ReadRouter("db", async () => { throw new Error("down"); }, {
            stickyMs: 5000, maxLagMs: 1000, now: () => now
        });
        await router.sample();
        expect(router.route("u1")).toEqual({ target: "primary", reason: "unavailable" });
        now += 60_000;
        expect(router.route("u1")).toEqual({ target: "primary", reason: "no-sample" });
    });
});

describe("isReplicaFallbackError", () => {
    const pg = (code: string) => Object.assign(new Error("x"), { code });

    it.each(["08006", "53300", "57P01", "57P03", "57014", "40001"])("retries %s on the primary", (code) => {
        expect(isReplicaFallbackError(pg(code))).toBe(true);
        expect(isReplicaFallbackError(new Error("Failed query: select 1", { cause: pg(code) }))).toBe(true);
    });

    it("retries a replica that cannot be reached or a pool that timed out", () => {
        expect(isReplicaFallbackError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(true);
        expect(isReplicaFallbackError(new Error("timeout exceeded when trying to connect"))).toBe(true);
        expect(isReplicaFallbackError(new AggregateError([Object.assign(new Error("x"), { code: "EHOSTUNREACH" })]))).toBe(true);
    });

    it.each(["42501", "42P01", "22P02", "23505", "P0001"])("leaves %s as the read's own answer", (code) => {
        expect(isReplicaFallbackError(pg(code))).toBe(false);
    });

    it("leaves an error a hook threw alone", () => {
        expect(isReplicaFallbackError(new Error("not allowed"))).toBe(false);
        expect(isReplicaFallbackError(undefined)).toBe(false);
    });
});

describe("sameDatabaseTarget", () => {
    it("sees through the search_path the boot pins onto the primary's URL", () => {
        const primary = "postgres://rebase:pw@db:5432/app";
        expect(sameDatabaseTarget(primary, pinSearchPath(primary))).toBe(true);
    });

    it("treats a missing port as 5432", () => {
        expect(sameDatabaseTarget("postgres://u@db/app", "postgresql://u@DB:5432/app")).toBe(true);
    });

    it("tells another host, database or role apart", () => {
        expect(sameDatabaseTarget("postgres://u@db/app", "postgres://u@replica/app")).toBe(false);
        expect(sameDatabaseTarget("postgres://u@db/app", "postgres://u@db/other")).toBe(false);
        expect(sameDatabaseTarget("postgres://u@db/app", "postgres://v@db/app")).toBe(false);
        expect(sameDatabaseTarget("postgres://u@db:5432/app", "postgres://u@db:6432/app")).toBe(false);
    });
});

describe("routing options from the environment", () => {
    it("defaults to 5000 ms sticky and 1000 ms lag", () => {
        expect(readRoutingOptionsFromEnv({})).toEqual({ stickyMs: 5000, maxLagMs: 1000 });
    });

    it("reads both variables", () => {
        expect(readRoutingOptionsFromEnv({ REBASE_READ_STICKY_MS: "0", REBASE_READ_MAX_LAG_MS: " 250 " }))
            .toEqual({ stickyMs: 0, maxLagMs: 250 });
    });

    it("throws on a malformed value, naming the variable", () => {
        expect(() => parseReadRoutingMs("5s", "REBASE_READ_STICKY_MS")).toThrow(/REBASE_READ_STICKY_MS/);
        expect(() => readRoutingOptionsFromEnv({ REBASE_READ_MAX_LAG_MS: "-1" })).toThrow(/REBASE_READ_MAX_LAG_MS/);
    });
});
