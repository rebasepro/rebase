---
name: rebase-design-language
description: |
  Comprehensive Rebase UI Design Language specification. Use this skill whenever building, modifying, or reviewing any UI view, custom page, or home page in a Rebase project. This skill covers the exact design tokens, color system, typography scale, spacing conventions, layout patterns, component usage rules, and common anti-patterns to avoid. Agents MUST read this skill before creating or modifying any visual UI.
---

# Rebase Design Language

This document is the single source of truth for the visual design language used across all Rebase applications. Every custom view, home page, dashboard, or UI component **must** follow these rules exactly.

---

## 1. Foundational Principle

> **The UI must look like it belongs to the Rebase admin panel, not a standalone landing page.**

Rebase applications render inside the Rebase Shell — an admin panel with a sidebar, top bar, and content area. Custom views must feel like a native part of this panel. They must **not** look like a marketing website, a Dribbble concept, or a standalone SaaS dashboard.

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
    cls, defaultBorderMixin, cardMixin, cardClickableMixin, paperMixin,
    // Icons (all from @rebasepro/ui)
    ArrowRightIcon, AddIcon, DeleteIcon
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
|---------------------------|-------------|------------------------------------|
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

---

## 4. Typography

### The `Typography` Component

**MANDATORY**: Use `Typography` for ALL visible text. Never use raw `<h1>`, `<p>`, `<span>`, `<label>` tags.

### Variant Scale

| Variant      | CSS Class             | Rendered Element | Specs                                    |
|--------------|-----------------------|------------------|------------------------------------------|
| `h1`         | `typography-h1`       | `<h1>`           | 6xl, font-light, tracking-tight          |
| `h2`         | `typography-h2`       | `<h2>`           | 5xl, font-light, tracking-tight          |
| `h3`         | `typography-h3`       | `<h3>`           | 4xl, font-normal, tracking-tight         |
| `h4`         | `typography-h4`       | `<h4>`           | 3xl, font-normal, tracking-tight         |
| `h5`         | `typography-h5`       | `<h5>`           | 2xl, font-normal                         |
| `h6`         | `typography-h6`       | `<h6>`           | xl, font-normal                          |
| `subtitle1`  | `typography-subtitle1`| `<h6>`           | lg, font-medium                          |
| `subtitle2`  | `typography-subtitle2`| `<h6>`           | base, font-medium                        |
| `body1`      | `typography-body1`    | `<p>`            | base                                     |
| `body2`      | `typography-body2`    | `<p>`            | sm                                       |
| `caption`    | `typography-caption`  | `<p>`            | xs                                       |
| `label`      | `typography-label`    | `<label>`        | sm, font-medium                          |
| `inherit`    | `typography-inherit`  | `<p>`            | text-inherit (inherits parent sizing)    |
| `button`     | `typography-button`   | `<span>`         | sm, font-semibold                        |

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
// Page title — use h4 or h5, never h1-h3 (those are too large for admin panels)
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

```tsx
// ❌ NEVER: Gradient text on headings
<Typography className="bg-gradient-to-r from-violet-600 to-cyan-500 bg-clip-text text-transparent">

// ❌ NEVER: Overriding font-weight excessively
<Typography className="font-extrabold">

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
// cardMixin = "bg-white dark:bg-surface-900 rounded-md border border-surface-200/60 dark:border-surface-700/60 m-1 -p-1"
// cardClickableMixin = "hover:bg-surface-accent-100 dark:hover:bg-surface-800 hover:ring-1 hover:ring-primary/50 hover:shadow-sm cursor-pointer hover:bg-primary/10 dark:hover:bg-primary/10 transition-all duration-150"
```

