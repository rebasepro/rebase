---
name: rebase-ui-components
description: Guide for using the @rebasepro/ui component library. Use this skill when building UI with Rebase, creating custom views, or needing to know which components are available.
---

# Rebase UI Component Library

`@rebasepro/ui` is Rebase's standalone, production-ready component library built on **Tailwind CSS v4** and **Radix UI**. It's fully typed, accessible, and can be used in any React project.

> **IMPORTANT FOR AGENTS:** Always import components, hooks, utilities, icons, and style mixins from `@rebasepro/ui`. **Never** add direct `@radix-ui/*` or `lucide-react` dependencies — the UI package re-exports everything you need.

> **This skill covers component APIs — not how to compose them into a view.** Before building an admin view, page, or dashboard, read the **`rebase-design-language`** skill: it holds the design rules and copy-paste whole-view skeletons, and points at the live UI reference that ships in every Rebase project (`node_modules/@rebasepro/app/src/components/Debug/UIReferenceView.tsx`, rendered at `/debug/ui`). Knowing the props is not enough to make a view that looks right.

## Installation

```bash
pnpm add @rebasepro/ui
```

## Core Rules

1. **Always use `@rebasepro/ui`** for all UI components. Check this skill before creating custom ones.
2. **Never use `as any`** — use proper types or `unknown`.
3. **Use `cls()`** for conditional class merging — not template literals.
4. **Use `Typography`** for all text — never raw `<h1>`, `<p>`, `<span>`.
5. **Icons come from `lucide-react` via `@rebasepro/ui`** — there are no `ArrowForwardIcon` or `AddIcon` exports. Use real lucide names like `ArrowRightIcon`, `PlusIcon`.

## Package Exports

The package exports five modules:

```ts
export * from "./components";  // All UI components
export * from "./styles";      // Tailwind style mixin strings
export * from "./util";        // cls(), debounce(), chip_colors, keyToIconComponent
export * from "./icons";       // Icon component, iconSize, LucideIconByName, iconKeys, cool_icon_keys
export * from "./hooks";       // React hooks
```

---

## Components — Complete Reference

### Button

Polymorphic button with multiple variants and colors.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"filled" \| "outlined" \| "text"` | `"filled"` | Visual style |
| `color` | `"primary" \| "secondary" \| "text" \| "error" \| "neutral"` | `"neutral"` | Color scheme |
| `size` | `"small" \| "medium" \| "large" \| "xl" \| "2xl"` | `"medium"` | Size preset |
| `startIcon` | `ReactNode` | `null` | Icon before label |
| `fullWidth` | `boolean` | `false` | Stretch to container width |
| `disabled` | `boolean` | `false` | Disabled state |
| `component` | `React.ElementType` | `"button"` | Render as a different element (e.g. `"a"`) |
| `className` | `string` | — | Additional classes |
| `onClick` | `MouseEventHandler` | — | Click handler |

```tsx
import { Button } from "@rebasepro/ui";
import { PlusIcon } from "@rebasepro/ui";

<Button variant="filled" color="primary" size="large" startIcon={<PlusIcon size={20} />}>
    Create Item
</Button>

<Button variant="outlined" color="error" size="small">Delete</Button>
<Button variant="text" color="secondary">Cancel</Button>

{/* As an anchor */}
<Button component="a" href="/docs" variant="text" color="primary">
    Go to Docs
</Button>
```

### IconButton

Icon-only button with ghost or filled background.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"smallest" \| "small" \| "medium" \| "large"` | `"medium"` | Size (6/8/10/12 = 24/32/40/48 px) |
| `variant` | `"ghost" \| "filled"` | `"ghost"` | Background style |
| `shape` | `"circular" \| "square"` | `"circular"` | Border radius |
| `disabled` | `boolean` | — | Disabled state |
| `toggled` | `boolean` | — | Shows outline ring when toggled |
| `component` | `React.ElementType` | `"button"` | Polymorphic element |
| `onClick` | `MouseEventHandler` | — | Click handler |
| `aria-label` | `string` | — | Required for accessibility |

```tsx
import { IconButton } from "@rebasepro/ui";
import { SettingsIcon } from "@rebasepro/ui";

<IconButton aria-label="Settings" onClick={openSettings}>
    <SettingsIcon size={20} />
</IconButton>
```

### LoadingButton

Extends `Button` with a loading spinner. Automatically disables when loading.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `loading` | `boolean` | — | Shows spinner, hides startIcon, disables button |
| _...all ButtonProps_ | | | Inherits all Button props |

```tsx
import { LoadingButton } from "@rebasepro/ui";

<LoadingButton loading={isSaving} variant="filled" color="primary" onClick={handleSave}>
    Save Changes
</LoadingButton>
```

### Typography

Renders text with semantic HTML elements and consistent styling.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `TypographyVariant` (see below) | `"body1"` | Text style |
| `color` | `"inherit" \| "initial" \| "primary" \| "secondary" \| "disabled" \| "error"` | `"primary"` | Text color |
| `component` | `React.ElementType` | auto from variant | Override rendered element |
| `gutterBottom` | `boolean` | `false` | Adds bottom margin |
| `noWrap` | `boolean` | `false` | Truncate with ellipsis |
| `paragraph` | `boolean` | `false` | Renders as `<p>` with margin |
| `align` | `"center" \| "inherit" \| "justify" \| "left" \| "right"` | `"inherit"` | Text alignment |
| `variantMapping` | `Record<string, string>` | built-in | Override variant→element mapping |

**TypographyVariant values:** `"h1"`, `"h2"`, `"h3"`, `"h4"`, `"h5"`, `"h6"`, `"subtitle1"`, `"subtitle2"`, `"label"`, `"body1"`, `"body2"`, `"inherit"`, `"caption"`, `"button"`

| Variant | Default Element | CSS Class |
|---------|----------------|-----------|
| `h1`–`h6` | `<h1>`–`<h6>` | `typography-h1`–`typography-h6` |
| `subtitle1`, `subtitle2` | `<h6>` | `typography-subtitle1/2` |
| `body1`, `body2` | `<p>` | `typography-body1/2` |
| `label` | `<label>` | `typography-label` |
| `caption` | `<p>` | `typography-caption` |
| `button` | `<span>` | `typography-button` |

```tsx
import { Typography } from "@rebasepro/ui";

<Typography variant="h4" gutterBottom>Page Title</Typography>
<Typography variant="body1">Regular text content</Typography>
<Typography variant="caption" color="secondary">Helper text</Typography>
<Typography variant="body2" color="error">Validation message</Typography>
<Typography variant="h6" noWrap>Very long title that will truncate...</Typography>
```

### Container

