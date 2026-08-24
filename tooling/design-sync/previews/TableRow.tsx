import React from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  Chip
} from "@rebasepro/ui";

const COLLECTIONS = [
  { id: "c1", name: "users", type: "table", rows: "128,442", rls: true },
  { id: "c2", name: "orders", type: "table", rows: "54,910", rls: true },
  { id: "c3", name: "audit_logs", type: "view", rows: "2,004,331", rls: false }
];

export function ClickableRows() {
  return (
    <div className="overflow-x-auto w-full">
      <Table className="w-full">
        <TableHeader>
          <TableCell header>Name</TableCell>
          <TableCell header>Type</TableCell>
          <TableCell header align="right">Rows</TableCell>
          <TableCell header align="center">RLS</TableCell>
        </TableHeader>
        <TableBody>
          {COLLECTIONS.map(col => (
            <TableRow key={col.id} onClick={() => {}}>
              <TableCell className="font-mono text-xs font-medium">{col.name}</TableCell>
              <TableCell className="text-text-secondary dark:text-text-secondary-dark">{col.type}</TableCell>
              <TableCell align="right">{col.rows}</TableCell>
              <TableCell align="center">
                <Chip size="small" colorScheme={col.rls ? "green" : "red"}>
                  {col.rls ? "Enabled" : "Disabled"}
                </Chip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const USERS = [
  { uid: "1", email: "maria.chen@rebase.pro", displayName: "Maria Chen", role: "Admin" },
  { uid: "2", email: "diego.alvarez@rebase.pro", displayName: "Diego Alvarez", role: "Editor" },
  { uid: "3", email: "priya.natarajan@rebase.pro", displayName: "Priya Natarajan", role: "Viewer" }
];

export function StaticRows() {
  return (
    <div className="overflow-x-auto w-full">
      <Table className="w-full">
        <TableHeader>
          <TableCell header>Email</TableCell>
          <TableCell header>Name</TableCell>
          <TableCell header>Role</TableCell>
        </TableHeader>
        <TableBody>
          {USERS.map(user => (
            <TableRow key={user.uid}>
              <TableCell>{user.email}</TableCell>
              <TableCell className="font-medium">{user.displayName}</TableCell>
              <TableCell>
                <Chip size="small" colorScheme={user.role === "Admin" ? "purple" : user.role === "Editor" ? "blue" : "gray"}>
                  {user.role}
                </Chip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
