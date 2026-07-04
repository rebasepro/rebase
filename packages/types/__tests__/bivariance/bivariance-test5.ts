export type AfterReadProps<M extends Record<string, unknown>> = {
    collection: CollectionConfig<Record<string, unknown>>; // <--- Notice Record<string, unknown> instead of M
};

export type CollectionCallbacks<M extends Record<string, unknown>> = {
    afterRead?(props: AfterReadProps<M>): M;
};

export interface PostgresCollectionConfig<M extends Record<string, unknown>> {
    callbacks?: CollectionCallbacks<M>;
}

export type CollectionConfig<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollectionConfig<M>;

declare let specificColl: CollectionConfig<{ id: string, name: string }>;
declare let genericColl: CollectionConfig;

genericColl = specificColl; // Should succeed!
