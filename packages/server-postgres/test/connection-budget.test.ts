/**
 * The arithmetic behind the boot-time connection check: what the database
 * accepts, what this process may open, and when one process takes too much.
 *
 * The hosted demo ran a 20-connection main pool per process against a
 * 25-connection database, three instances deep, and the first sign was a
 * SQLSTATE 53300 in front of a user. See `src/connection-budget.ts`.
 */
import { jest } from "@jest/globals";
import { logger } from "@rebasepro/server";

import {
    assessConnectionBudget,
    currentConnectionDemand,
    demandOn,
    demandUnderCeiling,
    formatConnectionBudgetWarning,
    parseConnectionLimits,
    resetConnectionBudget,
    serverKeyOf,
    suggestedPoolMax,
    trackConnectionDemand,
    usableConnectionSlots,
    watchConnectionBudget,
    type ConnectionDemand,
    type DatabaseConnectionLimits
} from "../src/connection-budget";
import { createDirectDatabaseConnection, createPostgresDatabaseConnection } from "../src/connection";

const SERVER = "db.example.com:5432";
const URL_ = "postgresql://rebase:s3cret@db.example.com:5432/app";

/** A Cloud SQL db-f1-micro: 25 connections, 3 kept for superusers. */
const SMALL_TIER: DatabaseConnectionLimits = {
    maxConnections: 25,
    superuserReserved: 3,
    reserved: 0,
    roleLimit: -1,
    databaseLimit: -1,
    superuser: false
};

const pool = (label: string, max: number, requested: number | undefined = max): ConnectionDemand =>
    ({ label, max, requested, server: SERVER, pooled: false });
const fixed = (label: string, max: number): ConnectionDemand =>
    ({ label, max, server: SERVER, pooled: false });
const listen = (channel: string): ConnectionDemand =>
    ({ label: `LISTEN ${channel}`, max: 1, server: SERVER, pooled: false });

afterEach(() => {
    resetConnectionBudget();
    jest.restoreAllMocks();
});

describe("usableConnectionSlots", () => {
    it("is max_connections less the superuser reserve", () => {
        expect(usableConnectionSlots(SMALL_TIER)).toEqual({
            usable: 22,
            explanation: "max_connections 25 − 3 reserved for superusers"
        });
    });

    it("also takes off PG16's reserved_connections", () => {
        expect(usableConnectionSlots({ ...SMALL_TIER, maxConnections: 100, reserved: 5 }).usable).toBe(92);
    });

    it("is the role's limit when that is lower", () => {
        expect(usableConnectionSlots({ ...SMALL_TIER, roleLimit: 10 })).toEqual({
            usable: 10,
            explanation: "the role's CONNECTION LIMIT 10"
        });
    });

    it("is the database's limit when that is lower still", () => {
        expect(usableConnectionSlots({ ...SMALL_TIER, roleLimit: 10, databaseLimit: 4 }).usable).toBe(4);
    });

    it("ignores the role's and the database's limits for a superuser, who is exempt from both", () => {
        expect(usableConnectionSlots({ ...SMALL_TIER, roleLimit: 2, databaseLimit: 2, superuser: true }).usable).toBe(22);
    });

    it("never goes below zero", () => {
        expect(usableConnectionSlots({ ...SMALL_TIER, maxConnections: 2 }).usable).toBe(0);
    });
});

describe("parseConnectionLimits", () => {
    const row = {
        max_connections: "25",
        superuser_reserved: "3",
        reserved: null,
        role_limit: "-1",
        superuser: false,
        database_limit: "-1"
    };

    it("reads the row the query answers, reserved_connections missing before PG16", () => {
        expect(parseConnectionLimits(row)).toEqual(SMALL_TIER);
    });

    it("reads PG16's reserved_connections and a role limit", () => {
        expect(parseConnectionLimits({ ...row, reserved: "2", role_limit: "8", superuser: true }))
            .toMatchObject({ reserved: 2, roleLimit: 8, superuser: true });
    });

    it.each([
        ["no row", undefined],
        ["a max_connections that is not a number", { ...row, max_connections: "lots" }],
        ["a max_connections of zero", { ...row, max_connections: "0" }],
        ["a fractional value", { ...row, superuser_reserved: "3.5" }],
        ["a negative limit other than -1", { ...row, role_limit: "-2" }],
        ["a missing reserve", { ...row, superuser_reserved: undefined }]
    ])("refuses %s rather than warn on a misread number", (_name, input) => {
        expect(parseConnectionLimits(input)).toBeUndefined();
    });
});

