# design-sync notes — @rebasepro/ui

Repo-specific gotchas for future syncs. Read this before re-running.

## The big one: the package ships no compiled CSS

`@rebasepro/ui` ships Tailwind **source**, not compiled CSS:

- `dist/theme.css` is an `@theme` block (tokens only).
- `dist/index.css` has 16 `.typography-*` rules built with `@apply`, plus a
  `:focus-visible` rule — all uncompiled.
- Every component styles itself with utility classes (`bg-surface-accent-200/50`,
  `text-surface-accent-500`, `dark:bg-white/[0.055]`) that **no shipped
  stylesheet defines**. Consumers run Tailwind themselves.

So the sync compiles them: `.design-sync/tailwind-entry.css` →
`packages/ui/dist/_design-sync-compiled.css` (~422 KB), and `cfg.cssEntry`
points at that. Without this step every preview renders unstyled.

- Regenerate with `bash .design-sync/rebuild.sh` (or `--css-only` to skip the
  package build). **Order matters**: `pnpm --filter @rebasepro/ui build` starts
  with `rm -rf dist`, which deletes the compiled stylesheet.
- The entry mirrors `app/frontend/src/index.css` (the real consumer) but imports
  `index.css` **unlayered**. The app wraps it in `layer(base)`; `theme.css`'s own
  header says a layered import stops its `@theme` from registering.
- Dark mode is **class-based** (`@custom-variant dark (&:where(.dark, .dark *))`),
  not `prefers-color-scheme`.
- The Tailwind CLI is installed into `.ds-sync/`, and `.design-sync/node_modules`
  is a symlink to it so `@import 'tailwindcss'` resolves from the entry file.
  Recreate on a fresh clone: `ln -sfn ../.ds-sync/node_modules .design-sync/node_modules`.
- **`.ds-sync/` is a toolchain, not a cache.** It is gitignored and it sits next
  to genuinely disposable directories, so it reads as scratch and has been
  deleted by mistake during a root cleanup. It now carries its own
  `.ds-sync/package.json` pinning the four things that must be there —
  `@tailwindcss/cli` and `@tailwindcss/typography` (matching the workspace's
  `tailwindcss@^4.3.3`, and the `@plugin` on `tailwind-entry.css:20`) plus
  `playwright`/`@playwright/test` at the repo-pinned `1.62.0` for the audit
  scripts. Rebuild it with a plain `cd .ds-sync && npm install` — **`npm`, not a
  workspace `pnpm install`**, which is the whole reason it lives outside the
  workspace. Then re-link `node_modules` as above and confirm with
  `bash .design-sync/rebuild.sh --css-only`.
- `ds-bundle/` **is** regenerable output — the DesignSync package build writes it,
  and `gen-ui-docs.mjs` only reads it. Losing it costs a rebuild, nothing more:
  the docs it generates (`website/src/content/docs/docs/ui/**`) and the previews
  it pairs them with (`.design-sync/previews/`) are both tracked.

## Install / build

- **Do not run a workspace-wide `pnpm install`.** This repo has a gitignored
  `saas/` workspace member and an untracked `app/*` importer; a wholesale install
  prunes importers. `node_modules` and `packages/ui/dist` were already present
  and fresh, so this sync skipped the install entirely.
- `--node-modules packages/ui/node_modules` resolves `react`/`react-dom` fine.
- Playwright: browsers are already cached at
  `~/Library/Caches/ms-playwright/chromium-1234`, which is what the repo's pinned
  `@playwright/test@1.62.0` wants. `playwright` itself is installed into
  `.ds-sync/` (the validate script needs to import it from there).

## Component scoping

- The `.d.ts` exports **238** PascalCase symbols. 135 of those are lucide icon
  pass-throughs re-exported from `packages/ui/src/icons/index.ts`; they are
  excluded from the component list via `cfg.componentSrcMap: {…: null}` so the
  picker isn't swamped. **They remain importable from `window.RebaseUI`** — the
  JS bundle is built from the package entry, so excluding a component from the
  card list never removes it from the bundle.
- Two of them do **not** carry an `Icon` suffix: `AppWindow` and `UserPlus`.
  Regenerate the exclusion list from `dist/icons/index.d.ts`'s
  `export {...} from "lucide-react"` line, never by name pattern.
- There is **no `Icon` component**. `src/icons/Icon.tsx` exports only
  `iconSize`, `IconProps`, `colorClassesMapping` — types and constants.
- That leaves **103** real components.

## API drift + component gaps found while authoring

