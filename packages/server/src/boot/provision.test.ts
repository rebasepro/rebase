import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import type { BackendBootstrapper, CollectionConfig } from "@rebasepro/types";

import {
    provisionCollectionPolicies,
    provisionCollectionTables,
    provisionTargetFor,
    verifyProvisioningConnection,
    type ProvisionTarget
} from "./provision";
import { logger } from "../utils/logger";

/**
 * Boot-time schema creation may decline, but it may never decline quietly.
 *
 * A skipped provision and a database that was never migrated look identical from
 * outside the pod: sign-in works, every `/api/data/*` route 500s. The only thing
 * that tells them apart is the reason this module prints on its way out, so these
 * tests assert the log line, not just the early return — a refactor that restores
 * a bare `return` fails here rather than in production.
 *
 * They also assert the reason is RETURNED, not only logged. That is what the
 * driver's drift check reads to explain itself, and a log line alone left it
 * guessing — which is how it came to tell operators to redeploy with an
 * environment variable that nothing in their boot path read.
 */

let infoSpy: ReturnType<typeof jest.spyOn>;
let warnSpy: ReturnType<typeof jest.spyOn>;
let debugSpy: ReturnType<typeof jest.spyOn>;

const collection = (slug: string, routing: { engine?: string; dataSource?: string } = {}): CollectionConfig =>
    ({ slug, name: slug, table: slug, properties: {}, ...routing } as unknown as CollectionConfig);

/** A target whose driver can create tables, unless told otherwise. */
function target(over: Partial<ProvisionTarget> = {}): ProvisionTarget {
    return {
        driverPackage: "@rebasepro/server-postgres",
        engine: "postgres",
        bootstrapper: {
            ensureCollectionSchema: jest.fn(async () => ({ applied: 0 })),
            ensureCollectionPolicies: jest.fn(async () => ({ applied: 0 }))
        } as unknown as ProvisionTarget["bootstrapper"],
        ...over
    };
}

/**
 * Every message this call logged, at any level — `debug` included.
 *
 * These tests are about whether a reason was *stated*, not about which level
 * carries it. The steady-state summaries ("up to date") were demoted to `debug`
 * because they fired on every boot and said nothing anyone could act on, while
 * every skip reason and applied-change count stayed where an operator reads
 * them. A `logged()` that only saw info and warn would fail on the demotion and
 * pass on an outright deletion, which is backwards.
 */
const logged = (): string =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls, ...debugSpy.mock.calls]
        .map(call => String(call[0])).join("\n");

/** Only what an operator sees at the default level. */
const loggedAtDefaultLevel = (): string =>
    [...infoSpy.mock.calls, ...warnSpy.mock.calls].map(call => String(call[0])).join("\n");

