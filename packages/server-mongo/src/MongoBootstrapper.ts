import { Db, MongoClient } from "mongodb";
import type {
    AuthAdapter,
    BackendBootstrapper,
    InitializedDriver,
    BootstrappedAuth,
    DatabaseAdmin,
    HistoryConfig,
    RealtimeProvider,
    DataDriver,
    CollectionConfig
} from "@rebasepro/types";
import { MongoDriver } from "./services/MongoDriver";
import { MongoRealtimeService } from "./services/MongoRealtimeService";
import { MongoCollectionRegistry } from "./factory";
import { MongoAuthRepository, MongoUserService, MongoRoleService } from "./auth/services";
import { logger } from "@rebasepro/server";

export interface MongoDriverConfig {
    connection: Db;
    client: MongoClient;
}

export interface MongoDriverInternals {
    db: Db;
    client: MongoClient;
    registry: MongoCollectionRegistry;
    realtimeService: MongoRealtimeService;
    driver: MongoDriver;
}

/** Shape of the config object passed to `initializeDriver` by the coordinator. */
interface DriverInitConfig {
    collections?: CollectionConfig[];
}

/** Shape of the auth config passed to `initializeAuth`. */
interface AuthInitConfig {
    email?: import("@rebasepro/server").EmailConfig;
}



export function createMongoBootstrapper(mongoConfig: MongoDriverConfig): BackendBootstrapper {
    // Cached admin object, set during getAdmin() and used by initializeWebsockets
    let cachedAdmin: DatabaseAdmin | undefined;

    return {
        type: "mongodb",

        async initializeDriver(config: unknown): Promise<InitializedDriver> {
            const { collections } = config as DriverInitConfig;

            const registry = new MongoCollectionRegistry();
            if (collections) {
                collections.forEach(collection => registry.register(collection));
            }

            const db = mongoConfig.connection;
            const client = mongoConfig.client;

            // Verify connection
            try {
                await db.command({ ping: 1 });
            } catch (err) {
                logger.error("❌ Failed to connect to MongoDB", { error: err });
            }

            const realtimeService = new MongoRealtimeService(db);
            const driver = new MongoDriver(db, realtimeService, undefined, registry);

            const internals: MongoDriverInternals = {
                db,
                client,
                registry,
                realtimeService,
                driver
            };

            return {
                driver,
                realtimeProvider: realtimeService,
                collectionRegistry: registry,
                internals
            };
        },

        async initializeAuth(config: unknown, driverResult: InitializedDriver): Promise<BootstrappedAuth | undefined> {
            const internals = driverResult.internals as MongoDriverInternals;
            const db = internals.db;

            const { ensureAuthCollectionsExist } = await import("./auth/ensure-collections");
            await ensureAuthCollectionsExist(db);

            const { createEmailService } = await import("@rebasepro/server");
            const authConfig = config as AuthInitConfig | undefined;
            let emailService: unknown;
            if (authConfig?.email) {
                emailService = createEmailService(authConfig.email);
            }

            const userService = new MongoUserService(db);
            const roleService = new MongoRoleService(db);
            const authRepository = new MongoAuthRepository(db);

            return {
                userService,
                roleService,
                authRepository,
                emailService
            };
        },

        async initializeHistory(config: HistoryConfig, driverResult: InitializedDriver): Promise<{ historyService: unknown } | undefined> {
            if (!config) return undefined;

            const internals = driverResult.internals as MongoDriverInternals;
            const db = internals.db;

            const { ensureHistoryCollectionExists } = await import("./history/ensure-history-collection");
            await ensureHistoryCollectionExists(db);

            const { MongoHistoryService } = await import("./services/MongoHistoryService");

            const retention = typeof config === "object" ? config.retention : undefined;
            const historyService = new MongoHistoryService(db, retention ? { ttlDays: retention } : undefined);

            return { historyService };
        },

        async initializeRealtime(_config: unknown, driverResult: InitializedDriver): Promise<RealtimeProvider | undefined> {
            const internals = driverResult.internals as MongoDriverInternals;
            return internals.realtimeService;
        },

        getAdmin(driverResult: InitializedDriver): DatabaseAdmin | undefined {
            const internals = driverResult.internals as MongoDriverInternals;
            const db = internals.db;

            const admin: DatabaseAdmin = {
                async executeAggregate(pipeline: Record<string, unknown>[]) {
                    const firstStage = pipeline[0];
                    const collName = (firstStage as { $from?: string })?.$from ?? "__admin__";
                    const cursor = db.collection(collName).aggregate(pipeline);
                    return await cursor.toArray() as Record<string, unknown>[];
                },
                async fetchCollectionStats(collectionName: string) {
                    const stats = await db.command({ collStats: collectionName }) as { count: number; size: number };
                    return { count: stats.count,
sizeBytes: stats.size };
                },
                async fetchUnmappedTables(mappedPaths?: string[]) {
                    const allCollections = await db.listCollections().toArray();
                    const names = allCollections.map(c => c.name).filter(n => !n.startsWith("system."));
                    if (!mappedPaths || mappedPaths.length === 0) return names;
                    const mappedSet = new Set(mappedPaths.map(p => p.toLowerCase()));
                    return names.filter(n => !mappedSet.has(n.toLowerCase()));
                },
                async fetchTableMetadata(collectionName: string) {
                    const sample = await db.collection(collectionName).findOne();
                    if (!sample) return { columns: [],
foreignKeys: [],
junctions: [],
policies: [] };
                    const columns = Object.entries(sample).map(([key, value]) => ({
                        column_name: key,
                        data_type: typeof value,
                        udt_name: typeof value,
                        is_nullable: "YES",
                        column_default: null,
                        character_maximum_length: null
                    }));
                    return { columns,
foreignKeys: [],
junctions: [],
policies: [] };
                }
            };

            cachedAdmin = admin;
            return admin;
        },

        mountRoutes() {},

        // Five parameters, not four. `BackendBootstrapper` declares an
        // `authAdapter` here and `init.ts` passes one; dropping it left the
        // socket with only its built-in JWT verifier, so on a backend using an
        // AuthAdapter every realtime AUTHENTICATE failed with "Invalid or
        // expired token" — and nothing on either side could have type-checked
        // the mismatch.
        async initializeWebsockets(server: unknown, realtimeService: RealtimeProvider, driver: DataDriver, config?: unknown, authAdapter?: AuthAdapter): Promise<void> {
            const { createMongoWebSocket } = await import("./websocket");
            createMongoWebSocket(
                server as import("http").Server,
                realtimeService as MongoRealtimeService,
                driver as MongoDriver,
                config as Record<string, unknown> | undefined,
                cachedAdmin,
                authAdapter
            );
        }
    };
}