Centered max-width container with responsive padding.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `maxWidth` | `"xs" \| "sm" \| "md" \| "lg" \| "xl" \| "2xl" \| "3xl" \| "4xl" \| "5xl" \| "6xl" \| "7xl"` | `"7xl"` | Maximum width |
| `className` | `string` | — | Extra classes |
| `style` | `CSSProperties` | — | Inline styles |

```tsx
import { Container } from "@rebasepro/ui";

<Container maxWidth="4xl">
    {/* Content limited to max-w-4xl with mx-auto px-3 md:px-4 */}
    …
</Container>
```

### Card

Bordered card with optional click behavior. Automatically adds keyboard support and `role="button"` when `onClick` is provided.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onClick` | `(e?: React.MouseEvent) => void` | — | Makes card clickable with hover effects |
| `className` | `string` | — | Extra classes (padding NOT included — add `p-4`/`p-6`) |
| `style` | `CSSProperties` | — | Inline styles |

> **IMPORTANT FOR AGENTS:** Card does NOT include padding. Always add `className="p-4"` or similar.

```tsx
import { Card, Typography } from "@rebasepro/ui";

{/* Static card */}
<Card className="p-6">
    <Typography variant="h6">Title</Typography>
    <Typography variant="body2" color="secondary">Description</Typography>
</Card>

{/* Clickable card — gets hover effects automatically */}
<Card className="p-4" onClick={() => navigate("/details")}>
    <Typography variant="body1">Click me</Typography>
</Card>
```

### Paper

Minimal bordered container. Uses `paperMixin` styling: white bg, rounded-md, border.

```tsx
import { Paper } from "@rebasepro/ui";
<Paper className="p-4">Content</Paper>
```

### CenteredView

Centers content vertically and horizontally within a full-height container.

```tsx
import { CenteredView } from "@rebasepro/ui";
<CenteredView>
    <Typography>Centered content</Typography>
</CenteredView>
```

### Alert

Contextual alert banner with color-coded left border.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `color` | `"error" \| "warning" \| "info" \| "success" \| "base"` | `"info"` | Alert severity |
| `size` | `"small" \| "medium" \| "large"` | `"medium"` | Padding size |
| `onDismiss` | `() => void` | — | Shows × dismiss button |
| `action` | `ReactNode` | — | Action element on right side |
| `className` | `string` | — | Class for inner content div |
| `outerClassName` | `string` | — | Class for outer container |
| `style` | `CSSProperties` | — | Inline styles |

```tsx
import { Alert, Button } from "@rebasepro/ui";

<Alert color="error" onDismiss={() => setShow(false)}>
    Something went wrong. Please try again.
</Alert>

<Alert color="success" size="small">
    Record saved successfully!
</Alert>

<Alert color="warning" action={<Button variant="text" size="small">Fix</Button>}>
    Missing required fields
</Alert>
```

### Chip

Colored label/tag with optional icon.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `colorScheme` | `ChipColorScheme \| ChipColorKey` | — | Color. Can be a key string (`"blue"`, `"teal"`, etc.) or a `ChipColorScheme` object |
| `size` | `"smallest" \| "small" \| "medium" \| "large"` | `"large"` | Size preset |
| `outlined` | `boolean` | — | Outlined variant with translucent bg |
| `error` | `boolean` | — | Red error styling |
| `onClick` | `() => void` | — | Makes chip clickable |
| `icon` | `ReactNode` | — | Icon rendered after text |
| `className` | `string` | — | Extra classes |

**ChipColorKey values:** `"blue"`, `"teal"`, `"yellow"`, `"pink"`, `"purple"`, `"cyan"`, `"orange"`, `"green"`, `"red"`, `"gray"`, `"indigo"`, `"violet"`, `"fuchsia"`, `"rose"`, `"emerald"`

```tsx
import { Chip } from "@rebasepro/ui";

<Chip colorScheme="blue" size="medium">Active</Chip>
<Chip colorScheme="red" outlined>Urgent</Chip>
<Chip error>Error</Chip>
<Chip size="small">Default</Chip>
```

### FilterChip

Toggle chip for filter presets. Uses inset box-shadow for stable sizing.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `active` | `boolean` | `false` | Selected/active state |
| `icon` | `ReactNode` | — | Icon before label |
| `size` | `"small" \| "medium"` | `"medium"` | Size preset |
| `disabled` | `boolean` | `false` | Disabled state |
| `onClick` | handler | — | Click handler |

```tsx
import { FilterChip } from "@rebasepro/ui";

<FilterChip active={filter === "active"} onClick={() => setFilter("active")}>
    Active
</FilterChip>
```

### Dialog, DialogTitle, DialogContent, DialogActions

Modal dialog built on Radix Dialog.

**Dialog Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | — | Controlled open state |
| `onOpenChange` | `(open: boolean) => void` | — | Open state callback |
| `maxWidth` | `"xs" \| "sm" \| "md" \| "lg" \| "xl" \| "2xl"–"7xl" \| "full"` | `"lg"` | Dialog max width |
| `fullWidth` | `boolean` | `true` | Use 11/12 of available width |
| `fullHeight` | `boolean` | — | Full height |
| `fullScreen` | `boolean` | — | Full screen overlay |
| `scrollable` | `boolean` | `true` | Scrollable content |
| `modal` | `boolean` | `true` | Modal behavior |
| `disableInitialFocus` | `boolean` | `true` | Skip auto-focus on open |

**DialogTitle Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `TypographyVariant` | `"subtitle2"` | Typography variant |
| `hidden` | `boolean` | — | Visually hidden (for a11y) |
| `includeMargin` | `boolean` | `true` | Add mt-8 mx-8 margin |
| `gutterBottom` | `boolean` | `true` | Bottom margin |

**DialogContent Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `includeMargin` | `boolean` | `true` | Add my-8 mx-8 margin |
| `fullHeight` | `boolean` | — | Flex-grow full height |

**DialogActions Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `position` | `"sticky" \| "absolute"` | `"sticky"` | Positioning |
| `translucent` | `boolean` | `true` | Backdrop blur effect |

```tsx
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from "@rebasepro/ui";

