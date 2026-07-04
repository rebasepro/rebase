import * as React from "react";

export interface Snapshot<M> { id: string; values: M; }

export interface AdditionalFieldDelegate<M extends Record<string, unknown> = Record<string, unknown>> {
    readonly dependencies?: Extract<keyof M, string> | (string & {})[];
}

export interface PostgresCollectionConfig<M extends Record<string, unknown>> {
    readonly additionalFields?: readonly AdditionalFieldDelegate<M>[]; // Array also must be readonly
}

declare let specificColl: PostgresCollectionConfig<{ id: string, name: string }>;
declare let genericRecordColl: PostgresCollectionConfig<Record<string, unknown>>;

genericRecordColl = specificColl; // Should succeed
