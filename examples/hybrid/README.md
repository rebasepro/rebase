# Hybrid example: Postgres tables and a Firestore collection

One Rebase admin over two databases. Customers and orders are Postgres tables
the Rebase backend serves under row-level security; live events are a
Firestore collection the browser reads and writes straight from Firebase. Each
side points at the other, and the admin follows the reference to the right
database.

## What lives where

| File | Side | What it is |
|---|---|---|
| `backend/schema/customers.ts` | backend | `defineTable("customers")` — a Postgres table, served at `/api/data/customers` |
| `backend/schema/orders.ts` | backend | `defineTable("orders")` — a Postgres table; `sourceEventId` is a text column holding a Firestore document id |
| `backend/schema/index.ts` | backend | every table the backend serves, and `defaultRls` for `rls: "inherit"` |
| `frontend/src/cms/orders.tsx` | browser | `customizeTable<typeof orders>("orders", …)` — labels, enum colours, and `referenceTo: "fs_events"` on `sourceEventId` |
| `frontend/src/cms/events.ts` | browser | `defineFirestoreCollection({ slug: "fs_events", path: "events", … })` — its `customerId` targets the `customers` table |
| `frontend/src/App.tsx` | browser | `<Rebase client dataSources={[firestoreSource]}>` and `<RebaseCMS tableCustomizations externalCollections>` |
| `frontend/src/firebase.ts` | browser | the Firebase app, from `.env` |

The backend knows only `backend/schema`. It never sees Firestore, and nothing
Firestore-shaped is in `@rebasepro/server`: the Firestore collection is a
frontend declaration (`@rebasepro/firebase`), protected by your Firestore
security rules. `customers` has no customization file and is shown with the
defaults the admin derives from the table.

## The two references

- **Firestore → Postgres.** An event's `customerId` is a `reference` field with
  `target: "customers"`. Opening it, the admin routes the lookup to the Rebase
  backend, and the customer comes back under Postgres row-level security. The
  document stores the customer's id as a plain string, so
  `where("customerId", "==", id)` finds it.
- **Postgres → Firestore.** `orders.sourceEventId` is `col.text()` to Postgres.
  `customizeTable` marks it `referenceTo: "fs_events"`, so the admin draws it
  as a reference chip and reads the preview from Firestore.

## Run it

```bash
pnpm install                         # once, from the repository root
cp examples/hybrid/.env.example examples/hybrid/.env   # then fill in your Firebase project
cd examples/hybrid
pnpm dev                             # rebase dev: a managed Postgres, the backend and the admin
```

Without `DATABASE_URL`, `rebase dev` starts a managed development database and
creates the two tables from `backend/schema`. Sign in, create a customer, add a
document under `events` in Firestore with that customer's id in `customerId`,
and open it from **Live events (Firestore)**.

`pnpm typecheck` checks both halves against the workspace's source; it is what
`pnpm check:examples` runs here.
