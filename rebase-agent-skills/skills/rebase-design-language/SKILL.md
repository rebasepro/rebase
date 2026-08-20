---
name: rebase-design-language
description: |
  Comprehensive Rebase UI Design Language specification. Use this skill whenever building, modifying, or reviewing any UI view, custom page, or home page in a Rebase project. This skill covers the exact design tokens, color system, typography scale, spacing conventions, layout patterns, component usage rules, and common anti-patterns to avoid. Agents MUST read this skill before creating or modifying any visual UI.
---

# Rebase Design Language

This document is the single source of truth for the visual design language used across all Rebase applications. Every custom view, home page, dashboard, or UI component **must** follow these rules exactly.

---

## 0. Ground truth — the UI reference ships with your project

Rebase ships a live reference of every UI pattern it uses. **It is installed in your project already** — you do not need the Rebase monorepo to see it.

### Read the source

The reference is plain TSX, shipped in the `@rebasepro/app` package. Read it directly:

```
node_modules/@rebasepro/app/src/components/Debug/UIReferenceView.tsx
node_modules/@rebasepro/app/src/components/Debug/crm-dashboard/       # dashboard composition
node_modules/@rebasepro/app/src/components/Debug/collection-views/    # table, card, kanban
```

Its header says *"All markup / styles are copied verbatim from source files. DO NOT add invented styles."* — that makes it the highest-fidelity reference available. **When this document and `UIReferenceView.tsx` disagree, the file wins.**

### See it rendered

The route is registered by `@rebasepro/admin` in every Rebase app. Start the dev server and open:

```
http://localhost:5173/debug/ui
```

It is hidden (not linked from the drawer) but always present. Use it to check spacing and dark mode before you call a view done.

### What to read for what you're building

| Building | Read |
|---|---|
| Any view at all | `references/view-patterns.md` (whole-view skeletons) |
| A list of records | `Debug/collection-views/CollectionTableDemo.tsx` |
| A dashboard / home page | `Debug/crm-dashboard/CrmDashboardDemo.tsx`, `DashboardMetrics.tsx` |
| A card or kanban layout | `Debug/collection-views/CardViewDemo.tsx`, `KanbanBoardDemo.tsx` |
| A form or dialog | `UIReferenceView.tsx` → `user-dialog` section |
| Component props & API | the `rebase-ui-components` skill |

### The rule

Before writing a new view, **read `references/view-patterns.md` and copy the closest skeleton**. Extend an existing pattern; do not invent a layout. If nothing fits, read `UIReferenceView.tsx` and compose from the sections there.

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
| `--color-secondary`    | `#FF5B79`    | Secondary accent                          |
| `--color-primary-bg`   | primary/0.1  | Subtle primary backgrounds               |

#### Surface Scale (Neutrals)

The surface scale goes from `50` (lightest) to `950` (darkest):

| Token              | Value       | Light mode usage       | Dark mode usage        |
|--------------------|-------------|------------------------|------------------------|
| `surface-50`       | `#fafafa`   | Page background        | —                      |
| `surface-100`      | `#f5f5f5`   | Subtle backgrounds     | —                      |
| `surface-200`      | `#e5e5e5`   | Borders, dividers      | —                      |
| `surface-300`      | `#d4d4d4`   | Hover borders          | —                      |
| `surface-400`      | `#a3a3a3`   | Muted text, placeholders | —                    |
| `surface-500`      | `#737373`   | Secondary icons        | Secondary icons        |
| `surface-600`      | `#404040`   | —                      | Muted text, labels     |
| `surface-700`      | `#262626`   | —                      | Borders, dividers      |
| `surface-800`      | `#111111`   | —                      | Page background        |
| `surface-900`      | `#0a0a0a`   | —                      | Card backgrounds       |
| `surface-950`      | `#000000`   | —                      | Deepest backgrounds    |

#### Surface Accent Scale (Blue-tinted neutrals)

Used for subtle interactive backgrounds and input fields. Full 50–950 range:

