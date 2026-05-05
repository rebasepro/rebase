import * as React from "react";

export interface ActionProps<M> {
    collection: M;
}

export interface Collection {
    Actions?: React.ComponentType<ActionProps<unknown>>[];
}

declare let specificAction: React.ComponentType<ActionProps<{ id: string }>>;

const coll: Collection = {
    Actions: [specificAction]
};
