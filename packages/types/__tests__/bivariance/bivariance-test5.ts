export type AfterReadProps<M extends Record<string, unknown>> = {
    collection: SnapshotCollection<Record<string, unknown>>; // <--- Notice Record<string, unknown> instead of M
};

export type CollectionCallbacks<M extends Record<string, unknown>> = {
    afterRead?(props: AfterReadProps<M>): M;
};

export interface PostgresCollection<M extends Record<string, unknown>> {
    callbacks?: CollectionCallbacks<M>;
}

export type SnapshotCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: SnapshotCollection<{ id: string, name: string }>;
declare let genericColl: SnapshotCollection;

genericColl = specificColl; // Should succeed!