describe("serverKeyOf", () => {
    it.each([
        [URL_, "db.example.com:5432"],
        ["postgres://u@DB.example.com/app", "db.example.com:5432"],
        ["postgresql://u@10.0.0.4:6543/app?sslmode=require", "10.0.0.4:6543"],
        ["postgresql:///app?host=/var/run/postgresql", "/var/run/postgresql:5432"],
        ["postgresql:///app", "localhost:5432"]
    ])("%s is %s", (url, key) => {
        expect(serverKeyOf(url)).toBe(key);
    });

    it("keys a string that is not a URL by itself, so it never counts against another server", () => {
        expect(serverKeyOf("host=db user=x")).toBe("host=db user=x");
    });
});

describe("assessConnectionBudget", () => {
    it("warns for the default pool against a 25-connection database: 21 of 22", () => {
        const assessment = assessConnectionBudget([pool("main pool", 20), listen("rebase_cdc")], SMALL_TIER);
        expect(assessment).toMatchObject({
            demand: 21,
            usable: 22,
            parts: ["main pool 20", "LISTEN rebase_cdc 1"],
            // 10 + 1 = 11, half of 22: two instances fit.
            suggestedPoolMax: 10,
            processesThatFit: 1
        });
    });

    it("says nothing for REBASE_DB_POOL_MAX=5 against the same database", () => {
        expect(assessConnectionBudget([pool("main pool", 5, 20), listen("rebase_cdc")], SMALL_TIER)).toBeUndefined();
    });

    it("warns at just over half, not at half", () => {
        expect(assessConnectionBudget([pool("main pool", 11)], SMALL_TIER)).toBeUndefined();
        expect(assessConnectionBudget([pool("main pool", 12)], SMALL_TIER)).toBeDefined();
    });

    it("sums the same label, largest first", () => {
        const assessment = assessConnectionBudget(
            [listen("a"), pool("main pool", 20), listen("a"), pool("direct pool", 5)],
            SMALL_TIER
        );
        expect(assessment?.parts).toEqual(["main pool 20", "direct pool 5", "LISTEN a 2"]);
    });
});

describe("suggestedPoolMax", () => {
    it("is the largest ceiling that fits, counting fixed demand at its size", () => {
        const demands = [pool("main pool", 20), pool("database pool", 10), listen("x"), listen("y")];
        // n=4: 4 + 4 + 2 = 10 ≤ 11; n=5: 5 + 5 + 2 = 12.
        expect(suggestedPoolMax(demands, 11)).toBe(4);
        expect(demandUnderCeiling(demands, 4)).toBe(10);
    });

    it("leaves a pool smaller than the ceiling at its own size", () => {
        expect(demandUnderCeiling([pool("main pool", 20), pool("small", 3)], 10)).toBe(13);
    });

    it("is undefined when fixed demand alone is over budget", () => {
        expect(suggestedPoolMax([pool("main pool", 20), fixed("fixed", 12)], 11)).toBeUndefined();
    });

    it("is undefined when no pool follows the ceiling", () => {
        expect(suggestedPoolMax([listen("x")], 11)).toBeUndefined();
    });
});

describe("demandOn", () => {
    it("counts only what reaches that server directly — not a pooler's clients, not another server", () => {
        const demands: ConnectionDemand[] = [
            { ...pool("main pool", 20), pooled: true },
            pool("SQL console session pool", 3),
            { ...pool("read replica pool", 10), server: "replica:5432" },
            listen("rebase_cdc")
        ];
        expect(demandOn(SERVER, demands).map(d => d.label)).toEqual(["SQL console session pool", "LISTEN rebase_cdc"]);
    });
});

describe("formatConnectionBudgetWarning", () => {
    it("names both numbers, the parts and the fix", () => {
        const assessment = assessConnectionBudget([pool("main pool", 20), listen("rebase_cdc")], SMALL_TIER);
        if (!assessment) throw new Error("expected a warning");
        const text = formatConnectionBudgetWarning(assessment, SERVER);
        expect(text).toContain("This process can open 21 connections; PostgreSQL at db.example.com:5432 accepts 22");
        expect(text).toContain("22 usable = max_connections 25 − 3 reserved for superusers");
        expect(text).toContain("main pool 20, LISTEN rebase_cdc 1");
        expect(text).toContain("REBASE_DB_POOL_MAX=10");
        expect(text).toContain("53300");
        expect(text).toContain("fewer instances");
        expect(text).toContain("tier with more connections");
    });

    it("says when one process can take every slot by itself", () => {
        const assessment = assessConnectionBudget([pool("main pool", 30)], SMALL_TIER);
        if (!assessment) throw new Error("expected a warning");
        expect(formatConnectionBudgetWarning(assessment, SERVER)).toContain("This process alone can take every slot");
    });
});

