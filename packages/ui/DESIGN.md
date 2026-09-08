# Design

<!-- impeccable:design-schema 1 -->

The visual system behind `@rebasepro/ui`, as the code does it. Tokens live in
`src/theme.css`; mixins that apply them live in `src/styles.ts`. This file
records the decisions those two files carry, so a change to either is a change
to this document. Product truth is in `PRODUCT.md`.

## Surfaces

Added September 2026. Plan and measurements:
[`docs/plans/surface-system-2026-09.md`](../../docs/plans/surface-system-2026-09.md);
reference: [`docs/design/instatic-distilled.html`](../../docs/design/instatic-distilled.html).

A surface is named by **role**, never by a numbered pair. `bg-white
dark:bg-surface-900` is the pattern this system exists to retire: 180 files
each picked their own pair, and the result in dark mode was two opaque values
on screen with every card darker than the sheet it sat on.

| Role | Class | Light | Dark | Used for |
|---|---|---|---|---|
| Frame | `bg-surface-frame` | `#f0f0f2` | `#0a0a0a` | drawer, rail, app bar, the page around the sheet |
| Sheet | `bg-surface-sheet` | `#f9f9fa` | `#131313` | the content area; table headers |
| Card | `bg-surface-card` | `#ffffff` | `#181818` | cards, paper, dialogs, menus, popovers, table rows |
| Card hover | `hover:bg-surface-card-hover` | `#f7f7f8` | `#1d1d1d` | a clickable card or row |
| Raised | `bg-surface-raised` | `#ececee` | `#242424` | neutral buttons, chips, tiles inside a card, avatars, skeletons |
| Raised hover | `hover:bg-surface-raised-hover` | `#e3e3e6` | `#2c2c2c` | also badges, disabled slider parts |
| Lifted | `bg-surface-lifted` | `#ffffff` | `#2c2c2c` | the active segment on a track, a switch thumb |
| Field | `bg-surface-field` | black 3.5% | white 4% | inputs, search, segmented tracks, kanban columns, neutral alerts |
| Field hover | `hover:bg-surface-field-hover` | black 5.5% | white 7% | |
| Hover | `hover:bg-surface-hover` | black 4% | white 6% | a transparent row, nav item, menu item, icon button |
| Active | `bg-surface-active` | black 7% | white 9% | selected or checked item, slider track, drop target |
| Scrim | `bg-surface-scrim` | black 40% | black 60% | dialog and sheet backdrops |
| Well | `bg-surface-well` | `#f5f5f5` | `#0a0a0a` | an inset code well (a query, a log tail, a connection string): the one surface that goes down the ladder, darker than its card on purpose |
| Hairline | `border-hairline` | black 8% | white 8% | cards on the sheet, fields, dividers |
| Hairline strong | `border-hairline-strong` | black 13% | white 14% | menus, popovers, dialogs, outlined buttons and chips |

### The two rules

1. **Frame, sheet, card: each one step lighter than the one it sits on, on both
   themes.** The light frame is the greyest thing on the page and the light
   card is white, the ceiling. Above the card the two themes part ways: `raised`,
   `lifted` and `field` are grey, which reads as *lifted* on a dark card and as
   *inset* on a white one. That is not a contradiction to fix; it is how each
   theme already says "this is a control". Fields are grey on both themes for
   the same reason, as an alpha fill that composes over whatever holds it.
