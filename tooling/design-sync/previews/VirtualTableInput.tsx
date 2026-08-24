import React from "react";
import { VirtualTableInput, cls } from "@rebasepro/ui";

function CellShell({
  selected,
  width = 240,
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

export function FocusedTextCell() {
  return (
    <CellShell selected width={260}>
      <VirtualTableInput
        value="Add authentication middleware to /api routes"
        focused
        disabled={false}
        updateValue={() => {}}
      />
    </CellShell>
  );
}

export function MultilineDescriptionCell() {
  return (
    <CellShell width={280} height={80}>
      <VirtualTableInput
        value={"Handles inbound webhook events from Stripe and reconciles subscription status."}
        multiline
        focused={false}
        disabled={false}
        updateValue={() => {}}
      />
    </CellShell>
  );
}

export function DisabledCell() {
  return (
    <CellShell width={220}>
      <VirtualTableInput
        value="service_role"
        focused={false}
        disabled
        updateValue={() => {}}
      />
    </CellShell>
  );
}
