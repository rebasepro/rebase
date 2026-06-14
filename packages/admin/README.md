# @rebasepro/admin

CMS frontend — content management views, forms, routing, visual schema editor, and data import/export for Rebase.

## Installation

```bash
pnpm add @rebasepro/admin
```

**Peer dependencies:** `react >= 19`, `react-dom >= 19`, `react-router ^7`, `react-router-dom ^7`

## What This Package Does

`@rebasepro/admin` is the complete CMS layer of Rebase. It provides the admin panel UI — collection table/card views, entity editing forms, side-panel navigation, the visual collection (schema) editor, data import/export (CSV, JSON, Excel), and the app shell with auth gating, routing, and drawer layout. It sits on top of `@rebasepro/core` (runtime hooks/providers) and `@rebasepro/ui` (design system components).

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

### Entity & Collection Views

| Export | Description |
|---|---|
| `EntityView` | Full entity detail/edit view |
| `EntityCollectionView` | Primary collection list view (table + toolbar) |
| `EntityCollectionTable` | Virtualized spreadsheet table for a collection |
| `EntityCollectionCardView` | Card/grid layout for a collection |
| `EntityCard` | Individual entity card |
| `EntityCollectionViewActions` | Toolbar actions (filters, search, create) |
| `EntityCollectionRowActions` | Per-row action buttons |
| `EntitySelectionTable` | Table for multi-entity selection dialogs |
| `SelectableTable` | Generic selectable table component |
| `EntityPreview` | Compact entity preview widget |
| `VirtualTableInput` | Inline-edit input rendered inside the virtual table |
| `ArrayContainer` | Renders array/repeated property fields |
| `ReferenceWidget` | Reference (foreign key) picker widget |

### Entity Actions

| Export | Description |
|---|---|
| `editEntityAction` | Built-in action to open an entity for editing |
| `copyEntityAction` | Built-in action to duplicate an entity |
| `deleteEntityAction` | Built-in action to delete an entity |
| `resetPasswordAction` | Action to reset a user's password |

### Hooks

| Export | Description |
|---|---|
| `useApp` | Access the app-level context (navigation, mode, config) |
| `useSideEntityController` | Open/close entity side panels programmatically |
| `useEntitySelectionDialog` | Launch a multi-entity selection dialog |
| `useSelectionController` | Row selection state for tables |
| `useEntityHistory` | Entity change history and version revert |
| `useBreadcrumbsController` | Breadcrumb navigation state |
| `useCMSContext` | Access the CMS-level context |
| `useResolvedNavigationFrom` | Resolve navigation tree from collection configs |

### Data Import/Export

All exports from `./data_import` and `./data_export` — utilities for importing CSV/JSON/Excel data with field mapping, and exporting collection data in multiple formats.

### Collection Editor (Visual Schema Editor)

All exports from `./collection_editor` — the visual schema editor UI for creating and editing collection definitions (properties, relations, validation rules) from within the CMS.

Also available as a separate entry point:

```ts
import { ... } from "@rebasepro/admin/collection_editor_ui";
```

### Rich Text Editor

Type exports only from the main entry point (`RebaseEditorProps`, `JSONContent`, `EditorAIController`). The full ProseMirror editor is a heavy import (~300 KB) and available as a separate entry point:

```ts
import { RebaseEditor } from "@rebasepro/admin/editor";
```

### Utilities

| Export | Description |
|---|---|
| `getFieldConfig` / `getDefaultFieldConfig` | Resolve field config for a property type |
| `getIconForWidget` / `getIconForProperty` | Get the display icon for a property or widget |
| `getPropertyInPath` / `getResolvedPropertyInPath` | Navigate nested property paths |
| `getPropertiesWithPropertiesOrder` | Apply display ordering to properties |
| `getEntityPreviewKeys` / `getEntityTitlePropertyKey` | Determine preview/title fields |
| `isReferenceProperty` / `isRelationProperty` | Property type guards |
| `mergeEntityActions` / `resolveEntityAction` / `resolveEntityView` | Action & view resolution |
| Path helpers | `addInitialSlash`, `removeInitialSlash`, `removeTrailingSlash`, etc. |

## Quick Start

```tsx
import { RebaseCMS } from "@rebasepro/admin";

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

- [`@rebasepro/core`](../core) — Runtime hooks, providers, auth components, and context
- [`@rebasepro/ui`](../ui) — Design system components (buttons, dialogs, inputs, etc.)
- [`@rebasepro/common`](../common) — Shared utilities, collection registry, query builder
- [`@rebasepro/types`](../types) — TypeScript type definitions
- [`@rebasepro/formex`](../formex) — Form state management
- [`@rebasepro/schema-inference`](../schema-inference) — Schema introspection from databases
