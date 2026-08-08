# Rebase SDK Demo

A sample React + Vite app demonstrating the `@rebasepro/client` SDK.

## Features

- **Authentication** — Login / Register using the SDK's auth client
- **Collection Browsing** — Navigate Authors, Posts, Tags, Profiles
- **CRUD Operations** — Create, edit, delete records via the SDK
- **Pagination** — Server-side pagination with page navigation
- **Live queries** — Lists are driven by `observe()`, so writes appear without a refetch
- **Offline & local-first sync** — `offline: true`, with a sync pill and a switch that cuts the network
- **Dark Theme** — follows the Rebase UI design language (blue primary, neutral surfaces)

## Trying offline

Hit **Simulate offline** in the sidebar. It makes every request fail the way a
dead network does, which is what the SDK's offline engine keys on.

With it on: lists keep rendering from the local database (the page subtitle says
so), edits apply instantly and the sync pill counts what is unsaved. Hit
**Reconnect** and the queue replays on its own — no refetch, no reload.

## Prerequisites

Install the workspace once from the repo root, then start the backend:

```bash
# From the repo root
pnpm install
cd app
pnpm dev --backend-only --port 3001
```

The demo falls back to `http://localhost:3001` when `VITE_API_URL` is unset, and
`rebase dev` otherwise picks a deterministic per-project port in 3001–3999 — hence
the explicit `--port 3001` above. To point the demo somewhere else instead, set
`VITE_API_URL` when starting it.

## Running

This example is a workspace package (`sdk-demo`), so its `@rebasepro/client`
dependency resolves through pnpm — `npm install` inside this folder cannot
resolve `workspace:*` and fails.

```bash
# From the repo root
pnpm --filter sdk-demo dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Default Credentials

The demo pre-fills `admin@demo.com` / `admin123`. These must exist in your backend's auth database.

## How It Works

```
┌─────────────┐     HTTP/WS     ┌──────────────┐
│  React App  │ ◄──────────────►│   Backend    │
│  (Vite)     │                 │  (Port 3001) │
│             │  @rebasepro/    │              │
│  hooks.ts   │  client SDK     │  REST: /api  │
│  App.tsx    │                 │  WS: :3001   │
└─────────────┘                 └──────────────┘
```

### Key Files

| File | Description |
|------|-------------|
| `src/client.ts` | SDK initialization with `createRebaseClient()` |
| `src/hooks.ts` | `useAuth()` and `useCollection()` React hooks |
| `src/App.tsx` | Full UI with auth, sidebar, table, CRUD dialogs |
