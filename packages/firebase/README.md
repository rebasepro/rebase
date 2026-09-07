# @rebasepro/firebase

Firebase client adapter for Rebase — connects the Rebase admin panel to Firebase (Firestore, Auth, Storage).

## Installation

```bash
pnpm add @rebasepro/firebase
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. `require()` of it resolves only on Node 22.12+, which supports
`require(esm)`.

**Peer dependencies:** `firebase ^10.12.2 || ^11.0.0 || ^12.0.0`, `react >= 19.0.0`, `react-dom >= 19.0.0`, `typesense ^1.8.0` (optional)

## What This Package Does

This package provides the full Firebase integration layer for Rebase. It includes:

- A top-level `RebaseFirebaseApp` component that wires up Firebase Auth, Firestore, and Storage into a complete admin app with login, routing, and data management.
- React hooks for each Firebase service (auth, Firestore, storage, App Check, user management).
- Text search adapters (Algolia, Pinecone, Typesense, local, Rebase-hosted).
- Firebase login view with configurable sign-in providers.

## Key Exports

### Components

| Export | Description |
|---|---|
| `RebaseFirebaseApp` | Full-featured Rebase app component backed by Firebase. Handles init, auth, routing, and rendering |
| `RebaseFirebaseAppProps` | Props type for `RebaseFirebaseApp` — name, logo, collections, views, signInOptions, plugins, etc. |
| `FirebaseLoginView` | Standalone Firebase login view with social sign-in buttons |

### Hooks

| Export | Description |
|---|---|
| `useInitialiseFirebase` | Initializes the Firebase app from config |
| `useFirebaseAuthController` | Manages Firebase Auth state (sign-in, sign-out, user) |
| `useFirestoreDriver` | Creates a Firestore-backed `DataDriver` for CRUD and realtime listeners |
| `useFirebaseStorageSource` | Provides file upload/download via Firebase Storage |
| `useAppCheck` | Enables Firebase App Check verification |
| `useRecaptcha` | reCAPTCHA integration for App Check |
| `useBuildUserManagement` | Builds a user/role management delegate from Firestore |
| `useFirebaseAccessGate` | Evaluates whether the current user can access the admin panel |
| `useFirebaseRealTimeDBDelegate` | Realtime Database integration |

### Utils

| Export | Description |
|---|---|
| `buildAlgoliaSearchController` | Algolia text search adapter |
| `buildPineconeSearchController` | Pinecone text search adapter |
| `buildRebaseSearchController` | Rebase-hosted search adapter |
| `buildLocalTextSearchController` | Client-side fuzzy search (Fuse.js) |
| `buildTextSearchController` | Generic text search adapter builder |
| `buildCollectionsFromFirestore` | Auto-generate collection configs by introspecting Firestore data |

### Types

| Export | Description |
|---|---|
| `FirebaseSignInProvider` | Provider ID strings (`google.com`, `github.com`, etc.) |
| `FirebaseSignInOption` | Sign-in config with scopes and custom parameters |
| `FirebaseAuthController` | Extended auth controller type for Firebase |
| `FirebaseUserWrapper` | Rebase user wrapper around Firebase User |
| `FirestoreTextSearchControllerBuilder` | Builder type for text search controllers |
| `AppCheckOptions` | App Check configuration type |

## Quick Start

```tsx
import { RebaseFirebaseApp } from "@rebasepro/firebase";

const firebaseConfig = {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
    storageBucket: "...",
};

export default function App() {
    return (
        <RebaseFirebaseApp
            name="My Admin"
            firebaseConfig={firebaseConfig}
            collections={[/* your collections */]}
            signInOptions={["google.com"]}
        />
    );
}
```

## Related Packages

- `@rebasepro/cms` — Admin panel UI (Scaffold, Drawer, SideDialogs)
- `@rebasepro/app` — Core framework (Rebase provider, routing)
- `@rebasepro/common` — Shared data utilities
- `@rebasepro/types` — Shared type definitions
- `@rebasepro/ui` — UI component library
