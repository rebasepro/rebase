import React from "react";
import { VirtualTableDateField, cls } from "@rebasepro/ui";

function CellShell({
  selected,
  width = 200,
  height = 44,
  children
}: {
  selected?: boolean;
  width?: number;
  height?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-md" style={{ width, height }}>
      <div
        className={cls(
          "flex relative h-full rounded-md border-4 p-1",
          selected ? "border-primary bg-surface-accent-50 dark:bg-surface-accent-900" : "border-transparent"
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DueDateCell() {
  return (
    <CellShell selected width={180} height={64}>
      <VirtualTableDateField
        mode="date"
        internalValue={new Date(2026, 7, 15)}
        focused
        disabled={false}
        updateValue={() => {}}
      />
    </CellShell>
  );
}

export function CreatedAtDateTimeCell() {
  return (
    <CellShell width={220} height={64}>
      <VirtualTableDateField
        mode="date_time"
        internalValue={new Date(2026, 6, 12, 14, 32)}
        focused={false}
        disabled={false}
        updateValue={() => {}}
      />
    </CellShell>
  );
}
