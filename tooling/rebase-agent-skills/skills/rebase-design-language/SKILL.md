---
name: rebase-design-language
description: |
  Comprehensive Rebase UI Design Language specification. Use this skill whenever building, modifying, or reviewing any UI view, custom page, or home page in a Rebase project. This skill covers the exact design tokens, color system, typography scale, spacing conventions, layout patterns, component usage rules, and common anti-patterns to avoid. Agents MUST read this skill before creating or modifying any visual UI.
---

# Rebase Design Language

This document is the single source of truth for the visual design language used across all Rebase applications. Every custom view, home page, dashboard, or UI component **must** follow these rules exactly.

---

## 0. Ground truth — the UI reference ships with your project

Rebase ships a live reference of every UI pattern it uses: `UIReferenceView`, on the `@rebasepro/app/debug` subpath. **It is installed in your project already** — you do not need the Rebase monorepo to see it.

### Read the source

The TSX lives in the Rebase repository, under `packages/app/src/debug/`:

```
packages/app/src/debug/UIReferenceView.tsx
packages/app/src/debug/crm-dashboard/       # dashboard composition
packages/app/src/debug/collection-views/    # table, card, kanban
```

The npm package publishes only its build, so in your project the same code is `node_modules/@rebasepro/app/dist/debug.js` — compiled but not minified, class strings intact, and each file headed by a `// src/debug/…` comment. Read that, or the TSX on GitHub (`github.com/rebasepro/rebase`, same paths).

Its header says the markup and classes are copied from the source files they name, with no invented styles — that makes it the highest-fidelity reference available. **When this document and `UIReferenceView` disagree, the reference wins.**

### See it rendered

`/debug/ui` is not a framework route: the Rebase repository's own app registers the reference as a hidden custom view. Do the same in yours while you work:

```tsx
import type { AppView } from "@rebasepro/cms-types";
import { UIReferenceView } from "@rebasepro/app/debug";

// <RebaseCMS collections={collections} views={[uiReference]} />
export const uiReference: AppView = {
    slug: "debug/ui",
    name: "UI reference",
    hideFromNavigation: true,
    view: UIReferenceView
};
```

Then open `/debug/ui` on the frontend URL `rebase dev` prints. Use it to check spacing and dark mode before you call a view done. It is a development aid, a quarter of a megabyte of demo UI: drop it before shipping, or load it with `React.lazy` as the Rebase app does.

### What to read for what you're building

| Building | Read |
|---|---|
| Any view at all | `references/view-patterns.md` (whole-view skeletons) |
| A list of records | `debug/collection-views/CollectionTableDemo.tsx` |
| A dashboard / home page | `debug/crm-dashboard/CrmDashboardDemo.tsx`, `DashboardMetrics.tsx` |
| A card or kanban layout | `debug/collection-views/CardViewDemo.tsx`, `KanbanBoardDemo.tsx` |
| A form or dialog | `UIReferenceView.tsx` → `user-dialog` section |
| Component props & API | the `rebase-ui-components` skill |

### The rule

Before writing a new view, **read `references/view-patterns.md` and copy the closest skeleton**. Extend an existing pattern; do not invent a layout. If nothing fits, read `UIReferenceView` and compose from the sections there.

---

## 1. Foundational Principle

> **Near-zero chrome — the UI disappears so content is the interface.**

Rebase applications render inside the Rebase Shell — an admin panel with a sidebar, top bar, and content area. Custom views must feel like a native part of this panel. The design is Attio-inspired: data-dense, quiet, and monochromatic. Every element exists to serve the data, not to decorate. They must **not** look like a marketing website, a Dribbble concept, or a standalone SaaS dashboard.

---

## 2. Component Library (`@rebasepro/ui`)

**MANDATORY**: Use `@rebasepro/ui` components for ALL UI elements. Never use raw HTML elements when a kit equivalent exists.

### Core Imports

```tsx
import {
    // Layout
    Card, Paper, Container, CenteredView,
    // Typography
    Typography, Markdown,
    // Buttons
    Button, IconButton, LoadingButton,
    // Form Inputs
    TextField, DebouncedTextField, TextareaAutosize,
    Select, SelectItem, MultiSelect, Autocomplete,
    Checkbox, BooleanSwitch, RadioGroup, Slider,
    DateTimeField, ColorPicker, FileUpload,
    // Dialogs & Overlays
    Dialog, DialogTitle, DialogContent, DialogActions,
    Menu, Menubar, MenuItem, Popover, Sheet,
    // Data Display
    Table, TableHeader, TableBody, TableRow, TableCell,
    Tabs, Chip, Badge, Label, InfoLabel,
    // Feedback
    Tooltip, Skeleton, CircularProgress, Separator,
    Alert, Collapse, ExpandablePanel,
    // Other
    Avatar, SearchBar, ErrorBoundary,
    // Utilities
    cls, defaultBorderMixin, cardMixin, cardClickableMixin, paperMixin, codeSurfaceMixin,
    // Icons (all from @rebasepro/ui, under their lucide names)
    PlusIcon, Trash2Icon
} from "@rebasepro/ui";
```

