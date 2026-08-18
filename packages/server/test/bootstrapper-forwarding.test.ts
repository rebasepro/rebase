import type { DatabaseAdapter } from "@rebasepro/types";
import { adapterToBootstrapper } from "../src/boot/driver";
import { wrapDatabaseAdapter } from "../src/init";

/**
 * Neither wrapper may drop a capability the adapter implements.
 *
 * Two functions turn a `DatabaseAdapter` into a `BackendBootstrapper`, and both
 * rebuild the object field by field. That shape fails silently in a way that is
 * worth stating plainly: every capability is optional, so omitting one is not a
 * type error, and the caller's response to a missing method is to skip — so it
 * is not a runtime error either. The whole failure surfaces three layers away as
 * data routes 500ing on relations that were never created.
 *
 * That is exactly what happened. `ensureCollectionSchema` was absent from both
 * wrappers, so boot-time table creation was dead on the real adapter path from
 * the day it shipped; the fix restored it in `driver.ts` and left `init.ts`
 * still dropping it. A test naming one method would have missed that. This one
 * enumerates the optional surface, so the next capability added to the adapter
 * protocol has to be added to `CAPABILITIES` — and the moment it is, both
 * wrappers are held to it.
 *
 * It happened again with the schema-stamp hooks, one layer further out: both
 * wrappers here were updated, and `createPostgresAdapter` — a THIRD wrapper,
 * in the driver package, rebuilding the same object field by field — was not.
 * The stamp was therefore never written by any real deployment, and because a
 * check that never runs looks exactly like a check that passes, only the e2e
 * noticed. `packages/server-postgres/test/adapter-forwarding.test.ts` is the
 * sibling of this file, added for that reason.
 */
const CAPABILITIES = [
    "initializeRealtime",
    "initializeAuth",
    "initializeHistory",
    "initializeWebsockets",
    "ensureCollectionSchema",
    "ensureCollectionPolicies",
    "readCollectionsSchemaVersion",
    "stampCollectionsSchemaVersion",
    "getAdmin",
    "mountRoutes"
] as const;

/** An adapter that implements everything, so any omission shows up as a gap. */
function fullyCapableAdapter(): DatabaseAdapter {
    const adapter: Record<string, unknown> = {
        type: "test-driver",
        initializeDriver: async () => ({ internals: {} })
    };
    for (const capability of CAPABILITIES) {
        adapter[capability] = () => undefined;
    }
    return adapter as unknown as DatabaseAdapter;
}

/** An adapter that implements nothing optional — the schemaless-driver shape. */
function minimalAdapter(): DatabaseAdapter {
    return {
        type: "test-driver",
        initializeDriver: async () => ({ internals: {} })
    } as unknown as DatabaseAdapter;
}

const WRAPPERS: Array<[string, (adapter: DatabaseAdapter) => Record<string, unknown>]> = [
    ["wrapDatabaseAdapter (init.ts, config.database path)",
        adapter => wrapDatabaseAdapter(adapter) as unknown as Record<string, unknown>],
    ["adapterToBootstrapper (boot/driver.ts, multi-source path)",
        adapter => adapterToBootstrapper(adapter, "(default)", true) as unknown as Record<string, unknown>]
];

describe.each(WRAPPERS)("%s", (_name, wrap) => {
    it.each(CAPABILITIES)("forwards %s when the adapter implements it", capability => {
        expect(typeof wrap(fullyCapableAdapter())[capability]).toBe("function");
    });

    it.each(CAPABILITIES)("leaves %s undefined when the adapter does not", capability => {
        // The negative half matters as much as the positive one: boot decides
        // whether to run a phase by testing for the method, so a wrapper that
        // always installed a function would make a schemaless driver claim
        // capabilities it does not have, and the skip path would never run.
        expect(wrap(minimalAdapter())[capability]).toBeUndefined();
    });

    it("keeps the required surface intact", () => {
        const wrapped = wrap(fullyCapableAdapter());
        expect(wrapped.type).toBe("test-driver");
        expect(typeof wrapped.initializeDriver).toBe("function");
    });

    it("actually calls through to the adapter, not just exposes a stub", () => {
        // Forwarding the *presence* of a method is not enough — an earlier
        // shape wrapped these in closures, and a closure that forgets its
        // argument passes the type check while doing nothing useful.
        const calls: string[] = [];
        const adapter = fullyCapableAdapter() as unknown as Record<string, unknown>;
        adapter.ensureCollectionSchema = (collections: unknown[]) => {
            calls.push(`schema:${collections.length}`);
            return { applied: 0 };
        };
        adapter.ensureCollectionPolicies = (collections: unknown[]) => {
            calls.push(`policies:${collections.length}`);
            return { applied: 0 };
        };

        const wrapped = wrap(adapter as unknown as DatabaseAdapter);
        (wrapped.ensureCollectionSchema as (...args: unknown[]) => unknown)(
            [{}, {}], { internals: {} }, () => undefined
        );
        (wrapped.ensureCollectionPolicies as (...args: unknown[]) => unknown)(
            [{}], { internals: {} }, () => undefined
        );

        expect(calls).toEqual(["schema:2", "policies:1"]);
    });
});
