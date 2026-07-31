import React from "react";
import { VirtualTable, Chip } from "@rebasepro/ui";
import type { VirtualTableColumn, CellRendererParams } from "@rebasepro/ui";

type UserRow = { id: string; name: string; role: string; status: string };

const USER_COLUMNS: VirtualTableColumn[] = [
  { key: "name", title: "Name", width: 150 },
  { key: "role", title: "Role", width: 100 },
  { key: "status", title: "Status", width: 110 }
];

const USER_ROWS: UserRow[] = [
  { id: "1", name: "Maria Chen", role: "Admin", status: "active" },
  { id: "2", name: "Diego Alvarez", role: "Editor", status: "active" },
  { id: "3", name: "Priya Natarajan", role: "Viewer", status: "invited" },
  { id: "4", name: "Sam Okafor", role: "Editor", status: "active" },
  { id: "5", name: "Elena Petrova", role: "Viewer", status: "suspended" }
];

function statusColor(status: string) {
  if (status === "active") return "green" as const;
  if (status === "invited") return "blue" as const;
  return "gray" as const;
}

function userCellRenderer({ column, rowData }: CellRendererParams<UserRow>) {
  if (!rowData) return null;
  if (column.key === "name") {
    return <div className="flex items-center h-full px-3 font-medium truncate">{rowData.name}</div>;
  }
  if (column.key === "role") {
    return <div className="flex items-center h-full px-3"><Chip size="small">{rowData.role}</Chip></div>;
  }
  if (column.key === "status") {
    return <div className="flex items-center h-full px-3"><Chip size="small" colorScheme={statusColor(rowData.status)}>{rowData.status}</Chip></div>;
  }
  return null;
}

export function UsersVirtualTable() {
  return (
    <div style={{ width: 380, height: 296, border: "1px solid #e5e7eb", borderRadius: 8 }}>
      <VirtualTable
        data={USER_ROWS}
        columns={USER_COLUMNS}
        cellRenderer={userCellRenderer}
        rowHeight={48}
        headerHeight={40}
      />
    </div>
  );
}

type ApiKeyRow = { id: string; name: string; scope: string; created: string };

const API_KEY_COLUMNS: VirtualTableColumn[] = [
  { key: "name", title: "Name", width: 170 },
  { key: "scope", title: "Scope", width: 110 },
  { key: "created", title: "Created", width: 110, align: "right" }
];

const API_KEY_ROWS: ApiKeyRow[] = [
  { id: "k1", name: "CI/CD deploy key", scope: "deploy", created: "Jul 12, 2026" },
  { id: "k2", name: "Analytics read-only", scope: "read", created: "Jun 30, 2026" },
  { id: "k3", name: "Mobile app (iOS)", scope: "write", created: "Jan 4, 2026" }
];

function apiKeyCellRenderer({ column, rowData }: CellRendererParams<ApiKeyRow>) {
  if (!rowData) return null;
  if (column.key === "name") {
    return <div className="flex items-center h-full px-3 font-medium truncate">{rowData.name}</div>;
  }
  if (column.key === "scope") {
    return <div className="flex items-center h-full px-3"><Chip size="small" colorScheme={rowData.scope === "write" ? "green" : "gray"}>{rowData.scope}</Chip></div>;
  }
  if (column.key === "created") {
    return <div className="flex items-center justify-end h-full px-3 text-text-secondary dark:text-text-secondary-dark">{rowData.created}</div>;
  }
  return null;
}

export function ApiKeysVirtualTable() {
  return (
    <div style={{ width: 390, height: 202, border: "1px solid #e5e7eb", borderRadius: 8 }}>
      <VirtualTable
        data={API_KEY_ROWS}
        columns={API_KEY_COLUMNS}
        cellRenderer={apiKeyCellRenderer}
        rowHeight={54}
        headerHeight={40}
      />
    </div>
  );
}