Five real bugs surfaced by this sync. **All five were fixed on 2026-07-31**, in
the same working tree as the sync — verified by typecheck, the `@rebasepro/ui`
build, and fresh preview captures:

| Bug | Fix |
|---|---|
| `UIReferenceView` passed `Chip colorScheme="purpleDark"/"blueDark"`; `CHIP_COLORS` has no `*Dark` keys, so those chips rendered unstyled | → `"purple"` / `"blue"` (`UIReferenceView.tsx:862`) |
| `VirtualTableDateField` never forwarded `size`, so `DateTimeField` fell back to its own `size="large"` default (min-h-64px) and overflowed the cell — the value read as struck through | added `small?: boolean` → `size={small ? "small" : "medium"}`, and the admin date binding now passes `small={getPreviewSizeFrom(size) !== "medium"}` like every sibling field binding already did |
| `Menubar` had **no** controlled-open path — `Menubar`/`MenubarMenu`/`MenubarTrigger` forwarded no rest props, so `value`/`defaultValue`/`open` were silently dropped | `Menubar` now forwards `value`/`defaultValue`/`onValueChange`; `MenubarMenu` forwards `value` |
| `HandleIcon` had zero props — hardcoded 24px, no size/colour/className | now takes `IconProps` |
| `GitHubIcon` wrote `props.size` straight into SVG `width`, so an `IconSize` keyword emitted `width="small"` | resolves keywords via `iconSize`; also honours `color`/`onClick`/`style` |