2. **A hairline marks an object, not a region, with one exception.** Cards on
   the sheet, floating surfaces and fields get a line. Tiles inside a card, rows,
   segmented tracks, buttons and chips do not; the lightness step is their
   separation. Floating surfaces use `hairline-strong` because they have to
   read against anything underneath them. The exception is the **sheet edge
   against the frame**: that step is about 3 L\* on both themes (#0a0a0a to
   #131313, #f0f0f2 to #f9f9fa), under what a dimmed screen renders, so the
   sheet carries a plain hairline in the inset layout. The first pass removed
   it on the theory that the step would do its work, and the frame and the
   sheet read as one black. The reference's own content sheet carries this
   line.

### Alpha and solid

Interaction fills (`hover`, `active`, `field`) are alpha so they lift whatever
they land on by the same amount. Solid surfaces carry their own hover value
(`card-hover`, `raised-hover`) because an alpha fill on a solid background
*replaces* it instead of tinting it: white at 6% over the sheet is darker than
the card it was meant to lift. So: alpha hover on transparent things, solid
hover on solid things.

### How the tokens switch

The roles are plain custom properties (`--surface-card` and friends) defined on
`:root` for light and on `.dark, [data-theme="dark"]` for dark, and aliased into
Tailwind through `@theme inline`. `inline` is load-bearing: it makes
`bg-surface-card` emit `var(--surface-card)` at the element, so the value
resolves under whichever dark selector the consumer uses (the panel sets
`.dark` on `<html>`, the marketing site sets `data-theme="dark"`). In a plain
`@theme` the alias would be computed once on `:root` and stay light.

There is deliberately no `.light` class selector. Nothing in the app sets one,
and a third-party root that stamps its own theme class (React Flow puts `light`
or `dark` on `.react-flow`) would otherwise re-light every token under it on a
dark page, which is exactly what the schema canvas did. Light is the `:root`
ladder; the only switches are `.dark` and `[data-theme]`. A widget that carries
its own theme class is told the app theme instead (`colorMode` from
`useIsDarkMode()`), so its controls and our tokens agree.

### The numbered scale

`surface-50` to `surface-950` and `surface-accent-*` keep their values and stay
exported. They are the palette under the roles, and the marketing site and
third-party custom fields use them directly. Inside the kit they are no longer
how a background is chosen. The remaining numbered uses are glyphs, not
surfaces: a switch knob, a status dot, a disabled badge under white ink, the
tooltip's inverse ground. `tooling/scripts/migrate-surfaces.mjs --check` lists
each one with its reason and fails on anything else, so the list cannot grow
unnoticed. `surface-accent` survives as a text color and as the unchecked
`Checkbox` border; it paints no background in the kit.

## Chrome colour

Added September 2026, the second pass of the surface work. The rule the
reference follows and the panel now follows: **the chrome is monochrome, and a
hue is information.** A hue may be a dot, an icon, a 1px outline, or a low-alpha
tint behind hue-coloured text. It is not a filled control, with one exception.

- **One primary button per screen.** `Button color="primary" variant="filled"`
  is the single main action a screen has (add, save, publish). Everything else
  is `neutral`, which paints `surface-raised`. The label is `typography-button`:
  14px, weight 500, sentence case, no tracking. Semibold and `tracking-wide` were
  the Rubik-era voice and made every control shout equally; emphasis is the
  fill, not the letterforms.
- **Chips are tinted by default.** `Chip` with a colour scheme paints the hue's
  solid stop at 10–26% alpha (by tone, four points higher in dark mode) behind
  an ink measured on that composite, so an enum value reads as a label rather
  than a block. `variant="filled"` keeps the saturated stop for swatches (a
  colour picker, a legend). The tint values live on the scheme
  (`tintColor` / `tintText` and their dark pair) and are derived in
  `src/util/chip_colors.ts`; `test/chip-contrast.test.ts` holds every hue × tone
  × theme at AA on the composite, which an ink measured on the bare page fails.
  The ink is chosen in JS per theme, so `Chip` reads the theme through
  `useIsDarkMode()` (a `MutationObserver` on the root's `class` and
  `data-theme`) and re-inks on a switch; it used to read the class once and keep
  the other theme's ink until something else re-rendered it.
- **The switch is on = primary.** A boolean is the one place the product turns
  a hue into a value, and the hue is the one that means "yes" everywhere else.
  Off is `surface-active` with a strong hairline. The secondary rose is a
  marketing token and no longer a control colour.
- **Status is a dot before the word**, not a filled badge, where a list shows
  state; the chip is for a value the operator chose.

## Shape

Side by side with the reference the panel read as square, and the first answer
to that was wrong in a way worth recording: rounding is not something you add
to elements, it is what shaped OBJECTS look like, and the reference has fewer
objects than we did. Three rules follow.

1. **Rows have no fill.** A row in a list is text on the panel. Only the row
   being touched, chosen or opened takes a shape, as an alpha highlight
   (`hover`, `active`), inset from the panel edge (`mx-2`) and rounded because
   it is an object the moment it appears. Giving every row a solid fill and
   rounding it turns a list into a stack of tiles. No dividers between rows and
   no coloured edge bar on the selected one: the highlight is the whole signal.
2. **A radius is proportional to what it rounds, and ours is between Tailwind's
   and the reference's.** `theme.css` sets `rounded-md` 6px, `rounded-lg` 9px
   and `rounded-xl` 13px, so every call site moves together and none names a
   number; the step each element uses follows its size. Chips, tiles and
   segments are `md`; controls, menus, list highlights, folder tabs and
   segmented tracks are `lg`; cards, the sheet and dialogs are `xl`. The first
   ladder (8 / 10 / 14) matched the reference's curvature and read as
   borrowed; this one keeps the panel's own character. The chip at `lg` had
   become a pill, and a pill is a different object.
3. **`rounded-full` is a rule, not a size, and it is rare.** Search fields, the
   switch and avatars are pills. Segmented tracks (`ToggleButtonGroup`, the
   drawer's CMS/Studio toggle) are `lg` tracks with `md` segments, 32px, the
   active segment lifted in the primary ink, not blue.
4. **Regions meet with a step, not a rule.** A line marks an object (DESIGN.md
   surfaces, rule 2), so the toolbar on the sheet, the identity bar above the
   tab strip, the form rail beside the form and the split list beside the
   record carry no separator; the surface step is the separation. The lines
   that stay each hold something up: the sheet edge against the frame, the tab
   strip's edge the folder tab sits on, and a table or list header's rule.

The `boxy` tab variant is a folder tab: the active tab is cut from the panel's
own surface and sits over the strip's hairline, with no dividers and no
underline.

## Form density

Measured on the product form before this was written: inputs at 48px with 16px
text, selects at 48px, no edge on any field. The reference sets its inputs at
32px with 13px text and a 1px edge. The kit's answer, without inventing a new
height: field bindings default to `small` (32px, the reference's own density),
the input and textarea text is `text-sm` (14px, the body size), the field label
is 13px medium in the primary ink with a muted 14px type icon, and
`fieldBackgroundMixin` carries `border-hairline`, so a field is an object with
an edge on both themes. `medium` (40px) is the toolbar and dialog control
height; `large` (48px) remains on the scale for the login screen and other
one-field moments.

## Type, color, control heights

Recorded in `src/theme.css` and `src/index.css` with their reasoning inline:
Inter for UI and body, Instrument Sans for headings, a 600 weight ceiling, the
three tracking tiers keyed to rendered size, the control height scale
(28/32/40/48), and the text and primary tokens with their measured contrast.
