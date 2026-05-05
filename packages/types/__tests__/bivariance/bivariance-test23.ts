import * as React from "react";

export interface ActionProps<M> {
    collection: M;
}

export interface Collection<M> {
    Actions?: React.ComponentType<ActionProps<NoInfer<M>>>[];
}

declare let specificColl: Collection<{ id: string }>;
declare let genericRecordColl: Collection<unknown>;

genericRecordColl = specificColl; // Should succeed