function ConfirmDialog({ open, onClose, onConfirm }) {
    return (
        <Dialog open={open} onOpenChange={onClose} maxWidth="sm">
            <DialogTitle>Confirm Action</DialogTitle>
            <DialogContent>
                <Typography>Are you sure you want to proceed?</Typography>
            </DialogContent>
            <DialogActions>
                <Button variant="text" onClick={onClose}>Cancel</Button>
                <Button variant="filled" color="primary" onClick={onConfirm}>
                    Confirm
                </Button>
            </DialogActions>
        </Dialog>
    );
}
```

### Select, SelectItem, SelectGroup

Radix-based single-value select dropdown.

**Select Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string \| number \| boolean` | — | Selected value |
| `onValueChange` | `(value: T) => void` | — | Value change callback |
| `size` | `"smallest" \| "small" \| "medium" \| "large"` | `"large"` | Size preset |
| `label` | `ReactNode \| string` | — | Label (string renders as `SelectInputLabel`) |
| `placeholder` | `ReactNode` | — | Placeholder when no value |
| `renderValue` | `(value: T) => ReactNode` | — | Custom value renderer |
| `disabled` | `boolean` | — | Disabled state |
| `error` | `boolean` | — | Error styling |
| `invisible` | `boolean` | — | Transparent background |
| `fullWidth` | `boolean` | `false` | Full width |
| `position` | `"item-aligned" \| "popper"` | `"item-aligned"` | Dropdown position |
| `endAdornment` | `ReactNode` | — | End adornment |
| `dataType` | `"string" \| "number" \| "boolean"` | `"string"` | Type coercion for value |

```tsx
import { Select, SelectItem, SelectGroup } from "@rebasepro/ui";

<Select
    value={status}
    onValueChange={setStatus}
    label="Status"
    placeholder="Select a status"
    size="large"
>
    <SelectGroup label="Active">
        <SelectItem value="draft">Draft</SelectItem>
        <SelectItem value="published">Published</SelectItem>
    </SelectGroup>
    <SelectItem value="archived">Archived</SelectItem>
</Select>
```

### MultiSelect, MultiSelectItem

Multi-value select with search, chips, select-all, and clear.

**MultiSelect Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `T[]` | — | Selected values |
| `onValueChange` | `(values: T[]) => void` | — | Change callback |
| `size` | `"smallest" \| "small" \| "medium" \| "large"` | `"large"` | Size |
| `label` | `ReactNode \| string` | — | Label |
| `placeholder` | `ReactNode` | — | Placeholder |
| `useChips` | `boolean` | `true` | Show selected values as chips |
| `includeSelectAll` | `boolean` | `true` | Show "(Select All)" option |
| `includeClear` | `boolean` | `true` | Show clear button |
| `renderValues` | `(values: T[]) => ReactNode` | — | Custom selected values renderer |
| `disabled`, `error`, `invisible` | `boolean` | — | State flags |

```tsx
import { MultiSelect, MultiSelectItem } from "@rebasepro/ui";

<MultiSelect
    value={selectedTags}
    onValueChange={setSelectedTags}
    label="Tags"
    placeholder="Select tags..."
>
    <MultiSelectItem value="frontend">Frontend</MultiSelectItem>
    <MultiSelectItem value="backend">Backend</MultiSelectItem>
    <MultiSelectItem value="devops">DevOps</MultiSelectItem>
</MultiSelect>
```

### TextField

Single-line or multiline text input with floating label.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string \| number` | — | Input value |
| `onChange` | `ChangeEventHandler` | — | Change handler |
| `label` | `ReactNode` | — | Floating label |
| `type` | `InputType` | `"text"` | `"text" \| "number" \| "email" \| "password" \| "url" \| "search"` etc. |
| `size` | `"smallest" \| "small" \| "medium" \| "large"` | `"large"` | Height preset |
| `multiline` | `boolean` | `false` | Renders as textarea |
| `disabled` | `boolean` | — | Disabled state |
| `invisible` | `boolean` | — | Transparent bg |
| `error` | `boolean` | — | Error border |
| `placeholder` | `string` | — | Placeholder text |
| `endAdornment` | `ReactNode` | — | Element at input end |
| `autoFocus` | `boolean` | — | Auto focus |

```tsx
import { TextField } from "@rebasepro/ui";

<TextField
    label="Email"
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    size="large"
    error={!isValid}
/>

<TextField
    label="Description"
    multiline
    minRows={3}
    value={desc}
    onChange={(e) => setDesc(e.target.value)}
/>
```

### DebouncedTextField

Wraps `TextField` with 150ms debounce. Flushes on blur. Same props as `TextField`.

```tsx
import { DebouncedTextField } from "@rebasepro/ui";

<DebouncedTextField
    label="Search"
    value={searchTerm}
    onChange={(e) => setSearchTerm(e.target.value)}
/>
```

### Tabs, Tab

Tabbed navigation with three visual variants.

**Tabs Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | — | Active tab value |
| `onValueChange` | `(value: string) => void` | — | Tab change callback |
| `variant` | `"standard" \| "boxy" \| "pill"` | `"standard"` | Visual style |
| `className` | `string` | — | Outer container class |
| `innerClassName` | `string` | — | Tab list class |

**Tab Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | — | Tab identifier |
| `disabled` | `boolean` | — | Disabled state |
| `className` | `string` | — | Extra classes |

```tsx
import { Tabs, Tab } from "@rebasepro/ui";

<Tabs value={activeTab} onValueChange={setActiveTab} variant="standard">
    <Tab value="general">General</Tab>
    <Tab value="advanced">Advanced</Tab>
    <Tab value="settings">Settings</Tab>
</Tabs>

{/* Boxy variant — bordered tabs with bottom highlight */}
<Tabs value={tab} onValueChange={setTab} variant="boxy">
    <Tab value="data">Data</Tab>
    <Tab value="schema">Schema</Tab>
</Tabs>

{/* Pill variant — compact rounded pills */}
<Tabs value={tab} onValueChange={setTab} variant="pill">
    <Tab value="all">All</Tab>
    <Tab value="active">Active</Tab>
</Tabs>
```

### Sheet

Slide-in panel overlay (side drawer) built on Radix Dialog.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | — | Controlled open state |
| `onOpenChange` | `(open: boolean) => void` | — | Open state change |
| `side` | `"top" \| "bottom" \| "left" \| "right"` | `"right"` | Slide direction |
| `modal` | `boolean` | `true` | Modal behavior |
| `includeBackgroundOverlay` | `boolean` | `true` | Show backdrop blur overlay |
| `transparent` | `boolean` | — | No shadow/background on panel |
| `title` | `string` | `"Sheet"` | Accessible title (sr-only) |
| `className` | `string` | — | Panel class |
| `overlayClassName` | `string` | — | Overlay class |

```tsx
import { Sheet, Typography, Button } from "@rebasepro/ui";

<Sheet open={isOpen} onOpenChange={setIsOpen} side="right">
    <div className="p-6 w-[400px]">
        <Typography variant="h5" gutterBottom>Details</Typography>
        <Typography variant="body1">Panel content here</Typography>
        <Button onClick={() => setIsOpen(false)} className="mt-4">Close</Button>
    </div>
