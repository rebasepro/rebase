/**
 * Real collaborators for a `PostgresBackendDriver` under unit test: a signed-in
 * user, a registry that serves one collection, and a realtime service whose
 * outward calls are spied instead of sent.
 */
import type { PgTable } from "drizzle-orm/pg-core";
import type { CollectionConfig, User } from "@rebasepro/types";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../../src/services/realtimeService";
import type { PgSqlDatabase } from "../../src/interfaces";

/** A complete signed-in `User`. */
export function testUser(uid = "u1", roles: string[] = [], extra: Partial<User> = {}): User {
    return {
        uid,
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "test",
        isAnonymous: false,
        roles,
        ...extra
    };
}

/**
 * A real registry that answers every path with `collection`, lists no
 * collections, has no global callbacks, and serves `table` (when given) for
 * any table name.
 */
export function registryServing(collection: CollectionConfig, table?: PgTable): PostgresCollectionRegistry {
    const registry = new PostgresCollectionRegistry();
    jest.spyOn(registry, "getCollectionByPath").mockReturnValue(collection);
    jest.spyOn(registry, "getCollections").mockReturnValue([]);
    jest.spyOn(registry, "getTable").mockReturnValue(table);
    jest.spyOn(registry, "getGlobalCallbacks").mockReturnValue(undefined);
    return registry;
}

/** A real `RealtimeService` whose broadcasts and subscriptions are spies. */
export function quietRealtime(db: PgSqlDatabase, registry: PostgresCollectionRegistry): RealtimeService {
    const realtime = new RealtimeService(db, registry);
    jest.spyOn(realtime, "notifyUpdate").mockResolvedValue(undefined);
    jest.spyOn(realtime, "startDataDriverSubscription").mockImplementation(() => undefined);
    jest.spyOn(realtime, "unsubscribe").mockImplementation(() => undefined);
    return realtime;
}
