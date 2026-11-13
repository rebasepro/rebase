import type { AuthAdapter, BackendBootstrapper, InitializedDriver } from "@rebasepro/types";

import { createPostgresAdapter } from "../src/PostgresAdapter";
// Imported as a namespace as well so the delegation tests can stand a stub in
// for the bootstrapper the adapter builds for itself.
import * as bootstrapperModule from "../src/PostgresBootstrapper";
import { createPostgresBootstrapper, type PostgresDriverConfig } from "../src/PostgresBootstrapper";
import { driverStand } from "./helpers/spg-b-driver-stand";
import { tablesFromCollections } from "./helpers/tables";

/**
 * `createPostgresAdapter` must surface the boot-time schema/RLS provisioning the
 * bootstrapper implements. The adapter wraps the bootstrapper and re-declares
 * the methods it exposes; when it omitted `ensureCollectionSchema` /
 * `ensureTablePolicies`, the runtime booted a managed tenant with no tables
 * (500 on every data route) or no policies (401 on every read). The bootstrapper
 * has always implemented both — this pins that the adapter does not drop them.
 */
describe("createPostgresAdapter forwards the schema-provisioning methods", () => {
    // No connection is made at construction — the methods are only invoked at
    // boot — so a placeholder config is enough to assert the surface.
    const config: PostgresDriverConfig = { connection: {}, connectionString: "postgres://localhost/x" };

    it("exposes both provisioning methods when the bootstrapper does", () => {
        const bootstrapper = createPostgresBootstrapper(config);
        expect(typeof bootstrapper.ensureCollectionSchema).toBe("function");
        expect(typeof bootstrapper.ensureTablePolicies).toBe("function");

        const adapter = createPostgresAdapter(config);
        expect(typeof adapter.ensureCollectionSchema).toBe("function");
        expect(typeof adapter.ensureTablePolicies).toBe("function");
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
        const collections = tablesFromCollections([
            { slug: "posts", name: "Posts", properties: { id: { type: "string", name: "Id", isId: true } } },
            { slug: "authors", name: "Authors", properties: { id: { type: "string", name: "Id", isId: true } } }
        ]).tables;
        const driverResult: InitializedDriver = { driver: driverStand().driver };
        const log = jest.fn();

        let ensureCollectionSchema: jest.Mock;
        let ensureTablePolicies: jest.Mock;

        function stubBootstrapper(over: Partial<BackendBootstrapper> = {}) {
            const bootstrapper: BackendBootstrapper = {
                type: "postgres",
                initializeDriver: jest.fn(),
                ensureCollectionSchema,
                ensureTablePolicies,
                ...over
            };
            jest.spyOn(bootstrapperModule, "createPostgresBootstrapper").mockReturnValue(bootstrapper);
        }

        beforeEach(() => {
            ensureCollectionSchema = jest.fn().mockResolvedValue({ applied: 3 });
            ensureTablePolicies = jest.fn().mockResolvedValue({ applied: 7 });
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

        it("hands ensureTablePolicies every argument and returns its result", async () => {
            stubBootstrapper();

            const result = await createPostgresAdapter(config)
                .ensureTablePolicies!(collections, driverResult, log);

            expect(ensureTablePolicies).toHaveBeenCalledTimes(1);
            expect(ensureTablePolicies).toHaveBeenCalledWith(collections, driverResult, log);
            expect(result).toEqual({ applied: 7 });
        });

        it("leaves the method undefined when the bootstrapper implements none", () => {
            // Both are optional on the interface, so the wrapper must not
            // manufacture a no-op: a caller checks for the method's presence to
            // decide whether boot provisioning is available at all.
            stubBootstrapper({
                ensureCollectionSchema: undefined,
                ensureTablePolicies: undefined
            });

            const adapter = createPostgresAdapter(config);

            expect(adapter.ensureCollectionSchema).toBeUndefined();
            expect(adapter.ensureTablePolicies).toBeUndefined();
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
            stubBootstrapper({ initializeWebsockets });

            const server = { marker: "http-server" };
            const { realtime: realtimeService, driver } = driverStand();
            const authConfig = { requireAuth: true };
            const authAdapter: AuthAdapter = {
                id: "clerk",
                verifyRequest: async () => null,
                getCapabilities: () => ({
                    hasBuiltInAuthRoutes: false, emailPasswordLogin: false, registrationEnabled: false, passwordReset: false,
                    adminPasswordReset: false, sessionManagement: false, profileUpdate: false, emailVerification: false,
                    magicLink: false, anonymousLogin: false, enabledProviders: []
                })
            };
            // The data API's body and rate limits, for the socket's frames —
            // dropped here, the socket has neither.
            const limits = { maxPayload: 1024, dataRateLimit: async () => null };

            await createPostgresAdapter(config).initializeWebsockets!(
                server,
                realtimeService,
                driver,
                authConfig,
                authAdapter,
                limits
            );

            expect(initializeWebsockets).toHaveBeenCalledWith(
                server, realtimeService, driver, authConfig, authAdapter, limits
            );
        });
    });
});