| Token                     | Value       | Usage                              |
|---------------------------|-------------|-------------------------------------|
| `surface-accent-50`       | `#f8fafc`   | Lightest accent background         |
| `surface-accent-100`      | `#f1f5f9`   | Hover backgrounds (light)          |
| `surface-accent-200`      | `#e2e8f0`   | Field backgrounds (light)          |
| `surface-accent-300`      | `#cbd5e1`   | Accent borders (light)             |
| `surface-accent-400`      | `#94a3b8`   | Muted accent text                  |
| `surface-accent-500`      | `#64748b`   | Mid-tone accent                    |
| `surface-accent-600`      | `#475569`   | Accent labels (dark)               |
| `surface-accent-700`      | `#334155`   | Field backgrounds (dark)           |
| `surface-accent-800`      | `#1e293b`   | Hover backgrounds (dark)           |
| `surface-accent-900`      | `#172033`   | Deep accent background (dark)      |
| `surface-accent-950`      | `#0f172a`   | Deepest accent background (dark)   |

#### Text Colors

| Token                    | Value      | Usage                                    |
|--------------------------|------------|------------------------------------------|
| `text-primary`           | `#212121`  | Default text (light mode)                |
| `text-secondary`         | `#757575`  | Secondary/helper text (light mode)       |
| `text-disabled`          | `#9e9e9e`  | Disabled text (light mode)               |
| `text-primary-dark`      | `#ffffff`  | Default text (dark mode)                 |
| `text-secondary-dark`    | `#a0a0a9`  | Secondary/helper text (dark mode)        |
| `text-disabled-dark`     | `#757580`  | Disabled text (dark mode)                |

### Color Rules

1. **NEVER use arbitrary Tailwind colors** like `text-violet-600`, `bg-indigo-500`, `text-fuchsia-500`, `bg-rose-500` for structural UI elements. These are only acceptable inside semantic status indicators (e.g., pipeline stage colors).
2. **NEVER use gradient text** (`bg-gradient-to-r ... bg-clip-text text-transparent`) for titles or headings. Use `Typography` with its built-in color prop.
3. **NEVER use glassmorphism** (`backdrop-blur`, `backdrop-filter`, semi-transparent backgrounds) for cards or panels. Use the `Card`, `Paper` components or standard `bg-white dark:bg-surface-900` backgrounds.
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
display tier separates itself by size and tracking, not by weight: medium at
4xl is a page title, semibold at 2xl is a section, medium at sm is UI chrome.

| Variant      | CSS Class             | Rendered Element | Specs                                                  |
|--------------|-----------------------|------------------|---------------------------------------------------------|
| `h1`         | `typography-h1`       | `<h1>`           | 4xl, font-headers, font-medium, tracking-display        |
| `h2`         | `typography-h2`       | `<h2>`           | 3xl, font-headers, font-medium, tracking-display        |
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
| `micro`      | `typography-micro`    | `<p>`            | 2xs, font-medium, uppercase, tracking-[0.08em]          |
| `mono`       | `typography-mono`     | `<p>`            | font-mono, tabular-nums                                 |
| `stat`       | `typography-stat`     | `<p>`            | 3xl, font-headers, font-semibold, tracking-display, tabular-nums |
| `label`      | `typography-label`    | `<label>`        | xs, font-medium, tracking-wide                          |
| `inherit`    | `typography-inherit`  | `<p>`            | text-inherit (inherits parent sizing)                   |
| `button`     | `typography-button`   | `<span>`         | sm, font-semibold, tracking-wide                        |

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
<div className="py-2 overflow-auto h-full w-full bg-surface-50 dark:bg-surface-800">
    <Container maxWidth="6xl">
        {/* Content sections */}
        …
    </Container>
