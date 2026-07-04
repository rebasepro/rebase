---
title: Slots
sidebar_label: Slots
description: Reference for all UI extension point slots available in Rebase — named locations where you can inject custom components.
---

## Overview

Slots are named UI extension points where you can inject custom React components. Each slot has typed props specific to its location in the UI. Rebase ships with 29 built-in slots covering the home page, navigation, collection views, snapshot forms, dashboards, and more.

## Usage

### Via `<Rebase>` prop

```tsx
<Rebase
    client={client}
    slots={[
        {
            slot: "navigation.footer",
            Component: MyNavigationFooter,
            order: 10
        },
        {
            slot: "collection.actions",
            Component: BulkExportButton
        }
    ]}
>
```

### Via plugin

```typescript
const myPlugin: RebasePlugin = {
    key: "my-plugin",
    slots: [
        {
            slot: "home.cards",
            Component: AnalyticsCard,
            order: 20
        }
    ]
};
```

:::note
`order` controls rendering order — lower values render first. The default is `50`.
:::

## Available Slots

#### Home Page

| Slot | Props Type | Description |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Actions in the home page header |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Additional cards on the home page |
| `home.children.start` | `PluginGenericProps` | Content at the start of the home page |
| `home.children.end` | `PluginGenericProps` | Content at the end of the home page |
| `home.card.insight` | `HomeCardInsightSlotProps` | Compact insight widget inside a home page collection card |
| `home.collection.actions` | `PluginHomePageActionsProps` | Actions on home page collection cards |

#### Navigation

| Slot | Props Type | Description |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Below the logo in the sidebar drawer |
| `navigation.footer` | `NavigationSlotProps` | Above the collapse toggle at the bottom of the drawer |

#### Collection View

| Slot | Props Type | Description |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | End-side toolbar actions (after collection `Actions`) |
| `collection.actions.start` | `CollectionActionsProps` | Start-side toolbar actions (alongside filters) |
| `collection.header.action` | `CollectionHeaderActionProps` | Column header action buttons |
| `collection.add-column` | `CollectionAddColumnProps` | "Add column" area in table header |
| `collection.error` | `CollectionErrorProps` | Error state display for a collection |
| `collection.toolbar` | `CollectionToolbarProps` | Extra widgets inside the collection toolbar row |
| `collection.empty-state` | `CollectionEmptyStateProps` | Custom empty-state when collection has no data |
| `collection.insights` | `CollectionInsightsSlotProps` | Insight widgets above the collection table |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Custom filter sidebar alongside the table |

#### Snapshot / Form

| Slot | Props Type | Description |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Actions in the snapshot form action bar |
| `form.actions.top` | `PluginFormActionProps` | Actions above the form action bar |
| `form.before` | `PluginFormActionProps` | Content before the form title/field list |
| `form.after` | `PluginFormActionProps` | Content after the form field list |
| `snapshot.row.actions` | `EntityRowActionsProps` | Per-row actions in snapshot tables |
| `snapshot.field.before` | `EntityFieldSlotProps` | UI injected before an individual form field |
| `snapshot.field.after` | `EntityFieldSlotProps` | UI injected after an individual form field |

#### Dashboard

| Slot | Props Type | Description |
|------|-----------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widgets on the dashboard/home page |

#### Global

| Slot | Props Type | Description |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Cross-collection search bar component |
| `shell.toolbar` | `ShellToolbarProps` | Top-level toolbar actions in the app bar |

#### Kanban

| Slot | Props Type | Description |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | Kanban board setup UI |
| `kanban.add-column` | `KanbanAddColumnProps` | "Add column" in kanban view |

## Slot Props Reference

All slot prop types are exported from `@rebasepro/types` and can be imported for type-safe slot components:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/types";
```

Each props type provides access to the context relevant to the slot's location — collection metadata, snapshot data, navigation state, and more. Refer to the individual type definitions for full property details.
