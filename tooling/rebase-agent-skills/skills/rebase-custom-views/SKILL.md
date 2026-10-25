---
name: rebase-custom-views
description: Build a custom back-office screen inside the Rebase admin instead of a separate app — dashboards, review queues, dispatch boards, record summaries, custom field editors. Covers `rebase generate view`, top-level screens (AppView), record tabs (admin.entityViews), field widgets (admin.Field / admin.Preview), and the design tokens that make a view look native. Use it whenever a screen is not a plain table, form or board.
---

# Custom views in the Rebase admin

Most back-office screens are a table, a form or a board, and the admin draws
those from the collection. For the rest, **write a React component inside the
admin, not a separate app.** Inside the admin the component already has the
signed-in user, the security rules (every read and write goes through the
server, so RLS and collection callbacks apply), the sidebar, the router, the UI
kit and the data layer. A standalone Next.js app has to rebuild every one of
those and keep them in step.

A custom view is about a hundred lines. There are three places to put one:

| You want | Put a component in | It receives | It renders |
|---|---|---|---|
| A screen in the sidebar | `<RebaseCMS views={AppView[]}>` | nothing — read with hooks | full page at `/<slug>`, inside the shell |
| A tab on every record of a collection | the collection's `admin.entityViews` | `EntityCustomViewParams` | a tab in the record's tab strip, in the side panel and the full-page record |
| A different editor for one field | the property's `admin.Field` (and `admin.Preview`) | `FieldProps` / `PropertyPreviewProps` | in the form, and in table cells and cards |

Other places (toolbar buttons, view modes, slots, replacing built-in parts) are
in the `rebase-customize-admin` skill.

## Scaffold first

```bash
rebase generate view orders-board
rebase generate view audit-trail --collection orders
```

The first writes `frontend/src/views/OrdersBoardView.tsx`, lists it in
`frontend/src/views/index.ts` (an `AppView[]`), and on its first run wires
`App.tsx` to pass that list as `<RebaseCMS views={views}>`. The second writes
`frontend/src/views/AuditTrailView.tsx` and adds an entry to the `orders`
collection's `admin.entityViews` that points at the file by path. `--name`
sets the label, `--icon` a Lucide icon for the sidebar, `--dry-run` lists the
changes without making them, `--force` replaces an existing view file.

The frontend is wherever `rebase.json` mounts the CMS (the static app with a
`cms` key), which is `frontend/` in a project from `rebase init`. A headless
project has no admin and the command refuses.

Open the generated file and replace the body. It already imports the kit and
the hooks and compiles as written.

## A screen (`AppView`)

The component takes no props. Read what it needs with hooks; it renders inside
the admin's router, so links and `useUrlController().navigate(…)` work.

```tsx
// frontend/src/views/ReviewQueueView.tsx
import { useEffect, useState } from "react";
import type { Entity } from "@rebasepro/types";
import { useAuthController, useData, useSnackbarController } from "@rebasepro/app";
import { useSidePanel } from "@rebasepro/cms";
import { Button, Card, Chip, CircularProgressCenter, Container, Typography } from "@rebasepro/ui";

export function ReviewQueueView() {
    const data = useData();
    const { user } = useAuthController();
    const snackbar = useSnackbarController();
    const sidePanel = useSidePanel();
    const [rows, setRows] = useState<Entity[] | undefined>();

    useEffect(() => {
        // Live: re-runs when a matching row changes, through the same RLS as a read.
        return data.collection("posts")
            .where("status", "==", "review")
            .listen(({ data: found }) => setRows(found));
    }, [data]);

    const approve = async (row: Entity) => {
        await data.collection("posts").update(row.id, { status: "published" });
        snackbar.open({ type: "success", message: `Published “${String(row.values.title)}”` });
    };

    if (!rows) return <CircularProgressCenter/>;

    return (
        <Container maxWidth="4xl" className="py-8 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
                <Typography variant="h5">Review queue</Typography>
                <Chip size="small">{rows.length} waiting</Chip>
            </div>
            <Typography variant="body2" color="secondary">Reviewing as {user?.displayName ?? user?.email}</Typography>
            {rows.map(row => (
                <Card key={String(row.id)} className="p-4 flex items-center justify-between gap-4">
                    <Typography variant="subtitle2" className="truncate">{String(row.values.title)}</Typography>
                    <div className="flex gap-2 shrink-0">
                        <Button color="neutral" variant="outlined" onClick={() => sidePanel.open({ path: "posts", entityId: row.id })}>
                            Open
                        </Button>
                        <Button color="primary" onClick={() => approve(row)}>Publish</Button>
                    </div>
                </Card>
            ))}
        </Container>
    );
}

export default ReviewQueueView;
```

Register it in the screens list:

```tsx
// frontend/src/views/index.ts
import type { AppView } from "@rebasepro/cms-types";
import { ReviewQueueView } from "./ReviewQueueView";

export const views: AppView[] = [
    {
        slug: "review-queue",
        name: "Review queue",
        icon: "ListChecks",
        group: "Editorial",
        roles: ["editor", "admin"],
        view: ReviewQueueView
    }
];
```