</Sheet>
```

### Popover

Positioned popover built on Radix Popover.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `trigger` | `ReactNode` | — | **Required.** Trigger element |
| `children` | `ReactNode` | — | Popover content |
| `open` | `boolean` | — | Controlled open state |
| `onOpenChange` | `(open: boolean) => void` | — | Open state change |
| `side` | `"top" \| "right" \| "bottom" \| "left"` | — | Preferred side |
| `sideOffset` | `number` | `5` | Distance from trigger |
| `align` | `"start" \| "center" \| "end"` | — | Alignment |
| `enabled` | `boolean` | `true` | When false, renders trigger only |
| `modal` | `boolean` | `false` | Modal behavior |

```tsx
import { Popover, Button, Typography } from "@rebasepro/ui";

<Popover
    trigger={<Button variant="outlined">Options</Button>}
    side="bottom"
    align="start"
>
    <div className="p-4">
        <Typography variant="body2">Popover content</Typography>
    </div>
</Popover>
```

### ExpandablePanel

Collapsible panel with animated open/close.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `ReactNode` | — | **Required.** Panel header |
| `initiallyExpanded` | `boolean` | `true` | Initial open state |
| `expanded` | `boolean` | — | Controlled open state |
| `onExpandedChange` | `(expanded: boolean) => void` | — | Expansion change callback |
| `invisible` | `boolean` | `false` | Remove border, use border-bottom only |
| `asField` | `boolean` | — | Apply field background styling |
| `className` | `string` | — | Root container class |
| `innerClassName` | `string` | — | Content wrapper class |
| `titleClassName` | `string` | — | Trigger header class |

```tsx
import { ExpandablePanel, Typography } from "@rebasepro/ui";

<ExpandablePanel title={<Typography variant="subtitle2">Advanced Options</Typography>}>
    <div className="p-4">
        {/* panel content */}
    </div>
</ExpandablePanel>

{/* Controlled, initially collapsed */}
<ExpandablePanel
    title="Filters"
    initiallyExpanded={false}
    invisible
    asField
>
    {/* filter form fields */}
</ExpandablePanel>
```

### BooleanSwitch

Standalone toggle switch.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `boolean \| null` | — | Current value |
| `onValueChange` | `(value: boolean) => void` | — | Change callback |
| `disabled` | `boolean` | `false` | Disabled state |
| `size` | `"smallest" \| "small" \| "medium" \| "large"` | `"medium"` | Size preset |
| `allowIndeterminate` | `boolean` | `false` | Allow null (three-state) |

### BooleanSwitchWithLabel

Toggle switch with a label. Wraps `BooleanSwitch`.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `ReactNode` | — | Label text |
| `position` | `"start" \| "end"` | `"end"` | Label position relative to switch |
| `invisible` | `boolean` | — | Remove field background |
| `error` | `boolean` | — | Error state |
| `fullWidth` | `boolean` | `true` | Full width |
| `size` | `"smallest" \| "small" \| "medium" \| "large"` | `"medium"` | Size |
| _...all BooleanSwitchProps_ | | | |

```tsx
import { BooleanSwitchWithLabel } from "@rebasepro/ui";

<BooleanSwitchWithLabel
    value={isEnabled}
    onValueChange={setIsEnabled}
    label="Enable notifications"
    size="medium"
/>
```

### Checkbox

Styled checkbox based on Radix Checkbox. See source for full props.

### RadioGroup, RadioGroupItem

Radio button group built on Radix RadioGroup.

| Prop (RadioGroup) | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | — | Selected value |
| `onValueChange` | `(value: string) => void` | — | Change callback |
| `disabled` | `boolean` | — | Disabled |
| `loop` | `boolean` | `false` | Keyboard navigation loops |

```tsx
import { RadioGroup, RadioGroupItem } from "@rebasepro/ui";

<RadioGroup value={plan} onValueChange={setPlan}>
    <div className="flex items-center gap-2">
        <RadioGroupItem value="free" />
        <label>Free</label>
    </div>
    <div className="flex items-center gap-2">
        <RadioGroupItem value="pro" />
        <label>Pro</label>
    </div>
</RadioGroup>
```

### Slider

Range slider with tooltip, built on Radix Slider.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number[]` | — | Current value(s) |
| `onValueChange` | `(value: number[]) => void` | — | Live change |
| `onValueCommit` | `(value: number[]) => void` | — | Change on release |
| `min` | `number` | — | Minimum |
| `max` | `number` | — | Maximum |
| `step` | `number` | — | Step size |
| `disabled` | `boolean` | — | Disabled |
| `size` | `"small" \| "regular"` | `"regular"` | Track/thumb size |

```tsx
import { Slider } from "@rebasepro/ui";

<Slider
    value={[volume]}
    onValueChange={([v]) => setVolume(v)}
    min={0}
    max={100}
    step={1}
/>
```

### DateTimeField

Date/datetime picker using native `<input type="date|datetime-local">`.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `Date \| null` | — | Date value |
| `onChange` | `(date: Date \| null) => void` | — | Change callback |
| `mode` | `"date" \| "date_time"` | `"date"` | Date only or datetime |
| `disabled` | `boolean` | — | Disabled |
| `clearable` | `boolean` | — | Show clear button |
| `error` | `boolean` | — | Error state |
| `size` | `"smallest" \| "small" \| "medium" \| "large"` | `"large"` | Size |
| `label` | `ReactNode` | — | Floating label |
| `timezone` | `string` | local | IANA timezone string |

```tsx
import { DateTimeField } from "@rebasepro/ui";

<DateTimeField
    value={dueDate}
    onChange={setDueDate}
    mode="date_time"
    label="Due Date"
    clearable
    timezone="America/New_York"
/>
```

### ColorPicker

Grid of color swatches using `CHIP_COLORS`. For selecting colors for enum values and tags.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `ChipColorKey` | — | Selected color key |
| `onChange` | `(key: ChipColorKey \| undefined) => void` | — | Change callback |
| `size` | `"small" \| "medium"` | `"medium"` | Swatch size |
| `allowClear` | `boolean` | `true` | Show "Auto" clear option |
| `disabled` | `boolean` | `false` | Disabled |

```tsx
import { ColorPicker } from "@rebasepro/ui";

<ColorPicker value={color} onChange={setColor} />
```

### FileUpload

