# @rebasepro/app

Framework-agnostic runtime for data-driven admin panels — React hooks, providers, contexts, and shared components used by `@rebasepro/cms` and `@rebasepro/studio`.

## Installation

```bash
pnpm add @rebasepro/app
```

**Peer dependencies:** `react >= 19.2.7`, `react-dom >= 19.2.7`, `react-router ^8`

## What This Package Does

`@rebasepro/app` is the shared runtime layer that powers the Rebase CMS. It provides:

- **App bootstrapping** — `Rebase`, `RebaseRouter`, `RebaseRoutes`, `PluginProviderStack`
- **React contexts** — auth, data driver, storage, snackbar, dialogs, mode, admin mode, role, analytics, customization
- **Hooks** — data fetching (`useData`, `useCollection`, `useFetch`), data mutation (`save`, `delete`), auth (`useAuthController`), storage, permissions, i18n, and more
- **UI components** — `LoginView`, `RebaseAuth`, `ConfirmationDialog`, `ErrorView`, `UserSettingsView`, `BootstrapAdminBanner`, etc.
- **Utilities** — icon system, snapshot caching, storage upload controller, enums, constants
- **i18n** — built-in English and Spanish locales via `react-i18next`
- **Studio Bridge** — shared context for optional CMS↔Studio integration

This package is **framework-agnostic** in the sense that it doesn't depend on any specific data backend — it works with any `DataDriver` implementation (PostgreSQL, Firebase, MongoDB, etc.).

## Key Exports

### App Bootstrapping

| Export | Description |
|---|---|
| `Rebase` | Root component — accepts collections, auth, data source config and renders the app |
| `RebaseRouter` | Router wrapper for react-router integration |
| `RebaseRoutes` | Route definitions |
| `PluginProviderStack` | Wraps children with plugin-provided context providers |

### Hooks — Data

| Export | Description |
|---|---|
| `useData` | Access the data driver from context |
| `useCollection` | Fetch a collection with filters, pagination, and realtime |
| `useFetch` | Fetch a single snapshot by ID |
| `useRelationSelector` | Relation field selector state |
| `useUserSelector` | User selector state |
| `save` utilities | Snapshot save helpers |
| `delete` utilities | Snapshot delete helpers |

### Hooks — Auth & Permissions

| Export | Description |
|---|---|
| `useAuthController` | Access the current auth controller from context |
| `useAuthSubscription` | Subscribe to auth state changes |
| `usePermissions` | Check permissions for collections/actions |
| `useAdminModeController` / `useBuildAdminModeController` | Admin mode toggle |
| `useEffectiveRoleController` / `useBuildEffectiveRoleController` | Current user's effective role |

### Hooks — UI & State

| Export | Description |
|---|---|
| `useRebaseContext` | Access the top-level Rebase context |
| `useDialogsController` | Programmatic dialog management |
| `useSnackbarController` | Show snackbar notifications |
| `useModeController` / `useBuildModeController` | Light/dark mode |
| `useStorageSource` / `useBackendStorageSource` | Storage source from context |
| `useRebaseClient` | Access the `RebaseClient` instance |
| `useLargeLayout` | Responsive layout breakpoint hook |
| `useClipboard` | Copy-to-clipboard |
| `useUnsavedChangesDialog` | Prompt user about unsaved changes |
| `useCustomizationController` | UI customization overrides |
| `useRebaseRegistry` | Access the collection/plugin registry |
| `useTranslation` | i18n translation hook |
| `useAnalyticsController` | Analytics event tracking |

### Hooks — Studio Bridge

| Export | Description |
|---|---|
| `useStudioBridge` | Access bridge context for CMS↔Studio communication |
| `useBridgeRegistration` | Register bridge callbacks (self-assembling) |

### Components

| Export | Description |
|---|---|
| `LoginView` | Pre-built login/register form UI |
| `RebaseAuth` | Auth gate component — handles login flow rendering |
| `ErrorView` | Error display component |
| `ConfirmationDialog` | Configurable confirmation dialog |
| `UnsavedChangesDialog` | "Discard changes?" dialog |
| `NotFoundPage` | 404 page |
| `UserSettingsView` | User profile settings page |
| `UserSelectPopover` / `UserDisplay` | User avatar/name display |
| `LanguageToggle` | i18n language switcher |
| `BootstrapAdminBanner` | First-user setup banner |
| `RebaseLogo` | Rebase branding logo |

### Contexts

| Export | Description |
|---|---|
| `SnackbarProvider` | Snackbar notification context |
| `ModeController` | Light/dark mode context |
| `AdminModeController` | Admin mode context |
| `EffectiveRoleController` | User role context |
| `AuthControllerContext` | Auth controller context |
| `DataDriverContext` | Data driver context |
| `StorageSourceContext` | Storage source context |
| `DialogsProvider` | Dialog management context |
| `RebaseClientInstanceContext` | Client instance context |
| `CustomizationControllerContext` | UI customization context |
| `AnalyticsContext` | Analytics context |

### Utilities

| Export | Description |
|---|---|
| `iconList` / icon helpers | Full icon set and lookup |
| `createFormexStub` | Create a form stub for testing |
| `snapshotCache` | Snapshot LRU cache |
| `useStorageUploadController` | File upload progress controller |
| `previews` | Preview rendering utilities |
| `enums` / `constants` | Shared enums and constant values |

### i18n

| Export | Description |
|---|---|
| `RebaseI18nProvider` | i18n context provider |
| `en` locale | English translations |
| `es` locale | Spanish translations |

### Vite Plugin

Available as a separate entry point:

```ts
import { rebaseVitePlugin } from "@rebasepro/app/vitePlugin";
```

## Quick Start

```tsx
import { Rebase, useAuthController, useCollection } from "@rebasepro/app";

function App() {
    return (
        <Rebase
            collections={collections}
            authController={authController}
            dataSource={dataSource}
        />
    );
}

// Inside any child component:
function ProductList() {
    const { data, loading } = useCollection("products", { limit: 20 });
    // ...
}
```

## Related Packages

- [`@rebasepro/cms`](../admin) — CMS views, forms, and routing (built on top of core)
- [`@rebasepro/ui`](../ui) — Design system components
- [`@rebasepro/common`](../common) — Shared utilities and collection registry
- [`@rebasepro/types`](../types) — TypeScript type definitions
- [`@rebasepro/forms`](../formex) — Form state management
- [`@rebasepro/client`](../client) — HTTP client SDK