`AppView` fields: `slug` (the path), `name` (sidebar label), `icon` (a Lucide
name such as `"ShoppingCart"`), `group` (sidebar section), `pinToBottom`,
`hideFromNavigation` (reachable by URL, not listed), `roles` (filtered out
entirely for anyone without one), `nestedRoutes` (also mounts `<slug>/*`), and
`view` — a component, or an element. Pass the component, not `<ReviewQueueView/>`:
it is then only built when someone opens the screen.

`App.tsx` hands the list to the admin once:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { collections } from "virtual:rebase-collections";
import { views } from "./views";

export const Admin = () => <RebaseCMS collections={collections} views={views}/>;
```

## A record tab (`admin.entityViews`)

The collection file is shared with the backend, so reference the component **by
path**, relative to the collection file. The backend never evaluates the string;
the admin's Vite plugin turns it into a lazy `import()` and renders the file's
**default export**.

```ts
// config/collections/orders.ts
import { defineCollection } from "@rebasepro/cms-types";

export default defineCollection({
    name: "Orders",
    singularName: "Order",
    slug: "orders",
    table: "orders",
    admin: {
        entityViews: [
            {
                key: "audit-trail",
                name: "Audit trail",
                Builder: "../../frontend/src/views/AuditTrailView"
            }
        ]
    },
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        status: {
            name: "Status",
            type: "string",
            enum: [
                { id: "pending", label: "Pending" },
                { id: "shipped", label: "Shipped" }
            ]
        },
        note: { name: "Note", type: "string" }
    }
});
```

Entry fields: `key` (unique on the record), `name` (tab label), `Builder`,
`icon`, and `position` — `"end"` (default, after the form) or `"start"` (before
it: a read-only cover of the record, with the form one tab to the right).
Never import the component into the collection file: the backend loads that
file too, and the import pulls React into it.

The component receives `EntityCustomViewParams`:

- `collection` — the resolved collection (`name`, `singularName`, `properties`, …);
- `entity` — the saved record (`id`, `values`), **absent while it is being created**;
- `modifiedValues` — the form's current values, unsaved edits included;
- `formContext` — the record's form: `setFieldValue(key, value)` edits a field
  (Save in the identity bar stores it, closing with an edit pending asks first),
  `disabled`, `readOnly` (no form behind it: writes throw), `isSaving`.

```tsx
// frontend/src/views/AuditTrailView.tsx
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import { Button, Card, Chip, Typography } from "@rebasepro/ui";

export function AuditTrailView({ collection, entity, modifiedValues, formContext }: EntityCustomViewParams) {
    if (!entity) {
        return (
            <div className="p-6">
                <Typography variant="body2" color="secondary">Save this {collection.singularName} first.</Typography>
            </div>
        );
    }
    const values = modifiedValues ?? entity.values;
    const shipped = values.status === "shipped";

    return (
        <div className="p-6 flex flex-col gap-4">
            <div className="flex items-center gap-2">
                <Typography variant="h6">Order {String(entity.id)}</Typography>
                <Chip size="small" colorScheme={shipped ? "greenLighter" : "orangeLighter"}>{String(values.status)}</Chip>
            </div>
            <Card className="p-4 flex flex-col gap-1">
                <Typography variant="caption" color="secondary">Note</Typography>
                <Typography variant="body2">{String(values.note ?? "—")}</Typography>
            </Card>
            {!shipped && !formContext.readOnly && (
                <div>
                    <Button color="neutral" variant="outlined" onClick={() => formContext.setFieldValue("status", "shipped")}>
                        Mark as shipped
                    </Button>
                </div>
            )}
        </div>
    );
}

export default AuditTrailView;
```

An entity view used by several collections can instead be registered once on
`<RebaseCMS entityViews={[{ key, name, Builder }]}>` and named by key from each
collection: `admin: { entityViews: ["audit-trail"] }`.

## A field widget (`admin.Field`, `admin.Preview`)

To change how one property is edited, point its `admin.Field` at a component,
by path as above. `admin.Preview` changes how it shows when not being edited
(table cells, cards, references); override one, the other, or both.
`customProps` is passed through untouched. (`admin.widget` is something else:
it only picks `"select"` or `"dialog"` for a relation.)

```ts
import { defineCollection } from "@rebasepro/cms-types";

export default defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        rating: {
            name: "Rating",
            type: "number",
            admin: {
                Field: "../../frontend/src/fields/RatingField",
                Preview: "../../frontend/src/fields/RatingPreview",
                customProps: { max: 5 }
            }
        }
    }
});
```

The component replaces the whole field: it draws the input, the label and the
error line (`error`, when `showError`) itself, as the built-in fields do;
validation stays with the form, which computes `error` from the property's
rules. `FieldProps` carries `value`, `setValue(value)`, `property`,
`propertyKey`, `disabled`, `error`, `showError`, `customProps`, and `context`
(the whole form: `values`, `setFieldValue`, `entityId`, …).

```tsx
// frontend/src/fields/RatingField.tsx
import type { FieldProps } from "@rebasepro/cms-types";
import type { NumberProperty } from "@rebasepro/types";
import { Button, Typography } from "@rebasepro/ui";

