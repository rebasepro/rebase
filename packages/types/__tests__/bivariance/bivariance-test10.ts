export type CollectionCallbacks<M extends Record<string, unknown>> = {
    beforeSave?({ snapshotId, values }: { snapshotId: string, values: M }): M;
};

export interface PostgresCollectionConfig<M extends Record<string, unknown>> {
    callbacks?: CollectionCallbacks<M>;
}

export type CollectionConfig<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollectionConfig<M>;

declare let specificColl: CollectionConfig<{ id: string, name: string }>;
declare let genericColl: CollectionConfig;

genericColl = specificColl; // Should succeed?
