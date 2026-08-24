import React from "react";
import { VirtualTableNumberInput, cls } from "@rebasepro/ui";

function CellShell({
  selected,
  width = 160,
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

export function RightAlignedCountCell() {
  return (
    <CellShell selected width={160}>
      <VirtualTableNumberInput
        value={128442}
        align="right"
        focused
        disabled={false}
        updateValue={() => {}}
      />
    </CellShell>
  );
}

export function LeftAlignedPriceCell() {
  return (
    <CellShell width={140}>
      <VirtualTableNumberInput
        value={49}
        align="left"
        focused={false}
        disabled={false}
        updateValue={() => {}}
      />
    </CellShell>
  );
}
