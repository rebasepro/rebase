import * as React from "react";

export interface Snapshot<M> { id: string; values: M; }

export interface AdditionalFieldDelegate<M extends Record<string, unknown> = Record<string, unknown>> {
    Builder?(props: { snapshot: Snapshot<M>, context: any }): React.ReactNode;
    value?(props: { snapshot: Snapshot<M>, context: any }): string | number | undefined;
    dependencies?: NoInfer<Extract<keyof M, string>> | NoInfer<Extract<keyof M, string>>[] | (string & {}) | (string & {})[];
}

export interface PostgresCollectionConfig<M extends Record<string, unknown>> {
    additionalFields?: AdditionalFieldDelegate<M>[];
}

declare let specificColl: PostgresCollectionConfig<{ id: string, name: string }>;
declare let genericRecordColl: PostgresCollectionConfig<Record<string, unknown>>;

genericRecordColl = specificColl; // Should succeed
