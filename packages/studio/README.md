# @rebasepro/studio

Developer tools layer for Rebase — provides 9 lazy-loaded tools (SQL Console, JS Console, RLS Editor, Storage, Cron Jobs, Schema Visualizer, Branches, API Explorer, Logs Explorer) plus a customizable home page.

## Installation

```bash
pnpm add @rebasepro/studio
```

### Peer Dependencies

- `react` >= 19.0.0
- `react-dom` >= 19.0.0
- `react-router` ^8.3.0
- `@rebasepro/cms` (optional)

## What This Package Does

`@rebasepro/studio` registers a set of developer tools into the Rebase CMS. The `<RebaseStudio>` component renders nothing visible — it declaratively registers tool views into the Rebase registry. Each tool (Monaco-based editors, xyflow graph, etc.) is lazy-loaded so it stays out of the initial bundle.

## Available Tools

| Slug | Name | Group | Description |
|---|---|---|---|
| `sql` | SQL Console | Database | Execute raw SQL queries |
| `js` | JS Console | Compute | Run JavaScript in a live sandbox |
| `rls` | RLS Policies | Database | Configure Row Level Security |
| `storage` | Storage | Storage | Browse and manage files |
| `cron` | Cron Jobs | Compute | Monitor scheduled tasks |
| `schema-visualizer` | Schema Visualizer | Database | Interactive database ERD |
| `branches` | Branches | Database | Create and manage database branches |
| `api` | API Explorer | API | Interactive API docs and testing |
| `logs` | Logs Explorer | Database | Real-time system and query logs |

All 9 tools are enabled by default. The `schema` tool (collection editor) is auto-injected by the CMS when `collectionEditor` is enabled — it is **not** registered here.

## Key Exports

| Export | Type | Description |
|---|---|---|
| `RebaseStudio` | Component | Main entry point — registers tools into the Rebase registry |
| `StudioHomePage` | Component | Default home page with tool cards and SDK quick-start snippet |
| `StudioBridgeProvider` | Component | Re-exported from `@rebasepro/app` |
| `StudioBridgeContext` | Context | Re-exported from `@rebasepro/app` |
| `useStudioCollectionRegistry` | Hook | Access the collection registry |
| `useStudioSidePanelController` | Hook | Control the side snapshot panel |
| `useStudioUrlController` | Hook | URL state management |
| `useStudioNavigationState` | Hook | Navigation state |
| `useStudioBreadcrumbs` | Hook | Breadcrumb management |
| `StudioBridge` | Type | Bridge interface type |
| `BreadcrumbEntry` | Type | Single breadcrumb item |
| `BreadcrumbsController` | Type | Breadcrumb controller interface |

Individual tools (e.g. `SQLEditor`, `SchemaVisualizer`) are **not** re-exported from the barrel to preserve code splitting. Use deep imports if needed:

```typescript
import { SQLEditor } from "@rebasepro/studio/components/SQLEditor/SQLEditor";
```

## Quick Start

```tsx
import { RebaseStudio } from "@rebasepro/studio";

// Inside your Rebase app — enable all 9 tools (default)
<RebaseStudio />

// Or pick specific tools
<RebaseStudio tools={["sql", "rls", "storage", "api"]} />

// Custom home page
<RebaseStudio homePage={<MyCustomHomePage />} />
```

### StudioHomePage Props

| Prop | Type | Description |
|---|---|---|
| `additionalActions` | `ReactNode` | Extra actions in the top-right area |
| `additionalChildrenStart` | `ReactNode` | Content before the tool grid |
| `additionalChildrenEnd` | `ReactNode` | Content after the tool grid |
| `sections` | `HomePageSection[]` | Extra sections appended to the page |
| `hiddenGroups` | `string[]` | Groups to hide from the home page |

## Related Packages

- `@rebasepro/app` — Bridge, registry, and navigation primitives
- `@rebasepro/ui` — Component library used by Studio tools
- `@rebasepro/cms` — The CMS layer (optional peer dep)
- `@rebasepro/types` — Shared type definitions
