# @rebasepro/cms-types

Type definitions for the Rebase CMS: collection and property shapes, the entity
and navigation models, and the translation keys the admin panel renders.

This package is **mostly types** — the vocabulary that the runtime, the generated
SDK and the admin panel all agree on, kept in one package so a change to a
collection's shape cannot mean one thing to the server and another to the panel.
The little that executes is there for the same reason: `defineCollection`, which
type-checks a collection's `admin` block, and the key lists (`ADMIN_PROPERTY_KEYS`,
`ADMIN_COLLECTION_KEYS`) that tell an `admin` key from a core one.

The runtime that consumes these types is
[`@rebasepro/cms`](https://www.npmjs.com/package/@rebasepro/cms). A project that
`rebase init` scaffolds depends on this package directly: its collection files
import `defineCollection` from here.

## Installation

```bash
npm install @rebasepro/cms-types
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

## Usage

```ts
import { defineCollection } from "@rebasepro/cms-types";

export const posts = defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", validation: { required: true } },
        body: { name: "Body", type: "string", admin: { multiline: true } }
    }
});
```

## Documentation

- [Collections](https://rebase.pro/docs/collections)
- [Full documentation](https://rebase.pro/docs)

## License

MIT
