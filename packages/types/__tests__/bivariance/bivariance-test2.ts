export type AfterReadProps<M extends Record<string, unknown>> = {
    collection: SnapshotCollection<M>;
};

export type CollectionCallbacks<M extends Record<string, unknown>> = {
    afterRead?: { bivarianceHack(props: AfterReadProps<M>): M }["bivarianceHack"];
};

export interface PostgresCollection<M extends Record<string, unknown>> {
    titleProperty?: Extract<keyof M, string>;
    callbacks?: CollectionCallbacks<M>;
}

export type SnapshotCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

let specificColl: SnapshotCollection<{ id: string, name: string }>;
declare let genericColl: SnapshotCollection;

genericColl = specificColl; // Should succeed!
