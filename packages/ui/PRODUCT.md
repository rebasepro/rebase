# Product

<!-- impeccable:product-schema 1 -->

`@rebasepro/ui` — the Rebase design system. Inherits
[`/PRODUCT.md`](../../docs/PRODUCT.md) for shared Rebase truth. This file records only
what is specific to the library.

## Platform

web

## Users

1. **Third-party developers building custom fields and views.** Confirmed as a
   primary audience: this is the library their custom fields are meant to be
   built with, and `rebase.pro/ui` is its public gallery. They are strangers to
   the monorepo and read the exports, not the source.
2. **Rebase's own packages** — `@rebasepro/admin`, `@rebasepro/studio`, the
   console, and the marketing site — which consume it as a workspace dependency
   and are its highest-volume caller.

Both matter. Where they conflict, the public contract wins, because breaking a
stranger's build is not recoverable and refactoring an internal caller is.

## Product Purpose

Be the one place a Rebase interface gets its primitives, so that the admin panel,
Studio, the console, and a developer's own custom field all read as one product
without any of them re-deciding what a button is.

Success is a developer building a custom field that is indistinguishable from a
built-in one, without reading the panel's source.

## Positioning

The design system is the mechanism behind two product claims it does not make
itself: *radical extensibility* (custom React is a first-class citizen because
the primitives are public) and *premium UI* (the panel looks considered because
one system decides, not each view).

## Operating Context

- Wraps **Radix UI** primitives with Rebase tokens and **Tailwind CSS v4**
  styling, and re-exports **lucide-react** icons so consumers need no direct icon
  dependency.
- Two stylesheets, and the split is load-bearing: `theme.css` must be imported
  **unlayered** (Tailwind only reads `@theme` from an unlayered import), while
  `index.css` is imported into a layer by consumers that need component CSS below
  their own utilities. Importing both into a layer silently drops every token.
- Surface spans roughly 60 components, plus hooks, icons, style mixins, and
  higher-level views. `VirtualTable` (react-window) is the load-bearing component
  for the panel's spreadsheet.
- Ships `src` alongside `dist`, so consumers can read the implementation.

## Capabilities and Constraints

- **Public, supported API.** Exports, prop shapes, and the token names are a
  contract with third-party developers. Renaming or removing an export is a
  breaking change and needs a deprecation path, not a refactor. Currently on the
  `0.13.x` line, MIT.
- Peer deps: React `>=19.0.0`, `react-dom >=19.0.0`. Node `>=20`.
- The token file (`src/theme.css`) is the single source of fonts, type scale,
  tracking tiers, control heights, and colour for *every* Rebase surface —
  including ones outside this repo. Tokens are a published API surface; add
  before you change, and never fork them into a consumer's own `@theme`.
- **Control heights resolve to one scale** so a Button, TextField, and Select at
  the same size share a baseline. `CONTROL_HEIGHT` in `styles.ts` is the source
  for React; the CSS variables exist for consumers that cannot import a JS mixin.
- **Product UI must not go below `text-xs` (12px).** `--text-2xs` and
  `--text-3xs` exist for the marketing site only.

## Brand Commitments

Inherits the root record. Library-specific: this package *is* the design
language's implementation. Its tokens are the authority other surfaces defer to,
so a change here is a change to every Rebase interface and is never a local
decision.

## Evidence on Hand

- Public gallery at `rebase.pro/ui`, reachable from `/admin` and `/developers`.
- The package README enumerates the actual exports and is current.
- Every consumer in this monorepo is a live integration test of the API surface.
- **Absences:** no per-component usage docs beyond the README table, no visual
  regression suite, no adoption numbers. Do not cite any.

## Product Principles

1. **One decision, made once.** If two surfaces need the same thing, it belongs
   here — not in both.
2. **The contract outlives the refactor.** A published export is a promise; treat
   renames as breaking changes.
3. **Wrap the primitive, don't reimplement it.** Radix owns keyboard and ARIA
   behaviour; this library owns how it looks.
4. **Tokens over values.** A hardcoded size or colour in a consumer is a missing
   token, not a local choice.
5. **A stranger must succeed from the exports alone.** If using a component
   correctly requires reading the panel's source, the component is unfinished.

## Accessibility & Inclusion

Inherits the root record. Library-specific: accessibility is delivered *here* or
nowhere — every consumer inherits whatever these components do. Radix semantics
must survive restyling, contrast is checked at the token level (the secondary was
moved off `#FF5B79` for failing AA), and `prefers-reduced-motion` is honoured in
component motion.
