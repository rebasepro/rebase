---
title: Firestore beside Postgres
sidebar_label: Firebase
description: "Show Firestore collections in the CMS next to your Postgres tables: defineFirestoreCollection, useFirestoreDataSource, externalCollections, and references that cross between Firestore documents and Postgres rows in both directions."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

`@rebasepro/firebase` lets the CMS read and write Firestore collections in the
browser, through the Firebase SDK, next to the tables your Rebase backend
serves. One navigation, one search, one reference picker: an operator does not
need to know which engine a record lives in.

Firestore is a frontend concern here. The backend knows nothing about it, and a
Firestore collection is declared in `frontend/src/cms/`, never in
`backend/schema`.

:::caution[Firestore collections are read directly from the browser]
Nothing between the browser and Firestore is Rebase's: row-level security, the
REST API, the generated SDK, functions, crons and the storage access model do
not apply to a Firestore collection. Who may read and write its documents is
decided by **Firebase Security Rules**, written and deployed in Firebase.
:::

## Installation

<span class="since-badge" data-since="0.31">Since 0.31</span>

```bash
pnpm add @rebasepro/firebase firebase
```

Peer dependencies: `firebase` (10, 11 or 12), `react` ≥ 19, `react-dom` ≥ 19, and
optionally `typesense` for text search.

## Declare a Firestore collection

<span class="since-badge" data-since="0.31">Since 0.31</span>

```ts
// frontend/src/cms/events.ts
import { defineFirestoreCollection } from "@rebasepro/firebase";

const eventTraces = defineFirestoreCollection({
    slug: "fs_event_traces",
    path: "traces",
    name: "Traces",
    dataSource: "firestore",
    fields: {
        step: { name: "Step", type: "string" },
        at:   { name: "At", type: "date" },
    },
});

export const firestoreEvents = defineFirestoreCollection({
    slug: "fs_events",
    path: "events",
    name: "Live Events (Firestore)",
    dataSource: "firestore",
    fields: {
        type:       { name: "Event Type", type: "string", required: true },
        payload:    { name: "Payload", type: "map" },
        // A reference to a row of the `customers` Postgres table.
        customerId: { name: "Customer", type: "reference", target: "customers" },
    },
    subcollections: () => [eventTraces],
});
```

| Key | What it does |
|---|---|
| `slug` | The collection's name in the panel: its URL and the target other references name. It must differ from every table's slug. |
| `path` | Where the documents live in Firestore, when it is not the slug. |
| `name` | The label in the navigation. |
| `dataSource` | The key of the `<Rebase dataSources>` entry that reads it: the `key` given to `useFirestoreDataSource`. Leave it out only when Firestore is the default source. |
| `databaseId` | A Firestore database other than the default one. |
| `fields` | The document's fields, by key. |
| `subcollections` | Collections nested under each document, shown as tabs of the document and stored at `<path>/<id>/<child path>`. Each is a `defineFirestoreCollection` too. |

A field's `type` is one Firestore stores: `string`, `number`, `boolean`,
`date`, `geopoint`, `map`, `array`, `reference` or `binary`. `required: true`
is short for a required field. A `reference` names the collection it points at
with `target`, on any data source. A `relation` or a `vector` belongs to a
Postgres table and is refused here, as are `properties` and `engine`.

The document type is inferred from `fields`, so the collection's own options are
checked against its keys. Presentation options a Firestore collection takes
(icon, group, views) are those of the panel's collection model, not
`customizeTable`, which is for tables.

## Mount it beside the tables

<span class="since-badge" data-since="0.31">Since 0.31</span>

Two steps: register Firestore as a data source on `<Rebase>`, and pass the
collection to `<RebaseCMS externalCollections>`.

```tsx
// frontend/src/App.tsx
import React from "react";
import { initializeApp } from "firebase/app";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { useFirestoreDataSource } from "@rebasepro/firebase";
import { postsCms } from "./cms/posts";
import { customersCms } from "./cms/customers";
import { firestoreEvents } from "./cms/events";

const rebaseClient = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });
const firebaseApp = initializeApp({ projectId: "acme-ops", apiKey: "…", appId: "…" });

export function App() {
    const authController = useRebaseAuthController({ client: rebaseClient });
    const firestoreSource = useFirestoreDataSource({ key: "firestore", firebaseApp });

    return (
        <Rebase
            client={rebaseClient}            // the default data source: the Postgres backend
            dataSources={[firestoreSource]}  // a second, direct source: Firestore
            authController={authController}
        >
            <RebaseAuth/>
            <RebaseCMS
                tableCustomizations={[postsCms, customersCms]}
                externalCollections={[firestoreEvents]}
            />
            <RebaseStudio/>
            <RebaseShell title="Acme Ops"/>
        </Rebase>
    );
}
```