Drag-and-drop file upload zone using `react-dropzone`.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onFilesAdded` | `(files: File[]) => void` | — | **Required.** Files accepted callback |
| `onFilesRejected` | handler | — | Files rejected callback |
| `accept` | `Record<string, string[]>` | — | MIME type filter, e.g. `{ "image/*": [] }` |
| `maxSize` | `number` | — | Max file size in bytes |
| `maxFiles` | `number` | — | Max number of files |
| `disabled` | `boolean` | — | Disabled |
| `title` | `ReactNode` | — | Top-left caption |
| `uploadDescription` | `ReactNode` | — | Center description |
| `size` | `"small" \| "medium" \| "large"` | — | Height: 64/112/176 px |

```tsx
import { FileUpload } from "@rebasepro/ui";

<FileUpload
    accept={{ "image/*": [] }}
    onFilesAdded={(files) => handleUpload(files)}
    title="Cover Image"
    uploadDescription="Drop an image or click to browse"
    size="medium"
/>
```

### SearchBar

Debounced search input with clear button and loading state.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onTextSearch` | `(searchString?: string) => void` | — | Debounced search callback |
| `placeholder` | `string` | `"Search"` | Placeholder text |
| `size` | `"smallest" \| "small" \| "medium"` | `"medium"` | Height preset |
| `expandable` | `boolean` | `false` | Expand on focus |
| `loading` | `boolean` | — | Show spinner instead of icon |
| `disabled` | `boolean` | — | Disabled |
| `autoFocus` | `boolean` | — | Auto focus |
| `initialValue` | `string` | — | Initial search text |

```tsx
import { SearchBar } from "@rebasepro/ui";

<SearchBar
    onTextSearch={(term) => filterItems(term)}
    placeholder="Search items..."
    size="small"
/>
```

### Table, TableHeader, TableBody, TableRow, TableCell

Basic HTML table components with consistent styling.

```tsx
import { Table, TableHeader, TableBody, TableRow, TableCell } from "@rebasepro/ui";

// Named `rows` rather than `users`: a Drizzle schema table of that name would shadow it.
const rows: { id: string; name: string; email: string }[] = [];

<Table>
    <TableHeader>
        <TableCell header>Name</TableCell>
        <TableCell header>Email</TableCell>
        <TableCell header align="right">Actions</TableCell>
    </TableHeader>
    <TableBody>
        {rows.map(user => (
            <TableRow key={user.id} onClick={() => selectUser(user)}>
                <TableCell>{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell align="right">
                    <IconButton aria-label="Edit"><PencilIcon size={16} /></IconButton>
                </TableCell>
            </TableRow>
        ))}
    </TableBody>
</Table>
```

**TableCell extra props:** `header` (boolean), `align` (`"left" | "center" | "right"`), `colspan` (number).

### VirtualTable

High-performance virtualized table for large datasets. Uses `react-window` for windowed rendering. Supports sorting, filtering, column resize, drag-and-drop column reorder, infinite scroll, and frozen columns.

Key props: `data`, `columns` (array of `VirtualTableColumn`), `cellRenderer`, `onRowClick`, `onEndReached`, `filter`, `onFilterUpdate`, `sortBy`, `onSortByUpdate`, `loading`, `emptyComponent`.

See `VirtualTableProps` and `VirtualTableColumn` types for full API.

#### Generic Editable Tables & Cell Selection

`@rebasepro/ui` includes a generic, high-performance selection engine and primitive cell inputs that allow you to construct keyboard-navigable editable grid tables without any Rebase database dependencies.

**Selection Hooks & Context:**
* `createVirtualTableSelectionStore()` — Instantiates a selection store tracking active selection by `rowId` and `columnKey`. It uses `useSyncExternalStore` so that selection changes only trigger re-renders on the active cell (preventing whole-table lag).
* `VirtualTableSelectionProvider` — React context provider to pass down the selection store.
* `useVirtualTableSelection()` — Hook to access the selection store and triggers inside custom cells.
* `useVirtualTableCellSelected(store, columnKey, rowId)` — Returns `boolean` indicating if this cell is currently focused.

**Generic Cell Inputs:**
* `VirtualTableInput` — Auto-growing, debounced multiline/single text input.
* `VirtualTableNumberInput` — Constrained numeric input.
* `VirtualTableSwitch` — Small boolean switch toggle.
* `VirtualTableDateField` — Decoupled Date/DateTime picker (accepts `locale`, `timezone`, `mode`).
* `VirtualTableSelect` — Option-based single/multi dropdown list using chips. Takes `options: { value, label, color? }[]`.

**Example Custom Editable Table:**
```tsx
import React, { useMemo, useState, useCallback } from "react";
import { 
    VirtualTable, 
    createVirtualTableSelectionStore, 
    VirtualTableSelectionProvider, 
    useVirtualTableCellSelected, 
    useVirtualTableSelection,
    VirtualTableInput 
} from "@rebasepro/ui";

function EditableCell({ rowId, columnKey, value, onUpdate }) {
    const { selectionStore } = useVirtualTableSelection();
    const selected = useVirtualTableCellSelected(selectionStore, columnKey, rowId);

    return (
        <div 
            className="w-full h-full flex items-center px-2 cursor-text"
            onClick={(e) => selectionStore.select({ 
                id: rowId, 
                columnKey, 
                cellRect: e.currentTarget.getBoundingClientRect(),
                width: e.currentTarget.offsetWidth,
                height: e.currentTarget.offsetHeight
            })}
        >
            <VirtualTableInput
                value={value}
                updateValue={onUpdate}
                focused={selected}
                disabled={false}
                multiline={false}
            />
        </div>
    );
}

export function MyEditableGrid() {
    const [data, setData] = useState([
        { id: "row-1", name: "Project Alpha" },
        { id: "row-2", name: "Project Beta" }
    ]);

    const selectionStore = useMemo(() => createVirtualTableSelectionStore(), []);

    const updateCell = useCallback((rowId: string, value: string) => {
        setData(prev => prev.map(row => row.id === rowId ? { ...row, name: value } : row));
    }, []);

    const columns = [
        { key: "name", title: "Name", width: 300 }
    ];

    return (
        <VirtualTableSelectionProvider store={selectionStore}>
            <VirtualTable
                data={data}
                columns={columns}
                rowHeight={52}
                cellRenderer={({ rowData, column }) => {
                    // rowData is Record<string, unknown> — narrow it here.
                    const row = rowData as { id: string; name: string };
                    return (
                        <EditableCell
                            rowId={row.id}
                            columnKey={column.key}
                            value={row.name}
                            onUpdate={(val) => updateCell(row.id, val || "")}
                        />
                    );
                }}
            />
        </VirtualTableSelectionProvider>
    );
}
```

### ToggleButtonGroup

Single-select button group for toggling between options.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `T extends string` | — | Selected value |
| `onValueChange` | `(value: T) => void` | — | Change callback |
| `options` | `ToggleButtonOption<T>[]` | — | Array of `{ value, label, icon?, disabled? }` |
| `className` | `string` | — | Extra classes |

