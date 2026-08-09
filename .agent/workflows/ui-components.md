---
description: Rules for creating UI components in the Rebase codebase
---

## Visual Cohesion Rules

1. **Always use the `@rebasepro/ui` kit** for all UI components. Before creating any new component, check what is available in `packages/ui/src/components/`. Available components include:
   - `Card`, `Paper`, `Container`, `CenteredView`
   - `Typography`, `Markdown`
   - `Button`, `IconButton`, `LoadingButton`
   - `TextField`, `DebouncedTextField`, `TextareaAutosize`
   - `Select`, `MultiSelect`, `Autocomplete`
   - `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions`
   - `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell`
   - `Tabs`, `Chip`, `Badge`, `Label`, `InfoLabel`
   - `Checkbox`, `BooleanSwitch`, `RadioGroup`, `Slider`
   - `Menu`, `Menubar`, `MenuItem`, `Popover`, `Sheet`
   - `Tooltip`, `Skeleton`, `CircularProgress`, `Separator`
   - `Avatar`, `Alert`, `Collapse`, `ExpandablePanel`
   - `SearchBar`, `DateTimeField`, `ColorPicker`, `FileUpload`
   - Icons from `@rebasepro/ui`. These are Lucide names with an `Icon` suffix — `PlusIcon`, `Trash2Icon`, `ArrowRightIcon`, `SearchIcon` — not Material names. If you are unsure, grep `packages/ui/src/icons/` rather than guessing a name that reads plausibly.

2. **Never use `as any`** in TypeScript code. Use proper typing or explicit type narrowing instead.

3. **Follow existing patterns**: `UIReferenceView` (`packages/app/src/components/Debug/UIReferenceView.tsx`, served at `/debug/ui`) is the design source of truth for the kit. For layout, read `ContentHomePage`, `StudioHomePage` or `NavigationCardBinding` and follow how they compose kit components.

4. **Use `cls()` from `@rebasepro/ui`** for conditional class merging instead of template literals.

5. **Use `Typography`** for all text rendering — never use raw `<h1>`, `<p>`, `<span>` for visible UI text.

---

## Design Token Rules (MANDATORY — NO EXCEPTIONS)

1. **All borders MUST use `defaultBorderMixin`** from `@rebasepro/ui` — the package barrel, not a `@rebasepro/ui/styles` subpath, which is not in the package's `exports` map and would not resolve for an installed consumer. NEVER hardcode border colors. Import and apply via `cls()`.

2. **Use the established color token scale for interactive states**. Look at existing components in the codebase for the correct tokens. NEVER invent arbitrary color values — always reference the existing design system (`surface-accent-*`, `primary-*`, etc.).

3. **No gradients on icons or fallback placeholders** unless the design explicitly calls for it.

4. **Let text fill its container naturally**. Use `truncate` for overflow. Do NOT hardcode `max-w-[Npx]` on text elements.

5. **Interactive controls must always be visible**. Never hide checkboxes, toggles, or action buttons behind hover states.

---

## Responsive Layout Rules (MANDATORY)

1. **Container-aware, not viewport-aware**: Use `ResizeObserver` on the actual container, NOT media queries, for adaptive layout. This ensures correct behavior inside split panels, side panels, and nested layouts.

2. **Refs that observers depend on MUST render unconditionally**. If a component uses `ResizeObserver`, `IntersectionObserver`, or any ref-dependent effect, the element carrying the `ref` MUST NOT be inside a conditional return. Loading, empty, and error states go INSIDE the always-rendered container.

3. **One component, adaptive rendering**: Prefer a single component that adapts to its container width over separate "compact" and "full" variants. This prevents feature drift and keeps the codebase DRY.

---

## Mobile / Small Screen Rules (MANDATORY)

1. **Master-detail views on small screens**: When space is insufficient for side-by-side panels:
   - If an item IS selected, show the **detail/form view**.
   - If NO item is selected, show the **list**.
   - NEVER show only the list when the user has selected something.

2. **Back navigation**: Escape or a back action from the detail view should return to the list.

---

## View Mode Icon Conventions

Each collection view mode has a standard icon from Lucide. When building view switchers or navigation, use these mappings consistently:

| View Mode | Lucide Icon | Notes |
|-----------|-------------|-------|
| `table` | `Table` | Default tabular view |
| `cards` | `LayoutGrid` | Grid of cards |
| `kanban` | `Columns` | Board with columns |
| `list` | `List` | Compact list view |

---

## Agent Enforcement Rules (MANDATORY)

1. **UI Kit First**: The `@rebasepro/ui` component library is the single source of truth for all UI elements. When writing new code, **always** use the UI kit component if one exists. Never introduce a raw HTML element (`<table>`, `<input>`, `<label>`, `<h1>`–`<h6>`, etc.) when a kit equivalent is available.

2. **Proactive Notification**: When performing **any** task (bug fix, feature, refactor), if you encounter an existing file that uses a raw HTML element or hand-rolled styled component where a `@rebasepro/ui` equivalent exists, **immediately tell the user**. Do NOT silently fix it — describe the violation and which kit component should replace it, then let the user decide.

3. **Common Replacements Reference**:
   | Raw / Legacy | UI Kit Replacement |
   |--------------|--------------------|
   | `<input type="radio">` | `RadioGroup` |
   | `<input type="checkbox">` | `Checkbox` |
   | `<label>` | `Label` / `InputLabel` |
   | `<table>`, `<tr>`, `<td>`, `<th>` | `Table`, `TableHeader`, `TableRow`, `TableCell` |
   | `<h1>`–`<h6>`, `<p>`, `<span>` (for text) | `Typography` |
   | Hand-rolled alert/banner div | `Alert` |
   | Hand-rolled badge/pill span | `Badge` / `Chip` |
   | Hardcoded `border-gray-*` | `defaultBorderMixin` |
   | Hardcoded `text-gray-*` / `text-slate-*` | `text-surface-*` design tokens |

