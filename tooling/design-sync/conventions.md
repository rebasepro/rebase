# Building with @rebasepro/ui

The design system behind Rebase — an open-source backend-as-a-service for Postgres
with an optional admin panel. Expect product surfaces: collections, tables, SQL and
RLS editors, API keys, users.

## Setup

**No provider or theme wrapper is required.** Import a component and it is styled.
(`PortalContainerProvider` exists but is only for scoping portals into a specific
container — do not add it by default.)

**Dark mode is class-based, not `prefers-color-scheme`.** Put `class="dark"` on an
ancestor (normally `<html>`): the surface and hairline tokens below switch on their
own, and every `dark:` utility flips. Always author both themes — backgrounds and
borders through those tokens, which need no `dark:` pair, and everything else as a
light value beside its `dark:` one.

## Styling idiom

Tailwind utilities over a custom theme. Use these families — they are real, generated
tokens, not guesses:

| Family | Scale | Use for |
|---|---|---|
| `surface-frame` `-sheet` `-card` `-raised` `-lifted` `-field` `-well` `-scrim` | one per role; light and dark built in | every background, by role: frame (drawer, app bar, the page around the sheet) → sheet (the content area) → card (cards, dialogs, menus) → raised (neutral buttons, chips, tiles inside a card); `field` for inputs, `well` for an inset code block |
| `surface-hover` `-active` `-card-hover` `-raised-hover` `-field-hover` | one per role | hover and selected fills: `hover:bg-surface-hover` on transparent things, a solid surface's own `-hover` on that surface |
| `hairline` `hairline-strong` | light and dark built in | borders: `border-hairline` on cards and fields, `border-hairline-strong` on menus, popovers and dialogs |
| `surface-*` `surface-accent-*` | 50 → 950 | the palette under the roles — glyphs and text (`text-surface-accent-500`), not backgrounds |
| `text-primary` `text-secondary` `text-disabled` | + `-dark` variants | body copy, via `text-text-primary`, `dark:text-text-primary-dark` |
| `primary` `secondary` | + `-light` `-dark` `-bg` | brand blue `#0070F4`; `secondary` is rose `#E11D48` |

So: `bg-surface-sheet` for the page, `bg-surface-card border border-hairline` for a
card (`cardMixin` is that plus the radius), `text-text-secondary dark:text-text-secondary-dark`,
`bg-primary`, `text-primary`, `bg-primary-bg` (a 10%-alpha primary wash for
selected rows).

Type: `font-sans` (Inter) is the default; `font-headers` (Instrument Sans) is for
headings; `font-mono` (JetBrains Mono) for code and identifiers. Pair headings with
`tracking-display` / `tracking-title` / `tracking-heading`.

**Prefer the `Typography` component over raw type classes** — `<Typography variant="h3">`,
variants `h1`–`h6`, `subtitle1/2`, `body1/2`, `caption`, `label`, `button`, and
`color="primary|secondary|disabled|error|inherit"`. Equivalent `.typography-*` classes
exist if you need them on a raw element.

Exported helpers, all on `window.RebaseUI`: `cls()` to merge class strings;
`defaultBorderMixin`, `paperMixin`, `cardMixin`, `cardClickableMixin`,
`cardSelectedMixin`, `fieldBackgroundMixin`, `focusedClasses` for the DS's own
composite treatments; `iconSize` for icon sizing; `CHIP_COLORS` /
`getColorSchemeForKey` / `getColorSchemeForSeed` for chip palettes.
`.no-scrollbar` hides a scrollbar while keeping scrolling.

## Sizing — one scale, shared by every control

Every inline control resolves its height from one scale, so controls at the same
`size` are **pixel-identical and share a baseline**:

| `size` | height | use |
|---|---|---|
| `smallest` | 28px | dense tables, inline cell editors |
| `small` | 32px | toolbars, compact forms |
| `medium` | 40px | **default** — standard forms |
| `large` | 48px | prominent/primary forms |
| `xl` / `2xl` | 56 / 64px | buttons only — hero CTAs |