### The `cls()` Utility

Always use `cls()` from `@rebasepro/ui` for combining class names. Never use template literals for conditional classes.

```tsx
// ✅ CORRECT
<div className={cls("p-4 rounded-lg", isActive && "bg-primary/10")} />

// ❌ WRONG
<div className={`p-4 rounded-lg ${isActive ? "bg-primary/10" : ""}`} />
```

---

## 3. Color System

### Design Token Scale

Rebase uses a carefully defined set of CSS custom properties. **Never invent arbitrary color values.** Always reference these tokens.

#### Primary & Secondary

| Token                  | Value        | Usage                                    |
|------------------------|--------------|------------------------------------------|
| `--color-primary`      | `#0070F4`    | Primary actions, links, focus rings       |
| `--color-primary-light`| oklch derived| Lighter tint of primary                   |
| `--color-primary-dark` | oklch derived| Darker shade of primary                   |
| `--color-secondary`    | `#E11D48`    | Secondary accent (marketing; not a control colour) |
| `--color-primary-bg`   | primary/0.1  | Subtle primary backgrounds               |

#### Role Surfaces (what a background is chosen by)

A surface is named by **role**, and the theme decides the value — the role
tokens switch between light and dark on their own, so they need no `dark:`
pair. Never write `bg-white dark:bg-surface-900` or any other numbered
light/dark pair. The ladder and its rules are in `packages/ui/DESIGN.md`.

