export type EntityAfterReadProps<M extends Record<string, unknown>> = {
    collection: EntityCollection<M>;
};

export type EntityCallbacks<M extends Record<string, unknown>> = {
    afterRead?(props: EntityAfterReadProps<M>): M;
};

export interface PostgresCollection<M extends Record<string, unknown>> {
    titleProperty?: string; // <--- Changed from Extract<keyof M, string>;
    callbacks?: EntityCallbacks<M>;
}

export type EntityCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: EntityCollection<{ id: string, name: string }>;
declare let genericColl: EntityCollection;

genericColl = specificColl; // Should succeed!
