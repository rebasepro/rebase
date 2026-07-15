import React, { useContext } from "react";
import { DataCollectionTableController } from "@rebasepro/app";

export const SelectableTableContext = React.createContext<DataCollectionTableController<Record<string, unknown>>>(null! as DataCollectionTableController<Record<string, unknown>>);

export const useSelectableTableController = <M extends Record<string, unknown> = Record<string, unknown>>() =>
    useContext(SelectableTableContext) as unknown as DataCollectionTableController<M>;