```tsx
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
| `rounded-2xl`                                     | Let `Card` use `rounded-md`                   |
| `shadow-lg shadow-blue-500/20`                    | Let `cardClickableMixin` handle hover shadow  |
| `hover:-translate-y-1`                            | Don't lift cards on hover                     |
| `hover:scale-110` on icons                        | Use subtle `transition-colors` at most        |
| `bg-gradient-to-br from-blue-500 to-indigo-600`  | Use `bg-primary/8 dark:bg-primary/10`         |
| `glass-card`, `glass-panel`, backdrop-blur        | Use `Card` or `Paper` component               |

### NavigationCard Reference Pattern

This is the gold standard for how a card should look:

```tsx
<Card className={cls(
    "group h-full p-4 cursor-pointer transition-all duration-150 ease-in-out",
    "border-surface-200 dark:border-surface-700/40",
    "hover:shadow-md hover:shadow-black/[0.04]",
    "hover:border-surface-300 dark:hover:border-primary/20"
)}>
    <div className="flex flex-col h-full">
        {/* Icon in subtle primary tint */}
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/8 dark:bg-primary/10 text-primary/70 dark:text-primary/60">
            {icon}
        </div>
        {/* Title */}
        <Typography variant="subtitle1" component="h2">{name}</Typography>
        {/* Description */}
        <Typography variant="caption" color="secondary">
            <Markdown source={description} size="small" />
        </Typography>
    </div>
</Card>
```

**Key observations from NavigationCard:**
- Icons use `bg-primary/8 dark:bg-primary/10` — subtle, monochrome primary tint. **Not** vibrant gradients.
- Hover effects are minimal: slightly stronger border + tiny shadow. **Not** lifting, scaling, or glowing.
- The card transitions are `duration-150` — fast and subtle.

---

## 7. Style Mixins (`@rebasepro/ui/styles`)

Always import and use these mixins rather than hardcoding equivalent classes:

### Layout & Card Mixins

| Mixin                        | Classes                                                                                              |
|------------------------------|------------------------------------------------------------------------------------------------------|
| `defaultBorderMixin`         | `border-surface-200/60 dark:border-surface-700/60`                                                   |
| `paperMixin`                 | `bg-white rounded-md dark:bg-surface-800 border border-surface-200/60 dark:border-surface-700/60`    |
| `cardMixin`                  | `bg-white dark:bg-surface-900 rounded-md border border-surface-200/60 dark:border-surface-700/60`    |
| `cardClickableMixin`         | hover:bg, hover:ring-1, hover:shadow-sm, cursor-pointer, transition-all                             |
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

The `Button` component accepts these variants and colors:

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

### Button Anti-Patterns

```tsx
// ❌ NEVER: Casting variant to bypass types
<Button variant={"standard" as any}>

// ❌ NEVER: Custom gradient backgrounds
<Button className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white">

// ❌ NEVER: Custom shadow styling
<Button className="shadow-lg shadow-violet-500/20 hover:shadow-xl">

// ✅ CORRECT: Use proper variant and color
<Button variant="filled" color="primary">Submit</Button>
<Button variant="outlined" color="primary">Cancel</Button>
<Button variant="text" color="primary" startIcon={<RefreshCwIcon />}>Refresh</Button>
```

---

## 9. Alerts & Status Messages

### Use the `Alert` Component

```tsx
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
    className="px-4 py-1 rounded font-semibold text-[11px] uppercase tracking-wider text-surface-400 dark:text-surface-400"
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

When displaying numeric KPIs, follow the NavigationCard icon pattern:

```tsx
<Card className="p-4">
    <div className="flex items-center gap-4">
        {/* Icon: subtle primary-tinted background */}
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/8 dark:bg-primary/10 text-primary/70 dark:text-primary/60">
            <UsersIcon className="h-5 w-5" />
        </div>
        <div>
            <Typography variant="caption" color="secondary">Active Leads</Typography>
            <Typography variant="h5">{count}</Typography>
        </div>
    </div>
</Card>
```

### Metric Card Anti-Patterns

