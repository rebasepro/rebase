import type { BackendBootstrapper, InitializedDriver } from "@rebasepro/types";

import { createPostgresAdapter } from "../src/PostgresAdapter";
// Imported as a namespace as well so the delegation tests can stand a stub in
// for the bootstrapper the adapter builds for itself.
import * as bootstrapperModule from "../src/PostgresBootstrapper";
import { createPostgresBootstrapper } from "../src/PostgresBootstrapper";

/**
 * `createPostgresAdapter` must surface the boot-time schema/RLS provisioning the
 * bootstrapper implements. The adapter wraps the bootstrapper and re-declares
 * the methods it exposes; when it omitted `ensureCollectionSchema` /
 * `ensureCollectionPolicies`, the runtime booted a managed tenant with no tables
 * (500 on every data route) or no policies (401 on every read). The bootstrapper
 * has always implemented both — this pins that the adapter does not drop them.
 */
describe("createPostgresAdapter forwards the schema-provisioning methods", () => {
    // No connection is made at construction — the methods are only invoked at
    // boot — so a placeholder config is enough to assert the surface.
    const config = { connection: {}, connectionString: "postgres://localhost/x" } as never;

    it("exposes both provisioning methods when the bootstrapper does", () => {
        const bootstrapper = createPostgresBootstrapper(config);
        expect(typeof bootstrapper.ensureCollectionSchema).toBe("function");
        expect(typeof bootstrapper.ensureCollectionPolicies).toBe("function");

        const adapter = createPostgresAdapter(config);
        expect(typeof adapter.ensureCollectionSchema).toBe("function");
        expect(typeof adapter.ensureCollectionPolicies).toBe("function");
    });

    /**
     * A re-declared method that drops an argument, or throws its result away, is
     * still a function of the right name on the right object — so the surface
     * check above passes while boot provisioning quietly does nothing. What the
     * runtime depends on is the call reaching the bootstrapper intact: the same
     * collections, the same driver handle, the same `log` sink (the only way an
     * operator sees what was applied), and the `{ applied }` count coming back.
     */
    describe("delegation", () => {
        const collections = [{ slug: "posts" }, { slug: "authors" }];
        const driverResult = { marker: "driver-result" } as unknown as InitializedDriver;
        const log = jest.fn();

        let ensureCollectionSchema: jest.Mock;
        let ensureCollectionPolicies: jest.Mock;

        function stubBootstrapper(over: Partial<BackendBootstrapper> = {}) {
            jest.spyOn(bootstrapperModule, "createPostgresBootstrapper").mockReturnValue({
                type: "postgres",
                initializeDriver: jest.fn(),
                ensureCollectionSchema,
                ensureCollectionPolicies,
                ...over
            } as unknown as BackendBootstrapper);
        }

        beforeEach(() => {
            ensureCollectionSchema = jest.fn().mockResolvedValue({ applied: 3 });
            ensureCollectionPolicies = jest.fn().mockResolvedValue({ applied: 7 });
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        it("hands ensureCollectionSchema every argument and returns its result", async () => {
            stubBootstrapper();

            const result = await createPostgresAdapter(config)
                .ensureCollectionSchema!(collections, driverResult, log);

            expect(ensureCollectionSchema).toHaveBeenCalledTimes(1);
            expect(ensureCollectionSchema).toHaveBeenCalledWith(collections, driverResult, log);
            expect(result).toEqual({ applied: 3 });
        });

        it("hands ensureCollectionPolicies every argument and returns its result", async () => {
            stubBootstrapper();

            const result = await createPostgresAdapter(config)
                .ensureCollectionPolicies!(collections, driverResult, log);

            expect(ensureCollectionPolicies).toHaveBeenCalledTimes(1);
            expect(ensureCollectionPolicies).toHaveBeenCalledWith(collections, driverResult, log);
            expect(result).toEqual({ applied: 7 });
        });

        it("leaves the method undefined when the bootstrapper implements none", () => {
            // Both are optional on the interface, so the wrapper must not
            // manufacture a no-op: a caller checks for the method's presence to
            // decide whether boot provisioning is available at all.
            stubBootstrapper({
                ensureCollectionSchema: undefined,
                ensureCollectionPolicies: undefined
            });

            const adapter = createPostgresAdapter(config);

            expect(adapter.ensureCollectionSchema).toBeUndefined();
            expect(adapter.ensureCollectionPolicies).toBeUndefined();
        });

        /**
         * The AuthAdapter is the fifth argument, and dropping it was silent
         * twice over: JavaScript discards a surplus argument without complaint,
         * and TypeScript could not object either, because `DatabaseAdapter`
         * declared only four parameters while `BackendBootstrapper` — the type
         * on the other side of the very same call — declared five. Two
         * interfaces for one hop, disagreeing, with the wrapper here written
         * against the shorter one.
         *
         * What went missing is the argument that makes the realtime socket
         * secure by default: given an adapter the socket requires auth
         * unconditionally; without one it falls back to asking whether a local
         * `jwtSecret` happens to be set. For a server that authenticates through
         * an adapter the answer is no — so every client connected already
         * marked authenticated.
         */
        it("hands the AuthAdapter through to the bootstrapper's websocket init", async () => {
            const initializeWebsockets = jest.fn();
            stubBootstrapper({ initializeWebsockets } as unknown as Partial<BackendBootstrapper>);

            const server = { marker: "http-server" };
            const realtimeService = { marker: "realtime" };
            const driver = { marker: "driver" };
            const authConfig = { requireAuth: true };
            const authAdapter = { name: "clerk" };

            await createPostgresAdapter(config).initializeWebsockets!(
                server,
                realtimeService as never,
                driver as never,
                authConfig,
                authAdapter
            );

            expect(initializeWebsockets).toHaveBeenCalledWith(
                server, realtimeService, driver, authConfig, authAdapter
            );
        });
    });
});