The Menubar fix let `previews/Menubar.tsx` drop a synthetic-`pointerdown` hack in
favour of the real `defaultValue` API. **`MenubarSub` still needs a real `.click()`
on `[data-radix-menubar-subtrigger]`** — its `defaultOpen` raced the capture
(screenshot fired before the SubContent's Popper position resolved).

Controlled-open remains inconsistent across the DS — check the `.d.ts` every time:

| Component | Controlled | Uncontrolled |
|---|---|---|
| `Menu` | `open` | `defaultOpen` |
| `Tooltip` | `open` | `defaultOpen` |
| `Select`, `Popover` | `open` | **none** — `defaultOpen` silently no-ops |
| `Sheet` | `open` (**required**) | none |
| `Menubar` | `value` + `onValueChange` | `defaultValue` (**as of the fix above**) |
| `CollectionViewToolbar` | none — settings popover is internal `useState` | none |

Not drift, but easy to misread:

- `UIReferenceView`'s **"Form Dialog" section is a static div mockup**, not real
  `Dialog`/`DialogTitle`/`DialogContent`/`DialogActions` usage. Only its visual
  layout (`grid grid-cols-12 gap-4`, right-aligned actions) is canonical; the
  real component composition had to be built from the `.tsx` sources.
- `UIReferenceView` **captions** a tab bar `variant="default"` — but never passes
  it. `Tabs.variant` is `"standard" | "boxy" | "pill"`; the example just omits
  the prop and gets `"standard"`. The caption is wrong, the code is fine.
- `Badge` has no `size`; `FilterChip` has no `colorScheme` (only `active` /
  `icon` / `size` / `disabled`); `Separator.orientation` is required.
- `DialogTitle` / `DialogContent` props extend **`TypographyProps`**, not a
  dialog-specific shape (`DialogTitle` defaults to `variant="subtitle2"`).
- `PopoverPrimitive` is a raw `@radix-ui/react-popover` namespace re-export
  (`Root`/`Trigger`/`Portal`/`Content`/`Arrow`), typed `{[key: string]: unknown}`.
- `SelectInputLabel` is used by passing it AS the `label` prop of
  `Select`/`MultiSelect` — they render a ReactNode `label` verbatim. That is the
  real render path, not a lookalike.
- `CollectionViewToolbar`'s view-mode / size / group-by controls live behind an
  internal `Popover` with no external open control, so its card necessarily shows
  the closed-state bar. That is the component's true default appearance.

## `.d.ts` extraction gaps

The extractor drops type parameters on generic components, so the emitted
contract can reference an undeclared `T` or an unresolved named type. Since the
`.d.ts` IS the API contract the design agent codes against, these were
hand-written into `cfg.dtsPropsFor`:

| Component | What was wrong |
|---|---|
| `Chip` | `colorScheme?: ChipColorScheme` unresolved → wrote the real 15-key union |
| `ToggleButtonGroup` | `ToggleButtonOption<T>` unresolved → inlined the option shape |
| `DebouncedTextField` | `value?: T` with no `<T>` — it's `TextFieldProps<T>` in source → `string \| number` |
| `CardView` | dropped `<T>`; otherwise accurate |
| `ListView` | dropped `<T>`, **and `renderRow` emitted as `unknown`** — the one real content gap |
| `KanbanView` | dropped `<T, COLUMN>`; inlined `BoardItem`, `BoardItemViewProps`, `ColumnLoadingState` |
| `DefaultCellRenderer` | `CollectionPropertyConfig` never emitted anywhere → inlined |

Checked and deliberately NOT overridden (verified accurate against source):
`TableView` (its `VirtualTableColumn` / `CellRendererParams` / `OnRowClickParams`
names are defined in the same file and inlined correctly), the whole `Collection*`
family, `ColorPicker`, `DateTimeField`, and the `VirtualTable*` field editors
(their "unresolved `Error`" is genuinely the global `Error` type).

Known remaining gap, not yet overridden: **`FileUploadProps` drops `children`**
even though the component is `React.PropsWithChildren<FileUploadProps>`.

## Known render warns (triaged as legitimate)

- **`[FONT_MISSING]` naming "Inter", "Instrument Sans", "Space Mono",
  "Lucida Console"** — benign. These are *fallback* entries further down the
  `--font-sans` / `--font-headers` / `--font-mono` stacks. The primaries
  (`Inter Variable`, `Instrument Sans Variable`, `JetBrains Mono`) **do** ship
  via `cfg.extraFonts` and were confirmed rendering in the Typography sheet.
- **Open Radix surfaces show a blue focus ring.** Menus/selects take focus on
  open, and the DS's `:focus-visible` rule is `ring-2 ring-primary`. It's the
  true open-state render, not a preview defect.
- **`BooleanSwitch` / `Checkbox` "on" colours read pink/red**, not the primary
  blue — that is the shipped component's own colour choice.

## Coherence pass (2026-07-31) — sizing + colour

Audited by measuring real rendered boxes in headless chromium, not by reading
CSS. The harness is committed under `.design-sync/audit/`. **Re-run both after
any change to a control's padding, height or palette** — they are the regression
test for this work. Run them from `.ds-sync/`, which is where playwright is
installed, and after a `package-build.mjs` (they load `ds-bundle/_ds_bundle.js`,
so `rebuild.sh` alone is not enough — that trap cost two false readings):

```
cd .ds-sync && node ../.design-sync/audit/measure.mjs
cd .ds-sync && node ../.design-sync/audit/measure-colors.mjs
```

**Before**: `size="large"` meant 42px on a Button and 64px on a TextField. There
was no size name at which a Button and a TextField lined up. Nine controls each
carried their own private height map.

**Now**: one scale in `styles.ts` — `CONTROL_HEIGHT` / `controlHeightMixin` /
`controlPaddingMixin`, 28/32/40/48 (+56/64 for buttons only). Measured spread at
every size name across all nine inline controls: **0px**.

Specific bugs the measurements exposed, all fixed:

- `Button` derived height from padding alone, so it could never match a field.
- `DateTimeField` rendered its calendar/clear adornments as default-`medium`
  IconButtons (40px), flooring the whole field — smallest/small/medium were all
  40px. It also had a flat `py-2`.
- `MultiSelect` hardcoded `Chip size="medium"` inside a `py-2` row, overflowing
  its own min-height.
- `Checkbox` gave `smallest` and `small` the same 32px hit area.
- `BooleanSwitch` had `medium` and `large` sharing one branch.
- `Chip` `small`/`medium` differed only in horizontal padding — same height.
- `SearchBar` hardcoded its own heights and had no `large`.
- A labelled `TextField` was 50px at smallest, small AND medium — `size` was
  effectively inert whenever a label was present.

**Colour**: 61 combinations checked for WCAG AA against real composited pixels.
`--color-secondary` was `#FF5B79` at 2.99:1 — failing as text on white *and*
behind white text. Now `#E11D48` (rose-600, same hue family, 4.70:1). Button's
error variants moved `red-500` → `red-600` (3.76 → 4.83:1). All 15 Chip schemes
and all 4 Alert colours already passed and were left alone. `primary` `#0070F4`
passes at **4.54:1 with almost no margin** — treat it as fixed.

**Corner radius has to step down with the box.** Shrinking `Checkbox`'s
`smallest` box from 16px to 14px while it still carried `rounded-md` (6px) made
it render as a *circle* — 6px of radius from each side of a 14px box leaves
almost no straight edge. It shipped that way briefly and was immediately obvious
in the product. Anything at or below ~16px needs `rounded` (4px) or smaller. The
height harness does not catch this: the box measured correctly the whole time,
it just wasn't square. Eyeball shape changes, don't only measure them.

Two measurement caveats for whoever re-runs this:

- The 16 disabled-state rows reported below AA are **not defects** — WCAG 1.4.3
  exempts inactive controls. Expect them.
- `Button filled/error` reports a nonsense `1:1` (white on white). It is a
  harness artifact, not a bug — the button renders red with white text, verified
  by screenshot. Its true ratio is 4.83:1. Don't chase it.

## Marketing site alignment (2026-08-02)

`.design-sync/audit/site-drift.mjs` measures the site against the DS tokens.
Run it against a dev server: `cd .ds-sync && node ../.design-sync/audit/site-drift.mjs`.

**Read tokens from `theme.css` on disk, never from the page.** Tailwind v4
tree-shakes `@theme` variables nothing references, so a page-based read finds
only the handful in use and reports `primary` itself as drift. The first version
of the script did that and produced a garbage report.

The site was already tokenised for colour, fonts and the large type sizes — it
imports `theme.css` and defers to it. What had drifted was scale:

- **Type.** ~450 hand-written `text-[10px]`/`text-[11px]` classes. That tier was
  real but unnamed, so every page improvised it. The DS now defines `--text-2xs`
  (11px) and `--text-3xs` (10px), **marketing-only** — product UI must not go
  below `text-xs`. 117 non-mockup occurrences were swept onto the tokens.
- **Controls.** Header CTA 36→40, hero CTAs 52/54→56, "Read the Docs" 50→48,
  footer "Join" 38→40. The 2px gap between the two hero CTAs was the DS Button
  bug in miniature: identical padding, but only the outlined one had a border.
  Filled variants now carry `border-transparent`, as Button does.
- **Radii.** `rounded-3xl` collapsed to `2xl` except a phone bezel and a demo.

**Expected remaining "drift" — do not chase these:**

- Everything under `website/src/components/demos/**` and the mockup blocks in
  `StudioContent.astro` is a *scaled illustration of a UI*, not typography. It
  legitimately uses 6-9px text and 22-34px tab heights. Raising those breaks the
  illusion of a shrunken interface.
- Nav dropdown cards report as 62px/163px "controls" — they are link cards, not
  buttons; the script's control heuristic cannot tell them apart.
- Baseline at time of writing: 18 off-scale controls (15 mockup, 2 nav cards,
  1 demo tab) and 8/9/15px text (all mockup). A number materially above that is
  new drift.

**Not done: semantic colour.** The audit flags site accents (emerald/sky/amber/
rose) as matching no token — but the DS defines **zero** semantic colour tokens,
and `Alert` itself hardcodes `red-500`/`amber-500`/`blue-500`/`emerald-500`. The
site is doing exactly what the DS does, so there is nothing to move onto. The
real fix is to add `--color-success|warning|info|danger` to the DS and refactor
`Alert` onto them first; pointing the site at raw palette colours in the
meantime would just move the hardcoding around.

## The authoring trap: silently-dropped Tailwind classes

**The single biggest time sink of this sync.** The stylesheet is compiled ONCE
per sync, but preview files are authored continuously afterwards. A utility class
that appears for the first time in a new preview is **not** in the compiled CSS,
so it renders as a no-op — no build error, no warning, just a subtly wrong card
(a collapsed grid, a missing width, a zero-height virtualized view that looks
like a data problem). Three separate agents hit this.

Mitigations now in place, in order of preference:

1. `tailwind-entry.css` carries an `@source inline(...)` safelist of common
   layout/spacing/typography glue, so ordinary authoring is safe.
2. **For any fixed pixel dimension, use inline `style={{ height: 420 }}`** rather
   than an arbitrary bracket class like `h-[420px]`. Always works, never
   silently drops. This is mandatory for the virtualized views.
3. To check a class before trusting it, use **`grep -cF`** (fixed-string):

   ```
   grep -cF 'dark\:bg-surface-800' ds-bundle/_ds_bundle.css
   ```

   Plain `grep -c 'dark:...'` returns 0 for *every* dark-mode class because the
   compiled selectors are backslash-escaped (`dark\:`) — a false negative that
   has already produced one wrong "this class is missing" report. Verified: the
   DS's own mixin classes (`bg-primary-bg/30`, `ring-primary/75`,
   `hover:bg-primary/5`, `dark:border-surface-700/60`) **are** all compiled.

