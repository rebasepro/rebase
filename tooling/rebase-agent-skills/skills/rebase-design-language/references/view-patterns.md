# View Patterns — copy-paste skeletons

`SKILL.md` defines the design *rules* (tokens, typography, spacing, anti-patterns).
This file gives the *compositions*: whole views, ready to copy and fill in.

Every pattern here is derived from the live UI reference that ships with Rebase
(`UIReferenceView`, route `/debug/ui`). When a pattern here and the reference
disagree, **the reference wins** — see "Ground truth" in `SKILL.md`.

Pick the skeleton that matches what you were asked to build, copy it whole, then
replace the data. Do not start from a blank file.

| You were asked for | Use |
|---|---|
| A home page / dashboard | [A. Page shell](#a-page-shell) + [C. Metric row](#c-metric-row) |
| A list of records | [D. List view](#d-list-view-toolbar--table) |
| A create/edit form | [F. Form panel](#f-form-panel) |
| A settings or multi-section page | [A. Page shell](#a-page-shell) + [B. Section header](#b-section-header) |
| An editor / split pane | [G. Boxy tabs & sidebar](#g-boxy-tabs--editor-sidebar) |
| Anything with a "nothing here yet" state | [E. Empty state](#e-empty-state) |

---

## A. Page shell

Every custom top-level view starts here. The outer `div` owns the scroll and the
page background; `Container` owns the max width.

```tsx
import React from "react";
import { Container, Typography, Button, PlusIcon } from "@rebasepro/ui";

export function ProjectsPage() {
    return (
        <div className="py-2 overflow-auto h-full w-full bg-surface-50 dark:bg-surface-800">
            <Container maxWidth="6xl">

                {/* Page header — title grows, actions sit right */}
                <div className="flex items-center mt-12">
                    <Typography gutterBottom variant="h4" component="h4" className="grow">
                        Projects
                    </Typography>
                    <Button startIcon={<PlusIcon/>}>Add project</Button>
                </div>

                {/* Sections go here, separated by my-10 */}

            </Container>
        </div>
    );
}
```

Rules:
- `h4` is the page title. Never `h1`/`h2` — they are display sizes, too loud for the shell.
- The action button lives on the title row, not in a separate toolbar strip.
- Page background is `bg-surface-50 dark:bg-surface-800` — **not** `dark:bg-surface-950`.

## B. Section header

Sections inside a page are labelled with a small uppercase caption, not a heading.

```tsx
import React from "react";
import { Typography } from "@rebasepro/ui";

export function PipelineSection({ children }: { children: React.ReactNode }) {
    return (
        <div className="my-10">
            <Typography
                variant="caption"
                component="h2"
                color="secondary"
                className="px-4 py-1 rounded font-medium text-[10px] uppercase tracking-[0.08em] text-surface-400 dark:text-surface-500"
            >
                Pipeline stages
            </Typography>
            {children}
        </div>
    );
}
```

For a title *inside* a `Card` or `Paper`, use `subtitle1` instead:

```tsx
import React from "react";
import { Card, Typography } from "@rebasepro/ui";

export function TasksCard() {
    return (
        <Card className="p-4">
            <Typography variant="subtitle1" className="mb-2">Tasks</Typography>
            {/* content */}
        </Card>
    );
}
```

## C. Metric row

Four KPI cards across the top of a dashboard. Plain muted icon, no pill, no
gradient. `tabular-nums` keeps the figures from jittering as they update.

```tsx
import React from "react";
import { Card, Skeleton, Typography, UsersIcon } from "@rebasepro/ui";

interface Metric { label: string; value: string | number }

export function MetricRow({ metrics, loading }: { metrics: Metric[]; loading: boolean }) {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {metrics.map(metric => (
                <Card key={metric.label} className="p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500">
                            <UsersIcon className="h-4 w-4"/>
                        </div>
                        <div className="flex-1 min-w-0">
                            <Typography variant="caption" color="secondary"
                                        className="uppercase tracking-[0.05em] text-[10px]">
                                {metric.label}
                            </Typography>
                            {loading
                                ? <Skeleton className="h-7 w-12 mt-0.5"/>
                                : <Typography variant="h5" className="tabular-nums mt-0.5">{metric.value}</Typography>}
                        </div>
                    </div>
                </Card>
            ))}
        </div>
    );
}
```

Always render a `Skeleton` of roughly the final size while loading — never a
spinner in place of a number, and never a layout that reflows when data lands.

## D. List view (toolbar + table)

The canonical record list: a filter row, a bordered table, and an inline empty
state. Row actions are `smallest` icon buttons in a fixed-width trailing column.

```tsx
import React, { useState } from "react";
import {
    Chip, cls, defaultBorderMixin, IconButton, iconSize, PencilIcon, SearchBar,
    Select, SelectItem, Table, TableBody, TableCell, TableHeader, TableRow,
    Tooltip, Trash2Icon, Typography
} from "@rebasepro/ui";

interface Project { id: string; name: string; status: string; tags: string[] }

export function ProjectsTable({ projects }: { projects: Project[] }) {
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("all");

    const filtered = projects.filter(p =>
        (status === "all" || p.status === status) &&
        p.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <div className="space-y-3">

            {/* Toolbar — small controls, wraps on narrow viewports */}
            <div className="flex items-center gap-3 flex-wrap">
                <SearchBar onTextSearch={term => setSearch(term ?? "")}
                           placeholder="Search projects…" size="small"/>
                <Select value={status} onValueChange={setStatus} size="small" placeholder="Status">
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                </Select>
            </div>

            <div className={cls("rounded-lg border overflow-hidden", defaultBorderMixin)}>
                <Table className="w-full">
                    <TableHeader>
                        <TableCell header>Name</TableCell>
                        <TableCell header>Status</TableCell>
                        <TableCell header>Tags</TableCell>
                        <TableCell header style={{ width: "80px" }}/>
                    </TableHeader>
                    <TableBody>
                        {filtered.map(project => (
                            <TableRow key={project.id}>
                                <TableCell className="font-medium">{project.name}</TableCell>
                                <TableCell>{project.status}</TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        {project.tags.map(tag => (
                                            <Chip key={tag} size="smallest" colorScheme="cyan">{tag}</Chip>
                                        ))}
                                    </div>
                                </TableCell>
                                <TableCell style={{ width: "80px" }}>
                                    <div className="flex gap-1">
                                        <Tooltip title="Edit" asChild>
                                            <IconButton size="smallest"><PencilIcon size={iconSize.smallest}/></IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete" asChild>
                                            <IconButton size="smallest"><Trash2Icon size={iconSize.smallest}/></IconButton>
                                        </Tooltip>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {filtered.length === 0 && (
                <div className="flex items-center justify-center py-8">
                    <Typography variant="label" color="secondary">No projects match your filters</Typography>
                </div>
            )}
        </div>
    );
}
```

## E. Empty state

One layout for every "nothing here" case: centred column, `label` message,
primary action with a `PlusIcon`. No illustrations, no marketing copy.

```tsx
import React from "react";
import { Button, cls, defaultBorderMixin, PlusIcon, Typography } from "@rebasepro/ui";

export function EmptyProjects({ onAdd }: { onAdd: () => void }) {
    return (
        <div className={cls("flex flex-col items-center justify-center h-48 border rounded-lg", defaultBorderMixin)}>
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <Typography variant="label">Now you can add your first project</Typography>
                <Button onClick={onAdd}>
                    <PlusIcon/>
                    Add new project
                </Button>
            </div>
        </div>
    );
}
```

Write the message as an invitation ("Now you can add your first property",
"Select a property to edit it") — not an error ("No data found").

## F. Form panel

A 12-column grid, full-width fields, actions right-aligned at the bottom. This is
the structure used by the built-in user dialog; it works identically inside a
`Dialog` or as a standalone panel.

```tsx
import React from "react";
import {
    Button, cls, defaultBorderMixin, LoadingButton, MultiSelect, MultiSelectItem,
    TextField, Typography
} from "@rebasepro/ui";

export function UserForm({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
    return (
        <div className={cls("rounded-lg border w-full max-w-xl", defaultBorderMixin)}>
            <div className="px-6 pt-6 pb-2">
                <Typography variant="h4">User</Typography>
            </div>
            <div className="px-6 py-4">
                <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12">
                        <TextField name="displayName" required label="Name"
                                   value="Alice Johnson" onChange={() => {}}/>
                    </div>
                    <div className="col-span-12">
                        <TextField name="email" required label="Email" disabled
                                   value="alice@example.com" onChange={() => {}}/>
                    </div>
                    <div className="col-span-12">
                        <MultiSelect className="w-full" label="Roles"
                                     value={["admin"]} onValueChange={() => {}}>
                            <MultiSelectItem value="admin">Admin</MultiSelectItem>
                            <MultiSelectItem value="editor">Editor</MultiSelectItem>
                        </MultiSelect>
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 pb-6">
                <Button variant="text" onClick={onCancel}>Cancel</Button>
                <LoadingButton variant="filled" loading={saving}>Update</LoadingButton>
            </div>
        </div>
    );
}
```

Rules:
- Half-width fields are `col-span-6`, never a nested flex row.
- Cancel is `variant="text"`; the submit is the only filled button on the panel.
- Submits that hit the network use `LoadingButton`, not `Button` plus a spinner.

## G. Boxy tabs & editor sidebar

Editor-style surfaces (SQL, JS, RLS, collection editors) use `variant="boxy"`
tabs flush against the panel border, followed by an uppercase section header.

```tsx
import React from "react";
import {
    cls, defaultBorderMixin, IconButton, iconSize, SettingsIcon, Tab, Tabs, Typography
} from "@rebasepro/ui";

export function EditorSidebar() {
    return (
        <div className={cls("border rounded-lg overflow-hidden w-[320px]", defaultBorderMixin)}>
            <Tabs value="schema" onValueChange={() => {}} variant="boxy"
                  className="border-b border-surface-200 dark:border-surface-950">
                <Tab value="schema">Schema</Tab>
                <Tab value="snippets">Snippets</Tab>
            </Tabs>
            <div className={cls("p-3 border-b flex justify-between items-center bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>
                <Typography variant="caption"
                            className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">
                    TABLES
                </Typography>
                <IconButton size="small"><SettingsIcon size={iconSize.smallest}/></IconButton>
            </div>
            <div className="p-2">{/* scrollable list */}</div>
        </div>
    );
}
```

Use plain `<Tabs>` (default variant) for page-level navigation; use `boxy` only
inside a bordered editor panel.

## H. Banner / inline alert

```tsx
import React from "react";
import { Alert, Button } from "@rebasepro/ui";

export function AdminBootstrapBanner({ onPromote }: { onPromote: () => void }) {
    return (
        <Alert color="warning"
               outerClassName="mb-4"
               action={<Button onClick={onPromote}>Make me admin</Button>}>
            No admin users exist. You can make yourself an admin.
        </Alert>
    );
}
```

Use `Alert` for state that belongs to the page. Never hand-roll a coloured `div`,
and never use an `Alert` for a transient result — that is a toast.

---

## Density cheat sheet

| Context | Value |
|---|---|
| Between page sections | `my-10` |
| Between a toolbar and its table | `space-y-3` |
| Grid gap (cards, metrics, form fields) | `gap-4` |
| Card padding | `p-4` (`p-6` for a dialog-sized panel) |
| Corner radius | `rounded-lg` — never `rounded-2xl` |
| Table row actions | `IconButton size="smallest"` in an 80px column |
| Numeric display | `tabular-nums` |

## Before you ship a view

1. Did you copy a skeleton from this file, or invent a layout? Invented layouts drift.
2. Every text node inside a `Typography` — no raw `<p>`, `<h1>`, `<span>`.
3. Every class list through `cls()` — no template literals.
4. Only `primary` blue as an accent, used sparingly. No second accent colour.
5. Loading states are `Skeleton`s sized like the real content.
6. Check it in dark mode. Surfaces need an explicit `dark:` variant.
7. Compare against `/debug/ui` in the running app before calling it done.
