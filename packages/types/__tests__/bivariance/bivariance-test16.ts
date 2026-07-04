export interface SelectionController<M extends Record<string, unknown>> {
    readonly selectedSnapshots: readonly M[];
    setSelectedSnapshots(snapshots: M[]): void;
    setSelectedSnapshots(action: (prev: M[]) => M[]): void;
}

export interface PostgresCollectionConfig<M extends Record<string, unknown>> {
    readonly selectionController?: SelectionController<M>;
}

export type CollectionConfig<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollectionConfig<M>;

declare let specificColl: CollectionConfig<{ id: string, name: string }>;
declare let genericColl: CollectionConfig;

genericColl = specificColl; // Should succeed!