describe("the demand pools record as they are created", () => {
    const original = process.env.REBASE_DB_POOL_MAX;
    afterEach(() => {
        if (original === undefined) delete process.env.REBASE_DB_POOL_MAX;
        else process.env.REBASE_DB_POOL_MAX = original;
    });

    it("counts the main pool at its size after REBASE_DB_POOL_MAX, remembering what it asked for", async () => {
        process.env.REBASE_DB_POOL_MAX = "5";
        const { pool: main } = createPostgresDatabaseConnection(URL_);
        expect(currentConnectionDemand()).toEqual([
            { label: "main pool", max: 5, requested: 20, server: SERVER, pooled: false }
        ]);
        await main.end();
        expect(currentConnectionDemand()).toEqual([]);
    });

    it("counts a malformed REBASE_DB_POOL_MAX as no ceiling — it never quietly shrinks the pool", async () => {
        process.env.REBASE_DB_POOL_MAX = "5x";
        const { pool: main } = createPostgresDatabaseConnection(URL_);
        expect(currentConnectionDemand()[0]?.max).toBe(20);
        await main.end();
    });

    it("marks a pool that read no ceiling (openRebase passes no environment) as fixed", async () => {
        process.env.REBASE_DB_POOL_MAX = "5";
        const { pool: main } = createPostgresDatabaseConnection(URL_, undefined, undefined, {});
        expect(currentConnectionDemand()[0]?.max).toBe(20);
        expect(currentConnectionDemand()[0]?.requested).toBeUndefined();
        await main.end();
    });

    it("counts a pooled pool, flagged so it is not counted against the server", async () => {
        const { pool: direct } = createDirectDatabaseConnection(URL_, undefined, { max: 3, pooled: true });
        expect(currentConnectionDemand()).toEqual([
            { label: "direct pool", max: 3, requested: 3, server: SERVER, pooled: true }
        ]);
        await direct.end();
    });
});

describe("watchConnectionBudget", () => {
    it("warns once, naming the server without its credentials, and again for nothing added later", () => {
        const warnings: string[] = [];
        jest.spyOn(logger, "warn").mockImplementation((message: string) => { warnings.push(message); });

        trackConnectionDemand({}, pool("main pool", 20));
        trackConnectionDemand({}, listen("rebase_cdc"));
        watchConnectionBudget(URL_, SMALL_TIER);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("db.example.com:5432 accepts 22");
        expect(warnings[0]).not.toContain("s3cret");

        trackConnectionDemand({}, pool("database \"other\" pool", 10));
        expect(warnings).toHaveLength(1);
    });

    it("weighs demand that opens after the boot read the limits", () => {
        const warnings: string[] = [];
        jest.spyOn(logger, "warn").mockImplementation((message: string) => { warnings.push(message); });

        trackConnectionDemand({}, pool("main pool", 5, 20));
        watchConnectionBudget(URL_, SMALL_TIER);
        expect(warnings).toHaveLength(0);

        trackConnectionDemand({}, pool("database \"other\" pool", 10));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("main pool 5");
        expect(warnings[0]).toContain("database \"other\" pool 10");
    });

    it("stops counting what was released", () => {
        const warnings: string[] = [];
        jest.spyOn(logger, "warn").mockImplementation((message: string) => { warnings.push(message); });

        const release = trackConnectionDemand({}, pool("main pool", 20));
        release();
        watchConnectionBudget(URL_, SMALL_TIER);
        expect(warnings).toHaveLength(0);
    });

    it("does not name a connection string that is not a URL, which may carry a password", () => {
        const warnings: string[] = [];
        jest.spyOn(logger, "warn").mockImplementation((message: string) => { warnings.push(message); });
        const dsn = "host=db password=s3cret";
        trackConnectionDemand({}, { ...pool("main pool", 20), server: dsn });
        watchConnectionBudget(dsn, SMALL_TIER);
        expect(warnings[0]).toContain("PostgreSQL at this database");
        expect(warnings[0]).not.toContain("s3cret");
    });
});
