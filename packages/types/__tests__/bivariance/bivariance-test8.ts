export type EntityAfterReadProps<M extends Record<string, unknown>> = {
    collection: EntityCollection<Record<string, unknown>>; // NO M
};

export type EntityCallbacks<M extends Record<string, unknown>> = {
    afterRead?(props: EntityAfterReadProps<M>): M;
};

// Now PostgresCollection STILL uses strictly typed properties!
export interface PostgresCollection<M extends Record<string, unknown>> {
    titleProperty?: Extract<keyof M, string>; // NO STRING HACK
    callbacks?: EntityCallbacks<M>;
}

export type EntityCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

declare let specificColl: EntityCollection<{ id: string, name: string }>;
declare let genericColl: EntityCollection;

genericColl = specificColl; // Should succeed!