</div>
```

Key rules:
- **Wrap content in `<Container>`** with an appropriate `maxWidth` (`4xl`, `5xl`, `6xl`, `7xl`).
- **Page background**: `bg-surface-50 dark:bg-surface-800` (not `dark:bg-surface-950`).
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
// cardMixin = "bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700/60"
// cardClickableMixin = "hover:bg-primary/5 dark:hover:bg-primary/5 cursor-pointer transition-colors duration-150"
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
| `rounded-2xl`                                     | Let `Card` use `rounded-lg`                   |
| `shadow-lg shadow-blue-500/20`                    | No shadows — hover uses `bg-surface-50` only  |
| `hover:-translate-y-1`                            | Don't lift cards on hover                     |
| `hover:scale-110` on icons                        | Use subtle `transition-colors` at most        |
| `bg-gradient-to-br from-blue-500 to-indigo-600`  | Use plain surface colors                      |
| `glass-card`, `glass-panel`, backdrop-blur        | Use `Card` or `Paper` component               |
| `hover:shadow-md`, `hover:ring-1`                | Use `hover:bg-surface-50 dark:hover:bg-surface-800` |

### NavigationCard Reference Pattern

This is the gold standard for how a card should look:

```tsx
<Card className={cls(
    "group h-full p-4 cursor-pointer transition-colors duration-150 ease-in-out",
    "hover:bg-surface-50 dark:hover:bg-surface-800"
)}>
    <div className="flex flex-col h-full">
        {/* Header: icon + title left, actions right */}
        <div className="flex items-center w-full justify-between mb-1">
            <div className="flex items-center gap-3">
                {/* Icon: plain muted color, no background pill */}
                <div className="flex items-center justify-center w-5 h-5 text-surface-400 dark:text-surface-500">
                    {icon}
                </div>
                <Typography variant="subtitle1" component="h2">{title}</Typography>
            </div>
        </div>
        {/* Description indented to align with title */}
        <div className="grow pl-8">
            <Typography variant="caption" color="secondary">
                <Markdown source={description} size="small" />
            </Typography>
        </div>
    </div>
</Card>
```

**Key observations from NavigationCard:**
- Icons are **plain muted color** (`text-surface-400 dark:text-surface-500`) — no background pill, no gradient, no primary tint.
- Hover effect is a **single background color change** — `hover:bg-surface-50 dark:hover:bg-surface-800`. No shadows, no border changes, no rings.
- The card transitions use `transition-colors duration-150` — fast and minimal.
- No arrow icon or decorative footer — the card is the affordance.
- Description is offset with `pl-8` to align with the title (past the icon).

---

## 7. Style Mixins (`@rebasepro/ui/styles`)

Always import and use these mixins rather than hardcoding equivalent classes:

### Layout & Card Mixins

| Mixin                        | Classes                                                                                              |
|------------------------------|------------------------------------------------------------------------------------------------------|
| `defaultBorderMixin`         | `border-surface-200 dark:border-surface-700/60`                                                      |
| `paperMixin`                 | `bg-white rounded-lg dark:bg-surface-900 border border-surface-200 dark:border-surface-700`          |
| `cardMixin`                  | `bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-700/60`       |
| `codeSurfaceMixin`           | `bg-surface-100 dark:bg-surface-950 rounded-md`                                                      |
| `cardClickableMixin`         | `hover:bg-primary/5 dark:hover:bg-primary/5 cursor-pointer transition-colors duration-150`           |
| `cardSelectedMixin`          | `bg-primary-bg/30 dark:bg-primary-bg/10 ring-1 ring-primary/75`                                     |

### Field & Focus Mixins

| Mixin                            | Classes                                                                                          |
|----------------------------------|--------------------------------------------------------------------------------------------------|
| `fieldBackgroundMixin`           | `bg-surface-accent-200/50 dark:bg-surface-900`                                                   |
| `fieldBackgroundInvisibleMixin`  | `bg-surface-accent-200/0 dark:bg-surface-900/0` — fully transparent field background             |
| `fieldBackgroundDisabledMixin`   | `bg-surface-accent-200/50 dark:bg-surface-900/90` — slightly opaque disabled state               |
| `fieldBackgroundHoverMixin`      | `hover:bg-surface-accent-200/70 hover:dark:bg-surface-700/40` — hover highlight for fields       |
| `focusedClasses`                 | `z-30 outline-none ring-2 ring-primary/75 ring-offset-0` — standard focus ring                   |
| `focusedDisabled`                | `focus-visible:ring-0 focus-visible:ring-offset-0` — removes focus ring for disabled elements    |
| `focusedInvisibleMixin`          | `focus:bg-surface-accent-100/70 dark:focus:bg-surface-900/60` — subtle bg on focus for invisible fields |

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

```tsx
<Button variant="filled" color="primary">Primary Action</Button>
<Button variant="outlined" color="primary">Secondary Action</Button>
<Button variant="text" color="primary">Tertiary Action</Button>
<Button variant="filled" color="neutral">Neutral Button</Button>
```

| Prop      | Values                                        |
|-----------|-----------------------------------------------|
| `variant` | `"filled"`, `"outlined"`, `"text"`            |
| `color`   | `"primary"`, `"secondary"`, `"text"`, `"error"`, `"neutral"` |
| `size`    | `"small"`, `"medium"`, `"large"`, `"xl"`, `"2xl"` |

### Button Styling Details

- Base shape: `rounded-lg` (not `rounded-md`)
- Transitions: `transition-colors` (not `transition-all`)
- Filled hover: `hover:brightness-105` (subtle, not `hover:brightness-110`)
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
<Button variant="outlined" color="primary">Cancel</Button>
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

Follow the `NavigationGroup` pattern — section headers are **small, uppercase, secondary-colored labels**, not large bold headings:

```tsx
// ✅ CORRECT: Section header pattern (from NavigationGroup)
<Typography
    variant="caption"
    component="h2"
    color="secondary"
    className="px-4 py-1 rounded font-medium text-[10px] uppercase tracking-[0.08em] text-surface-400 dark:text-surface-500"
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

