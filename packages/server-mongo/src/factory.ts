/**
 * MongoDB Backend Factory
 *
 * This module provides factory functions for creating MongoDB backend instances.
 * It abstracts the creation of drivers, realtime services, and row services.
 */

import { Db, MongoClient } from "mongodb";
import { DataDriver, CollectionConfig, getCollectionDataPath } from "@rebasepro/types";

import { MongoDataService } from "./db/MongoDataService";
import { MongoRealtimeService } from "./services/MongoRealtimeService";
import { MongoDriver } from "./services/MongoDriver";
import { MongoHistoryService, HistoryRetentionConfig } from "./services/MongoHistoryService";
import { MongoDBConnection } from "./connection";
import { BackendConfig, BackendInstance, CollectionRegistryInterface, DataRepository, RealtimeProvider, DatabaseConnection, DatabaseAdmin, DocumentAdmin, SchemaAdmin, SchemaEditingAdmin, HealthCheckResult } from "@rebasepro/types";
import { planMongoSchemaChange } from "./schema/plan-schema-change";

/**
 * Configuration for creating a MongoDB backend.
 */
export interface MongoBackendConfig extends BackendConfig {
    type: "mongodb";
    /** MongoDB database instance */
    connection: Db;
    /** MongoDB client (for connection management) */
    client: MongoClient;
    /** Collections to register (optional, can be registered later) */
    collections?: CollectionConfig[];
    /** History retention configuration */
    historyRetention?: Partial<HistoryRetentionConfig>;
}

/**
 * MongoDB-specific backend instance with additional MongoDB types.
 */
export interface MongoBackendInstance extends BackendInstance {
    /** The MongoDB database instance */
    db: Db;
    /** The MongoDB client */
    client: MongoClient;
    /** MongoDB DataDriver for use with Rebase */
    driver: DataDriver;
    /** Entity service for direct database operations */
    dataService: MongoDataService;
    /** Realtime service for subscriptions */
    realtimeService: MongoRealtimeService;
    /** Admin capabilities (DocumentAdmin + SchemaAdmin) */
    admin: DatabaseAdmin;
}

// =============================================================================
// Simple Collection Registry
// =============================================================================

/**
 * Simple in-memory collection registry for MongoDB.
 */
export class MongoCollectionRegistry implements CollectionRegistryInterface {
    /** Every addressable key → collection. See {@link register}. */
    private collections = new Map<string, CollectionConfig>();
    /** Registration order, so `getCollections()` returns each collection once. */
    private registered: CollectionConfig[] = [];
    private _globalCallbacks?: any;

    /**
     * Register a collection under every name it can be addressed by.
     *
     * A Mongo collection has up to three: `slug` (the routing key), `path` (the
     * MongoDB collection-name override, which is what `getCollectionDataPath`
     * hands the driver) and `name` (the human label). Registering only `name`
     * meant every `getCollectionByPath` lookup missed — and the realtime path,
     * whose only source of the collection is this registry, ran with no
     * `securityRules`, no `properties` and no callbacks.
     */
    register(collection: CollectionConfig): void {
        this.registered.push(collection);
        for (const key of [getCollectionDataPath(collection), collection.slug, collection.name]) {
            if (key) this.collections.set(key, collection);
        }
    }

    /**
     * Get a collection by its path
     */
    getCollectionByPath(path: string): CollectionConfig | undefined {
        return this.collections.get(path);
    }

    /**
     * Get all registered collections
     */
    getCollections(): CollectionConfig[] {
        return [...this.registered];
    }

    /**
     * Get the currently registered global callbacks, if any.
     */
    getGlobalCallbacks(): any | undefined {
        return this._globalCallbacks;
    }

