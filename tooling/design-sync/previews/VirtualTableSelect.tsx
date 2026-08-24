import React from "react";
import { VirtualTableSelect, cls } from "@rebasepro/ui";

function CellShell({
  selected,
  width = 220,
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

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" }
];

export function SingleSelectCell() {
  return (
    <CellShell selected width={200}>
      <VirtualTableSelect
        options={STATUS_OPTIONS}
        value="active"
        multiple={false}
        focused
        disabled={false}
        updateValue={() => {}}
      />
    </CellShell>
  );
}

const SCOPE_OPTIONS = [
  { value: "read", label: "read" },
  { value: "write", label: "write" },
  { value: "admin", label: "admin" }
];

export function MultiSelectCell() {
  return (
    <CellShell width={260}>
      <VirtualTableSelect
        options={SCOPE_OPTIONS}
        value={["read", "write"]}
        multiple
        focused={false}
        disabled={false}
        updateValue={() => {}}
      />
    </CellShell>
  );
}