## Card presentation overrides

`[GRID_OVERFLOW]` is a presentation check, not a render failure — it fires when a
story escapes or overflows its grid cell in the product's card view. 57 entries
now live in `cfg.overrides`:

- **`cardMode: "single"`** — content escapes via a portal; no grid layout can
  contain it, and only `single` is exempt by construction. Applied to `Menu`,
  `Select`, `SelectItem`, `SelectGroup`, the whole `Dialog` family, `Popover`,
  `PopoverPrimitive`, `Sheet`, `Tooltip`, `MenuItem`, and all 16 `Menubar*` parts.
- **`cardMode: "column"`** — merely wider than a cell. Applied to the table
  family, the collection/data views, `Autocomplete*`, `IconButton` (the icon
  gallery), `Markdown`, `SearchBar`, `Tabs`, `TextField`, `TextareaAutosize`,
  `Typography`, `InfoLabel`, `BooleanSwitchWithLabel`.

`Autocomplete` notably does **not** portal — its dropdown is a plain
`absolute top-full` sibling inside a `relative` parent, so it stays contained.

## Compositions worth not rediscovering

- **`VirtualTable` renders fine statically** — it just needs three things: an
  explicit pixel-height ancestor (react-window measures its container), explicit
  numeric column widths, and a `cellRenderer` following the real
  `CollectionTableView.tsx` pattern.