```tsx
import { ToggleButtonGroup } from "@rebasepro/ui";
import { LayoutGridIcon, ListIcon } from "@rebasepro/ui";

<ToggleButtonGroup
    value={viewMode}
    onValueChange={setViewMode}
    options={[
        { value: "grid", label: "Grid", icon: <LayoutGridIcon size={16} /> },
        { value: "list", label: "List", icon: <ListIcon size={16} /> }
    ]}
/>
```

### ResizablePanels

Two-panel resizable layout with drag handle.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `firstPanel` | `ReactNode` | — | First panel content |
| `secondPanel` | `ReactNode` | — | Second panel content |
| `panelSizePercent` | `number` | — | 0–100, width/height of first panel |
| `onPanelSizeChange` | `(percent: number) => void` | — | Resize callback |
| `showFirstPanel` | `boolean` | `true` | Toggle first panel visibility |
| `showSecondPanel` | `boolean` | `true` | Toggle second panel visibility |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Layout direction |
| `minPanelSizePx` | `number` | `200` | Minimum panel size in pixels |
| `animateLayout` | `boolean` | `true` | Animate transitions |
| `stacked` | `boolean` | `false` | Stack panels absolutely |

```tsx
import { ResizablePanels } from "@rebasepro/ui";

<ResizablePanels
    firstPanel={<Sidebar />}
    secondPanel={<MainContent />}
    panelSizePercent={30}
    onPanelSizeChange={setPanelSize}
    minPanelSizePx={250}
/>
```

### CircularProgress

Animated loading spinner.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"smallest" \| "small" \| "medium" \| "large"` | — | Size preset |

### CircularProgressCenter

Full-screen centered loading spinner with optional text message.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `text` | `string` | — | Loading message below spinner |
| _...CircularProgressProps_ | | | |

```tsx
import { CircularProgressCenter } from "@rebasepro/ui";

<CircularProgressCenter text="Loading data..." />
```

### ErrorBoundary

React error boundary with inline or full-page error display. Detects permission errors for tailored messaging.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `fullPage` | `boolean` | — | Full-page centered error display |
| `onReset` | `() => void` | — | Custom reset handler |

```tsx
import { ErrorBoundary } from "@rebasepro/ui";

<ErrorBoundary fullPage>
    <App />
</ErrorBoundary>
```

### Tooltip

Tooltip on hover, built on Radix Tooltip.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string \| ReactNode` | — | Tooltip content. If falsy, renders children only |
| `side` | `"top" \| "bottom" \| "left" \| "right"` | `"bottom"` | Tooltip position |
| `delayDuration` | `number` | `200` | Delay in ms |
| `sideOffset` | `number` | `4` | Distance from trigger |
| `align` | `"start" \| "center" \| "end"` | — | Alignment |

```tsx
import { Tooltip, IconButton } from "@rebasepro/ui";
import { SettingsIcon } from "@rebasepro/ui";

<Tooltip title="Open settings" side="bottom">
    <IconButton aria-label="Settings">
        <SettingsIcon size={20} />
    </IconButton>
</Tooltip>
```

### Other Components

| Component | Description |
|-----------|-------------|
| `Autocomplete` | Text input with filtered suggestions dropdown |
| `Avatar` | User avatar circle with image/initials |
| `Badge` | Small count badge |
| `Collapse` | Animated show/hide wrapper |
| `InputLabel` | Floating label used internally by `TextField`. Props: `shrink` |
| `SelectInputLabel` | Small label above Select/MultiSelect. Props: `error` |
| `InfoLabel` | Small info label |
| `Label` | Form label |
| `Markdown` | Markdown renderer |
| `Menu` | Context menu |
| `Menubar` | Horizontal menu bar |
| `MenuItem` | Menu item |
| `Paper` | Bordered container |
| `Separator` | Horizontal/vertical divider |
| `Skeleton` | Loading placeholder |
| `TextareaAutosize` | Auto-growing textarea |

### Re-exported Radix Primitives

These are re-exported so you never need a direct `@radix-ui` dependency:

```tsx
import { Portal, PopoverPrimitive, Slot } from "@rebasepro/ui";
```

- **`Portal`** — `@radix-ui/react-portal`
- **`PopoverPrimitive`** — `@radix-ui/react-popover` (full primitive API)
- **`Slot`** — `@radix-ui/react-slot` (for composition)

---

## Icon System

> **WARNING FOR AGENTS:** There are NO `ArrowForwardIcon` or `AddIcon` exports. Use real Lucide icon names: `ArrowRightIcon`, `PlusIcon`, etc.

### Using Icons

Icons are re-exported from `lucide-react`. Use the `iconSize` map for consistent sizing:

```tsx
import { PlusIcon, SettingsIcon, Trash2Icon, iconSize } from "@rebasepro/ui";

// Use iconSize for consistent sizing
<PlusIcon size={iconSize.small} />      // 20px
<SettingsIcon size={iconSize.medium} /> // 24px
<Trash2Icon size={iconSize.large} />   // 28px
```

### `iconSize` Map

| Key | Value (px) |
|-----|-----------|
| `smallest` | `16` |
| `small` | `20` |
| `medium` | `24` |
| `large` | `28` |

### `IconProps` Type

| Prop | Type | Description |
|------|------|-------------|
| `size` | `IconSize \| number` | Size in px |
| `color` | `IconColor` | `"inherit" \| "primary" \| "secondary" \| "disabled" \| "error" \| "success" \| "warning"` |
| `className` | `string` | Extra classes |

### `colorClassesMapping`

Maps `IconColor` values to Tailwind classes:

| Color | Class |
|-------|-------|
| `"primary"` | `text-primary` |
| `"secondary"` | `text-secondary` |
| `"error"` | `text-red-500` |
| `"success"` | `text-green-500` |
| `"warning"` | `text-yellow-500` |
| `"disabled"` | `text-text-disabled dark:text-text-disabled-dark` |
| `"inherit"` | _(none)_ |

### `LucideIconByName` — Icon Lookup by String Name

`@rebasepro/ui` used to re-export lucide's whole `icons` map as `lucideIcons`.
It no longer does: that map holds a reference to every icon in the library, so
exporting it defeated tree-shaking and put 822 kB of icon components in the
entry chunk, preloaded before login. Render by name instead — the icon set is
fetched on first use.

```tsx
import { LucideIconByName } from "@rebasepro/ui";

<LucideIconByName name="Database" size={24} />
```

Whether a name exists can be answered *before* the fetch, against `iconKeys`,
which is a plain string array and costs nothing:

```tsx
import { iconKeys } from "@rebasepro/ui";

const exists = iconKeys.includes("Database");
```

Outside React, or when you need the map itself:

```tsx
import { loadLucideIcons, getLoadedLucideIcons } from "@rebasepro/ui";

const icons = await loadLucideIcons();   // Promise<Record<string, LucideIcon | undefined>>
const Icon = icons["Database"];

getLoadedLucideIcons();                  // the map if already fetched, else undefined
```

Inside React, `useLucideIcons()` returns the map once it has landed and
`undefined` before that.

### `iconKeys` and `cool_icon_keys`

- **`iconKeys`** — Array of ~1900+ all available Lucide icon name strings.
- **`cool_icon_keys`** — Curated subset of ~50 visually distinctive icon names for icon pickers.

```tsx
import { iconKeys, coolIconKeys, LucideIconByName } from "@rebasepro/ui";
```

### `keyToIconComponent(key: string): string`

Converts a snake_case icon key to a PascalCase component name with `Icon` suffix:

```tsx
keyToIconComponent("arrow_right"); // "ArrowRightIcon"
keyToIconComponent("database");    // "DatabaseIcon"
```

> **NOT IMPORTABLE.** `@rebasepro/ui` does not re-export this from its entry
> point, and its `exports` map has no `./util/*` subpath — the deep import
> `@rebasepro/ui/util/key_to_icon_component` resolves inside this repository and
> fails for every installed consumer. It is documented because framework code
> uses it internally. In app code, map the key yourself or use the `<Icon>`
> component, which already accepts an icon key.

### Custom Icons

- **`GitHubIcon`** — GitHub logo SVG
- **`HandleIcon`** — Drag handle dots

```tsx
import { GitHubIcon, HandleIcon } from "@rebasepro/ui";
```

---

## Style Mixins

Exported Tailwind class strings for consistent styling. Import and use with `cls()`:

```tsx
import {
    focusedClasses,
    focusedDisabled,
    focusedInvisibleMixin,
    fieldBackgroundMixin,
    fieldBackgroundInvisibleMixin,
    fieldBackgroundDisabledMixin,
    fieldBackgroundHoverMixin,
    defaultBorderMixin,
    paperMixin,
    cardMixin,
    cardClickableMixin,
    cardSelectedMixin
} from "@rebasepro/ui";
```

| Mixin | Purpose |
|-------|---------|
| `focusedClasses` | Focus ring: `ring-2 ring-primary ring-opacity-75` |
| `focusedDisabled` | Remove focus ring: `focus-visible:ring-0` |
| `focusedInvisibleMixin` | Focus bg for invisible fields |
| `fieldBackgroundMixin` | Default field background (light/dark) |
| `fieldBackgroundInvisibleMixin` | Transparent field background |
| `fieldBackgroundDisabledMixin` | Disabled field background |
| `fieldBackgroundHoverMixin` | Field hover background |
| `defaultBorderMixin` | Standard border: `border-surface-200/60 dark:border-surface-700/60` |
| `paperMixin` | Paper container: white bg, rounded-md, border |
| `cardMixin` | Card container: white/dark bg, rounded-md, border, margin |
| `cardClickableMixin` | Hover/click effects for interactive cards |
| `cardSelectedMixin` | Selected card highlight: `bg-primary-bg/30 ring-1 ring-primary/75` |

```tsx
import { cls, paperMixin, cardClickableMixin } from "@rebasepro/ui";

<div className={cls(paperMixin, "p-4")}>Paper-styled container</div>
```

---

## Utility Functions

### `cls(...classes)`

Combines `clsx` + `twMerge` for conditional class merging with Tailwind conflict resolution.

```tsx
import { cls } from "@rebasepro/ui";

<div className={cls(
    "p-4 rounded-lg",
    isActive && "bg-blue-500",
    isDisabled && "opacity-50 cursor-not-allowed"
)} />
```

### `debounce(func, wait?)`

General-purpose debounce function. Returns a debounced function with a `.clear()` method.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `func` | `Function` | — | Function to debounce |
| `wait` | `number` | `166` | Delay in ms |

```tsx
import { debounce } from "@rebasepro/ui";

const debouncedSearch = debounce((query: string) => {
    fetchResults(query);
}, 300);

debouncedSearch("hello");
debouncedSearch.clear(); // Cancel pending call
```

### `hashString(str)`

Deterministic 32-bit hash of a string. Returns a positive integer.

```tsx
import { hashString } from "@rebasepro/utils";
hashString("my-entity-id"); // e.g. 1234567
```

### Chip Color Utilities

```tsx
import {
    CHIP_COLORS,              // Record<string, ChipColorScheme>
    getColorSchemeForKey,      // (key: ChipColorKey) => ChipColorScheme
    getColorSchemeForSeed      // (seed: string) => ChipColorScheme (deterministic)
} from "@rebasepro/ui";
```

**`ChipColorScheme`** type:
```ts no-verify
{
    color: string;      // Light mode background hex
    text: string;       // Light mode text hex
    darkColor?: string; // Dark mode background hex
    darkText?: string;  // Dark mode text hex
}
```

**Available CHIP_COLORS keys:** `blue`, `teal`, `yellow`, `pink`, `purple`, `cyan`, `orange`, `green`, `red`, `gray`, `indigo`, `violet`, `fuchsia`, `rose`, `emerald`

```tsx
// Deterministic color from any string
const scheme = getColorSchemeForSeed("user-status-active");
<Chip colorScheme={scheme}>Active</Chip>

// Or by key
<Chip colorScheme="blue">Info</Chip>
```

---

## Hooks

### `useInjectStyles(key, styles)`

Injects a `<style>` element into the DOM (idempotent). Respects `PortalContainerContext`.

```tsx
import { useInjectStyles } from "@rebasepro/ui";

useInjectStyles("MyComponent", `
    .my-animation { animation: fadeIn 200ms ease-out; }
`);
```

### `useOutsideAlerter(ref, onOutsideClick, active?)`

Calls `onOutsideClick` when a click occurs outside the referenced element. Ignores clicks inside Radix presentation layers.

```tsx
import { useRef } from "react";
import { useOutsideAlerter } from "@rebasepro/ui";

const ref = useRef<HTMLDivElement>(null);
useOutsideAlerter(ref, () => setOpen(false), isOpen);
```

### `useDebouncedCallback(value, callback, immediate, timeoutMs?)`

Debounces a callback that fires when `value` changes.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `value` | `T` | — | Watched value |
| `callback` | `() => void` | — | Callback to debounce |
| `immediate` | `boolean` | — | If true, flush immediately |
| `timeoutMs` | `number` | `300` | Debounce delay |

### `useDebounceCallback(callback?, delay?)`