beforeEach(() => {
    infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
    warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    debugSpy = jest.spyOn(logger, "debug").mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe("provisionCollectionTables — every exit says why", () => {
    it("names the opt-out when REBASE_MIGRATE_ON_BOOT=none", async () => {
        const outcome = await provisionCollectionTables([collection("posts")], target(), {
            env: { REBASE_MIGRATE_ON_BOOT: "none" }
        });

        expect(logged()).toContain("REBASE_MIGRATE_ON_BOOT=none");
        expect(outcome).toEqual({ status: "skipped", reason: expect.stringContaining("REBASE_MIGRATE_ON_BOOT=none") });
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("explains an introspecting project rather than skipping in silence", async () => {
        const outcome = await provisionCollectionTables([], target(), { introspecting: true, env: {} });

        expect(logged()).toContain("read from the database");
        expect(outcome.status).toBe("skipped");
        // Reading a schema you did not declare is normal, not a problem.
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("explains an empty collection list", async () => {
        const outcome = await provisionCollectionTables([], target(), { env: {} });

        expect(logged()).toContain("no collections");
        expect(outcome.status).toBe("skipped");
    });

    it("blames the adapter, not the driver package, for the missing method", async () => {
        const outcome = await provisionCollectionTables(
            [collection("posts")],
            target({ bootstrapper: {} as BackendBootstrapper }),
            { env: {} }
        );

        expect(warnSpy).toHaveBeenCalled();
        expect(logged()).toContain("@rebasepro/server-postgres");
        expect(logged()).toContain("rebase db push");
        expect(outcome.status).toBe("skipped");

        // The real cause, twice now, was a driver that DID implement this on a
        // class the adapter never forwarded. Wording that says "the driver does
        // not implement" sends the reader to npm versions, which is the wrong
        // suspect in two of the three ways this method can go missing.
        expect(logged()).toContain("adapter");
        expect(logged()).not.toContain("does not implement");
    });
});

describe("provisionCollectionTables — the path that does the work", () => {
    it("applies the driver's changes and reports the count", async () => {
        const ensure = jest.fn(async () => ({ applied: 2 }));

        const outcome = await provisionCollectionTables(
            [collection("posts")],
            target({ bootstrapper: { ensureCollectionSchema: ensure } as unknown as ProvisionTarget["bootstrapper"] }),
            { env: {} }
        );

        expect(ensure).toHaveBeenCalled();
        expect(logged()).toContain("Applied 2");
        expect(outcome).toEqual({ status: "applied", applied: 2 });
        // Nothing is wrong on a working boot — a warn here would train operators
        // to ignore the very lines the skip paths rely on.
        expect(warnSpy).not.toHaveBeenCalled();
    });

    // "Nothing changed" is the overwhelmingly common outcome of this call, and
    // an operator cannot act on it. It is still said — a boot that goes quiet
    // here is indistinguishable from one that never reached the provision — but
    // at `debug`, where a diagnosis will find it and a first boot will not be
    // padded by it.
    it("records that the schema is already up to date, below the default level", async () => {
        await provisionCollectionTables([collection("posts")], target(), { env: {} });

        expect(logged()).toContain("up to date");
        expect(loggedAtDefaultLevel()).not.toContain("up to date");
        expect(warnSpy).not.toHaveBeenCalled();
    });
});

/**
 * What these hooks are *handed*, not just whether they are called.
 *
 * Both were once shipped passing the connection bare behind an `as never`, which
 * type-checks and then dies inside the driver on `undefined.db`: a real driver
 * reads its own opaque handle off `internals`. Every other test here mocks the
 * bootstrapper and ignores its second argument, so a whole suite can pass while
 * `rebase dev` crashes at boot.
 *
 * The fakes below therefore consume the argument the way PostgresBootstrapper
 * does, so the seam is asserted from the driver's side rather than the
 * coordinator's — including the case that matters most now: an app that built
 * its own adapter has no handle to pass, and the hook must be reached anyway.
 */
describe("the driver result the schema hooks pass", () => {
    /** Stands in for the drizzle handle `createConnection` puts on `db`. */
    const drizzleHandle = () => ({ execute: jest.fn(async () => ({ rows: [] })) });

    it("forwards a supplied pre-init result as `internals`, holding the live db handle", async () => {
        const db = drizzleHandle();
        let received: unknown;

        const ensure = jest.fn(async (_collections: unknown[], driverResult: unknown) => {
            const internals = (driverResult as { internals?: { db?: typeof db } }).internals;
            // Exactly what the driver does; throws on the pre-fix shape.
            await internals!.db!.execute();
            received = internals!.db;
            return { applied: 1 };
        });

        await provisionCollectionTables(
            [collection("posts")],
            target({
                bootstrapper: { ensureCollectionSchema: ensure } as unknown as ProvisionTarget["bootstrapper"],
                driverResult: { internals: { db } } as never
            }),
            { env: {} }
        );

        expect(received).toBe(db);
        expect(db.execute).toHaveBeenCalled();
    });

    it("reaches ensureCollectionPolicies the same way", async () => {
        const db = drizzleHandle();
        let received: unknown;

        const ensure = jest.fn(async (_collections: unknown[], driverResult: unknown) => {
            const internals = (driverResult as { internals?: { db?: typeof db } }).internals;
            await internals!.db!.execute();
            received = internals!.db;
            return { applied: 4 };
        });

        await provisionCollectionPolicies(
            [collection("posts")],
            target({
                bootstrapper: { ensureCollectionPolicies: ensure } as unknown as ProvisionTarget["bootstrapper"],
                driverResult: { internals: { db } } as never
            }),
            { env: {} }
        );

        expect(received).toBe(db);
        expect(logged()).toContain("Applied 4");
    });

    // The app-shipping-its-own-image case. It handed its connection to the
    // adapter, not to the framework, so there is no pre-init result to pass and
    // the hook must still run — this is the exact call shape that was missing
    // entirely, leaving those deployments with no tables at all.
    it("still calls the hook when no pre-init result exists", async () => {
        let sawArgument: unknown = "never called";
        const ensure = jest.fn(async (_collections: unknown[], driverResult: unknown) => {
            sawArgument = driverResult;
            return { applied: 3 };
        });

        const outcome = await provisionCollectionTables(
            [collection("posts")],
            target({
                bootstrapper: { ensureCollectionSchema: ensure } as unknown as ProvisionTarget["bootstrapper"],
                driverResult: undefined
            }),
            { env: {} }
        );

        expect(ensure).toHaveBeenCalled();
        expect(sawArgument).toBeUndefined();
        expect(outcome).toEqual({ status: "applied", applied: 3 });
    });
});

describe("provisionTargetFor", () => {
    it("prefers the bootstrapper marked default over declaration order", async () => {
        const secondary = { type: "firestore" } as BackendBootstrapper;
        const primary = { type: "postgres", isDefault: true } as BackendBootstrapper;

        expect(provisionTargetFor([secondary, primary]).engine).toBe("postgres");
    });

    it("falls back to the first bootstrapper when none is marked", async () => {
        expect(provisionTargetFor([{ type: "postgres" } as BackendBootstrapper]).engine).toBe("postgres");
    });
});

/**
 * The probe that runs before boot's first real query.
 *
 * Provisioning is the earliest thing in boot that touches the database —
 * earlier than `initializeDriver`, which is where the Postgres adapter's
 * connection diagnosis lives. So a developer whose database was not running got
 * Drizzle's wrapper and nothing else. The diagnosis existed; nothing reached it.
 */
describe("verifyProvisioningConnection", () => {
    it("asks the bootstrapper, passing the pre-init driver stand-in", async () => {
        const verifyConnection = jest.fn(async () => {});
        const driverResult = { internals: {} } as ProvisionTarget["driverResult"];
        const t = target({
            bootstrapper: { verifyConnection } as unknown as ProvisionTarget["bootstrapper"],
            driverResult
        });

        await verifyProvisioningConnection(t);

        expect(verifyConnection).toHaveBeenCalledWith(driverResult);
    });

    it("lets the driver's diagnosis through rather than wrapping it", async () => {
        // The whole point is the message: re-wrapping it here would bury the
        // host, the port and the hint one layer deeper than they already were.
        const t = target({
            bootstrapper: {
                verifyConnection: jest.fn(async () => {
                    throw new Error("Cannot connect to PostgreSQL at 127.0.0.1:5432: connection refused.");
                })
            } as unknown as ProvisionTarget["bootstrapper"]
        });

        await expect(verifyProvisioningConnection(t)).rejects.toThrow("127.0.0.1:5432");
    });

    it("is a no-op for a driver that cannot probe", async () => {
        // A better first message, not a new requirement on every driver.
        await expect(verifyProvisioningConnection(target())).resolves.toBeUndefined();
    });
});

/**
 * `provision: false` is what a split deployment sets on every process but one.
 *
 * Both halves have to hold: the DDL must not run, and the process must say so.
 * A silent decline is the worst failure available here — a replica that
 * provisions nothing looks exactly like one that provisioned everything, right
 * up until the owner never boots and the whole deployment serves 500s with no
 * line anywhere naming the reason.
 */
describe("provisioning ownership", () => {
    it("runs no schema DDL, and says which process owns it", async () => {
        const t = target();

        const outcome = await provisionCollectionTables([collection("posts")], t, { provision: false });

        expect(t.bootstrapper.ensureCollectionSchema).not.toHaveBeenCalled();
        expect(outcome.status).toBe("skipped");
        expect(loggedAtDefaultLevel()).toContain("another process in this deployment owns it");
    });

    it("applies no policies, and says so at the default level", async () => {
        const t = target();

        const outcome = await provisionCollectionPolicies([collection("posts")], t, { provision: false });

        expect(t.bootstrapper.ensureCollectionPolicies).not.toHaveBeenCalled();
        expect(outcome.status).toBe("skipped");
        expect(loggedAtDefaultLevel()).toContain("another process in this deployment owns them");
    });

    it("provisions when the option is absent — the default must not move", async () => {
        const t = target();

        await provisionCollectionTables([collection("posts")], t, { env: {} });

        expect(t.bootstrapper.ensureCollectionSchema).toHaveBeenCalled();
    });

    it("still declines for REBASE_MIGRATE_ON_BOOT=none, and names that reason instead", async () => {
        // The two opt-outs answer different questions and must not be collapsed:
        // an operator reading "another process owns it" on a deployment that has
        // exactly one process would go looking for a process that never existed.
        await provisionCollectionTables([collection("posts")], target(), {
            provision: true,
            env: { REBASE_MIGRATE_ON_BOOT: "none" }
        });

        expect(logged()).toContain("REBASE_MIGRATE_ON_BOOT=none");
        expect(logged()).not.toContain("another process");
    });
});
