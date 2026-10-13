import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { postgresDriverConfigFromEnv } from "../src/PostgresBootstrapper";
import { resolveChannelBusSetting } from "../src/services/channel-bus";
import { logger } from "@rebasepro/server";

/**
 * The environment is read in one place — where the server's boot builds the
 * driver's config — and each variable lands on an explicit option. The driver
 * itself (`openPostgresDriver`, and so `openRebase`) reads none of them; this
 * is the table of what the boot does instead, and of which side wins.
 */
describe("postgresDriverConfigFromEnv", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("leaves a config alone when the environment says nothing", () => {
        const config = { connectionString: "postgres://app/db", realtime: { maxSubscriptionsPerSocket: 50, cdc: "off" as const } };
        expect(postgresDriverConfigFromEnv(config, {})).toEqual({
            connectionString: "postgres://app/db",
            realtime: { maxSubscriptionsPerSocket: 50, cdc: "off", bus: { type: "memory" } }
        });
    });

    it("lets every REALTIME_* variable that is set win over its option", () => {
        const resolved = postgresDriverConfigFromEnv({
            realtime: {
                maxSubscriptionsPerSocket: 50,
                maxSocketsPerUser: 5,
                refetchMaxWaitMs: 100,
                recountIntervalMs: 200,
                recountMinRows: 300,
                cdc: "auto"
            }
        }, {
            REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET: "7",
            REALTIME_MAX_SOCKETS_PER_USER: " 3 ",
            REALTIME_REFETCH_MAX_WAIT_MS: "1500",
            REALTIME_RECOUNT_INTERVAL_MS: "60000",
            REALTIME_RECOUNT_MIN_ROWS: "1000",
            REALTIME_CDC: " OFF ",
            REALTIME_CHANNEL_BUS: "postgres"
        });
        expect(resolved.realtime).toEqual({
            maxSubscriptionsPerSocket: 7,
            maxSocketsPerUser: 3,
            refetchMaxWaitMs: 1500,
            recountIntervalMs: 60000,
            recountMinRows: 1000,
            cdc: "off",
            bus: { type: "postgres" }
        });
    });

    it("fills the replica and direct URLs only where the config left them empty", () => {
        const env = { DATABASE_READ_URL: "postgres://replica/db", DATABASE_DIRECT_URL: "postgres://direct/db" };
        expect(postgresDriverConfigFromEnv({}, env)).toMatchObject({
            readConnectionString: "postgres://replica/db",
            directConnectionString: "postgres://direct/db"
        });
        expect(postgresDriverConfigFromEnv({
            readConnectionString: "postgres://own-replica/db",
            directConnectionString: "postgres://own-direct/db"
        }, env)).toMatchObject({
            readConnectionString: "postgres://own-replica/db",
            directConnectionString: "postgres://own-direct/db"
        });
    });

    it("reads the bare URL variables for the default source only", () => {
        // They name the default database. Filled into a second source's
        // config, its LISTEN would sit on the default database and hear none
        // of its own notifications, and its reads would go to the default's
        // replica.
        const env = { DATABASE_READ_URL: "postgres://replica/db", DATABASE_DIRECT_URL: "postgres://direct/db" };
        const keyed = postgresDriverConfigFromEnv({ connectionString: "postgres://analytics/db" }, env, "analytics");
        expect(keyed.readConnectionString).toBeUndefined();
        expect(keyed.directConnectionString).toBeUndefined();
        expect(postgresDriverConfigFromEnv({
            connectionString: "postgres://analytics/db",
            directConnectionString: "postgres://analytics-direct/db"
        }, env, "analytics").directConnectionString).toBe("postgres://analytics-direct/db");
        expect(postgresDriverConfigFromEnv({}, env, "(default)")).toMatchObject({
            readConnectionString: "postgres://replica/db",
            directConnectionString: "postgres://direct/db"
        });
    });

    it("refuses a mistyped number, naming the variable", () => {
        expect(() => postgresDriverConfigFromEnv({}, { REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET: "lots" }))
            .toThrow(/REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET/);
        expect(() => postgresDriverConfigFromEnv({}, { REALTIME_MAX_SOCKETS_PER_USER: "0" }))
            .toThrow(/REALTIME_MAX_SOCKETS_PER_USER/);
        expect(() => postgresDriverConfigFromEnv({}, { REALTIME_RECOUNT_MIN_ROWS: "1.5" }))
            .toThrow(/REALTIME_RECOUNT_MIN_ROWS/);
    });

    it("reads an unknown REALTIME_CDC as auto, and says so", () => {
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
        expect(postgresDriverConfigFromEnv({ realtime: { cdc: "off" } }, { REALTIME_CDC: "sometimes" }).realtime?.cdc).toBe("auto");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("REALTIME_CDC"));
    });

    it("reads the environment it is given, not process.env", () => {
        const saved = process.env.REALTIME_CDC;
        process.env.REALTIME_CDC = "trigger";
        try {
            expect(postgresDriverConfigFromEnv({}, {}).realtime?.cdc).toBeUndefined();
            expect(postgresDriverConfigFromEnv({}).realtime?.cdc).toBe("trigger");
        } finally {
            if (saved === undefined) delete process.env.REALTIME_CDC;
            else process.env.REALTIME_CDC = saved;
        }
    });

    it("resolveChannelBusSetting reads REALTIME_CHANNEL_BUS from the environment it is given", () => {
        expect(resolveChannelBusSetting(undefined, { REALTIME_CHANNEL_BUS: "postgres" })).toEqual({ type: "postgres" });
        expect(resolveChannelBusSetting({ type: "postgres" }, {})).toEqual({ type: "postgres" });
    });
});
