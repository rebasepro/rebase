# @rebasepro/cms

CMS frontend — content management views, forms, routing, visual schema editor, and data import/export for Rebase.

## Installation

```bash
pnpm add @rebasepro/cms
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

**Peer dependencies:** `react ^19.2.7`, `react-dom ^19.2.7`, `react-router ^8.3.0`

## What This Package Does

`@rebasepro/cms` is the complete CMS layer of Rebase. It provides the admin panel UI — collection table/card views, entity editing forms, side-panel navigation, the visual collection (schema) editor, data import/export (CSV, JSON, Excel), and the app shell with auth gating, routing, and drawer layout. It sits on top of `@rebasepro/app` (runtime hooks/providers) and `@rebasepro/ui` (design system components).

## Key Exports

### App Shell & Layout

| Export | Description |
|---|---|
| `RebaseCMS` | Declares the CMS into the registry: `collections`, `views`, `homePage`, `entityViews`, `collectionViews`, `entityActions`, `collectionEditor`, `navigationGroupMappings`, `basePath`. Renders nothing; it sits inside `<Rebase>` |
| `RebaseShell` | Composes `RebaseAuthGate`, `RebaseNavigation`, `RebaseRouteDefs` and `RebaseLayout` with sensible defaults |
| `RebaseAuthGate` | Auth-gated wrapper — shows login or the CMS based on session state |
| `RebaseNavigation` | Renders the sidebar navigation from resolved collections/views |
| `RebaseLayout` | Main content layout (header + body area) |
| `RebaseRouteDefs` | Route definitions for react-router integration |
| `Scaffold` | Page-level layout wrapper (header, content, footer) |
| `AppBar` | Top application bar |
| `Drawer` / `DefaultDrawer` | Sidebar drawer components |
| `DrawerFooterActions` | Footer action buttons inside the drawer |
| `SideDialogs` | Stacked side-panel dialog system |
| `AdminModeSyncer` | Syncs the admin mode (`"cms"` \| `"studio"`) with the current route |
| `CollectionPanel` | Standalone collection browser panel |

### Entity & Collection Views

| Export | Description |
|---|---|
| `EntityViewBinding` | Full entity detail/edit view |
| `CollectionViewBinding` | Primary collection list view (table + toolbar) |
| `CollectionTableBinding` | Virtualized spreadsheet table for a collection |
| `CollectionCardViewBinding` | Card/grid layout for a collection |
| `EntityCardBinding` | Individual entity card |
| `CollectionViewActions` | Toolbar actions (filters, search, create) |
| `CollectionRowActions` | Per-row action buttons |
| `SelectionTableBinding` | Table for multi-entity selection dialogs |
| `SelectableTable` | Generic selectable table component |
| `EntityPreviewBinding` | Compact entity preview widget |
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
| `useSidePanel` | Open/close entity side panels programmatically |
| `useSelectionDialog` | Launch a multi-entity selection dialog |
| `useSelectionController` | Row selection state for tables |
| `useHistory` | Entity change history and version revert |
| `useBreadcrumbsController` | Breadcrumb navigation state |
| `useAdminContext` | Access the admin-level context |
| `useResolvedNavigationFrom` | Resolve navigation tree from collection configs |

### Data Import/Export

All exports from `./data_import` and `./data_export` — utilities for importing CSV/JSON/Excel data with field mapping, and exporting collection data in multiple formats.

### Collection Editor (Visual Schema Editor)

All exports from `./collection_editor` — the visual schema editor UI for creating and editing collection definitions (properties, relations, validation rules) from within the CMS.

Also available as a separate entry point:

```ts
import { CollectionEditorDialog, PropertyForm } from "@rebasepro/cms/collection_editor_ui";
```

### Rich Text Editor (`RichTextEditor`)

A full-featured WYSIWYG editor built on ProseMirror with support for **Markdown**, **JSON** (ProseMirror document tree), and **HTML** output formats. Includes slash commands, bubble menus, image uploads, tables, AI completions, and a raw Markdown toggle.

Type exports only from the main entry point (`RichTextEditorProps`, `JSONContent`, `EditorAIController`). The full ProseMirror editor is a heavy import (~300 KB) and available as a separate entry point:

```ts
import { RichTextEditor } from "@rebasepro/cms/editor";
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

`<RebaseCMS>` renders nothing on its own: it declares the CMS to the `<Rebase>`
it sits inside, and `<RebaseShell>` renders it.

```tsx
import { Rebase, RebaseAuth } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";

function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseAuth />
            <RebaseCMS collections={[/* your collection configs */]} />
            <RebaseShell title="Rebase" />
        </Rebase>
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
