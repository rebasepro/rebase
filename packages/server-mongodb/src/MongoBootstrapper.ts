import { Db, MongoClient } from "mongodb";
import {
    BackendBootstrapper,
    InitializedDriver,
    BootstrappedAuth,
    DatabaseAdmin,
    RealtimeProvider,
    DataDriver,
    EntityCollection
} from "@rebasepro/types";
import { MongoDriver } from "./services/MongoDriver";
import { MongoRealtimeService } from "./services/MongoRealtimeService";
import { MongoCollectionRegistry } from "./factory";
import { MongoAuthRepository, MongoUserService, MongoRoleService } from "./auth/services";

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

export function createMongoBootstrapper(mongoConfig: MongoDriverConfig): BackendBootstrapper {
    return {
        type: "mongodb",

        async initializeDriver(config: unknown): Promise<InitializedDriver> {
            const { collections } = config as { collections?: EntityCollection[] };

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
                console.error("❌ Failed to connect to MongoDB:", err);
            }

            const realtimeService = new MongoRealtimeService(db);
            const driver = new MongoDriver(db, realtimeService);

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

            // @ts-ignore
            const { createEmailService } = await import("@rebasepro/server-core");
            const authConfig = config as any;
            let emailService: any;
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

        async initializeHistory(config: unknown, driverResult: InitializedDriver): Promise<{ historyService: any } | undefined> {
            const historyConfig = config as any;
            if (!historyConfig) return undefined;

            const internals = driverResult.internals as MongoDriverInternals;
            const db = internals.db;

            const { ensureHistoryCollectionExists } = await import("./history/ensure-history-collection");
            await ensureHistoryCollectionExists(db);

            const { MongoHistoryService } = await import("./services/MongoHistoryService");
            
            const retention = typeof historyConfig === "object" && historyConfig !== null ? historyConfig.retention : undefined;
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

            return {
                async executeAggregate(pipeline: Record<string, unknown>[]) {
                    const firstStage = pipeline[0];
                    const collName = (firstStage as any)?.$from ?? "__admin__";
                    const cursor = db.collection(collName).aggregate(pipeline);
                    return await cursor.toArray() as Record<string, unknown>[];
                },
                async fetchCollectionStats(collectionName: string) {
                    const stats = await db.command({ collStats: collectionName }) as { count: number; size: number };
                    return { count: stats.count, sizeBytes: stats.size };
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
                    if (!sample) return { columns: [], foreignKeys: [], junctions: [], policies: [] };
                    const columns = Object.entries(sample).map(([key, value]) => ({
                        column_name: key,
                        data_type: typeof value,
                        udt_name: typeof value,
                        is_nullable: "YES",
                        column_default: null,
                        character_maximum_length: null
                    }));
                    return { columns, foreignKeys: [], junctions: [], policies: [] };
                }
            };
        },

        mountRoutes() {},

        async initializeWebsockets(server: unknown, realtimeService: RealtimeProvider, driver: DataDriver, config?: unknown): Promise<void> {
            const { createMongoWebSocket } = await import("./websocket");
            createMongoWebSocket(
                server as import("http").Server,
                realtimeService as MongoRealtimeService,
                driver as MongoDriver,
                config as any
            );
        }
    };
}
