# Building with @rebasepro/ui

The design system behind Rebase — an open-source backend-as-a-service for Postgres
with an optional admin panel. Expect product surfaces: collections, tables, SQL and
RLS editors, API keys, users.

## Setup

**No provider or theme wrapper is required.** Import a component and it is styled.
(`PortalContainerProvider` exists but is only for scoping portals into a specific
container — do not add it by default.)

**Dark mode is class-based, not `prefers-color-scheme`.** Put `class="dark"` on an
ancestor (normally `<html>`) and every `dark:` utility flips. Always author both
themes: the DS pairs a light and dark value on essentially every surface.

## Styling idiom

Tailwind utilities over a custom theme. Use these families — they are real, generated
tokens, not guesses:

| Family | Scale | Use for |
|---|---|---|
| `surface-*` | 50 100 200 300 400 500 600 700 800 900 950 | page and panel backgrounds, borders |
| `surface-accent-*` | 50 → 950 | field fills, subtle hover/selected tints |
| `text-primary` `text-secondary` `text-disabled` | + `-dark` variants | body copy, via `text-text-primary`, `dark:text-text-primary-dark` |
| `primary` `secondary` | + `-light` `-dark` `-bg` | brand blue `#0070F4`, accent pink `#FF5B79` |

So: `bg-surface-50 dark:bg-surface-900`, `border-surface-200`,
`text-text-secondary dark:text-text-secondary-dark`, `bg-primary`, `text-primary`,
`bg-primary-bg` (a 10%-alpha primary wash for selected rows).

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
<div className="p-6 bg-surface-50 dark:bg-surface-900 min-h-full">
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
