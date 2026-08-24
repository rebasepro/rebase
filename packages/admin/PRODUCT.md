# Product

<!-- impeccable:product-schema 1 -->

`@rebasepro/admin` — the CMS layer of Rebase. Inherits
[`/PRODUCT.md`](../../docs/PRODUCT.md) for shared Rebase truth. This file records only
what is specific to the panel.

## Platform

web

## Users

Two people use this package, and they are not the same person:

1. **The operator** — the editor, ops, or support person the developer hands the
   panel to. They live in it daily, on production data. They did not choose
   Rebase, will not read its docs, and judge it against the spreadsheet they were
   using before. Speed, scanability, undo-ability, and not being surprised matter
   more to them than anything expressive.
2. **The developer who configures it** — writes the collection definitions,
   builds custom fields and views in React, and decides what the operator sees.
   They are a user of the extension surface, not of the panel's chrome.

The panel answers to the operator. The developer is served by making that
possible.

## Product Purpose

Render a usable back-office directly from the collection definitions the backend
already has — no second data model, no separate admin schema. It is the optional
layer of the product: a React app talking to the same public API under the same
RLS policies, which can be added, skipped, or deleted without the API response
moving.

Success is an operator managing production records without a developer in the
loop, and a developer able to extend the panel with arbitrary React rather than
being confined to pre-built widgets.

## Operating Context

- Long sessions on large real tables. The primary view is a **virtualized
  spreadsheet** with inline editing, column reordering, drag-and-drop, filtering,
  sorting, text search, and realtime updates — alongside card grid, list, and
  arbitrary custom React views.
- Editing happens in stacked **side-panel dialogs** (`SideDialogs`) over the
  collection view, not on separate pages, so the operator keeps their place.
- A block editor (ProseMirror), kanban boards with fractional-index ordering, and
  import/export in CSV, JSON, and Excel are part of daily work.
- The panel ships two modes — content and admin (`AdminModeSyncer`) — plus a
  visual collection/schema editor for changing the model from the UI.
- Runs at `:5173` in development against the API on `:3001`; auth-gated by
  `RebaseAuthGate`, laid out as drawer + app bar + scaffold.

## Capabilities and Constraints

- Sits on `@rebasepro/app` (runtime hooks and providers) and `@rebasepro/ui`
  (design system). It does not own primitives — see the UI coherency rule below.
- Peer deps: React `>=19.2.7`, `react-dom`, `react-router` `^8`. Published MIT at
  `0.13.x`; the package ships `src` as well as `dist`.
- **Everything the panel shows is already filtered by Postgres RLS.** The panel
  is not an authorization layer and must never present itself as one; an empty
  view can mean "no rows visible to you", and that distinction is the operator's
  problem to understand.
- **UI coherency is an enforced project rule** (root `AGENT.md`): new views use
  `@rebasepro/ui` components rather than raw HTML or ad-hoc classes, and are
  built against an existing reference view for spacing, typography, and patterns.
- Product UI must not use type below `text-xs` (12px). The sub-`xs` tier in the
  token file is marketing-only.
- Extensibility is a headline promise: "if you can build it in React, you can
  build it in Rebase". Custom fields, custom collection views, and custom actions
  are first-class, so panel chrome must not assume it owns the content area.
- Terminology: *collection*, *snapshot* (a record), *side dialog*, *content mode*
  / *admin mode*.

## Brand Commitments

Inherits the root record. Panel-specific: the panel is positioned as the
*optional* layer — its own copy and empty states must not imply the backend needs
it.

## Evidence on Hand

- Live at `demo.rebase.pro`; real screenshots at `https://rebase.pro/img/`.
- `app/` is a runnable example app wired to this package.
- The package README enumerates the actual public exports and is current.
- **Absences:** no usability research, no operator interviews, no analytics on
  in-panel behaviour. Do not cite any.

## Product Principles

1. **The operator's day beats the demo screenshot.** Optimise for the hundredth
   hour in the panel, not the first minute.
2. **Density is a feature.** This is a data tool; scanability and rows-per-screen
   outrank breathing room.
3. **Never lose the operator's place.** Editing happens over the list, not away
   from it.
4. **Consistency is not negotiable per view.** A new view matches the system or
   it is wrong — there is no local exception.
5. **Leave room for someone else's React.** Custom fields and views are the
   product, not an escape hatch.

## Accessibility & Inclusion

Inherits the root record. Panel-specific: keyboard operation of the spreadsheet
view is load-bearing for operators who work in it all day, and Radix primitives
must keep carrying the focus and ARIA semantics rather than being restyled around.
