type SetStateAction<T> = T | ((prevState: T) => T);

export interface SelectionController<M extends Record<string, unknown>> {
    readonly selectedEntities: readonly M[];
    setSelectedEntities(action: SetStateAction<M[]>): void;
    isEntitySelected(entity: M): boolean;
    toggleEntitySelection(entity: M, newSelectedState?: boolean): void;
}

export interface PostgresCollection<M extends Record<string, unknown>> {
    readonly selectionController?: SelectionController<M>;
}

export type EntityCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: EntityCollection<{ id: string, name: string }>;
declare let genericColl: EntityCollection;

genericColl = specificColl; // Should succeed!
