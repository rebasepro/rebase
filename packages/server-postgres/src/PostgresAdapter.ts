import { DatabaseAdapter, InitializedDriver, RealtimeProvider, DataDriver, DatabaseAdmin, BootstrappedAuth } from "@rebasepro/types";
import { createPostgresBootstrapper } from "./PostgresBootstrapper";
import type { PostgresDriverConfig } from "./PostgresBootstrapper";

/**
 * Creates a Postgres database adapter for Rebase.
 */
export function createPostgresAdapter(pgConfig: PostgresDriverConfig): DatabaseAdapter {
    const bootstrapper = createPostgresBootstrapper(pgConfig);

    return {
        type: bootstrapper.type,

        async initializeDriver(config) {
            return bootstrapper.initializeDriver(config);
        },

        async initializeRealtime(driverResult) {
            if (bootstrapper.initializeRealtime) {
                return bootstrapper.initializeRealtime({}, driverResult);
            }
            return undefined;
        },

        async initializeAuth(config, driverResult) {
            if (bootstrapper.initializeAuth) {
                return bootstrapper.initializeAuth(config, driverResult);
            }
            return undefined;
        },

        async initializeHistory(config, driverResult) {
            if (bootstrapper.initializeHistory) {
                return bootstrapper.initializeHistory(config, driverResult);
            }
            return undefined;
        },

        // `adapter` is forwarded for the same reason the schema hooks below are:
        // dropping an argument here is invisible at the call site and silent at
        // runtime. This one decided whether the realtime socket authenticates at
        // all — without it, a server whose auth comes from an AuthAdapter fell
        // back to "is a jwtSecret set?", answered no, and admitted every client.
        initializeWebsockets(server, realtimeService, driver, config, adapter) {
            if (bootstrapper.initializeWebsockets) {
                return bootstrapper.initializeWebsockets(server, realtimeService, driver, config, adapter);
            }
        },

        // Forwarded so the boot-time schema/RLS provisioning is reachable when
        // this adapter is wrapped back into a bootstrapper. Omitting either left
        // a managed tenant with no tables (500 on every data route) or tables
        // but no policies (401 on every read) — the create step never ran.
        ensureCollectionSchema: bootstrapper.ensureCollectionSchema
            ? (collections, driverResult, log) =>
                bootstrapper.ensureCollectionSchema!(collections, driverResult, log)
            : undefined,

        ensureCollectionPolicies: bootstrapper.ensureCollectionPolicies
            ? (collections, driverResult, log) =>
                bootstrapper.ensureCollectionPolicies!(collections, driverResult, log)
            : undefined,

        getAdmin(driverResult) {
            if (bootstrapper.getAdmin) {
                return bootstrapper.getAdmin(driverResult);
            }
            return undefined;
        },

        mountRoutes(app, basePath, driverResult) {
            if (bootstrapper.mountRoutes) {
                bootstrapper.mountRoutes(app, basePath, driverResult);
            }
        }
    };
}
