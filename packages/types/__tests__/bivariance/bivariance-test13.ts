export type AfterReadProps<M extends Record<string, unknown>> = {
    collection: SnapshotCollection<Record<string, unknown>>; // Broke circularity!
    snapshot: M; // Still uses M
};

export interface CollectionCallbacks<M extends Record<string, unknown>> {
    afterRead?(props: AfterReadProps<M>): M;
    beforeSave?(props: { values: M }): M; // Contravariant use of M
}

// Notice NO readonly here! Let's see if readonly is required if circularity is broken!
export interface PostgresCollection<M extends Record<string, unknown>> {
    callbacks?: CollectionCallbacks<M>;
}

export type SnapshotCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: SnapshotCollection<{ id: string, name: string }>;
declare let genericColl: SnapshotCollection;

genericColl = specificColl; // Should succeed!