- **The `VirtualTable*` field editors ship no cell chrome by design**, which is
  why they looked blank. The previews wrap each in a local `CellShell`
  reproducing the product's real `EntityTableCell` selected/unselected treatment
  (`border-4 border-primary` + `bg-surface-accent-*`).
- **`VirtualTableSelectionProvider` has no JSX usage anywhere in the repo.** Its
  preview is built from the underlying primitives —
  `createVirtualTableSelectionStore`, `useVirtualTableSelection`,
  `useVirtualTableCellSelected`, all real top-level exports. The one real caller
  to copy from is `packages/admin/src/components/SelectableTable/SelectionStore.ts`.
- **`Autocomplete` is used nowhere in `packages/app` or `packages/admin`** — its
  preview composition is original. It is `Collapse`-based, positioned
  `absolute top-full` as a sibling of a `TextField` inside a shared
  `<div className="relative">`.
- The full `Menubar` composition shape lives in
  `packages/ui/src/components/Menubar.tsx` — read it before authoring any
  `Menubar*` part.

## Preview sources

`packages/app/src/components/Debug/UIReferenceView.tsx` (route `/debug/ui`) is
the canonical composition source and is worth reading first — it explicitly
mirrors real screens rather than inventing styles. Its sibling demos carry
fabricated datasets that the heavy data views need:
`Debug/crm-dashboard/CrmDashboardDemo` and `Debug/collection-views`
(`CollectionTableDemo`, `CardViewDemo`, `KanbanBoardDemo`).

Sanity-check every ported prop against the current `<Name>.d.ts` — see the API
drift section above for two cases where the reference view has drifted.

## Re-sync risks

- **The compiled stylesheet is build output and is gitignored.** A fresh clone
  has no `packages/ui/dist/_design-sync-compiled.css`; run `rebuild.sh` before
  the converter or the whole bundle ships unstyled. This is the single most
  likely way a future sync silently regresses.
- **The lucide exclusion list is a snapshot.** Adding an icon to
  `src/icons/index.ts` makes it appear as a new component card until the
  `componentSrcMap` list is regenerated.
- **`cfg.extraFonts` points into `app/frontend/node_modules`.** If the app drops
  `@fontsource-variable/inter`, `@fontsource-variable/instrument-sans` or
  `@fontsource/jetbrains-mono`, fonts silently stop shipping.
- **`dtsPropsFor` entries are hand-copied from source** and will rot if those
  components' props change. Re-diff them against source on a version bump.
- **The `@source inline(...)` safelist is a guess at what previews will need.**
  It cannot cover arbitrary bracket values. Any newly authored preview that
  reaches for an uncompiled class fails silently — see the authoring-trap section.
- **`previews/Menubar*.tsx` depend on Radix internals**: a dispatched
  `pointerdown` and the `[data-radix-menubar-subtrigger]` attribute selector.
  A Radix major bump will break those cards silently (they will capture closed,
  not error). Re-check them on any `@radix-ui/react-menubar` upgrade.
- Verified only against the light theme; no dark-mode card was captured, even
  though the DS has full class-based dark support.
- Every component was authored and graded in this campaign, so the next sync's
  anchor should let it skip essentially everything. A large `changed` partition
  on the next run means something upstream moved — look before re-grading.
