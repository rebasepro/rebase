import * as React from 'react';

export type Entity<M> = M & { id: string };

export interface AdditionalFieldDelegate<M extends Record<string, unknown> = Record<string, unknown>> {
    Builder?(props: { entity: Entity<M>, context: any }): React.ReactNode;
    value?(props: { entity: Entity<M>, context: any }): string | number | undefined;
    dependencies?: (Extract<keyof M, string> | (string & {}))[];
}

export interface PostgresCollection<M extends Record<string, unknown>> {
    additionalFields?: AdditionalFieldDelegate<M>[];
}

declare let specificColl: PostgresCollection<{ id: string, name: string }>;
declare let genericRecordColl: PostgresCollection<Record<string, unknown>>;

genericRecordColl = specificColl; // Should succeed
