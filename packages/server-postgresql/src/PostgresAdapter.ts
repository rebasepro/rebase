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
        
        initializeWebsockets(server, realtimeService, driver, config) {
            if (bootstrapper.initializeWebsockets) {
                return bootstrapper.initializeWebsockets(server, realtimeService, driver, config);
            }
        },
        
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
