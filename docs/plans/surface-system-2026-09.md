# Surface system for `@rebasepro/ui`

Status: on branch `design/surface-system`, September 2026. Pass 1 (tokens,
mixins, the mechanical sweep) landed 2026-09-08; pass 2 the same day, after the
owner's review of the local demo: the 32 "ambiguous" pairs the script skipped
and the lone `dark:` halves it could not see were each decided by hand (the
collection toolbar and container were painting the FRAME value and #111111
inside the #131313 sheet), the sheet got its edge back, and the three chrome
rules that were out of scope below (buttons, chips, switch) were applied. The
script's `--check` mode is now the gate for the rule.
Reference: `docs/design/instatic-distilled.html` (the Instatic distillation and
the measurements this plan answers).

## Why

Measured on demo.rebase.pro in dark mode, the home page and the products view
use exactly two opaque surface values: the ground `#0a0a0a` and the content
sheet `#111111`. Every card, tile and dialog paints `dark:bg-surface-900`, which
is the ground value, on top of the sheet. Cards are holes cut into the surface
they sit on, one hairline recipe (`surface-700/60`) is drawn on the sheet edge,
every card and every tile alike, and the largest areas on screen carry the
darkest value. That is the whole of "it feels very dark".

The cause is structural, not a palette problem. Surfaces are chosen per call
site as a light/dark pair of numbered primitives (`bg-white dark:bg-surface-900`,
57 sites of one pair, 51 of another, 180 files in total), so no single place
decides how surfaces stack. Retuning the numbers cannot fix it: the sheet uses
`800` and cards use `900`, and `900` must stay darker than `800`.

## What changes

A **semantic surface layer** on top of the numbered primitives. Components and
consumers say what a surface *is* (frame, sheet, card, field, raised) and the
theme decides the value. The numbered `surface-*` and `surface-accent-*`
primitives keep their values and stay exported, because the marketing site and
third-party custom fields use them directly; they become the palette under the
roles rather than the API for surfaces.

Two rules carried over from the reference:

1. **Every nested surface is one step lifted from the surface it sits on.** In
   dark mode lifted means lighter; in light mode it means lighter too, with the
   frame as the greyest thing. Fields are the exception: a field is inset, so it
   is an alpha fill that goes the other way on both themes.
2. **A hairline marks an object, not a region.** Cards on the sheet, floating
   surfaces, and fields get a line. Tiles inside cards, rows, segmented
   tracks, buttons and chips do not; the lightness step is their separation.
   *Reversed for the sheet edge in pass 2 (2026-09-08):* the frame-to-sheet step
   is about 3 L\* on both themes and did not read on the local demo, so the
   sheet carries a plain hairline in the inset layout. Instatic's own sheet does.

## Tokens

Defined in `packages/ui/src/theme.css`, per theme, exposed as Tailwind colors
through `@theme inline` so `bg-surface-card` resolves at the element and
follows whichever dark selector the consumer uses (`.dark` in the panel,
`[data-theme=dark]` on the site).

| Role | Class | Light | Dark | Used for |
|---|---|---|---|---|
| Frame | `bg-surface-frame` | `#f0f0f2` | `#0a0a0a` | drawer, rail, app bar, the page around the sheet |
| Sheet | `bg-surface-sheet` | `#f9f9fa` | `#131313` | the content area |
| Card | `bg-surface-card` | `#ffffff` | `#181818` | cards, paper, dialogs, menus, popovers, table bodies |
| Card hover | `hover:bg-surface-card-hover` | `#f7f7f8` | `#1d1d1d` | a clickable card |
| Raised | `bg-surface-raised` | `#ececee` | `#242424` | neutral buttons, chips, tiles inside a card, avatars |
| Raised hover | `hover:bg-surface-raised-hover` | `#e3e3e6` | `#2c2c2c` | |
| Lifted | `bg-surface-lifted` | `#ffffff` | `#2c2c2c` | the active segment on a track, a switch thumb |
| Field | `bg-surface-field` | black 3.5% | white 4% | inputs; composes over any surface |
| Field hover | `hover:bg-surface-field-hover` | black 5.5% | white 7% | |
| Hover | `hover:bg-surface-hover` | black 4% | white 6% | a transparent row, nav item, menu item |
| Active | `bg-surface-active` | black 7% | white 9% | the selected row or segment when no hue is wanted |
| Scrim | `bg-surface-scrim` | black 40% | black 60% | dialog and sheet backdrops |
| Hairline | `border-hairline` | black 8% | white 8% | cards on the sheet, fields, separators |
| Hairline strong | `border-hairline-strong` | black 13% | white 14% | menus, popovers, dialogs, floating toolbars |

Dark values are Instatic's ladder shifted so a card on the sheet keeps a
five-unit step. Light values are designed, not inverted: white cards on a
near-white sheet inside a grey frame, which is the direction light interfaces
already read as lifted.

Interaction fills are alpha so they compose over whatever they land on; solid
surfaces get their own hover token because an alpha hover on a solid background
replaces it instead of tinting it.

`surface-accent-*` is no longer used for any background inside the kit. On the
dark ladder its slate hue is the one tinted neutral, and it makes the greys
around it read colder. Its text uses (`text-surface-accent-500` and friends)
are out of scope here and stay.

## Mixins (`packages/ui/src/styles.ts`)

| Mixin | Before | After |
|---|---|---|
| `defaultBorderMixin` | `border-surface-200 dark:border-surface-700/60` | `border-hairline` |
| `cardMixin` | `bg-white dark:bg-surface-900 rounded-xl border …` | `bg-surface-card rounded-xl border border-hairline` |
| `paperMixin` | `bg-white dark:bg-surface-900 rounded-lg border …-700` | `bg-surface-card rounded-lg border border-hairline-strong` |
| `cardClickableMixin` | `hover:bg-primary/5 …` | `hover:bg-surface-card-hover cursor-pointer transition-colors duration-150` |
| `fieldBackgroundMixin` | `bg-surface-accent-200/50 dark:bg-white/[0.055] …` | `bg-surface-field dark:shadow-[inset …]` |
| `fieldBackgroundHoverMixin` | `hover:bg-surface-accent-200/70 hover:dark:bg-white/[0.09]` | `hover:bg-surface-field-hover` |
| `fieldBackgroundDisabledMixin` | `bg-surface-accent-200/50 dark:bg-white/[0.03]` | `bg-surface-field/60` |
| `focusedInvisibleMixin` | `focus:bg-surface-accent-100 …` | `focus:bg-surface-field-hover` |
| `codeSurfaceMixin`, `cardSelectedMixin`, `accentTextMixin` | unchanged | |
| new `surfaceHoverMixin` | | `hover:bg-surface-hover transition-colors duration-150` |

## Class mapping for the sweep

Applied by `tooling/scripts/migrate-surfaces.mjs` (dry run by default) to
`packages/ui`, then `packages/cms`, `packages/app`, `packages/studio`. Every
replacement is a whole-pair match so a stray `dark:` half is never left behind.

| Pattern | Becomes | Note |
|---|---|---|
| `bg-white dark:bg-surface-900` | `bg-surface-card` | cards, dialogs, menus, table bodies |
| `bg-white dark:bg-surface-950` | `bg-surface-card` | Studio panels; see Stage 3 |
| `bg-white dark:bg-surface-800` | `bg-surface-card` | select and multiselect popovers |
| `bg-surface-50 dark:bg-surface-900` | `bg-surface-frame` | the scaffold, headers, table headers; reviewed per file |
| `bg-surface-50 dark:bg-surface-800` | `bg-surface-sheet` | the content sheet |
| `bg-surface-100 dark:bg-surface-900` / `-800` | `bg-surface-raised` | tracks, tags, chips |
| `bg-surface-200 dark:bg-surface-700` | `bg-surface-raised` | neutral filled button |
| `hover:bg-surface-accent-100 dark:hover:bg-surface-800` and the other five hover pairs | `hover:bg-surface-hover` | rows and items with a transparent ground |
| `hover:bg-primary/5 dark:hover:bg-primary/5` | `hover:bg-surface-card-hover` on cards, `hover:bg-surface-hover` on rows | reviewed per file |
| `bg-black/0 group-hover:bg-black/10` | `bg-white/0 group-hover:bg-white/[0.06]` | card image overlay in `EntityCardBinding` |
| `bg-surface-accent-100 dark:bg-surface-accent-800` | `bg-surface-raised` | filter chips, avatars, skeletons |
| `border-surface-200 dark:border-surface-700(/60)` | `border-hairline` | |
| `border-surface-200 dark:border-surface-950` | `border-hairline` | |

## Stages

1. **Tokens, mixins, the kit, the panel shell.** `theme.css`, `styles.ts`, the
   37 kit components that paint surfaces, and in `packages/cms` the scaffold
   (frame and sheet), drawer, app bar, navigation items, home page tiles and the
   card view hover. This is what the demo shows and what the UI reference view
   at `/debug/ui` exercises. Verified in both themes on the local demo app.
2. **The rest of the panel and the app runtime.** The remaining `cms` and
   `app` call sites, mechanically, with a diff review of anything the script
   flags as ambiguous. *Done in the same pass as Stage 1: the unambiguous pairs
   were cheap to apply everywhere at once, and the flagged files are listed by
   the script for review.*
3. **Studio.** Studio paints `dark:bg-surface-950` in 56 places on purpose,
   because it runs darker than the panel (`isStudioDark`). It gets the same
   roles but keeps its own ladder if the owner wants it darker; decide after
   Stages 1 and 2 are in.
4. **Documentation.** `packages/ui/DESIGN.md` records the surface system;
   `.agent/workflows/ui-components.md` adds the rule that a surface is named by
   role and never by a numbered pair; the UI reference view gains a "Surfaces"
   block showing the ladder in both themes.

The marketing site consumes the kit's components (the `/ui` page renders
`UIReferenceView`) and inherits Stage 1 automatically. Its own numbered
utilities are untouched by design.

## Verification

- Local demo app (`pnpm --dir app dev`, Postgres already on 5432) at
  `/debug/ui`, the home page, the products card view and table view, a dialog,
  a menu, and a select popover, in both themes.
- Computed-style read of the products view after the change: at least five
  distinct opaque surface values, cards lighter than the sheet, no
  `surface-accent` background in dark mode.
- `pnpm --filter @rebasepro/ui build` and `pnpm typecheck` pass; the kit has no
  visual regression suite, so screenshots of the reference view before and
  after are attached to the change.

## Out of scope, deliberately

Button weight and size, enum chip fills, primary-blue section labels, the rose
switch track, and `surface-accent` as a text color. Each is a separate decision
and none depends on this one.
