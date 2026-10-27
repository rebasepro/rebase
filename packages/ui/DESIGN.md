# Design

<!-- impeccable:design-schema 1 -->

The visual system behind `@rebasepro/ui`, as the code does it. Tokens live in
`src/theme.css`; mixins that apply them live in `src/styles.ts`. This file
records the decisions those two files carry, so a change to either is a change
to this document. Product truth is in `PRODUCT.md`.

## Neutrals: Graphite

Added 2026-10-14. Every neutral — the role surfaces below, the numbered scale,
the text tokens — sits on **one hue, 258°** (the brand blue's), at a chroma
between 0.002 and 0.014: low enough that nothing reads as blue, enough that a
lifted surface reads as the same material as the ground instead of a grey box
on black. Before, the neutrals sat on five hues (hue-less surfaces, zinc text
at 286°, grounds at 246°), and that mix was the clash.

- Never hand-write a pure grey or a Tailwind zinc hex. Use a role or a token.
- `zinc`, `neutral`, `gray` and `stone` utilities are re-pointed at the
  Graphite ramp (`--color-graphite-*`) in `theme.css`, so they are safe.
- `test/neutral-hue.test.ts` fails on any neutral token off the hue.

## Surfaces

Added September 2026. Reference, with the measurements behind the ladder:
[`docs/design/instatic-distilled.html`](../../docs/design/instatic-distilled.html).

A surface is named by **role**, never by a numbered pair. `bg-white
dark:bg-surface-900` is the pattern this system exists to retire: 180 files
each picked their own pair, and the result in dark mode was two opaque values
on screen with every card darker than the sheet it sat on.

| Role | Class | Light | Dark | Used for |
|---|---|---|---|---|
| Frame | `bg-surface-frame` | `#eff0f3` | `#090a0c` | drawer, rail, app bar, the page around the sheet |
| Sheet | `bg-surface-sheet` | `#f8f9fa` | `#111316` | the content area; table headers |
| Card | `bg-surface-card` | `#ffffff` | `#16181c` | cards, paper, dialogs, menus, popovers, table rows |
| Card hover | `hover:bg-surface-card-hover` | `#f6f7f9` | `#1b1d21` | a clickable card or row |
| Raised | `bg-surface-raised` | `#eaecef` | `#212429` | neutral buttons, chips, tiles inside a card, avatars, skeletons |
| Raised hover | `hover:bg-surface-raised-hover` | `#e1e4e7` | `#292c32` | also badges, disabled slider parts |
| Lifted | `bg-surface-lifted` | `#ffffff` | `#292c32` | the active segment on a track, a switch thumb |
| Field | `bg-surface-field` | black 5% | white 6.5% | inputs, search, segmented tracks, kanban columns, neutral alerts. A field has no edge, so this fill is the whole box |
| Field hover | `hover:bg-surface-field-hover` | black 7.5% | white 9.5% | |
| Hover | `hover:bg-surface-hover` | black 4% | white 6% | a transparent row, nav item, menu item, icon button |
| Active | `bg-surface-active` | black 7% | white 9% | selected or checked item, slider track, drop target |
| Scrim | `bg-surface-scrim` | black 40% | black 60% | dialog and sheet backdrops |
| Well | `bg-surface-well` | `#f4f5f7` | `#090a0c` | an inset code well (a query, a log tail, a connection string): the one surface that goes down the ladder, darker than its card on purpose |
| Hairline | `border-hairline` | black 8% | white 8% | cards on the sheet, dividers |
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
   the sheet and floating surfaces get a line. Tiles inside a card, rows,
   segmented tracks, buttons and chips do not; the lightness step is their
   separation. Fields do not either: a field is a filled box (the FireCMS
   field), and `surface-field` is set strong enough to be its edge. The mixin
   keeps a transparent 1px border, so every measured height still holds and an
   error recolours the border instead of adding one. Floating surfaces use
   `hairline-strong` because they have to read against anything underneath
   them. The exception is the **sheet edge
   against the frame**: that step is about 3 L\* on both themes (#090a0c to
   #111316, #eff0f3 to #f8f9fa), under what a dimmed screen renders, so the
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

The record form draws the FireCMS field: a filled box with no edge, the label
inside it. Measured on the product form, every one-line control is the same
box — 64px plus the field's transparent 1px border, so 66px — with the label
shrunk into its top edge and a 16px value under it.

- **Label inside**: text, number, email, URL, multiline, date, switch, single
  select, and a one-line read-only value. Empty, the label rests in the middle
  of the box at full size and floats up on focus or a value. The read-only box
  keeps an outline (`hairline-strong`) and drops the fill: that is what says it
  cannot be edited.
- **Label above** (`FieldBlock`, 13px medium in the primary ink with a muted
  14px type icon): multi-select, whose chips wrap and would read the label as
  one more chip; uploads, markdown, relations and references; and anything with
  a custom editor, which the form cannot vouch for. Their box is `large`, 48px.
- **Their own header**: maps, arrays and blocks.

`labelsInsideControl` (`packages/cms/src/form/label_placement.ts`) is the one
place that decides. Auto-layout only pairs fields of the same kind on a row,
so a row never mixes a label inside with a label above.

The description sits under the box, indented to the value (`ml-3.5`, where the
binding's error line already was), and the property's key shows at the end of
that line on hover — or, with no description, hangs in the 24px row gap below
the box. Rows are 24px apart: with no edge on a field, the gap is what keeps two
rows from reading as one block.

The 16px value is the record form's: a text field without its label (a table
cell, a dialog, a toolbar) keeps the kit's 14px. `medium` (40px) is the toolbar
and dialog control height; `small` (32px) is for controls inside dense chrome.

History: 0.20.0 took record forms to `small` (32px, 13px text, a hairline on
every field), the reference's own height, and labelled every field above. It
read as cramped against the forms people had had; the height came back first,
then the FireCMS field.

## Table and list density

Measured before the density pass (2026-09-08): the default table row was 140px
(the old ladder was 54 / 80 / 140 / 280 / 400, every step sized for an image
thumbnail), a reference cell rendered a bordered card with three lines inside
it, the id column stacked three always-visible icon buttons over a truncated
id, every header carried a property-type glyph, and the view presets were
pills with a primary ring. The reference runs 40px rows of text.

The ladder is now 36 / 42 / 48 / 96 / 160 (`xs` to `xl`, default `m` = 48).
`xs`..`m` are text rows and get `small` previews: a chip, a date, a number, and
a reference as one line (`InlineEntityPreview`: link glyph + title). `l` and
`xl` are the thumbnail rows and get `medium` and `large` previews, the card
included. The rules that fall out of it:

1. **A reference is a line unless there is room for a card.** Small previews
   render inline everywhere (cells, list rows, kanban cards); the card with
   image, id, secondary lines and side-panel button is for the read view and
   the tall rows.
2. **The id cell rests on its id.** The row actions (edit, menu, select) are an
   overlay that appears on hover, focus or while the row is selected, so the
   resting table is text and a 36px row still fits its tools.
3. **Headers are labels.** No property-type glyph before the column title; the
   type is visible in the cell and in the column menu. Header height is 40px.
4. **View presets take the row grammar, not the chip grammar.** Text at rest,
   the alpha highlight when active, `rounded-md`. A hue tint or a primary ring
   would read as an enum value, which they are not. The record count next to
   them is a mono readout, not a badge.
5. **Home cards carry readouts, not tiles.** A collection card's insight
   figures are `LABEL value delta` text on the card, wrapping at their own
   height; a bordered tile inside a bordered card inside the sheet was three
   objects deep, and the estimated tile height kept every card in the row
   tall and empty.
6. **Read-view values are body size.** The detail view inherits `text-sm`;
   only the last row of a summary section steps up to `text-base`.

## Type, color, control heights

Recorded in `src/theme.css` and `src/index.css` with their reasoning inline:
Inter for UI and body, Instrument Sans for headings, a 600 weight ceiling, the
three tracking tiers keyed to rendered size, the control height scale
(28/32/40/48), and the text and primary tokens with their measured contrast.
