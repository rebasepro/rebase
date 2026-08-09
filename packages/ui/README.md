# @rebasepro/ui

React component library and design system for the Rebase ecosystem. Built on Radix UI primitives, Tailwind CSS, and lucide-react icons.

## Installation

```bash
pnpm add @rebasepro/ui
```

### Peer Dependencies

- `react` >= 19.0.0
- `react-dom` >= 19.0.0

## What This Package Does

`@rebasepro/ui` provides all the shared UI primitives used across Rebase packages (`@rebasepro/studio`, `@rebasepro/admin`, etc.). It wraps Radix UI components with Rebase's design tokens and Tailwind styling, and re-exports lucide-react icons so other packages don't need direct icon dependencies.

Import the stylesheet in your app:

```typescript
import "@rebasepro/ui/index.css";
```

## Key Exports

### Components

| Component | Description |
|---|---|
| `Alert` | Status messages and notifications |
| `Autocomplete` | Text input with suggestions |
| `Avatar` | User avatar display |
| `Badge` | Small status indicator |
| `BooleanSwitch` / `BooleanSwitchWithLabel` | Toggle switch |
| `Button` / `IconButton` / `LoadingButton` | Action buttons |
| `Card` | Content container card |
| `CenteredView` | Horizontally/vertically centered layout |
| `Checkbox` | Checkbox input (Radix) |
| `Chip` / `FilterChip` | Tag-like chips |
| `CircularProgress` / `CircularProgressCenter` | Loading spinners |
| `Collapse` | Collapsible content (Radix) |
| `ColorPicker` | Color selection input |
| `Container` | Max-width content wrapper |
| `DateTimeField` | Date/time picker input |
| `DebouncedTextField` | Text field with debounced onChange |
| `Dialog` / `DialogTitle` / `DialogContent` / `DialogActions` | Modal dialogs (Radix) |
| `ErrorBoundary` | React error boundary |
| `ExpandablePanel` | Expandable/collapsible panel |
| `FileUpload` | Drag-and-drop file upload (react-dropzone) |
| `InputLabel` / `InfoLabel` / `Label` | Form labels |
| `Markdown` | Markdown renderer (markdown-it) |
| `Menu` / `Menubar` | Dropdown and menu bar (Radix) |
| `MultiSelect` | Multi-value select input |
| `Paper` | Elevated surface |
| `Popover` | Popover overlay (Radix) |
| `RadioGroup` | Radio button group (Radix) |
| `ResizablePanels` | Resizable split panes |
| `SearchBar` | Search input with icon |
| `Select` | Single-value select (Radix) |
| `Separator` | Visual divider (Radix) |
| `Sheet` | Slide-out panel |
| `Skeleton` | Loading placeholder |
| `Slider` | Range slider (Radix) |
| `Table` / `VirtualTable` | Data tables (VirtualTable uses react-window) |
| `Tabs` | Tab navigation (Radix) |
| `TextareaAutosize` | Auto-resizing textarea |
| `TextField` | Text input field |
| `ToggleButtonGroup` | Segmented toggle buttons |
| `Tooltip` | Hover tooltip (Radix) |
| `Typography` | Text with variant styling |

### Re-exported Radix Primitives

```typescript
import { Portal, PopoverPrimitive, Slot } from "@rebasepro/ui";
```

### Style Mixins

Tailwind class-string constants for consistent styling:

| Export | Description |
|---|---|
| `focusedClasses` | Ring styles for focused elements |
| `fieldBackgroundMixin` | Standard field background |
| `fieldBackgroundHoverMixin` | Hover state for fields |
| `defaultBorderMixin` | Default border color |
| `paperMixin` | Paper/card surface style |
| `cardMixin` / `cardClickableMixin` / `cardSelectedMixin` | Card variants |

### Utilities

| Export | Description |
|---|---|
| `cls(...)` | Class name merge utility (wraps `clsx`) |
| `debounce` | Debounce function |
| `chipColors` | Color palette for chips |
| `keyToIconComponent` | Map icon string key to lucide component |

### Hooks

| Hook | Description |
|---|---|
| `useInjectStyles` | Inject CSS into the document head |
| `useOutsideAlerter` | Detect clicks outside a ref |
| `useDebouncedCallback` | Debounced callback hook |
| `useDebounceCallback` | Callback debounce variant |
| `useDebounceValue` | Debounced value hook |
| `PortalContainerContext` | Context for portal target container |

### Icons

Re-exports ~100 individual lucide-react icon components (e.g. `ArrowRightIcon`, `SearchIcon`, `PlusIcon`), the `Icon` component, `GitHubIcon`, `HandleIcon`, `iconKeys`, and `coolIconKeys`.

To render an icon whose name is only known at runtime, use `<LucideIconByName name="ShoppingCart" />` (or `loadLucideIcons()` / `useLucideIcons()` for the map itself). The full `icons` map is **not** re-exported: it holds a reference to every icon in the library, so exporting it made the whole 822 kB set eager for anyone importing this package.

## Quick Start

```tsx
import { Button, TextField, Typography, cls } from "@rebasepro/ui";
import { SearchIcon } from "@rebasepro/ui";
import "@rebasepro/ui/index.css";

function MyForm() {
    return (
        <div className={cls("flex flex-col gap-4 p-4")}>
            <Typography variant="h6">Search</Typography>
            <TextField placeholder="Type to search..." />
            <Button variant="filled">
                <SearchIcon size={16} />
                Search
            </Button>
        </div>
    );
}
```

## Related Packages

- `@rebasepro/studio` — Dev tools layer (depends on this package)
- `@rebasepro/admin` — CMS layer (depends on this package)
- `@rebasepro/app` — Core framework (uses this for shared UI)
