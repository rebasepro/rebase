import React from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  IconButton,
  Tooltip,
  Trash2Icon
} from "@rebasepro/ui";

const COLLECTIONS = [
  { id: "c1", name: "users", rows: "128,442", rls: true },
  { id: "c2", name: "orders", rows: "54,910", rls: true },
  { id: "c3", name: "audit_logs", rows: "2,004,331", rls: false }
];

export function AlignedCells() {
  return (
    <div className="overflow-x-auto w-full">
      <Table className="w-full">
        <TableHeader>
          <TableCell header align="left">Name</TableCell>
          <TableCell header align="center">RLS</TableCell>
          <TableCell header align="right">Rows</TableCell>
        </TableHeader>
        <TableBody>
          {COLLECTIONS.map(col => (
            <TableRow key={col.id}>
              <TableCell align="left" className="font-mono text-xs font-medium">{col.name}</TableCell>
              <TableCell align="center">
                <Chip size="small" colorScheme={col.rls ? "green" : "red"}>
                  {col.rls ? "Enabled" : "Disabled"}
                </Chip>
              </TableCell>
              <TableCell align="right">{col.rows}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const USERS = [
  { uid: "1", email: "maria.chen@rebase.pro", displayName: "Maria Chen", roles: [{ id: "admin", name: "Admin", isAdmin: true }] },
  { uid: "2", email: "diego.alvarez@rebase.pro", displayName: "Diego Alvarez", roles: [{ id: "editor", name: "Editor", isAdmin: false }] }
];

export function RichContentCell() {
  return (
    <div className="overflow-x-auto w-full">
      <Table className="w-full">
        <TableHeader>
          <TableCell header className="w-16"></TableCell>
          <TableCell header>Name</TableCell>
          <TableCell header>Roles</TableCell>
        </TableHeader>
        <TableBody>
          {USERS.map(user => (
            <TableRow key={user.uid}>
              <TableCell style={{ width: "64px" }}>
                <Tooltip asChild title="Delete this user">
                  <IconButton size="small"><Trash2Icon/></IconButton>
                </Tooltip>
              </TableCell>
              <TableCell className="font-medium">{user.displayName}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {user.roles.map(role => (
                    <Chip key={role.id} colorScheme={role.isAdmin ? "purple" : "blue"} size="small">
                      {role.name}
                    </Chip>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
