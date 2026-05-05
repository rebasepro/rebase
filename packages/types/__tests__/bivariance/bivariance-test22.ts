import * as React from "react";

export interface ActionProps<M> {
    collection: M;
}
// Testing if call signature in interface is bivariant
export interface CollectionAction<M> {
    (props: ActionProps<M>): React.ReactNode;
}

export interface Collection<M> {
    Actions?: CollectionAction<M>[]; // Array of functions
}

declare let specificColl: Collection<{ id: string }>;
declare let genericRecordColl: Collection<unknown>;

genericRecordColl = specificColl; // Should succeed
