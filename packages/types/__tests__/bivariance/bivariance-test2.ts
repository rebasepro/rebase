export type EntityAfterReadProps<M extends Record<string, unknown>> = {
    collection: EntityCollection<M>;
};

export type EntityCallbacks<M extends Record<string, unknown>> = {
    afterRead?: { bivarianceHack(props: EntityAfterReadProps<M>): M }["bivarianceHack"];
};

export interface PostgresCollection<M extends Record<string, unknown>> {
    titleProperty?: Extract<keyof M, string>;
    callbacks?: EntityCallbacks<M>;
}

export type EntityCollection<M extends Record<string, unknown> = Record<string, unknown>> = PostgresCollection<M>;

let specificColl: EntityCollection<{ id: string, name: string }>;
declare let genericColl: EntityCollection;

genericColl = specificColl; // Should succeed!