    /**
     * Set global lifecycle callbacks that apply to every collection.
     */
    setGlobalCallbacks(callbacks: any): void {
        this._globalCallbacks = callbacks;
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a complete MongoDB backend instance.
 *
 * This factory function creates all the necessary services for a MongoDB backend:
 * - MongoDBConnection (database connection wrapper)
 * - MongoDataService (implements DataRepository)
 * - MongoRealtimeService (implements RealtimeProvider)
 * - MongoCollectionRegistry (implements CollectionRegistryInterface)
 * - MongoDriver (for Rebase integration)
 *
 * @example
 * ```typescript
 * import { createMongoBackend } from "@rebasepro/server-mongo";
 *
 * const client = new MongoClient("mongodb://localhost:27017");
 * await client.connect();
 * const db = client.db("my_database");
 *
 * const backend = createMongoBackend({
 *     type: "mongodb",
 *     connection: db,
 *     client: client,
 *     collections: myCollections
 * });
 *
 * // Use the backend
 * const rows = await backend.entityRepository.fetchCollection("users", {});
 * ```
 */
export function createMongoBackend(config: MongoBackendConfig): MongoBackendInstance {
    const { connection: db, client, collections } = config;

    // Create collection registry
    const collectionRegistry = new MongoCollectionRegistry();

    // Register collections if provided
    if (collections) {
        collections.forEach(collection => collectionRegistry.register(collection));
    }

    // Create services
    const dataService = new MongoDataService(db);
    const realtimeService = new MongoRealtimeService(db);
    const historyService = new MongoHistoryService(db, config.historyRetention);
    const driver = new MongoDriver(db, realtimeService, historyService, collectionRegistry);
    const mongoConnection = new MongoDBConnection(db, client);

    // Build admin capabilities for MongoDB
    const admin: DatabaseAdmin = {
        // A document database has no table to alter, so a collection change is
        // the commit and nothing else. Offered here because `isSchemaEditingAdmin`
        // is a structural check: without this method a Mongo project was told
        // live schema editing was *unsupported*, when it is the one place the
        // change cannot fail.
        planSchemaChange: async (before, after) => planMongoSchemaChange(
            before as CollectionConfig[],
            after as CollectionConfig[]
        ),
        async executeAggregate(pipeline: Record<string, unknown>[]) {
            // Run aggregation on a collection — requires a target collection
            // from the pipeline's $match or $lookup stage:
            const firstStage = pipeline[0];
            const collName = typeof firstStage.$from === "string" ? firstStage.$from : "__admin__";
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
            // Sample a document to infer fields
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
        // `satisfies` narrows the literal regardless of the annotation above, so
        // the schema-editing method has to be named here too or it reads as an
        // excess property.
    } satisfies DocumentAdmin & SchemaAdmin & SchemaEditingAdmin;

    return {
        // Abstract interface implementations
        connection: mongoConnection,
        entityRepository: dataService,
        realtimeProvider: realtimeService,
        collectionRegistry: collectionRegistry,
        admin,

        // Lifecycle
        async initialize() {
            // Connection is already established via the MongoClient constructor
        },
        async healthCheck(): Promise<HealthCheckResult> {
            const start = Date.now();
            try {
                await db.command({ ping: 1 });
                return { healthy: true,
latencyMs: Date.now() - start };
            } catch {
                return { healthy: false,
latencyMs: Date.now() - start };
            }
        },
        async destroy() {
            await client.close();
        },

        // MongoDB-specific accessors
        db,
        client,
        driver,
        dataService,
        realtimeService
    };
}

/**
 * Create a MongoDB DataDriver.
 *
 * This is a convenience function when you only need the DataDriver
 * without the full backend instance.
 *
 * @example
 * ```typescript
 * import { createMongoDelegate } from "@rebasepro/server-mongo";
 *
 * const delegate = createMongoDelegate(db);
 * ```
 */
export function createMongoDelegate(
    db: Db,
    realtimeService?: MongoRealtimeService,
    historyService?: MongoHistoryService,
    registry?: CollectionRegistryInterface
): MongoDriver {
    const realtime = realtimeService ?? new MongoRealtimeService(db);
    const history = historyService ?? new MongoHistoryService(db);
    return new MongoDriver(db, realtime, history, registry);
}

/**
 * Create a RealtimeService for MongoDB.
 *
 * @example
 * ```typescript
 * import { createMongoRealtimeService } from "@rebasepro/server-mongo";
 *
 * const realtimeService = createMongoRealtimeService(db);
 * ```
 */
export function createMongoRealtimeService(db: Db): MongoRealtimeService {
    return new MongoRealtimeService(db);
}

/**
 * Create a MongoDB row repository.
 *
 * @example
 * ```typescript
 * import { createMongoEntityRepository } from "@rebasepro/server-mongo";
 *
 * const repository = createMongoEntityRepository(db);
 * const users = await repository.fetchCollection("users", {});
 * ```
 */
export function createMongoEntityRepository(db: Db): DataRepository {
    return new MongoDataService(db);
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a backend config is for MongoDB.
 */
export function isMongoBackendConfig(config: BackendConfig): config is MongoBackendConfig {
    return config.type === "mongodb" &&
        typeof (config as MongoBackendConfig).connection !== "undefined" &&
        typeof (config as MongoBackendConfig).client !== "undefined";
}

/**
 * Check if a driver config is for MongoDB.
 */
export function isMongoDriverConfig(obj: unknown): obj is { type: "mongodb"; connection: Db; client: MongoClient } {
    return typeof obj === "object" &&
        obj !== null &&
        "type" in obj &&
        (obj as Record<string, unknown>).type === "mongodb" &&
        "connection" in obj &&
        "client" in obj;
}
