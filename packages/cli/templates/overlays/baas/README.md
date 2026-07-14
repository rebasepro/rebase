# {{PROJECT_NAME}}

A headless Rebase backend: a REST API, auth, storage, realtime and backups over
your PostgreSQL database.

There are no collection files. The server reads your database schema at boot and
serves every table, so the API follows your migrations — change the schema and
the endpoints change with it.

## Run it

```bash
pnpm install
pnpm dev
```

- API: `http://localhost:3001/api/data/<table>`
- Docs: `http://localhost:3001/api/swagger`
- Health: `http://localhost:3001/health`

Set `DATABASE_URL` in `.env` to point at your database.

## Use it from an app

```ts
import { createRebaseClient } from "@rebasepro/client";

const rebase = createRebaseClient({ baseUrl: "http://localhost:3001" });
const posts = await rebase.data.collection("posts").find();
```

## Adding an admin UI later

Nothing here locks you out of it. Switch `mode` to `"cms"` in
`backend/src/index.ts`, add a `config/collections` directory, and add a frontend
that renders them. See MODULAR-ARCHITECTURE.md in the Rebase repo for the three
adoption modes.
