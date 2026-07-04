export type AfterReadProps<M extends Record<string, unknown>> = {
    collection: CollectionConfig<Record<string, unknown>>;
};

export type CollectionCallbacks<M extends Record<string, unknown>> = {
    afterRead?(props: AfterReadProps<M>): M;
};

export interface PostgresCollectionConfig<M extends Record<string, unknown>> {
    readonly callbacks?: CollectionCallbacks<M>;
}

export type CollectionConfig<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollectionConfig<M>;

declare let specificColl: CollectionConfig<{ id: string, name: string }>;
declare let genericColl: CollectionConfig;

genericColl = specificColl; // Should succeed
