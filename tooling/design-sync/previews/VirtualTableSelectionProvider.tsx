import React, { useEffect, useMemo } from "react";
import {
  VirtualTableSelectionProvider,
  createVirtualTableSelectionStore,
  useVirtualTableSelection,
  useVirtualTableCellSelected,
  cardSelectedMixin,
  cardClickableMixin,
  cls
} from "@rebasepro/ui";
import type { VirtualTableSelectionStore, SelectedCell } from "@rebasepro/ui";

type Row = { id: string; name: string; status: string };

const ROWS: Row[] = [
  { id: "1", name: "Maria Chen", status: "Active" },
  { id: "2", name: "Diego Alvarez", status: "Active" },
  { id: "3", name: "Priya Natarajan", status: "Invited" }
];

function SelectableCell({
  store,
  columnKey,
  id,
  children
}: {
  store: VirtualTableSelectionStore<SelectedCell>;
  columnKey: string;
  id: string;
  children: React.ReactNode;
}) {
  const selected = useVirtualTableCellSelected(store, columnKey, id);
  const { select } = useVirtualTableSelection();
  return (
    <div
      onClick={() => select({ columnKey, id })}
      className={cls(
        "flex items-center px-3 text-sm border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900",
        selected ? cardSelectedMixin : cardClickableMixin
      )}
      style={{ width: 150, height: 42 }}
    >
      {children}
    </div>
  );
}

function SelectionGrid({ initialSelection }: { initialSelection?: SelectedCell }) {
  const store = useMemo(() => createVirtualTableSelectionStore(), []);

  useEffect(() => {
    if (initialSelection) store.select(initialSelection);
  }, [store]);

  return (
    <VirtualTableSelectionProvider store={store}>
      <div className="inline-flex flex-col border border-surface-200 dark:border-surface-700 rounded-md overflow-hidden">
        {ROWS.map(row => (
          <div key={row.id} className="flex divide-x divide-surface-100 dark:divide-surface-700">
            <SelectableCell store={store} columnKey="name" id={row.id}>{row.name}</SelectableCell>
            <SelectableCell store={store} columnKey="status" id={row.id}>{row.status}</SelectableCell>
          </div>
        ))}
      </div>
    </VirtualTableSelectionProvider>
  );
}

export function CellSelected() {
  return <SelectionGrid initialSelection={{ columnKey: "status", id: "2" }}/>;
}

export function NoSelection() {
  return <SelectionGrid/>;
}
