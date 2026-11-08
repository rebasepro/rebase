import React, { useCallback, useContext } from "react";
import type { AdditionalFieldDelegate, AdditionalFieldDelegateProps, AdminCollection } from "@rebasepro/cms-types";
import type { Entity } from "@rebasepro/types";
import { ROW_ACTIONS_COLUMN, rowOfEntity } from "@rebasepro/app";

/**
 * What `CollectionPanel`'s `rowActions` draws on a row: its own JSX, handed
 * the row as the server sends it and the record's id.
 */
export type RowActionsRenderer = (row: Record<string, unknown>, id: string) => React.ReactNode;

/**
 * The renderer of the panel drawn here, and the path its rows live at.
 *
 * Through context rather than props: the cards, the board and the table's
 * cells are memoised, and a caller's `rowActions` closes over its own state
 * (a `saving` flag, the row being shipped), so a new one has to reach them
 * without redrawing every row. The path keeps it to the panel's own rows: a
 * record opened in the split beside the list draws its relation tables inside
 * the same tree.
 */
export const RowActionsContext = React.createContext<{ path: string; render: RowActionsRenderer } | null>(null);

/** A row's `rowActions`, or nothing where the panel has none or the row is not its own. */
export function useRowActionsNode(entity: Entity<Record<string, unknown>>, collection: AdminCollection | undefined, path: string | undefined): React.ReactNode {
    const scope = useContext(RowActionsContext);
    if (!scope || scope.path !== (path ?? entity.path)) return null;
    return scope.render(rowOfEntity(entity, collection), String(entity.id));
}

/**
 * A row's `rowActions` where a list row or a card puts them. A click on them
 * is theirs: it does not reach the row, which would open the record.
 */
export function RowActionsSlot({ entity, collection, path, className }: {
    entity: Entity<Record<string, unknown>>;
    collection: AdminCollection | undefined;
    path: string | undefined;
    className?: string;
}) {
    const node = useRowActionsNode(entity, collection, path);
    const stopPropagation = useCallback((event: React.MouseEvent) => event.stopPropagation(), []);
    if (node === null || node === undefined || node === false) return null;
    return <div className={className ?? "flex items-center gap-1 shrink-0"} onClick={stopPropagation}>{node}</div>;
}

function RowActionsCell({ row, id }: AdditionalFieldDelegateProps) {
    const scope = useContext(RowActionsContext);
    const stopPropagation = useCallback((event: React.MouseEvent) => event.stopPropagation(), []);
    if (!scope) return null;
    return <div className="flex items-center gap-1" onClick={stopPropagation}>{scope.render(row, String(id))}</div>;
}

/**
 * The table's column for `rowActions`: the last one, always visible. One
 * object for the life of the module, so the collection it is added to only
 * changes when `rowActions` comes or goes, not each time it is a new function.
 */
export const ROW_ACTIONS_FIELD: AdditionalFieldDelegate = {
    key: ROW_ACTIONS_COLUMN,
    name: "",
    width: 160,
    Builder: (props) => <RowActionsCell {...props}/>
};
