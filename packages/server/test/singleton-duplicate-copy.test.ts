import type { RebaseServerClient } from "@rebasepro/types";
import { createRebaseBackend, type RebaseBackend } from "../src/backend/create-backend";
import { fakeBootstrapper } from "./helpers/server-b-fakes";
import { tablesFrom } from "./helpers/tables";

/**
 * The singleton must survive being loaded twice into one process.
 *
 * This is not a hypothetical. Under the managed runtime it is the NORMAL
 * layout: the image ships the framework at `/app/node_modules`, and a project's
 * bundle installs its own dependencies into `/bundle/node_modules` — where
 * `@rebasepro/server` lands as a transitive dependency of `@rebasepro/cms`
 * and `@rebasepro/server-postgres`. Every custom function imports
 * `defineFunction` from `@rebasepro/server`, so functions hold the bundle's
 * copy while `initializeRebaseBackend()` initializes the image's.
 *
 * With the instance in a module-local variable, that meant `rebase.data`,
 * `rebase.dataAsAdmin` and `rebase.storage` threw "server not initialized yet"
 * on EVERY request to EVERY custom function, in a process that booted cleanly
 * and reported itself healthy. Holding it on a `Symbol.for` slot — a registry
 * that is per-process rather than per-module — is what makes the copies agree.
 *
 * `jest.resetModules()` between imports gives two genuinely separate module
 * instances, which is exactly the production condition.
 */

const SLOT = Symbol.for("@rebasepro/server:singleton-instance");

type SingletonModule = typeof import("../src/singleton");

/** Load a fresh instance of the module, as a second copy on disk would be. */
async function loadCopy(): Promise<SingletonModule> {
    let copy!: SingletonModule;
    await jest.isolateModulesAsync(async () => {
        copy = (await import("../src/singleton")) as SingletonModule;
    });
    return copy;
}

describe("the rebase singleton across duplicate module copies", () => {
    const backends: RebaseBackend[] = [];

    /** A real server client: the one a backend built from a fake driver hands out. */
    async function serverClient(): Promise<RebaseServerClient> {
        const backend = await createRebaseBackend({
            bootstrappers: [fakeBootstrapper()],
            cronPersistence: false,
            provision: false
        });
        backends.push(backend);
        return backend.rebase;
    }

    afterEach(async () => {
        delete (globalThis as Record<symbol, unknown>)[SLOT];
        while (backends.length) await backends.pop()?.shutdown(0);
    });

    it("lets a copy that never booted read the instance the booting copy set", async () => {
        const runtimeCopy = await loadCopy();
        const bundleCopy = await loadCopy();

        // Two distinct module instances — otherwise this test proves nothing.
        expect(bundleCopy).not.toBe(runtimeCopy);

        const client = await serverClient();
        runtimeCopy._initRebase(client);

        // The bundle's copy is the one a custom function holds. Before the fix
        // this threw "server not initialized yet".
        expect(bundleCopy.rebase.dataAsAdmin).toBe(client.dataAsAdmin);
        expect(runtimeCopy.rebase.dataAsAdmin).toBe(client.dataAsAdmin);
    });

    it("still reports an uninitialized server, rather than reading a stale slot", async () => {
        const copy = await loadCopy();
        expect(() => copy.rebase.dataAsAdmin).toThrow(/server not initialized yet/);
    });

    it("publishes to the process-wide slot, not to module state", async () => {
        const copy = await loadCopy();
        const client = await serverClient();
        copy._initRebase(client);

        expect((globalThis as Record<symbol, unknown>)[SLOT]).toBe(client);
    });
});