| Class                          | Light       | Dark        | Used for                                         |
|--------------------------------|-------------|-------------|--------------------------------------------------|
| `bg-surface-frame`             | `#eff0f3`   | `#090a0c`   | drawer, rail, app bar, the page around the sheet |
| `bg-surface-sheet`             | `#f8f9fa`   | `#111316`   | the content area (a page's background)           |
| `bg-surface-card`              | `#ffffff`   | `#16181c`   | cards, paper, dialogs, menus, table rows         |
| `hover:bg-surface-card-hover`  | `#f6f7f9`   | `#1b1d21`   | a clickable card or row                          |
| `bg-surface-raised`            | `#eaecef`   | `#212429`   | neutral buttons, chips, tiles inside a card      |
| `bg-surface-field`             | black 3.5%  | white 4%    | inputs, search, segmented tracks                 |
| `hover:bg-surface-hover`       | black 4%    | white 6%    | hover on a transparent row, nav item, menu item  |
| `bg-surface-active`            | black 7%    | white 9%    | selected or checked item                         |
| `bg-surface-well`              | `#f4f5f7`   | `#090a0c`   | an inset code well (`codeSurfaceMixin`)          |
| `border-hairline`              | black 8%    | white 8%    | cards on the sheet, fields, dividers             |
| `border-hairline-strong`       | black 13%   | white 14%   | menus, popovers, dialogs, outlined buttons       |

#### Surface Scale (Neutrals)

The numbered scale below is the palette *under* the roles. It stays exported
for the marketing site and custom fields, but inside the kit it is no longer
how a background is chosen.

Every neutral in the system — this scale, the text tokens, the role surfaces —
is **Graphite**: `oklch(L c 258)`, the brand blue's hue at a chroma too low to
read as blue. Never write a pure grey (`#131313`, `#737373`) or a Tailwind
zinc value (`#a1a1aa`, hue 286°) by hand; Tailwind's `zinc`, `neutral`,
`gray` and `stone` palettes are re-pointed at Graphite in the kit, and a test
(`packages/ui/test/neutral-hue.test.ts`) fails on any neutral token off the hue.

The surface scale goes from `50` (lightest) to `950` (darkest):

| Token              | Value       |
|--------------------|-------------|
| `surface-50`       | `#f9fafb`   |
| `surface-100`      | `#f4f5f7`   |
| `surface-200`      | `#e3e5e9`   |
| `surface-300`      | `#d1d4d9`   |
| `surface-400`      | `#9ea4ab`   |
| `surface-500`      | `#747a81`   |
| `surface-600`      | `#3c4046`   |
| `surface-700`      | `#23262b`   |
| `surface-800`      | `#0f1114`   |
| `surface-900`      | `#090a0c`   |
| `surface-950`      | `#000000`   |

#### Surface Accent Scale (Slate: the brand hue at a higher chroma)

Survives as a text colour (the icons in neutral buttons and icon buttons) and
as the unchecked `Checkbox` border; it paints no background in the kit. Full
50–950 range:

| Token                     | Value       |
|---------------------------|-------------|
| `surface-accent-50`       | `#f8fafc`   |
| `surface-accent-100`      | `#f2f5f9`   |
| `surface-accent-200`      | `#e2e8f0`   |
| `surface-accent-300`      | `#ccd5e1`   |
| `surface-accent-400`      | `#94a3b8`   |
| `surface-accent-500`      | `#64748b`   |
| `surface-accent-600`      | `#475569`   |
| `surface-accent-700`      | `#334155`   |
| `surface-accent-800`      | `#1d293b`   |
| `surface-accent-900`      | `#152133`   |
| `surface-accent-950`      | `#0c182a`   |

#### Text Colors

| Token                    | Value      | Usage                                    |
|--------------------------|------------|------------------------------------------|
| `text-primary`           | `#1e2126`  | Default text (light mode)                |
| `text-secondary`         | `#646971`  | Secondary/helper text (light mode)       |
| `text-disabled`          | `#868c94`  | Disabled text (light mode)               |
| `text-primary-dark`      | `#f6f7f8`  | Default text (dark mode)                 |
| `text-secondary-dark`    | `#aeb3ba`  | Secondary/helper text (dark mode)        |
| `text-disabled-dark`     | `#7d828a`  | Disabled text (dark mode)                |

### Color Rules

1. **NEVER use arbitrary Tailwind colors** like `text-violet-600`, `bg-indigo-500`, `text-fuchsia-500`, `bg-rose-500` for structural UI elements. These are only acceptable inside semantic status indicators (e.g., pipeline stage colors).
2. **NEVER use gradient text** (`bg-gradient-to-r ... bg-clip-text text-transparent`) for titles or headings. Use `Typography` with its built-in color prop.
3. **NEVER use glassmorphism** (`backdrop-blur`, `backdrop-filter`, semi-transparent backgrounds) for cards or panels. Use the `Card`, `Paper` components or the role surface `bg-surface-card`.
4. **All borders must use `defaultBorderMixin`** — never hardcode border colors like `border-surface-200` or `border-gray-300`.
5. **`#0070F4` is tuned as a fill, not as ink.** White on it, or it on white, is
   correct. Read as *text* on a `surface-900` card it measures **4.36:1** — below
   AA, and every accent link in the product sits on exactly that surface. Dark
   mode uses `primary-light` for accent **text** (7.34:1); fills are untouched.
   Do not hand-write `text-primary` on a dark surface.
6. **Never hardcode chip or badge ink.** `Chip` derives its own foreground from
   the background it will actually sit on, walking a hue-tinted colour toward
   black or white only as far as it must to clear the contrast floor — and an
   `outlined` chip drops its fill and sits on the *page*, so it uses a separately
   measured ink. One value cannot be legible against two surfaces. Writing
   `text-white` on a chip is how 63 of 120 hue/tone/mode pairs ended up below AA.

---

## 4. Typography

### The `Typography` Component

**MANDATORY**: Use `Typography` for ALL visible text. Never use raw `<h1>`, `<p>`, `<span>`, `<label>` tags.

### Variant Scale

The scale is compact — built for content density — and spans **three weights:
400 / 500 / 600. Semibold (600) is the ceiling — nothing goes to 700.** The
ladder is monotonic: semibold for `h1`–`h4`, medium for `h5`, `h6` and small
labels, regular for copy. The display end separates itself by size and
tracking, not by weight.

| Variant      | CSS Class             | Rendered Element | Specs                                                  |
|--------------|-----------------------|------------------|---------------------------------------------------------|
| `h1`         | `typography-h1`       | `<h1>`           | 4xl, font-headers, font-semibold, tracking-display      |
| `h2`         | `typography-h2`       | `<h2>`           | 3xl, font-headers, font-semibold, tracking-display      |
| `h3`         | `typography-h3`       | `<h3>`           | 2xl, font-headers, font-semibold, tracking-title        |
| `h4`         | `typography-h4`       | `<h4>`           | xl, font-headers, font-semibold, tracking-title         |
| `h5`         | `typography-h5`       | `<h5>`           | lg, font-headers, font-medium, tracking-heading         |
| `h6`         | `typography-h6`       | `<h6>`           | base, font-headers, font-medium, tracking-heading       |
| `subtitle1`  | `typography-subtitle1`| `<h6>`           | sm, font-headers, font-medium, tracking-heading         |
| `subtitle2`  | `typography-subtitle2`| `<h6>`           | sm, font-headers, font-medium                           |
| `lead`       | `typography-lead`     | `<p>`            | base, leading-relaxed                                   |
| `body1`      | `typography-body1`    | `<p>`            | sm                                                      |
| `body2`      | `typography-body2`    | `<p>`            | xs                                                      |
| `caption`    | `typography-caption`  | `<p>`            | [11px], leading-[1.4]                                   |
| `micro`      | `typography-micro`    | `<span>`         | 2xs, font-medium, uppercase, tracking-[0.08em]          |
| `mono`       | `typography-mono`     | `<span>`         | font-mono, tabular-nums                                 |
| `stat`       | `typography-stat`     | `<span>`         | 3xl, font-headers, font-semibold, tracking-display, tabular-nums |
| `label`      | `typography-label`    | `<label>`        | xs, font-medium, tracking-wide                          |
| `inherit`    | `typography-inherit`  | `<p>`            | text-inherit (inherits parent sizing)                   |
| `button`     | `typography-button`   | `<span>`         | sm, font-medium (sentence case, no tracking)            |

**The three tiers people most often improvise, and should not:**

- **`lead`** is the sentence under a page title. Without it that line borrows
  `body2` (12px), so the one line explaining what a page is *for* ends up smaller
  than the page's own table rows.
- **`micro`** is the uppercase field label above a value — the single sanctioned
  tier below `text-xs`, and it earns the exception by never carrying a sentence.
  Do not set anything a person reads at `2xs`.
- **`mono`** carries `tabular-nums`. Proportional digits make a column of
  measurements ragged and a live counter jitter as its glyphs change width.

### Color Prop

| Value        | Class applied                                          | Notes                         |
|--------------|--------------------------------------------------------|-------------------------------|
| `"primary"`  | `text-text-primary dark:text-text-primary-dark`        | Default — standard text       |
| `"secondary"`| `text-text-secondary dark:text-text-secondary-dark`    | Helper/description text       |
| `"disabled"` | `text-text-disabled dark:text-text-disabled-dark`      | Disabled state                |
| `"error"`    | `text-red-600 dark:text-red-500`                       | Error messages                |
| `"inherit"`  | `text-inherit`                                         | Inherits color from parent    |
| `"initial"`  | `text-current`                                         | Uses CSS `currentColor`       |

### Typography Usage Examples

```tsx
// Page title — use h4 or h5 (the scale is compact; h1-h3 are reserved for hero contexts)
<Typography variant="h4">Dashboard</Typography>

// Section title
<Typography variant="h6">Pipeline Overview</Typography>

// Card title
<Typography variant="subtitle1" component="h2">Active Leads</Typography>

// Description / helper text
<Typography variant="body2" color="secondary">
    Manage your pipeline here.
</Typography>

// Small label above a metric
<Typography variant="caption" color="secondary">Total Revenue</Typography>
```

### Typography Anti-Patterns

```tsx no-verify
// ❌ NEVER: Gradient text on headings
<Typography className="bg-gradient-to-r from-violet-600 to-cyan-500 bg-clip-text text-transparent">

// ❌ NEVER: Going above semibold. 600 is the ceiling of the system —
// font-bold/extrabold/black are never correct, on any surface.
<Typography className="font-bold">

// ❌ NEVER: Custom tracking/sizing overrides
<Typography className="tracking-widest text-[10px] uppercase">

// ✅ CORRECT: Let Typography variants handle all styling
<Typography variant="caption" color="secondary">Label Text</Typography>
```

---

## 5. Layout Patterns

### Page-Level Layout

The reference layout used by `ContentHomePage` (the default Rebase home page):

```tsx
<div className="py-2 overflow-auto h-full w-full bg-surface-sheet">
    <Container maxWidth="6xl">
        {/* Content sections */}
        …
    </Container>
</div>
```

Key rules:
- **Wrap content in `<Container>`** with an appropriate `maxWidth` (`4xl`, `5xl`, `6xl`, `7xl`).
- **Page background**: the role surface `bg-surface-sheet` — never a numbered light/dark pair such as `bg-surface-50 dark:bg-surface-950`.
- **Use `overflow-auto h-full w-full`** on the outermost wrapper so the page scrolls inside the admin shell.

### Card Grid Layout

For grids of cards (like navigation cards on the home page):

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {/* Cards */}
</div>
```

- Use consistent `gap-4` (not `gap-6` or `gap-8`).
- Use the responsive breakpoints: 1 column → 2 columns at `md` → 3 columns at `lg`.

### Section Spacing

- Between major sections: `my-10` (from `NavigationGroup`)
- Between subsections: `mb-4` or `mt-4`
- Inside cards: `p-4` (standard), `p-6` (for larger panels)

---

## 6. Card Patterns

### Using the `Card` Component

The `Card` component from `@rebasepro/ui` automatically applies `cardMixin` and, if an `onClick` is provided, `cardClickableMixin`.

```tsx
// Style mixins applied by Card:
// cardMixin = "bg-surface-card rounded-xl border border-hairline"
// cardClickableMixin = "hover:bg-surface-card-hover cursor-pointer transition-colors duration-150"
```

```tsx no-verify
// ✅ CORRECT: Using Card component
<Card className="p-4">
    <Typography variant="subtitle1">Title</Typography>
    <Typography variant="body2" color="secondary">Description</Typography>
</Card>

// ✅ CORRECT: Clickable card
<Card onClick={() => navigate("/details")} className="p-4">
    <Typography variant="subtitle1">Title</Typography>
</Card>

// ❌ WRONG: Hand-rolled card with custom styling
<div className="glass-card p-6 rounded-2xl shadow-sm backdrop-blur-md">
```

### Card Anti-Patterns

| ❌ Don't                                          | ✅ Do                                         |
|---------------------------------------------------|-----------------------------------------------|
| `rounded-2xl`                                     | Let `Card` use its own `rounded-xl`           |
| `shadow-lg shadow-blue-500/20`                    | No shadows — hover is `bg-surface-card-hover` only |
| `hover:-translate-y-1`                            | Don't lift cards on hover                     |
| `hover:scale-110` on icons                        | Use subtle `transition-colors` at most        |
| `bg-gradient-to-br from-blue-500 to-indigo-600`  | Use plain surface colors                      |
| `glass-card`, `glass-panel`, backdrop-blur        | Use `Card` or `Paper` component               |
| `hover:shadow-md`, `hover:ring-1`                | Pass `onClick` to `Card`; it hovers to `bg-surface-card-hover` |

### NavigationCard Reference Pattern

This is the gold standard for how a card should look:

```tsx
<Card
    onClick={onClick}
    className="group h-full p-4 cursor-pointer transition-colors duration-150 ease-in-out"
>
    <div className="flex flex-col h-full">
        {/* Header: icon + title left, actions right */}
        <div className="flex items-center w-full justify-between mb-1">
            <div className="flex items-center gap-3">
                {/* Icon: plain muted color, no background pill */}
                <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500 transition-colors duration-150 group-hover:text-primary dark:group-hover:text-primary">
                    {icon}
                </div>
                <Typography variant="subtitle1" component="h2">{title}</Typography>
            </div>
        </div>
        {/* Description indented to align with title */}
        <div className="pl-8">
            <Typography variant="caption" color="secondary" component="div">
                <Markdown source={description} size="small" />
            </Typography>
        </div>
        <div className="grow"/>
    </div>
</Card>
```

**Key observations from NavigationCard:**
- Icons are **plain muted color** (`text-surface-400 dark:text-surface-500`) at rest — no background pill, no gradient. The one tint is `group-hover:text-primary` while the card is hovered.
- Hover effect is a **single background color change**, and `Card` supplies it: with an `onClick` it applies `cardClickableMixin` (`hover:bg-surface-card-hover`). No shadows, no border changes, no rings.
- The card transitions use `transition-colors duration-150` — fast and minimal.
- No arrow icon or decorative footer — the card is the affordance.
- Description is offset with `pl-8` to align with the title (past the icon).

---

## 7. Style Mixins (`@rebasepro/ui`)

Always import and use these mixins rather than hardcoding equivalent classes. They are on the package barrel; there is no `@rebasepro/ui/styles` subpath for an installed consumer.

### Layout & Card Mixins

| Mixin                        | Classes                                                                                              |
|------------------------------|------------------------------------------------------------------------------------------------------|
| `defaultBorderMixin`         | `border-hairline` (colour only — pair it with `border`)                                              |
| `paperMixin`                 | `bg-surface-card rounded-lg border border-hairline-strong` — a floating surface                      |
| `cardMixin`                  | `bg-surface-card rounded-xl border border-hairline` — a card in the document flow                   |
| `codeSurfaceMixin`           | `bg-surface-well rounded-md`                                                                         |
| `cardClickableMixin`         | `hover:bg-surface-card-hover cursor-pointer transition-colors duration-150`                          |
| `cardSelectedMixin`          | `bg-primary-bg/30 dark:bg-primary-bg/10 ring-1 ring-primary/75`                                     |
| `accentTextMixin`            | `text-primary dark:text-primary-light` — the accent as text (links, accent labels)                   |
| `surfaceHoverMixin`          | `hover:bg-surface-hover transition-colors duration-150` — hover on a transparent row or item         |
| `surfaceActiveMixin`         | `bg-surface-active` — the selected row or item                                                       |

### Field & Focus Mixins

| Mixin                            | Classes                                                                                          |
|----------------------------------|--------------------------------------------------------------------------------------------------|
| `fieldBackgroundMixin`           | `bg-surface-field border border-hairline`                                                        |
| `fieldBackgroundInvisibleMixin`  | `bg-transparent` — fully transparent field background                                            |
| `fieldBackgroundDisabledMixin`   | `bg-surface-field/60` — disabled field background                                                |
| `fieldBackgroundHoverMixin`      | `transition-colors duration-150 hover:bg-surface-field-hover` — hover highlight for fields       |
| `focusedClasses`                 | `z-30 outline-none ring-2 ring-primary/60 ring-offset-0 ring-offset-transparent` — an outset focus ring |
| `focusedDisabled`                | `focus-visible:ring-0 focus-visible:ring-offset-0` — removes the focus ring                      |
| `focusedInvisibleMixin`          | `focus:bg-surface-field-hover` — subtle bg on focus for invisible fields                         |

### `cardSelectedMixin` Usage

Use `cardSelectedMixin` to visually mark a card as the active/selected item in a list or grid:

```tsx
import { Card, cls, cardSelectedMixin } from "@rebasepro/ui";

<Card className={cls("p-4", isSelected && cardSelectedMixin)}>
    <Typography variant="subtitle1">{item.name}</Typography>
</Card>
```

The mixin applies a subtle primary-tinted background and a `ring-1` primary border, matching the Rebase selection style used in entity tables and multi-select UIs.

---

## 8. Buttons

### Valid Button Variants

The `Button` component accepts these variants and colors. Buttons use `rounded-lg`, `transition-colors`, and no active scale effect.

`color` defaults to `"neutral"`, which paints `surface-raised` — that is what almost every button is. A filled `primary` button is the **one** main action a screen has (add, save, publish). `secondary` and `error` are for destructive confirmations and the marketing site, not the panel's chrome.

```tsx
<Button variant="filled" color="primary">Primary Action</Button>
<Button>Neutral Action</Button>
<Button variant="outlined">Secondary Action</Button>
<Button variant="text">Tertiary Action</Button>
```

| Prop      | Values                                        |
|-----------|-----------------------------------------------|
| `variant` | `"filled"` (default), `"outlined"`, `"text"`  |
| `color`   | `"primary"`, `"secondary"`, `"text"`, `"error"`, `"neutral"` (default) |
| `size`    | `"smallest"`, `"small"`, `"medium"` (default), `"large"`, `"xl"`, `"2xl"` |

### Button Styling Details

- Base shape: `rounded-lg` (not `rounded-md`)
- Transitions: `transition-colors` (not `transition-all`)
- Label: `typography-button` — 14px, weight 500, sentence case, no tracking. Never add `uppercase`, `font-semibold` or `tracking-wide`.
- Filled hover: `hover:brightness-105` on primary/secondary (subtle, not `hover:brightness-110`); neutral steps to `surface-raised-hover`
- No `shadow-sm`, no `hover:shadow-md`, no `active:scale-[0.98]`

### Button Anti-Patterns

```tsx no-verify
// ❌ NEVER: Casting variant to bypass types
<Button variant={"standard" as any}>

// ❌ NEVER: Custom gradient backgrounds
<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white">

// ❌ NEVER: Custom shadow styling
<Button className="shadow-lg shadow-violet-500/20 hover:shadow-xl">

// ❌ NEVER: Active scale effect
<Button className="active:scale-[0.98]">

// ✅ CORRECT: Use proper variant and color
<Button variant="filled" color="primary">Submit</Button>
<Button variant="text">Cancel</Button>
<Button variant="text" color="primary" startIcon={<RefreshCwIcon />}>Refresh</Button>
```

---

## 9. Alerts & Status Messages

### Use the `Alert` Component

```tsx no-verify
// ✅ CORRECT
<Alert color="success" size="small">Lead captured successfully!</Alert>
<Alert color="error">Could not load dashboard statistics.</Alert>
<Alert color="info">Data is refreshing...</Alert>
<Alert color="warning">Some metrics may be stale.</Alert>

// ❌ WRONG: Hand-rolled alert div
<div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600">
```

| `color` prop | Usage                |
|-------------|----------------------|
| `"error"`   | Error messages       |
| `"warning"` | Warnings             |
| `"info"`    | Informational        |
| `"success"` | Success confirmations|
| `"base"`    | Neutral notices      |

---

## 10. Section Headers

### How to Title a Section

Follow the `NavigationGroup` pattern — section headers are **small, uppercase, secondary-colored labels** in the `micro` tier, not large bold headings:

```tsx
// ✅ CORRECT: Section header pattern (from NavigationGroup)
<Typography
    variant="micro"
    component="h2"
    color="secondary"
    className="py-1 rounded"
>
    Pipeline Stages
</Typography>

// ❌ WRONG: Oversized bold section title
<Typography variant="h6" className="font-bold text-surface-950 dark:text-surface-50">
    Pipeline Stage Distribution
</Typography>
```

For panel-level titles (inside a Card or Paper), use `subtitle1`:

```tsx
<Card className="p-4">
    <Typography variant="subtitle1" className="mb-2">Tasks</Typography>
    {/* content */}
</Card>
```

---

## 11. Metric / KPI Cards

When displaying numeric KPIs, use plain muted icons (matching NavigationCard) — no background pill:

```tsx
<Card className="p-4">
    <div className="flex items-center gap-3">
        {/* Icon: plain muted color, no background */}
        <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500">
            <UsersIcon className="h-4 w-4" />
        </div>
        <div>
            <Typography variant="caption" color="secondary">Active Leads</Typography>
            <Typography variant="h5">{count}</Typography>
        </div>
    </div>
</Card>
```

### Metric Card Anti-Patterns

```tsx no-verify
// ❌ NEVER: Gradient icon backgrounds
<div className="p-4 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl shadow-lg shadow-blue-500/20">

// ❌ NEVER: Primary-tinted icon pill (old pattern)
<div className="w-10 h-10 rounded-lg bg-primary/8 dark:bg-primary/10 text-primary/70">

// ❌ NEVER: Oversized rounded corners
<div className="rounded-2xl">

// ❌ NEVER: Animated hover scaling on icon containers
<div className="group-hover:scale-110 transition-transform">

// ❌ NEVER: Gradient text on values
<Typography className="bg-gradient-to-r from-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
```

---

## 12. Icons

- Never add a direct `lucide-react` dependency.
- Import icons from `@rebasepro/ui`, which re-exports a curated set of lucide icons under their lucide names with an `Icon` suffix — `PlusIcon`, `Trash2Icon`, `ArrowRightIcon`. There are no `AddIcon` or `DeleteIcon` exports. An icon outside that set (`packages/ui/src/icons/index.ts`) is not exported by name: render it with `<LucideIconByName name="…" />`.
- **Icon treatment**: plain muted color (`text-surface-400 dark:text-surface-500`). **No** background pill, **no** primary tint at rest, **no** gradients.
- Icon size: typically `h-4 w-4` or `h-5 w-5`.
- No decorative arrow icons on cards — the card itself is the affordance.

---

## 13. Panels & Sections (Non-Card Wrappers)

For larger content sections (like a table, form, or embedded panel), use `Paper` or apply `paperMixin`:

```tsx
// Using Paper component
<Paper className="p-4">
    <CollectionPanel path="tasks" title={false} />
</Paper>

// Or with cls and paperMixin
<div className={cls(paperMixin, "p-4")}>
    {/* content */}
</div>
```

### Panel Anti-Patterns

```tsx no-verify
// ❌ WRONG: Custom panel styling
<div className="p-6 rounded-2xl border bg-white dark:bg-surface-900/50 backdrop-blur-md shadow-sm">

// ✅ CORRECT: Use Paper or paperMixin
<Paper className="p-4">
```

---

## 14. Forms

Form inputs should use `@rebasepro/ui` components directly without excessive class overrides:

```tsx
// ✅ CORRECT
<TextField label="Client Name" value={clientName} onChange={e => setClientName(e.target.value)} />
<Select label="Package" value={pkg} onValueChange={setPkg}>
    <SelectItem value="basic">Basic</SelectItem>
    <SelectItem value="premium">Premium</SelectItem>
</Select>

// ❌ WRONG: Overriding input styling
<TextField className="rounded-lg border-surface-200 dark:border-surface-850 focus:border-violet-500 focus:ring-violet-500" />
```

---

## 15. Responsive Layout Rules

1. **Container-aware, not viewport-aware**: Use `ResizeObserver` on the actual container, NOT media queries, for adaptive layout in split panels.
2. **Refs that observers depend on MUST render unconditionally.**
3. **One component, adaptive rendering**: Prefer a single component that adapts to its container width.

---

## 16. Font Stack

```css
--font-sans: 'Inter Variable', 'Inter', ui-sans-serif, system-ui, 'Helvetica', 'Arial', sans-serif;
--font-headers: 'Instrument Sans Variable', 'Instrument Sans', 'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'Space Mono', 'Lucida Console', monospace;
```

**Instrument Sans for headings, Inter for UI and body copy, JetBrains Mono for
anything measured** (counts, sizes, timestamps, ids — the `mono` tier).

Ensure `@fontsource-variable/inter`, `@fontsource-variable/instrument-sans` and
`@fontsource/jetbrains-mono` are imported in the entry file, as a scaffolded
project's `App.tsx` does.

---

## 17. Dark Mode

- Rebase uses `dark:` variant for dark mode classes.
- Custom variant: `@custom-variant dark (&:where(.dark, .dark *))`.
- **Always provide dark mode equivalents** for any custom styling.
- The role surfaces switch on their own and need no `dark:` pair:
  - Page: `bg-surface-sheet`
  - Cards: `bg-surface-card`
  - Borders: `border-hairline`

---

## 18. CSS-Only Rules (index.css)

The project CSS file should:

1. Import Tailwind and the UI kit CSS:
   ```css
   @import "tailwindcss";
   @import "@rebasepro/ui/index.css" layer(base);
   ```
2. Source the UI kit JS for Tailwind scanning:
   ```css
   @source "../node_modules/@rebasepro";
   ```
3. Define the dark mode variant:
   ```css
   @custom-variant dark (&:where(.dark, .dark *));
   ```
4. **Do NOT add custom utility classes** that duplicate what the UI kit provides (e.g., `glass-card`, `glass-panel`, custom shimmer animations).
5. **Do NOT add custom color tokens** that conflict with the UI kit's token scale.

---

## 19. Complete Anti-Pattern Checklist

Before submitting UI code, verify you have NONE of these:

| # | Anti-Pattern                                         | Fix                                                    |
|---|------------------------------------------------------|--------------------------------------------------------|
| 1 | Raw HTML (`<h1>`, `<p>`, `<span>`, `<label>`)       | Use `Typography` with appropriate variant              |
| 2 | Hardcoded border colors                               | Use `defaultBorderMixin`                               |
| 3 | `as any` type casts on component props                | Use correct prop values from component types           |
| 4 | Template literal class concatenation                  | Use `cls()` from `@rebasepro/ui`                       |
| 5 | Gradient text on headings                             | Remove gradient, use `Typography` color prop           |
| 6 | Glassmorphism (`backdrop-blur`, translucent bg)       | Use `Card`, `Paper`, or solid backgrounds              |
| 7 | `rounded-2xl` on cards/panels                         | Use `Card` (`rounded-xl`) / `Paper` (`rounded-lg`)     |
| 8 | Colored gradient or primary-tinted icon backgrounds   | Use plain `text-surface-400 dark:text-surface-500`     |
| 9 | `hover:-translate-y-1` or `hover:scale-110`           | Don't lift or scale on hover                           |
| 10| Custom shadow colors (`shadow-blue-500/20`)           | No shadows on hover — `Card` with `onClick` hovers to `bg-surface-card-hover` |
| 11| `animate-bounce`, `animate-pulse` on alerts           | Use static `Alert` component                           |
| 12| Custom CSS classes like `glass-card`, `shimmer-shine` | Remove and use standard UI kit patterns                |
| 13| `font-bold`/`font-extrabold` overrides on Typography  | Let the variant handle font weight — 600 is the ceiling |
| 14| `text-[10px]`, `tracking-widest` custom overrides     | Use `Typography variant="micro"` (uppercase label) or `"caption"` |
| 15| Per-card colored themes (blue card, green card, etc.) | Use uniform `Card` with plain muted icons              |
| 16| A numbered light/dark pair for a page background (`bg-surface-50 dark:bg-surface-950`) | Use the role surface `bg-surface-sheet` |
| 17| Arbitrary Tailwind colors (`text-violet-600`, etc.)   | Use design token colors                                |
| 18| `hover:shadow-md`, `hover:ring-1` on cards            | Pass `onClick` to `Card` (`hover:bg-surface-card-hover`) |
| 19| `active:scale-[0.98]` on buttons                      | Buttons don't scale — use `transition-colors` only     |
| 20| Hand-picked border colours (`border-surface-700/60`)  | Use `defaultBorderMixin` (`border-hairline`)           |
| 21| `bg-primary/8` icon background pills                  | Icons are plain color, no background container         |
| 22| Decorative arrow icons on cards                       | Cards are the affordance — no `ArrowRightIcon` needed  |

> **IMPORTANT FOR AGENTS:** The internal `EntityCardBinding` component (used for card-view in collection grids) uses `hover:-translate-y-0.5` and `hover:shadow-lg`. This is an **intentional exception** in Rebase's own codebase for rich media cards with thumbnails. **Do NOT copy this pattern** into custom views, home pages, or dashboard cards — it is reserved for that internal component.

---

## 20. Reference Components

When building new views, always reference these existing implementations. The paths are in the Rebase repository (read them on GitHub, `github.com/rebasepro/rebase`): the npm packages publish only `dist`, not `src`, so none of these files is in your `node_modules`. The reference itself is the exception — its compiled, readable copy is `node_modules/@rebasepro/app/dist/debug.js` (see §0).

| Component            | Location (in the Rebase repository)                         | What it demonstrates           |
|----------------------|-------------------------------------------------------------|--------------------------------|
| `UIReferenceView`    | `packages/app/src/debug/UIReferenceView.tsx`                | **Everything** — see §0        |
| `NavigationCard`     | `packages/cms/src/components/HomePage/NavigationCard.tsx`   | Card pattern, plain icon treatment |
| `SmallNavigationCard`| `packages/cms/src/components/HomePage/SmallNavigationCard.tsx` | Compact card with mixins    |
| `ContentHomePage`    | `packages/cms/src/components/HomePage/ContentHomePage.tsx`  | Page layout, Container usage   |
| `NavigationGroup`    | `packages/cms/src/components/HomePage/NavigationGroup.tsx`  | Section headers, grouping      |

Whole-view skeletons built from these live in **`references/view-patterns.md`**, next to this file.

---

## 21. Summary: The Design Philosophy

1. **Near-zero chrome.** The UI disappears so content is the interface. No decorative elements, no visual noise — only what serves the data.
2. **Data-first.** Every element exists to present or interact with data. If it doesn't serve the data, remove it.
3. **Quiet sophistication.** Hierarchy comes from subtle weight and size differentiation (semibold headings, medium subtitles, regular body) rather than dramatic size jumps or color contrasts.
4. **Monochromatic hierarchy.** One accent color (`primary` blue) used sparingly at low opacity. Icons are plain muted grays. No rainbow gradients, no per-card color themes.
5. **Content density.** Smaller type, tighter spacing, more data per viewport. The compressed typography scale (`sm` body text, `xs` captions, `[11px]` fine print) maximizes information density without sacrificing readability.
