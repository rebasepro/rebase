export type AfterReadProps<M extends Record<string, unknown>> = {
    collection: SnapshotCollection<Record<string, unknown>>; // NO M
};

export type CollectionCallbacks<M extends Record<string, unknown>> = {
    afterRead?(props: AfterReadProps<M>): M;
};

// Now PostgresCollection STILL uses strictly typed properties!
export interface PostgresCollection<M extends Record<string, unknown>> {
    titleProperty?: Extract<keyof M, string>; // NO STRING HACK
    callbacks?: CollectionCallbacks<M>;
}

export type SnapshotCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: SnapshotCollection<{ id: string, name: string }>;
declare let genericColl: SnapshotCollection;

genericColl = specificColl; // Should succeed!
