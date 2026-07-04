# @rebasepro/plugin-data-enhancement

AI-powered data autofill and text autocomplete plugin for Rebase.

## Installation

```bash
pnpm add @rebasepro/plugin-data-enhancement
```

**Peer dependencies:** `react >= 19.0.0`, `react-dom >= 19.0.0`, `react-router >= 6.28.0`, `react-router-dom >= 6.28.0`

## What This Package Does

This plugin adds AI-powered capabilities to the Rebase admin panel:

- **Form autofill** — An "Enhance" action button injected into snapshot forms that uses AI to suggest and fill field values based on collection schema and existing data.
- **Editor autocomplete** — A streaming text autocomplete controller for rich text editors, powered by an AI backend.

It registers as a standard `RebasePlugin`, injecting UI slots and providers automatically.

## Key Exports

| Export | Type | Description |
|---|---|---|
| `useDataEnhancementPlugin` | Hook | Creates the plugin. Returns a `RebasePlugin` to pass to your app's `plugins` array |
| `DataEnhancementPluginProps` | Type | Configuration options for the plugin |
| `useEditorAIController` | Hook | Returns an `EditorAIController` with a streaming `autocomplete` method for rich text editors |

### `DataEnhancementPluginProps`

| Prop | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | Built-in default key | API key for the data enhancement service |
| `getConfigForPath` | `(props: { path, collection, user }) => boolean` | — | Return `false` to disable enhancement for specific paths |
| `host` | `string` | — | Custom API host (development only) |

## Quick Start

```tsx
import { useDataEnhancementPlugin } from "@rebasepro/plugin-data-enhancement";

// In your app setup:
const dataEnhancementPlugin = useDataEnhancementPlugin({
    getConfigForPath: ({ path, collection }) => {
        // Disable for certain collections
        return collection.name !== "system_logs";
    }
});

// Pass to your Rebase app:
<RebaseFirebaseApp
    plugins={[dataEnhancementPlugin]}
    // ...other props
/>
```

### Editor AI Autocomplete

```tsx
import { useEditorAIController } from "@rebasepro/plugin-data-enhancement";

const aiController = useEditorAIController({
    getAuthToken: () => firebaseUser.getIdToken()
});

// Use in a rich text editor:
await aiController.autocomplete(
    "The quick brown",   // text before cursor
    " over the fence",   // text after cursor
    (delta) => {         // streaming callback
        appendText(delta);
    }
);
```

## Related Packages

- `@rebasepro/admin` — The admin panel this plugin extends
- `@rebasepro/core` — Core framework providing the plugin system
- `@rebasepro/types` — Shared types (`RebasePlugin`, `CollectionConfig`, etc.)
