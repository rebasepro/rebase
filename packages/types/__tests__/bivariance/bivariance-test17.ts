import * as React from "react";

export interface AdditionalFieldDelegate<M> {
    // This makes it bivariant!
    Builder?(props: { snapshot: M }): React.ReactElement | null;
}

export interface PostgresCollectionConfig<M> {
    additionalFields?: AdditionalFieldDelegate<M>[];
}

declare let specificColl: PostgresCollectionConfig<{ id: string, name: string }>;
declare let genericColl: PostgresCollectionConfig<any>; // wait, <any> is always assignable.
declare let genericRecordColl: PostgresCollectionConfig<Record<string, unknown>>;

genericRecordColl = specificColl; // Should succeed if Builder is bivariant!
