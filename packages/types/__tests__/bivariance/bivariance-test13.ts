export type AfterReadProps<M extends Record<string, unknown>> = {
    collection: CollectionConfig<Record<string, unknown>>; // Broke circularity!
    snapshot: M; // Still uses M
};

export interface CollectionCallbacks<M extends Record<string, unknown>> {
    afterRead?(props: AfterReadProps<M>): M;
    beforeSave?(props: { values: M }): M; // Contravariant use of M
}

// Notice NO readonly here! Let's see if readonly is required if circularity is broken!
export interface PostgresCollectionConfig<M extends Record<string, unknown>> {
    callbacks?: CollectionCallbacks<M>;
}

export type CollectionConfig<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollectionConfig<M>;

declare let specificColl: CollectionConfig<{ id: string, name: string }>;
declare let genericColl: CollectionConfig;

genericColl = specificColl; // Should succeed!