```tsx
// ❌ NEVER: Gradient icon backgrounds
<div className="p-4 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl shadow-lg shadow-blue-500/20">

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
- Import icons from `@rebasepro/ui` for navigation icons (`ArrowRightIcon`, `AddIcon`, `DeleteIcon`, etc.)
- **Icon containers** use `bg-primary/8 dark:bg-primary/10` — a single, consistent primary tint. **Not** per-card colored gradients.
- Icon size: typically `h-5 w-5` or `h-4 w-4` inside icon containers.

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

```tsx
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
<TextField label="Client Name" value={name} onChange={e => setName(e.target.value)} />
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
--font-sans: 'Rubik', 'Roboto', 'Helvetica', 'Arial', sans-serif;
--font-headers: 'Rubik', 'Roboto', 'Helvetica', 'Arial', sans-serif;
--font-mono: 'JetBrains Mono', 'Space Mono', 'Lucida Console', monospace;
```

Ensure `@fontsource/rubik` and `@fontsource/jetbrains-mono` are imported in the entry file.

---

## 17. Dark Mode

- Rebase uses `dark:` variant for dark mode classes.
- Custom variant: `@custom-variant dark (&:where(.dark, .dark *))`.
- **Always provide dark mode equivalents** for any custom styling.
- Standard dark mode backgrounds:
  - Page: `dark:bg-surface-800`
  - Cards: `dark:bg-surface-900`
  - Borders: `dark:border-surface-700/60`

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
| 7 | `rounded-2xl` on cards/panels                         | Use `Card`/`Paper` which use `rounded-md`              |
| 8 | Colored gradient icon backgrounds                     | Use `bg-primary/8 dark:bg-primary/10`                  |
| 9 | `hover:-translate-y-1` or `hover:scale-110`           | Use subtle `hover:shadow-md` at most                   |
| 10| Custom shadow colors (`shadow-blue-500/20`)           | Use `hover:shadow-md hover:shadow-black/[0.04]`        |
| 11| `animate-bounce`, `animate-pulse` on alerts           | Use static `Alert` component                           |
| 12| Custom CSS classes like `glass-card`, `shimmer-shine` | Remove and use standard UI kit patterns                |
| 13| `font-extrabold` overrides on Typography              | Let the variant handle font weight                     |
| 14| `text-[10px]`, `tracking-widest` custom overrides     | Use `Typography variant="caption"`                     |
| 15| Per-card colored themes (blue card, green card, etc.) | Use uniform `Card` + `bg-primary/8` icon tint          |
| 16| `dark:bg-surface-950` for page background             | Use `dark:bg-surface-800`                              |
| 17| Arbitrary Tailwind colors (`text-violet-600`, etc.)   | Use design token colors                                |

> **IMPORTANT FOR AGENTS:** The internal `EntityCard` component (used for card-view in collection grids) uses `hover:-translate-y-0.5` and `hover:shadow-lg`, and the Studio home page uses per-section colored icons. These are **intentional exceptions** in Rebase's own codebase for specific contexts (rich media cards with thumbnails and the Studio admin landing page). **Do NOT copy these patterns** into custom views, home pages, or dashboard cards — they are reserved for these specific internal components.

---

## 20. Reference Components

When building new views, always reference these existing implementations:

| Component            | Location                                                          | What it demonstrates           |
|----------------------|-------------------------------------------------------------------|--------------------------------|
| `NavigationCard`     | `packages/admin/src/components/HomePage/NavigationCard.tsx`       | Card pattern, icon treatment   |
| `SmallNavigationCard`| `packages/admin/src/components/HomePage/SmallNavigationCard.tsx`  | Compact card with mixins       |
| `ContentHomePage`    | `packages/admin/src/components/HomePage/ContentHomePage.tsx`      | Page layout, Container usage   |
| `NavigationGroup`    | `packages/admin/src/components/HomePage/NavigationGroup.tsx`      | Section headers, grouping      |

---

## 21. Summary: The Design Philosophy

1. **Minimal, not flashy.** The admin panel is a work tool. It should be clean, readable, and professional — not eye-catching.
2. **Consistent, not creative.** Every card, button, and section should look the same across the entire application. Use the UI kit.
3. **Subtle, not dramatic.** Hover effects are barely noticeable. Transitions are 150ms. Shadows are paper-thin.
4. **Monochrome accents.** The only accent color is `primary` (blue), applied at very low opacity (`/8`, `/10`). No rainbow gradients.
5. **Let components do the work.** `Card`, `Paper`, `Typography`, `Alert`, `Button` — these handle all the visual styling. You add content and layout.
