import React, { useContext } from "react";
import { EntityCollectionTableController } from "@rebasepro/core";

export const SelectableTableContext = React.createContext<EntityCollectionTableController<Record<string, unknown>>>(null! as EntityCollectionTableController<Record<string, unknown>>);

export const useSelectableTableController = <M extends Record<string, unknown> = Record<string, unknown>>() =>
    useContext(SelectableTableContext) as unknown as EntityCollectionTableController<M>;
