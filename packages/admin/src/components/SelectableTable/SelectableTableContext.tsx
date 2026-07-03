import React, { useContext } from "react";
import { SnapshotCollectionTableController } from "@rebasepro/core";

export const SelectableTableContext = React.createContext<SnapshotCollectionTableController<Record<string, unknown>>>(null! as SnapshotCollectionTableController<Record<string, unknown>>);

export const useSelectableTableController = <M extends Record<string, unknown> = Record<string, unknown>>() =>
    useContext(SelectableTableContext) as unknown as SnapshotCollectionTableController<M>;
