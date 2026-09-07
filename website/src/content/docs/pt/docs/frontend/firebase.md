---
sourceHash: 619a84a6bea05de9
title: Firebase
sidebar_label: Firebase
description: "@rebasepro/firebase runs the Rebase admin panel against Firestore, Firebase Auth and Firebase Storage — a client-side adapter, with no Rebase server involved."
---

:::note[Esta página está disponível apenas em inglês]
A tradução está pendente. O conteúdo abaixo está em inglês.
:::

`@rebasepro/firebase` points the Rebase admin panel at Firebase. Your
collections describe Firestore documents, and the panel reads and writes them
through the Firebase SDK.

:::caution[Experimental, and structurally different from the rest of Rebase]
This is a **client-side adapter**. There is no Rebase server in the picture: the
browser talks to Firebase directly, so everything Rebase's backend provides —
row-level security, the REST API, the generated SDK, functions, crons, the
storage access model — is not part of this arrangement.

Authorization is **Firebase Security Rules**, written and deployed in Firebase.
Rebase's `securityRules` on a collection do not apply.
:::

## Installation

```bash
pnpm add @rebasepro/firebase firebase
```

Peer dependencies: `firebase` (10, 11 or 12), `react` ≥ 19, `react-dom` ≥ 19, and
optionally `typesense` for text search.

## What it gives you

- **`RebaseFirebaseApp`** — a complete admin app: Firebase Auth login, routing,
  and CRUD over Firestore built from your collection definitions.
- **Hooks per service** — auth, Firestore, storage, App Check, user management.
- **Text search adapters** — Algolia, Typesense, Pinecone, or local.

```tsx title="src/App.tsx" no-verify
import { RebaseFirebaseApp } from "@rebasepro/firebase";

export default function App() {
    return <RebaseFirebaseApp
        name="My Project"
        firebaseConfig={firebaseConfig}
        collections={[posts, authors]}
    />;
}
```

A working example lives in [`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).

## What does not carry over

Everything on this site that describes the Rebase **backend** describes the
PostgreSQL (or MongoDB) path, not this one:

| | |
|---|---|
| Row-level security | Firebase Security Rules instead, written in Firebase |
| REST API and generated SDK | Absent — the browser uses the Firebase SDK |
| Functions and crons | Cloud Functions for Firebase instead |
| Storage access model | Firebase Storage rules instead |
| Studio, `rls-check`, migrations | Postgres features; not applicable |

## Choosing it

Take this when you already have a Firebase project and want a better admin panel
over it. If you are choosing a backend rather than adapting to one you have,
the [PostgreSQL path](/docs/getting-started/quickstart/) is the one the rest of
this documentation is about.
