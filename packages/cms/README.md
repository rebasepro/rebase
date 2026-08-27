# @rebasepro/cms

CMS frontend — content management views, forms, routing, visual schema editor, and data import/export for Rebase.

## Installation

```bash
pnpm add @rebasepro/cms
```

**Peer dependencies:** `react >= 19.2.7`, `react-dom >= 19.2.7`, `react-router ^8`

## What This Package Does

`@rebasepro/cms` is the complete CMS layer of Rebase. It provides the admin panel UI — collection table/card views, snapshot editing forms, side-panel navigation, the visual collection (schema) editor, data import/export (CSV, JSON, Excel), and the app shell with auth gating, routing, and drawer layout. It sits on top of `@rebasepro/app` (runtime hooks/providers) and `@rebasepro/ui` (design system components).

## Key Exports

### App Shell & Layout

| Export | Description |
|---|---|
| `RebaseCMS` | Top-level CMS component — wires routing, auth, and layout together |
| `RebaseShell` | Outer shell (providers + chrome) without opinionated routing |
| `RebaseAuthGate` | Auth-gated wrapper — shows login or the CMS based on session state |
| `RebaseNavigation` | Renders the sidebar navigation from resolved collections/views |
| `RebaseLayout` | Main content layout (header + body area) |
| `RebaseRouteDefs` | Route definitions for react-router integration |
| `Scaffold` | Page-level layout wrapper (header, content, footer) |
| `AppBar` | Top application bar |
| `Drawer` / `DefaultDrawer` | Sidebar drawer components |
| `DrawerFooterActions` | Footer action buttons inside the drawer |
| `SideDialogs` | Stacked side-panel dialog system |
| `AdminModeSyncer` | Syncs admin/content mode state |
| `CollectionPanel` | Standalone collection browser panel |

### Snapshot & Collection Views

| Export | Description |
|---|---|
| `SnapshotCustomView` | Full snapshot detail/edit view |
| `DataCollectionView` | Primary collection list view (table + toolbar) |
| `DataCollectionTable` | Virtualized spreadsheet table for a collection |
| `SnapshotCollectionCardView` | Card/grid layout for a collection |
| `SnapshotCard` | Individual snapshot card |
| `DataCollectionViewActions` | Toolbar actions (filters, search, create) |
| `SnapshotCollectionRowActions` | Per-row action buttons |
| `SnapshotSelectionTable` | Table for multi-snapshot selection dialogs |
| `SelectableTable` | Generic selectable table component |
| `SnapshotPreview` | Compact snapshot preview widget |
| `VirtualTableInput` | Inline-edit input rendered inside the virtual table |
| `ArrayContainer` | Renders array/repeated property fields |
| `ReferenceWidget` | Reference (foreign key) picker widget |

### Snapshot Actions

| Export | Description |
|---|---|
| `editSnapshotAction` | Built-in action to open a snapshot for editing |
| `copySnapshotAction` | Built-in action to duplicate a snapshot |
| `deleteSnapshotAction` | Built-in action to delete a snapshot |
| `resetPasswordAction` | Action to reset a user's password |

### Hooks

| Export | Description |
|---|---|
| `useApp` | Access the app-level context (navigation, mode, config) |
| `useSidePanelController` | Open/close snapshot side panels programmatically |
| `useSelectionDialog` | Launch a multi-snapshot selection dialog |
| `useSelectionController` | Row selection state for tables |
| `useHistory` | Snapshot change history and version revert |
| `useBreadcrumbsController` | Breadcrumb navigation state |
| `useAdminContext` | Access the admin-level context |
| `useResolvedNavigationFrom` | Resolve navigation tree from collection configs |

### Data Import/Export

All exports from `./data_import` and `./data_export` — utilities for importing CSV/JSON/Excel data with field mapping, and exporting collection data in multiple formats.

### Collection Editor (Visual Schema Editor)

All exports from `./collection_editor` — the visual schema editor UI for creating and editing collection definitions (properties, relations, validation rules) from within the CMS.

Also available as a separate entry point:

```ts
import { ... } from "@rebasepro/cms/collection_editor_ui";
```

### Rich Text Editor (`RichTextEditor`)

A full-featured WYSIWYG editor built on ProseMirror with support for **Markdown**, **JSON** (ProseMirror document tree), and **HTML** output formats. Includes slash commands, bubble menus, image uploads, tables, AI completions, and a raw Markdown toggle.

Type exports only from the main entry point (`RichTextEditorProps`, `JSONContent`, `EditorAIController`). The full ProseMirror editor is a heavy import (~300 KB) and available as a separate entry point:

```ts
import { RichTextEditor } from "@rebasepro/cms/editor";
```

> **Note:** The previous name `RebaseEditor` still works but is deprecated.

### Utilities

| Export | Description |
|---|---|
| `getFieldConfig` / `getDefaultFieldConfig` | Resolve field config for a property type |
| `getIconForWidget` / `getIconForProperty` | Get the display icon for a property or widget |
| `getPropertyInPath` / `getResolvedPropertyInPath` | Navigate nested property paths |
| `getPropertiesWithPropertiesOrder` | Apply display ordering to properties |
| `getSnapshotPreviewKeys` / `getSnapshotTitlePropertyKey` | Determine preview/title fields |
| `isReferenceProperty` / `isRelationProperty` | Property type guards |
| `mergeSnapshotActions` / `resolveSnapshotAction` / `resolveSnapshotView` | Action & view resolution |
| Path helpers | `addInitialSlash`, `removeInitialSlash`, `removeTrailingSlash`, etc. |

## Quick Start

```tsx
import { RebaseCMS } from "@rebasepro/cms";

function App() {
    return (
        <RebaseCMS
            collections={[/* your collection configs */]}
            authController={authController}
            dataSource={dataSource}
        />
    );
}
```

## Related Packages

- [`@rebasepro/app`](../app) — Runtime hooks, providers, auth components, and context
- [`@rebasepro/ui`](../ui) — Design system components (buttons, dialogs, inputs, etc.)
- [`@rebasepro/common`](../common) — Shared utilities, collection registry, query builder
- [`@rebasepro/types`](../types) — TypeScript type definitions
- [`@rebasepro/forms`](../forms) — Form state management
- [`@rebasepro/inference`](../inference) — Schema introspection from databases
