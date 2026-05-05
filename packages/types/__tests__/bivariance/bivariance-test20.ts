import * as React from "react";

export type Entity<M> = M & { id: string };

export interface AdditionalFieldDelegate<M extends Record<string, unknown> = Record<string, unknown>> {
    readonly dependencies?: Extract<keyof M, string> | (string & {})[];
}

export interface PostgresCollection<M extends Record<string, unknown>> {
    readonly additionalFields?: readonly AdditionalFieldDelegate<M>[]; // Array also must be readonly
}

declare let specificColl: PostgresCollection<{ id: string, name: string }>;
declare let genericRecordColl: PostgresCollection<Record<string, unknown>>;

genericRecordColl = specificColl; // Should succeed
