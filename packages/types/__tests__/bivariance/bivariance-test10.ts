export type EntityCallbacks<M extends Record<string, unknown>> = {
    beforeSave?({ entityId, values }: { entityId: string, values: M }): M;
};

export interface PostgresCollection<M extends Record<string, unknown>> {
    callbacks?: EntityCallbacks<M>;
}

export type EntityCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: EntityCollection<{ id: string, name: string }>;
declare let genericColl: EntityCollection;

genericColl = specificColl; // Should succeed?
