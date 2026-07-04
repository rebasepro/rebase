export type AfterReadProps<M extends Record<string, unknown>> = {
    collection: CollectionConfig<M>;
};

export type CollectionCallbacks<M extends Record<string, unknown>> = {
    // using method syntax (which allows bivariance under --strictFunctionTypes, BUT doesn't work for deep properties?)
    afterRead?(props: AfterReadProps<M>): M;
};

export interface PostgresCollectionConfig<M extends Record<string, unknown>> {
    titleProperty?: Extract<keyof M, string>;
    callbacks?: CollectionCallbacks<M>;
}

export type CollectionConfig<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollectionConfig<M>;

let specificColl: CollectionConfig<{ id: string, name: string }>;
declare let genericColl: CollectionConfig;

genericColl = specificColl; // Fails!
