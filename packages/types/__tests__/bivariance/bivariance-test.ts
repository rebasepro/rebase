export type AfterReadProps<M extends Record<string, unknown>> = {
    collection: SnapshotCollection<M>;
};

export type CollectionCallbacks<M extends Record<string, unknown>> = {
    // using method syntax (which allows bivariance under --strictFunctionTypes, BUT doesn't work for deep properties?)
    afterRead?(props: AfterReadProps<M>): M;
};

export interface PostgresCollection<M extends Record<string, unknown>> {
    titleProperty?: Extract<keyof M, string>;
    callbacks?: CollectionCallbacks<M>;
}

export type SnapshotCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

let specificColl: SnapshotCollection<{ id: string, name: string }>;
declare let genericColl: SnapshotCollection;

genericColl = specificColl; // Fails!
