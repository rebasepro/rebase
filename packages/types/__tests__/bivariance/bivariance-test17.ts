import * as React from "react";

export interface AdditionalFieldDelegate<M> {
    // This makes it bivariant!
    Builder?(props: { snapshot: M }): React.ReactElement | null;
}

export interface PostgresCollection<M> {
    additionalFields?: AdditionalFieldDelegate<M>[];
}

declare let specificColl: PostgresCollection<{ id: string, name: string }>;
declare let genericColl: PostgresCollection<any>; // wait, <any> is always assignable.
declare let genericRecordColl: PostgresCollection<Record<string, unknown>>;

genericRecordColl = specificColl; // Should succeed if Builder is bivariant!
