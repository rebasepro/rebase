# @rebasepro/cms-types

Type definitions for the Rebase CMS: collection and property shapes, the entity
and navigation models, and the translation keys the admin panel renders.

This package contains **types only**. Nothing here executes — it is the
vocabulary that the runtime, the generated SDK and the admin panel all agree on,
kept in one package so a change to a collection's shape cannot mean one thing to
the server and another to the panel.

The runtime that consumes these types is
[`@rebasepro/cms`](https://www.npmjs.com/package/@rebasepro/cms). If you are
building an app, that is the package you want; you will normally get this one as
a transitive dependency rather than installing it yourself.

## Installation

```bash
npm install @rebasepro/cms-types
```

## Usage

```ts
import type { CollectionConfig } from "@rebasepro/cms-types";

export const posts: CollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", validation: { required: true } },
        body: { name: "Body", type: "string", admin: { multiline: true } }
    }
};
```

## Documentation

- [Collections](https://rebase.pro/docs/backend/collections)
- [Full documentation](https://rebase.pro/docs)

## License

MIT