- Import icons from `lucide-react` for functional/semantic icons.
- Import icons from `@rebasepro/ui` for navigation icons (`AddIcon`, `DeleteIcon`, etc.)
- **Icon treatment**: plain muted color (`text-surface-400 dark:text-surface-500`). **No** background pill, **no** primary tint, **no** gradients.
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
--font-sans: 'Instrument Sans Variable', 'Instrument Sans', ui-sans-serif, system-ui, 'Helvetica', 'Arial', sans-serif;
--font-headers: 'Instrument Sans Variable', 'Instrument Sans', ui-sans-serif, system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'Space Mono', 'Lucida Console', monospace;
```

**One face, Instrument Sans**, for headings and body alike. `--font-headers`
exists so headings can take their own weight and tracking tier, not because it
is a different family — mixing in a second face is what made earlier pages read
as two competing voices stacked on top of each other.

Ensure `@fontsource-variable/instrument-sans` and `@fontsource/jetbrains-mono`
are imported in the entry file.

---

## 17. Dark Mode

- Rebase uses `dark:` variant for dark mode classes.
- Custom variant: `@custom-variant dark (&:where(.dark, .dark *))`.
- **Always provide dark mode equivalents** for any custom styling.
- Standard dark mode backgrounds:
  - Page: `dark:bg-surface-800`
  - Cards: `dark:bg-surface-900`
  - Borders: `dark:border-surface-700`

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
   @source "../node_modules/@rebasepro/*/dist/**/*.js";
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
| 7 | `rounded-2xl` on cards/panels                         | Use `Card`/`Paper` which use `rounded-lg`              |
| 8 | Colored gradient or primary-tinted icon backgrounds   | Use plain `text-surface-400 dark:text-surface-500`     |
| 9 | `hover:-translate-y-1` or `hover:scale-110`           | Don't lift or scale on hover                           |
| 10| Custom shadow colors (`shadow-blue-500/20`)           | No shadows on hover — use `hover:bg-surface-50` only   |
| 11| `animate-bounce`, `animate-pulse` on alerts           | Use static `Alert` component                           |
| 12| Custom CSS classes like `glass-card`, `shimmer-shine` | Remove and use standard UI kit patterns                |
| 13| `font-bold`/`font-extrabold` overrides on Typography  | Let the variant handle font weight — 600 is the ceiling |
| 14| `text-[10px]`, `tracking-widest` custom overrides     | Use `Typography variant="caption"`                     |
| 15| Per-card colored themes (blue card, green card, etc.) | Use uniform `Card` with plain muted icons              |
| 16| `dark:bg-surface-950` for page background             | Use `dark:bg-surface-800`                              |
| 17| Arbitrary Tailwind colors (`text-violet-600`, etc.)   | Use design token colors                                |
| 18| `hover:shadow-md`, `hover:ring-1` on cards            | Use `hover:bg-surface-50 dark:hover:bg-surface-800`   |
| 19| `active:scale-[0.98]` on buttons                      | Buttons don't scale — use `transition-colors` only     |
| 20| `border-*/60` opacity on borders                      | Use solid borders via `defaultBorderMixin`             |
| 21| `bg-primary/8` icon background pills                  | Icons are plain color, no background container         |
| 22| Decorative arrow icons on cards                       | Cards are the affordance — no `ArrowRightIcon` needed  |

> **IMPORTANT FOR AGENTS:** The internal `EntityCard` component (used for card-view in collection grids) uses `hover:-translate-y-0.5` and `hover:shadow-lg`, and the Studio home page uses per-section colored icons. These are **intentional exceptions** in Rebase's own codebase for specific contexts (rich media cards with thumbnails and the Studio admin landing page). **Do NOT copy these patterns** into custom views, home pages, or dashboard cards — they are reserved for these specific internal components.

---

## 20. Reference Components

When building new views, always reference these existing implementations. All of them ship in your `node_modules` — the packages publish their `src`, so these paths resolve in any Rebase project:

| Component            | Location (from your project root)                                                     | What it demonstrates           |
|----------------------|---------------------------------------------------------------------------------------|--------------------------------|
| `UIReferenceView`    | `node_modules/@rebasepro/app/src/components/Debug/UIReferenceView.tsx`                | **Everything** — see §0        |
| `NavigationCard`     | `node_modules/@rebasepro/admin/src/components/HomePage/NavigationCard.tsx`             | Card pattern, plain icon treatment |
| `SmallNavigationCard`| `node_modules/@rebasepro/admin/src/components/HomePage/SmallNavigationCard.tsx`        | Compact card with mixins       |
| `ContentHomePage`    | `node_modules/@rebasepro/admin/src/components/HomePage/ContentHomePage.tsx`            | Page layout, Container usage   |
| `NavigationGroup`    | `node_modules/@rebasepro/admin/src/components/HomePage/NavigationGroup.tsx`            | Section headers, grouping      |

If you are working *inside the Rebase monorepo*, drop the `node_modules/@rebasepro/` prefix and use `packages/app/…` / `packages/admin/…` instead.

Whole-view skeletons built from these live in **`references/view-patterns.md`**, next to this file.

---

## 21. Summary: The Design Philosophy

1. **Near-zero chrome.** The UI disappears so content is the interface. No decorative elements, no visual noise — only what serves the data.
2. **Data-first.** Every element exists to present or interact with data. If it doesn't serve the data, remove it.
3. **Quiet sophistication.** Hierarchy comes from subtle weight and size differentiation (semibold headings, medium subtitles, regular body) rather than dramatic size jumps or color contrasts.
4. **Monochromatic hierarchy.** One accent color (`primary` blue) used sparingly at low opacity. Icons are plain muted grays. No rainbow gradients, no per-card color themes.
5. **Content density.** Smaller type, tighter spacing, more data per viewport. The compressed typography scale (`sm` body text, `xs` captions, `[11px]` fine print) maximizes information density without sacrificing readability.
