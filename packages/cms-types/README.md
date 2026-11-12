# @rebasepro/cms-types

Type definitions for the Rebase CMS: what `customizeTable` accepts (the
table- and field-level presentation options), the entity actions, views and
navigation models, the UI-preference shapes, and the translation keys the
admin panel renders.

This package is **types**. The tables themselves are declared in the backend,
with `defineTable` from `@rebasepro/server/schema`; the admin panel renders
every table the server serves with no configuration, and a project's
`frontend/src/cms/*.tsx` files state how one table differs from that default,
with `customizeTable` from [`@rebasepro/cms`](https://www.npmjs.com/package/@rebasepro/cms),
typed by the interfaces here (`TableCustomizationOptions`, `FieldOptions`,
`TableEntityAction`, `TableEntityView`, …).

## Installation

```bash
npm install @rebasepro/cms-types
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

## Usage

```tsx
// frontend/src/cms/posts.tsx
import { customizeTable } from "@rebasepro/cms";
import type { TableEntityAction } from "@rebasepro/cms-types";
import type { posts } from "../../../backend/schema/posts";

const archive: TableEntityAction = {
    key: "archive",
    name: "Archive",
    onClick: async ({ id, context }) => {
        if (id !== undefined) await context?.data.table("posts").update(id, { status: "archived" });
    }
};

export const postsCms = customizeTable<typeof posts>("posts", {
    icon: "Article",
    fields: { body: { multiline: true } },
    entityActions: [archive]
});
```

## Documentation

- [Customizing a table](https://rebase.pro/docs/frontend/customize-table/)
- [Full documentation](https://rebase.pro/docs)

## License

MIT
