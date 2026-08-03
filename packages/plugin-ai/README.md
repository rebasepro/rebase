# @rebasepro/plugin-ai

AI-powered data autofill and text autocomplete plugin for Rebase.

## Installation

```bash
pnpm add @rebasepro/plugin-ai
```

**Peer dependencies:** `react >= 19.2.7`, `react-dom >= 19.2.7`, `react-router ^8`

## What This Package Does

This plugin adds AI-powered capabilities to the Rebase admin panel:

- **Form autofill** — An "Autofill" action in the entity form footer that proposes values from the collection schema, whatever is already in the record, and an optional instruction.
- **Editor autocomplete** — A streaming inline continuation for the rich text editor.

It registers as a standard `RebasePlugin`, injecting UI slots and providers automatically.

### Autofill proposes; it does not edit

Clicking **Autofill** opens a review. Fields stream into that list as the model
writes them, so a long run shows progress — but the record is not touched. Each row
shows the proposed value, and the current value struck through when the proposal
would replace one. Untick anything you don't want, then **Apply** writes the rest in
a single step. **Discard** leaves the record exactly as it was.

This is a deliberate change from the FireCMS-era behaviour, where generated text was
streamed directly into the live form fields. That approach mutated the record before
anyone had agreed to it, showed half-written sentences that read as bugs, and relied
on heuristics to guess whether each token should append to or replace what you had
already typed — with no way back but retyping.

## How it reaches a model

The plugin talks to a small hosted service that Rebase runs and pays for (Gemini 3.6 Flash, behind Rebase’s own credits). There is
**nothing to configure and no API key to obtain** — install the plugin, mount it, done.

Two consequences worth knowing:

- **Requests are anonymous.** No auth token of any kind leaves your app. The service
  cannot verify a self-hosted backend's JWT (you sign it with your own secret), so
  asking for one would only hand a live credential to a third party that has no use
  for it. Cost is bounded by rate limits and a daily ceiling instead.
- **Your collection schema and the record's current values are sent** with each
  autofill request, because the service has no other way to know the shape of what
  it is filling. If that is not acceptable for your data, set `endpoint` and run the
  service yourself — the reference implementation is `saas/backend/functions/ai.ts`
  in the Rebase repository, and the wire format is documented in `src/api.ts`.

The plugin renders nothing until the service's `GET /status` reports itself
available, so an unreachable host or an exhausted daily quota means no Autofill
button — never a button that fails when clicked.

## Key Exports

| Export | Type | Description |
|---|---|---|
| `useDataEnhancementPlugin` | Hook | Creates the plugin. Returns a `RebasePlugin` to pass to your app's `plugins` array |
| `DataEnhancementPluginProps` | Type | Configuration options for the plugin |
| `useEditorAIController` | Hook | Returns an `EditorAIController` with a streaming `autocomplete` method for rich text editors |

### `DataEnhancementPluginProps`

| Prop | Type | Default | Description |
|---|---|---|---|
| `getConfigForPath` | `(props: { path, collection, user }) => boolean` | — | Return `false` to disable autofill for specific paths |
| `endpoint` | `string` | Rebase's hosted service | Base URL of the AI service. Point it at your own deployment to keep generation inside your infrastructure |

## Quick Start

```tsx
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const dataEnhancementPlugin = useDataEnhancementPlugin({
    getConfigForPath: ({ collection }) => collection.name !== "system_logs"
});

// Pass to your Rebase app:
// <Rebase plugins={[dataEnhancementPlugin]} ... />
```

### Self-hosting the service

```tsx
const dataEnhancementPlugin = useDataEnhancementPlugin({
    endpoint: "https://ai.internal.example.com"
});
```

Your endpoint needs to answer `GET /status`, `POST /autofill` (SSE), `POST /autocomplete`
(SSE) and `POST /prompts`.

### Editor AI Autocomplete

```tsx
import { useEditorAIController } from "@rebasepro/plugin-ai";

const aiController = useEditorAIController();

// Use in a rich text editor:
await aiController.autocomplete(
    "The quick brown",   // text before cursor
    " over the fence",   // text after cursor
    (delta) => {         // streaming callback
        appendText(delta);
    }
);
```

## Migrating from the FireCMS-era plugin

The `apiKey` and `host` props are gone. `apiKey` shipped a hardcoded key in the
published package and pointed at a service that no longer exists; `host` is now
`endpoint` and is a supported production option rather than a development-only
escape hatch. `useEditorAIController` no longer takes `getAuthToken` — it needs no
token.

## Related Packages

- `@rebasepro/admin` — The admin panel this plugin extends
- `@rebasepro/app` — Core framework providing the plugin system
- `@rebasepro/types` — Shared types (`RebasePlugin`, `CollectionConfig`, etc.)
