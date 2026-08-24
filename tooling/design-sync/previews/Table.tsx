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
  Button,
  Typography,
  Trash2Icon,
  PlusIcon
} from "@rebasepro/ui";

const USERS = [
  { uid: "1", email: "maria.chen@rebase.pro", displayName: "Maria Chen", roles: [{ id: "admin", name: "Admin", isAdmin: true }] },
  { uid: "2", email: "diego.alvarez@rebase.pro", displayName: "Diego Alvarez", roles: [{ id: "editor", name: "Editor", isAdmin: false }] },
  { uid: "3", email: "priya.natarajan@rebase.pro", displayName: "Priya Natarajan", roles: [] },
  { uid: "4", email: "sam.okafor@rebase.pro", displayName: "Sam Okafor", roles: [{ id: "editor", name: "Editor", isAdmin: false }] }
];

export function UsersTable() {
  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex items-center">
        <Typography gutterBottom variant="h4" className="grow" component="h4">Users</Typography>
        <Button startIcon={<PlusIcon/>}>Add user</Button>
      </div>
      <div className="overflow-x-auto">
        <Table className="w-full">
          <TableHeader>
            <TableCell header className="w-16"></TableCell>
            <TableCell header>Email</TableCell>
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
                <TableCell>{user.email}</TableCell>
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
    </div>
  );
}

const API_KEYS = [
  { id: "k1", name: "CI/CD deploy key", prefix: "pk_live_4f8a…c9e2", scopes: ["deploy"], created: "Jul 12, 2026" },
  { id: "k2", name: "Analytics read-only", prefix: "pk_live_9b1e…77a0", scopes: ["read"], created: "Jun 30, 2026" },
  { id: "k3", name: "Mobile app (iOS)", prefix: "pk_live_2d60…f13c", scopes: ["read", "write"], created: "Jan 4, 2026" }
];

export function ApiKeysTable() {
  return (
    <div className="overflow-x-auto w-full">
      <Table className="w-full">
        <TableHeader>
          <TableCell header>Name</TableCell>
          <TableCell header>Key prefix</TableCell>
          <TableCell header>Scopes</TableCell>
          <TableCell header align="right">Created</TableCell>
        </TableHeader>
        <TableBody>
          {API_KEYS.map(key => (
            <TableRow key={key.id}>
              <TableCell className="font-medium">{key.name}</TableCell>
              <TableCell className="font-mono text-xs text-text-secondary dark:text-text-secondary-dark">{key.prefix}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-2">
                  {key.scopes.map(scope => (
                    <Chip key={scope} size="small" colorScheme={scope === "write" ? "green" : "gray"}>
                      {scope}
                    </Chip>
                  ))}
                </div>
              </TableCell>
              <TableCell align="right" className="text-text-secondary dark:text-text-secondary-dark">{key.created}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