The panel shows every table the backend serves, with `postsCms` and
`customersCms` applied, and then `fs_events`, in the same navigation. A slug
names one collection: an external collection with a table's slug is refused,
naming both (see [collisions](/docs/frontend/#rebasecms-props)).

`useFirestoreDataSource` returns the same object on every render while its
options are the same, so it can sit inline in `dataSources`. Its options:

| Option | What it does |
|---|---|
| `key` | **Required.** What a collection's `dataSource` names. |
| `firebaseApp` | The initialised Firebase app. Until it is set, the source reports itself not ready. |
| `databaseId` | The Firestore database, when it is not the app's default. A collection's own `databaseId` wins. |
| `label` | A label for the source, where the panel names data sources. |
| `textSearchControllerBuilder` | Answers text searches with document ids (Algolia, Typesense, Pinecone, Rebase search). |
| `localTextSearchEnabled` | Search in the browser over the documents themselves when no controller covers a collection. Reads every document: fine for a small collection. |
| `firestoreIndexesBuilder` | The composite indexes the database has, so the panel offers only the filters and sorts Firestore can answer. |

It also registers what Firestore can do, so its collections are never offered
relation tabs or filters Firestore cannot run.

## Editing it in the collection editor

<span class="since-badge" data-since="0.31">Since 0.31</span>

In development the [collection editor](/docs/studio/#collection-editor) edits
Firestore collections too: a save rewrites the collection's
`defineFirestoreCollection({...})` call in `frontend/src/cms` in place,
changing only what you edited. Functions, custom components, comments and
imports stay as written; fields defined in code show as read-only. In
production Firestore collections are read-only in the editor. To delete one,
remove its file and its `externalCollections` entry.

## From Firestore to a table

<span class="since-badge" data-since="0.31">Since 0.31</span>

`customerId: { type: "reference", target: "customers" }` points at the
`customers` table. When an operator opens an event and clicks the customer chip,
or picks a customer, the lookup is routed by the target's data source: the
`customers` collection is a table, so it goes to the Rebase backend, under the
caller's row-level security.

A reference to a record on another data source is stored in the document as the
record's **id**, a string, so a Firestore query for `customerId == "42"`
matches it. A reference to a document in the same Firestore database is stored
as a Firestore `DocumentReference`, as Firestore expects.

## From a table to Firestore

<span class="since-badge" data-since="0.31">Since 0.31</span>

A table column that holds a Firestore document's id is a plain text column on
the backend. `referenceTo` in its `customizeTable` makes it a reference in the
panel:

```ts
// backend/schema/customers.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const customers = defineTable("customers", {
    columns: {
        id:             col.uuid().primaryKey().defaultRandom(),
        name:           col.text().notNull(),
        // The id of this customer's document in the Firestore `fs_events` collection.
        lastEventDocId: col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/customers.tsx
import { customizeTable } from "@rebasepro/cms";
import type { customers } from "../../../backend/schema/customers";

export const customersCms = customizeTable<typeof customers>("customers", {
    fields: {
        lastEventDocId: { name: "Last event", referenceTo: "fs_events" },
    },
});
```

The field is drawn and picked as a reference to `fs_events`, and opening it
reads the document through `firestoreSource`. The column still stores the id as
text, and the backend still sees a text column. `referenceTo` applies to text
and uuid columns; on any other type it is skipped, with a warning in
development.

## A Firestore-only panel

<span class="since-badge" data-since="0.31">Since 0.31</span>

`RebaseFirebaseApp` is a complete panel over Firebase alone: Firebase Auth
sign-in, routing and the collections you pass, with no Rebase backend at all.

```tsx
import React from "react";
import { RebaseFirebaseApp, defineFirestoreCollection } from "@rebasepro/firebase";

const firebaseConfig = { projectId: "acme-ops", apiKey: "…", appId: "…" };

// No `dataSource`: here Firestore is the default source.
const events = defineFirestoreCollection({
    slug: "events",
    name: "Events",
    fields: {
        type: { name: "Event Type", type: "string", required: true },
    },
});

export default function App() {
    return <RebaseFirebaseApp
        name="My Project"
        firebaseConfig={firebaseConfig}
        collections={[events]}
    />;
}
```

A working example lives in
[`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).
In that arrangement nothing on the backend pages of this site applies: Firebase
Security Rules replace row-level security, the Firebase SDK replaces the REST
API and the generated SDK, Cloud Functions replace functions and crons, and the
Studio and `rls-check` have nothing to inspect.

## Related

- [Tables in the CMS](/docs/collections/): what the Postgres side shows with no configuration
- [customizeTable](/docs/frontend/customize-table/): `referenceTo` and every other table option
- [Frontend overview](/docs/frontend/): `<Rebase dataSources>` and `<RebaseCMS>` props
- [Authentication & Login](/docs/frontend/authentication/): the sign-in surface
