import type { Property, Entity } from "@rebasepro/types";
import { CollectionSize, SelectedCellProps } from "@rebasepro/cms-types";

export type DataCollectionTableController<M extends Record<string, unknown>> = {

    /**
     * This cell is displayed as selected
     */
    selectedCell?: SelectedCellProps;
    /**
     * Store used to sync selection state across cells efficiently.
     */
    selectionStore?: { getEntity: () => SelectedCellProps | undefined; subscribe: (cb: () => void) => () => void };
    /**
     * Select a table cell
     * @param cell
     */
    select: (cell?: SelectedCellProps<M>) => void;
    /**
     * The cell that is displayed as a popup view.
     * @param cell
     */
    setPopupCell?: (cell?: SelectedCellProps<M>) => void;
    /**
     * Callback used when the value of a cell has changed.
     * @param params
     */
    onValueChange?: (params: OnCellValueChangeParams<unknown, Entity<M>>) => void;
    /**
     * Size of the elements in the collection
     */
    size: CollectionSize;
}

/**
 * Props passed in a callback when the content of a cell in a table has been edited
 * @group Collection components
 */
export interface OnCellValueChangeParams<T = unknown, D = unknown> {
    value: T,
    propertyKey: string,
    data?: D,
    onValueUpdated: () => void
    setError: (e: Error | undefined) => void
}

/**
 * @group Collection components
 */
export type UniqueFieldValidator = (props: {
    name: string,
    value: unknown,
    property: Property,
    entityId?: string | number
}) => Promise<boolean>;

/**
 * Callback when a cell has changed in a table
 * @group Collection components
 */
export type OnCellValueChange<T, M extends Record<string, unknown>> = (params: OnCellValueChangeParams<T, Entity<M>>) => Promise<void> | void;

/**
 * @group Collection components
 */
export type OnColumnResizeParams = { width: number, key: string };
