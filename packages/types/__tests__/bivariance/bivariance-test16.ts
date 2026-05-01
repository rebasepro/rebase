export interface SelectionController<M extends Record<string, unknown>> {
    readonly selectedEntities: readonly M[];
    setSelectedEntities(entities: M[]): void;
    setSelectedEntities(action: (prev: M[]) => M[]): void;
}

export interface PostgresCollection<M extends Record<string, unknown>> {
    readonly selectionController?: SelectionController<M>;
}

export type EntityCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: EntityCollection<{ id: string, name: string }>;
declare let genericColl: EntityCollection;

genericColl = specificColl; // Should succeed!
