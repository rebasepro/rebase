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
  Typography,
  Trash2Icon,
  KeyRoundIcon
} from "@rebasepro/ui";

const USERS = [
  { uid: "1", email: "maria.chen@rebase.pro", displayName: "Maria Chen", roles: [{ id: "admin", name: "Admin", isAdmin: true }] },
  { uid: "2", email: "diego.alvarez@rebase.pro", displayName: "Diego Alvarez", roles: [{ id: "editor", name: "Editor", isAdmin: false }] },
  { uid: "3", email: "priya.natarajan@rebase.pro", displayName: "Priya Natarajan", roles: [] },
  { uid: "4", email: "sam.okafor@rebase.pro", displayName: "Sam Okafor", roles: [{ id: "editor", name: "Editor", isAdmin: false }] }
];

export function PopulatedBody() {
  return (
    <div className="overflow-x-auto w-full">
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
  );
}

export function EmptyStateBody() {
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
          <TableRow>
            <TableCell colspan={4}>
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <KeyRoundIcon className="text-text-secondary dark:text-text-secondary-dark" size={20}/>
                <Typography variant="body2" color="secondary">No API keys yet</Typography>
                <Typography variant="caption" color="secondary">Create one to authenticate your first client.</Typography>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
