import { useMemo, useEffect } from "react";
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

    return useMemo(() => {
        if (!client) throw new Error("RebaseWebSocketClient must be provided in config.wsClient");

        const driver: PostgresDataDriver = {

        key: "postgres",

        name: "PostgreSQL",

        client,

        async fetchCollection<M extends Record<string, any>>(props: FetchCollectionProps<M>): Promise<Record<string, unknown>[]> {
            // Pick only the fields the client needs, ignoring extra fields from the admin layer
            const { path, filter, limit, startAfter, orderBy, searchString, order } = props;
            return client.fetchCollection({ path,
filter,
limit,
startAfter,
orderBy,
searchString,
order });
        },

        async fetchOne<M extends Record<string, any>>(props: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
            const { path, id, databaseId } = props;
            return client.fetchOne({ path,
id,
databaseId });
        },

        async save<M extends Record<string, any>>(props: SaveProps<M>): Promise<Record<string, unknown>> {
            return client.save({
                path: props.path,
                values: props.values,
                id: props.id,
                previousValues: props.previousValues,
                status: props.status
            });
        },

        async delete<M extends Record<string, any>>(props: DeleteProps<M>): Promise<void> {
            const { row } = props;
            return client.delete({ row });
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
            const { path, id, databaseId, onUpdate, onError } = props;
            return client.listenOne(
                { path,
id,
databaseId },
                (row: Record<string, unknown> | null) => {
                    props.onUpdate(row);
                },
                props.onError
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
    }, [client]);

}