Applies to `Button`, `LoadingButton`, `TextField`, `DebouncedTextField`,
`Select`, `MultiSelect`, `SearchBar`, `DateTimeField`, `IconButton`, `Checkbox`.
So `<Button size="medium">` beside `<TextField size="medium">` lines up exactly —
just give both the same `size` and don't hand-tune heights.

A **labelled** TextField sits exactly 16px taller (44/48/56/64), because the
label takes its own row. Don't mix labelled and unlabelled fields on one line and
expect alignment — give the unlabelled one the next size up, or label both.

The scale is exported three ways, so custom controls can sit on it too:
`CONTROL_HEIGHT` (numbers) and `controlHeightMixin` (Tailwind classes) from the
library, and CSS variables `--control-smallest|small|medium|large|xl|2xl` for
markup that can't import JS — e.g. `min-h-(--control-xl)` on a hero CTA. Reach
for those rather than a hand-picked pixel value.

## Colour

Every colour pair in the system meets WCAG AA except deliberately-inactive
(disabled) controls, which the spec exempts. Two things to respect:

- **`primary` passes at 4.54:1 — with almost no margin.** Don't put it on
  anything other than white/`surface-50`, and don't lighten it for text.
- All 15 `Chip` schemes and all 4 `Alert` colours are AA-safe in both their
  filled and outlined forms; use them freely.

## Icons

~135 lucide icons are re-exported directly — `PlusIcon`, `Trash2Icon`,
`ChevronDownIcon`, `SettingsIcon`, `SearchIcon`, `UserIcon`, `DatabaseIcon`,
`TableIcon`, `KeyIcon`, `FolderIcon`, etc. Import them from the library, not from
`lucide-react`. Two are unsuffixed: `AppWindow` and `UserPlus`. Only names in the
library exist — `BellIcon`, `ClockIcon`, `CreditCardIcon` and `BuildingIcon` do not.
Size lucide icons with the numeric `size` prop (`<PlusIcon size={18} />`).

The DS's own `GitHubIcon` and `HandleIcon` take `IconProps` — `size` accepts a
number or an `iconSize` keyword (`"smallest" | "small" | "medium" | "large"`),
plus `color`, `className`, `style` and `onClick`.

## Opening overlays — check the prop, it is inconsistent

| Component | How to open |
|---|---|
| `Menu`, `Tooltip` | `open` **or** `defaultOpen` |
| `Select`, `Popover` | controlled `open` only — `defaultOpen` silently does nothing |
| `Sheet` | `open` is required |
| `Menubar` | `defaultValue` / `value` on `Menubar` naming a `value` on one `MenubarMenu` |

`Chip` `colorScheme` accepts exactly: blue teal yellow pink purple cyan orange green
red gray indigo violet fuchsia rose emerald. There are no `*Dark` variants.

## Read the real thing

Before styling, read `_ds/<folder>/styles.css` and its imports for the full generated
token set, and each component's `<Name>.d.ts` for its exact props. Those are
authoritative; this file is a summary.

## Idiomatic example

```tsx
<div className="p-6 bg-surface-sheet min-h-full">
  <div className="flex items-center gap-4 mb-6">
    <Typography variant="h4" className="grow">Users</Typography>
    <SearchBar placeholder="Search users…" />
    <Button><PlusIcon size={18} /> Add user</Button>
  </div>

  <div className={cls("rounded-lg border overflow-hidden", defaultBorderMixin)}>
    <Table className="w-full">
      <TableHeader>
        <TableCell header>Email</TableCell>
        <TableCell header>Name</TableCell>
        <TableCell header>Roles</TableCell>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>alice@example.com</TableCell>
          <TableCell className="font-medium">Alice Johnson</TableCell>
          <TableCell><Chip colorScheme="purple" size="small">Admin</Chip></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</div>
```

Library components carry the controls; your own layout glue uses the utility families
above. Never hand-roll a component the library already ships.
