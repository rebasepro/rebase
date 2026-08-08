import { useMemo } from "react";
import {
    DataDriver,
    DeleteProps,
    CollectionConfig,
    FetchCollectionProps,
    FetchOneProps,
    ListenCollectionProps,
    ListenOneProps,
    SaveProps,
    BranchInfo
} from "@rebasepro/types";
import { RebaseWebSocketClient } from "@rebasepro/client";

export interface PostgresDataDriverConfig {
    wsClient?: RebaseWebSocketClient;

    /**
     * How the socket obtains an access token.
     *
     * `RebaseWebSocketClient` authenticates only when it has one, so a socket
     * built by hand and given no getter connects as `anon` and every read
     * returns whatever the anonymous policies allow: a driver that *works*,
     * silently, on the wrong identity. A socket obtained from
     * `createRebaseClient()` (`client.ws`) already carries the session's
     * getter and needs nothing here.
     */
    getAuthToken?: () => Promise<string | null>;
}

export interface PostgresDataDriver extends DataDriver {
    client?: RebaseWebSocketClient;
    /**
     * Human-readable name for this driver. `DataDriver` only carries the
     * machine `key`; the hook has always set this too, but the returned object
     * used to be cast to `PostgresDataDriver`, so the extra property was
     * invisible to every consumer — and to the test asserting on it.
     */
    name?: string;
}


export function usePostgresClientDriver(config: PostgresDataDriverConfig): PostgresDataDriver {
    const client = config.wsClient;
    const getAuthToken = config.getAuthToken;

    return useMemo(() => {
        if (!client) throw new Error("RebaseWebSocketClient must be provided in config.wsClient");

        // Idempotent assignment, and it has to happen before the first request
        // rather than in an effect: an unauthenticated socket does not fail, it
        // answers as `anon`.
        if (getAuthToken) client.setAuthTokenGetter(getAuthToken);

        const driver: PostgresDataDriver = {

        key: "postgres",

        name: "PostgreSQL",

        client,

        async fetchCollection<M extends Record<string, any>>(props: FetchCollectionProps<M>): Promise<Record<string, unknown>[]> {
            // Forwarded whole, like `count` below. The hand-written list named
            // seven of the twelve fields and dropped `offset` and `logical`
            // (plus `searchExplain`, `vectorSearch` and `collection`), so a
            // page-two read asked the server for page one while the `count`
            // beside it described the query that had been asked for — a
            // `hasMore` that never went false and an `iterate()` that yielded
            // page one over and over, terminating cleanly.
            return client.fetchCollection(props);
        },

        async fetchOne<M extends Record<string, any>>(props: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
            return client.fetchOne(props);
        },

        async save<M extends Record<string, any>>(props: SaveProps<M>): Promise<Record<string, unknown>> {
            // Whole, so `upsert` survives the hop: hand-listing it away turns a
            // re-runnable import into a duplicate-key error.
            return client.save(props);
        },

        async delete<M extends Record<string, any>>(props: DeleteProps<M>): Promise<void> {
            return client.delete(props);
        },

        async checkUniqueField(path: string, name: string, value: unknown, id?: string, collection?: CollectionConfig): Promise<boolean> {
            return client.checkUniqueField(path, name, value, id, collection);
        },

        async count<M extends Record<string, any>>(props: FetchCollectionProps<M>): Promise<number> {
            // Forwarded whole. The hand-written list dropped `logical`, so a
            // count beside an `or(...)` listing described a different query
            // than the rows it was reported with.
            return client.count(props);
        },

        listenCollection<M extends Record<string, any>>(props: ListenCollectionProps<M>): () => void {
            // Everything except the callbacks is the query. Re-listing the
            // fields by hand is what dropped `offset` and `logical` on this
            // hop — a page-two subscription that asked the server for page one,
            // and an `or(...)` subscription that asked for everything.
            const { onUpdate, onError, ...query } = props;
            return client.listenCollection(
                query,
                (rows: Record<string, unknown>[]) => onUpdate(rows),
                onError
            );
        },

        listenOne<M extends Record<string, any>>(props: ListenOneProps<M>): () => void {
            // Same shape as `listenCollection`: everything that is not a
            // callback is the query, and the query is forwarded whole.
            const { onUpdate, onError, ...query } = props;
            return client.listenOne(
                query,
                (row: Record<string, unknown> | null) => onUpdate(row),
                onError
            );
        },

        isFilterCombinationValid(): boolean {
            return true; // PostgreSQL supports complex filter combinations
        },

        admin: {
            executeSql(sql: string, options?: { database?: string; role?: string }): Promise<Record<string, unknown>[]> {
                return client.executeSql(sql, options);
            },
            fetchAvailableDatabases(): Promise<string[]> {
                return client.fetchAvailableDatabases();
            },
            fetchAvailableRoles(): Promise<string[]> {
                return client.fetchAvailableRoles();
            },
            fetchApplicationRoles(): Promise<string[]> {
                return client.fetchApplicationRoles();
            },
            fetchCurrentDatabase(): Promise<string | undefined> {
                return client.fetchCurrentDatabase();
            },
            fetchUnmappedTables(mappedPaths?: string[]): Promise<string[]> {
                return client.fetchUnmappedTables(mappedPaths);
            },
            fetchTableMetadata(tableName: string): Promise<unknown> {
                return client.fetchTableMetadata(tableName);
            },
            createBranch(name: string, options?: { source?: string }): Promise<BranchInfo> {
                return client.createBranch(name, options);
            },
            deleteBranch(name: string): Promise<void> {
                return client.deleteBranch(name);
            },
            listBranches(): Promise<BranchInfo[]> {
                return client.listBranches();
            }
        }
    };
        return driver;
    }, [client, getAuthToken]);

}
