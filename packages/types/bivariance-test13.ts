export type EntityAfterReadProps<M extends Record<string, unknown>> = {
    collection: EntityCollection<Record<string, unknown>>; // Broke circularity!
    entity: M; // Still uses M
};

export interface EntityCallbacks<M extends Record<string, unknown>> {
    afterRead?(props: EntityAfterReadProps<M>): M;
    beforeSave?(props: { values: M }): M; // Contravariant use of M
}

// Notice NO readonly here! Let's see if readonly is required if circularity is broken!
export interface PostgresCollection<M extends Record<string, unknown>> {
    callbacks?: EntityCallbacks<M>;
}

export type EntityCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: EntityCollection<{ id: string, name: string }>;
declare let genericColl: EntityCollection;

genericColl = specificColl; // Should succeed!
