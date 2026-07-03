export interface SelectionController<M extends Record<string, unknown>> {
    readonly selectedSnapshots: readonly M[];
    setSelectedSnapshots(snapshots: M[]): void;
    setSelectedSnapshots(action: (prev: M[]) => M[]): void;
}

export interface PostgresCollection<M extends Record<string, unknown>> {
    readonly selectionController?: SelectionController<M>;
}

export type SnapshotCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: SnapshotCollection<{ id: string, name: string }>;
declare let genericColl: SnapshotCollection;

genericColl = specificColl; // Should succeed!