export default function RatingField({ value, setValue, property, disabled, customProps }: FieldProps<NumberProperty, { max: number }>) {
    const max = customProps?.max ?? 5;
    return (
        <div className="flex flex-col gap-1">
            <Typography variant="caption" color="secondary">{property.name}</Typography>
            <div className="flex gap-1">
                {Array.from({ length: max }, (_, i) => i + 1).map(star => (
                    <Button key={star} size="small" disabled={disabled}
                        color={value !== null && star <= value ? "primary" : "neutral"}
                        variant={value !== null && star <= value ? "filled" : "outlined"}
                        onClick={() => setValue(star === value ? null : star)}>
                        {star}
                    </Button>
                ))}
            </div>
        </div>
    );
}
```

```tsx
// frontend/src/fields/RatingPreview.tsx
import type { PropertyPreviewProps } from "@rebasepro/cms";
import type { NumberProperty } from "@rebasepro/types";
import { Typography } from "@rebasepro/ui";

export default function RatingPreview({ value, customProps }: PropertyPreviewProps<NumberProperty, { max: number }>) {
    const rating = typeof value === "number" ? value : 0;
    return <Typography variant="body2">{"★".repeat(rating)}{"☆".repeat((customProps?.max ?? 5) - rating)}</Typography>;
}
```

## Data, from inside a view

- **`useData()`** (`@rebasepro/app`): `useData().collection("orders")` has
  `find({ where, orderBy, limit, offset })`, `findById(id)`, `create(values, id?)`,
  `update(id, values)`, `delete(id)`, and the chained `.where(…).listen(cb)` for
  live results. Saves go through the server: callbacks and security rules apply.
  Do not `fetch` the REST API from admin code.
- **Rows are `Entity` objects**: fields on `row.values`, the id on `row.id`.
  Dates in `values` are `Date` objects, not strings.
- **`useAuthController()`**: `user` (`uid`, `displayName`, `email`, roles),
  sign-in and sign-out. **`useSnackbarController()`**: `open({ type, message })`.
- **`useSidePanel()`** (`@rebasepro/cms`): `open({ path, entityId })` opens a
  record in the side panel, with its form and its tabs. **`useUrlController()`**:
  `buildUrlCollectionPath(slug)` and `navigate(url)`.
- An aggregate over many rows belongs in a custom function on the server (see
  `rebase-custom-functions`), called from the view — not a loop over `find()`.

## Looking native

The admin is monochrome and drawn from `@rebasepro/ui`. A view that follows
these rules is indistinguishable from a built-in screen:

- **Kit components, not raw HTML.** `Typography` for every piece of text (never
  a bare `<h1>`/`<p>`/`<span>`), `Button`, `Card`, `Chip`, `Table` /
  `TableHeader` / `TableBody` / `TableRow` / `TableCell`, `Tabs` + `Tab`,
  `Sheet` (a panel from the side), `Dialog`, `TextField`, `Select`. Icons are
  Lucide names with an `Icon` suffix from `@rebasepro/ui` (`PlusIcon`).
- **Surfaces by role.** The screen already sits on `bg-surface-sheet`; do not
  paint it again. A card, row or menu is `bg-surface-card` (`Card` applies it);
  a neutral tile or chip `bg-surface-raised`; an inset region `bg-surface-field`;
  a hover on something transparent `hover:bg-surface-hover`. Never a
  `bg-white dark:bg-…` pair: the theme decides the value.
- **Lines.** `border border-hairline` around an object on a surface,
  `border-hairline-strong` on a floating one. No rule under a header that sits
  on the sheet.
- **Shape.** `rounded-xl` for a card or sheet, `rounded-lg` for a control or
  row highlight, `rounded-md` for a chip or tile. Never a pixel radius.
- **One primary action.** At most one `color="primary"` filled `Button` per
  screen; every other button is `color="neutral"`. Labels are sentence case.
- **Hue is information.** Colour is a dot, an icon or a tinted `Chip`
  (`colorScheme`), never decoration.

```tsx
import { Typography } from "@rebasepro/ui";

export function StatTile({ label, value }: { label: string; value: number }) {
    return (
        <div className="bg-surface-card border border-hairline rounded-xl p-4 flex flex-col gap-1">
            <Typography variant="caption" color="secondary">{label}</Typography>
            <Typography variant="stat">{value}</Typography>
        </div>
    );
}
```

`/debug/ui` in the example app shows every kit component in each state; the
`rebase-design-language` and `rebase-ui-components` skills go deeper.

## Before you call it done

- The frontend typechecks (`tsc` in the frontend workspace) — every example
  above compiles as written.
- `rebase dev`, then open `/<slug>` for a screen, or a record of the
  collection for a tab, signed in as a user with and without the role.
- A view that only reads is safe; one that writes relies on the collection's
  security rules, so check those cover the write (`rebase-security`).