Returns a debounced version of the given callback function.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `callback` | `Function` | — | Function to debounce |
| `delay` | `number` | `200` | Delay in ms |

### `useDebounceValue(value, delay?)`

Returns a debounced version of a value.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `value` | `T` | — | Value to debounce |
| `delay` | `number` | `300` | Delay in ms |

```tsx
import { useDebounceValue } from "@rebasepro/ui";

const debouncedSearch = useDebounceValue(searchText, 200);
useEffect(() => { fetchResults(debouncedSearch); }, [debouncedSearch]);
```

### `PortalContainerProvider` and `usePortalContainer()`

Context provider that controls where Radix portals are rendered. All portal-based components (`Dialog`, `Sheet`, `Select`, `MultiSelect`, `Tooltip`, `Popover`) automatically use this context.

```tsx
import { useRef } from "react";
import { PortalContainerProvider } from "@rebasepro/ui";

const containerRef = useRef<HTMLDivElement>(null);

<div ref={containerRef}>
    <PortalContainerProvider container={containerRef.current}>
        {/* All portals render inside this div */}
        <Select />
        <Dialog>…</Dialog>
    </PortalContainerProvider>
</div>
```

---

## Complete Custom View Example

```tsx
import {
    Container,
    Typography,
    Card,
    Button,
    TextField,
    Tabs,
    Tab,
    Alert,
    Chip,
    SearchBar,
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableCell,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    cls,
    iconSize
} from "@rebasepro/ui";
import { PlusIcon, PencilIcon } from "@rebasepro/ui";
import { useState } from "react";

export function DashboardView() {
    const [tab, setTab] = useState("all");
    const [dialogOpen, setDialogOpen] = useState(false);

    return (
        <Container maxWidth="5xl">
            <div className="flex justify-between items-center mb-6">
                <Typography variant="h4">Dashboard</Typography>
                <Button
                    variant="filled"
                    color="primary"
                    startIcon={<PlusIcon size={iconSize.small} />}
                    onClick={() => setDialogOpen(true)}
                >
                    New Item
                </Button>
            </div>

            <Alert color="info" size="small" className="mb-4">
                Welcome back! You have 3 items needing review.
            </Alert>

            <div className="flex gap-4 mb-4">
                <Tabs value={tab} onValueChange={setTab} variant="standard">
                    <Tab value="all">All</Tab>
                    <Tab value="active">Active</Tab>
                    <Tab value="archived">Archived</Tab>
                </Tabs>
                <SearchBar
                    onTextSearch={(term) => console.log(term)}
                    size="small"
                />
            </div>

            <Card className="p-0 overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableCell header>Name</TableCell>
                        <TableCell header>Status</TableCell>
                        <TableCell header align="right">Actions</TableCell>
                    </TableHeader>
                    <TableBody>
                        <TableRow>
                            <TableCell>Example Item</TableCell>
                            <TableCell>
                                <Chip colorScheme="green" size="small">Active</Chip>
                            </TableCell>
                            <TableCell align="right">
                                <IconButton aria-label="Edit" size="small">
                                    <PencilIcon size={iconSize.smallest} />
                                </IconButton>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </Card>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen} maxWidth="md">
                <DialogTitle>Create New Item</DialogTitle>
                <DialogContent>
                    <TextField label="Name" size="large" />
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setDialogOpen(false)}>
                        Cancel
                    </Button>
                    <Button variant="filled" color="primary">
                        Create
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
}
```

## Rich Text Editor (`RichTextEditor`)

> **IMPORTANT:** `RichTextEditor` lives in `@rebasepro/admin`, NOT in `@rebasepro/ui`. It is a separate heavy entry point (~300 KB) because it bundles ProseMirror.

A full-featured, block-based WYSIWYG editor with slash commands, bubble menus, image uploads, tables, AI autocomplete, drag-and-drop reordering, and a raw Markdown toggle. Outputs **Markdown**, **JSON** (ProseMirror document tree), and **HTML**.

### Import

```ts
// The component (heavy — code-split / lazy-load when possible)
import { RichTextEditor } from "@rebasepro/admin/editor";

// Types only (lightweight — from the main entry point)
import type { RichTextEditorProps, JSONContent, EditorAIController } from "@rebasepro/admin";
```

> **Note:** The previous export name `RebaseEditor` still works but is deprecated. Always use `RichTextEditor`.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `JSONContent \| string` | — | Initial content. Pass a markdown string or a ProseMirror JSON document. |
| `onMarkdownContentChange` | `(md: string) => void` | — | Called with serialized Markdown on edits |
| `onJsonContentChange` | `(json: JSONContent \| null) => void` | — | Called with ProseMirror JSON on edits |
| `onHtmlContentChange` | `(html: string) => void` | — | Called with HTML string on edits |
| `handleImageUpload` | `(file: File) => Promise<string>` | **required** | Upload handler that returns the image URL |
| `version` | `number` | — | Bump to force-reset editor content (e.g. on form discard) |
| `textSize` | `"sm" \| "base" \| "lg"` | `"base"` | Prose typography scale |
| `highlight` | `{ from: number, to: number }` | — | Highlight a character range (used by AI autocomplete) |
| `aiController` | `EditorAIController` | — | AI autocomplete controller |
| `disabled` | `boolean` | `false` | Read-only mode |
| `markdownConfig` | `MarkdownEditorConfig` | — | Markdown parser options (`html`, `transformPastedText`) |

### Usage Example

```tsx
import { RichTextEditor } from "@rebasepro/admin/editor";

function MyEditor() {
    const [markdown, setMarkdown] = useState("");

    return (
        <RichTextEditor
            content={markdown}
            onMarkdownContentChange={setMarkdown}
            handleImageUpload={async (file) => {
                const url = await uploadToStorage(file);
                return url;
            }}
            textSize="base"
        />
    );
}
```

### Lazy Loading

Because the editor is ~300 KB, lazy-load it when it's not immediately visible:

```tsx
import { lazy, Suspense } from "react";
import { Skeleton } from "@rebasepro/ui";

const RichTextEditor = lazy(() =>
    import("@rebasepro/admin/editor").then(m => ({ default: m.RichTextEditor }))
);

function LazyEditor(props) {
    return (
        <Suspense fallback={<Skeleton height={200} className="w-full rounded-md" />}>
            <RichTextEditor {...props} />
        </Suspense>
    );
}
```

## Tailwind CSS v4

Rebase uses Tailwind CSS v4 with CSS-first configuration:
- No `tailwind.config.js` — configuration is in CSS
- CSS variables for theming
- Native cascade layers

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **UI Source:** `packages/ui/src/` in the monorepo
