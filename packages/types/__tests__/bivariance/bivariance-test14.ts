type SetStateAction<T> = T | ((prevState: T) => T);

export interface SelectionController<M extends Record<string, unknown>> {
    readonly selectedSnapshots: readonly M[];
    setSelectedSnapshots(action: SetStateAction<M[]>): void;
    isSnapshotSelected(snapshot: M): boolean;
    toggleSnapshotSelection(snapshot: M, newSelectedState?: boolean): void;
}

export interface PostgresCollection<M extends Record<string, unknown>> {
    readonly selectionController?: SelectionController<M>;
}

export type SnapshotCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: SnapshotCollection<{ id: string, name: string }>;
declare let genericColl: SnapshotCollection;

genericColl = specificColl; // Should succeed!
