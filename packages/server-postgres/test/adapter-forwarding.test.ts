import { createPostgresAdapter } from "../src/PostgresAdapter";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";

/**
 * `createPostgresAdapter` must not drop a capability the bootstrapper has.
 *
 * The sibling of `packages/server/test/bootstrapper-forwarding.test.ts`, and it
 * exists because that file was not enough. Two wrappers in the runtime turn a
 * `DatabaseAdapter` into a `BackendBootstrapper` and are held to an enumerated
 * list there. This is the *third* wrapper, pointing the other way — bootstrapper
 * to adapter — and it lives in the driver package, so nothing that guarded the
 * other two could see it.
 *
 * The schema-stamp hooks were added to the bootstrapper and to both runtime
 * wrappers, and omitted here. Every layer type-checked. Nothing threw. The
 * runtime asked the adapter for a method that was not there and did what it
 * always does with a missing optional capability — skipped — so the stamp was
 * never written on any real boot, and a check that never runs is
 * indistinguishable from a check that passes. The e2e caught it; a unit test
 * should have.
 *
 * Comparing against the bootstrapper's own key set rather than a hand-written
 * list is what makes this hold for the *next* capability too: adding one to
 * `createPostgresBootstrapper` fails this test until it is forwarded.
 */

/** A config that constructs without touching a database. */
const CONFIG = { connectionString: "postgres://user:pw@localhost:5432/db" } as never;

/**
 * Keys the adapter protocol deliberately does not carry.
 *
 * `initializeDriver` is present on both but is called differently, and the rest
 * are bootstrapper-only registry concerns: an adapter has no identity in the
 * multi-source registry, which is exactly what `adapterToBootstrapper` supplies
 * when it wraps one back.
 */
const NOT_ON_THE_ADAPTER = new Set(["isDefault", "id"]);

describe("createPostgresAdapter forwards the bootstrapper's capabilities", () => {
    it("implements every method the bootstrapper does", () => {
        const bootstrapper = createPostgresBootstrapper(CONFIG) as unknown as Record<string, unknown>;
        const adapter = createPostgresAdapter(CONFIG) as unknown as Record<string, unknown>;

        const missing = Object.keys(bootstrapper)
            .filter(key => typeof bootstrapper[key] === "function")
            .filter(key => !NOT_ON_THE_ADAPTER.has(key))
            .filter(key => typeof adapter[key] !== "function");

        expect(missing).toEqual([]);
    });

    it("forwards the schema stamp, both halves", () => {
        // Named explicitly as well as covered by the sweep above, because these
        // two are the reason this file exists and a regression in them is
        // silent in a way the others are not: the stamp is not on any request
        // path, so nothing fails, and the split deployment simply stops being
        // checked.
        const adapter = createPostgresAdapter(CONFIG) as unknown as Record<string, unknown>;

        expect(typeof adapter.readCollectionsSchemaVersion).toBe("function");
        expect(typeof adapter.stampCollectionsSchemaVersion).toBe("function");
    });
});
