import React from "react";
import { VirtualTableSwitch, cls } from "@rebasepro/ui";

function CellShell({
  selected,
  width = 120,
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
          "flex items-center relative h-full rounded-md border-4 p-1",
          selected ? "border-primary bg-surface-accent-50 dark:bg-surface-accent-900" : "border-transparent"
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function EnabledToggleCell() {
  return (
    <CellShell selected>
      <VirtualTableSwitch
        internalValue
        focused
        disabled={false}
        updateValue={() => {}}
      />
    </CellShell>
  );
}

export function DisabledToggleCell() {
  return (
    <CellShell>
      <VirtualTableSwitch
        internalValue={false}
        focused={false}
        disabled
        updateValue={() => {}}
      />
    </CellShell>
  );
}
