# The remaining import cycles in `@rebasepro/cms`

Every other workspace package is now free of import cycles. `packages/cms` is
not, and the three clusters that remain are not import mistakes — they are the
shape of the code. Breaking them means changing how the admin UI dispatches to
its own components, which is a design decision rather than a cleanup, so this
document describes the situation and the options instead of forcing a fix.

## First, a warning about the metric

`fallow` reports **43** circular dependencies for this package, up from 22 before
the cleanup. That number went up while the package got substantially better, so
do not steer by it.

The reason is that the count enumerates *simple cycles*, and the number of simple
cycles inside a single strongly-connected component is combinatorial in its size.
`components/index.ts` used to be a hub that nearly everything imported, so a great
many distinct paths collapsed onto a handful of reported cycles through it. Naming
concrete modules instead deleted the hub, and the paths that were always there
started being reported individually.

The stable measure is the strongly-connected components themselves:

| | before | after |
|---|---|---|
| files trapped in a cycle | 120 | 64 |
| largest cyclic component | 110 | 48 |
| cyclic components | 4 | 3 |

`tooling/scripts/` has no tool for this; the numbers above come from a Tarjan pass over
the intra-package import graph with `import type` edges excluded, since those are
erased at runtime.

## What is left

### 1. Recursive property rendering (SCC of 12 files)

`preview/PropertyPreview.tsx` is a dispatcher: it imports every concrete preview
and switches on the property type. The container previews — array, map, one-of —
then render `PropertyPreview` again for their inner properties, because a map
property contains properties. `ReferencePreview` and `RelationPreview` close a
second loop by rendering `EntityPreviewBinding`, which renders previews.

### 2. Recursive field rendering (part of the SCC of 48 files)

The same shape on the form side. `components/field_configs.tsx` imports all ~20
field bindings to build `DEFAULT_FIELD_CONFIGS`; `form/PropertyFieldBinding.tsx`
calls `getFieldConfig` to pick one; and the container bindings (map, repeat,
block, custom-shaped array) render `PropertyFieldBinding` for their children.

This SCC also contains coupling that is *not* recursion — the side panel renders
entity editors, and entity editors open the side panel — which is a separate
problem mixed into the same component. See "If you only do one thing" below.

### 3. The property editor dialog (SCC of 4 files)

`PropertyFormDialog` is exported from the 940-line `PropertyEditView.tsx`. The
map, repeat and block property fields open that dialog to edit a nested property,
and the dialog renders those same fields. Nine modules import `PropertyFormDialog`
from `PropertyEditView`, so it is effectively a public component living inside an
unrelated file.

## Why these are harmless, and the one way that broke (now fixed)

React defers component references to render time, so a cycle between two
components that only mention each other inside JSX resolves fine no matter which
module the bundler enters first.

The exception is **evaluation at module scope**, and this package has one:

```ts
// components/field_configs.tsx
export const DEFAULT_FIELD_CONFIGS: Record<DefaultFieldConfig, PropertyConfig> = {
    text_field: { /* … */ property: { ui: { Field: TextFieldBinding } } },
```

That object is built while the module initialises, and it reads binding values
that come from modules which — through `PropertyFieldBinding` — import
`field_configs` back. Enter the cycle at a field binding rather than at
`field_configs` and the read happens while the binding module is still in flight.

It worked only because every field binding is declared `export function`, which
hoists and initialises before any module body runs. Rewriting a single one as
`export const Binding = (props) => …` would have turned that read into a temporal
dead zone `ReferenceError` at import time, and the failure would have looked like
an unrelated blank screen. The preview cluster already mixes styles —
`ReferencePreview` and `RelationPreview` are `export const` — and is safe only
because nothing evaluates them at module scope.

**Fixed.** Each `Field` is now a getter, so the binding is read on first access
rather than while the module initialises, and declaration style no longer matters:

```ts
ui: { get Field() { return TextFieldBinding; } }
```

`test/components/field_configs.test.ts` guards it, and deliberately imports a
container binding *before* `field_configs` so the test enters the cycle from the
dangerous side. One case asserts the descriptor is still a getter rather than a
value — that is the case that fails if someone inlines the getters back, which no
behavioural test would catch while the bindings remain hoisted functions.

This removes the hazard but not the cycles; the clusters below are unchanged.

## Options

**A. Registry with runtime registration.** Add a leaf module owning
`register(type, Component)` / `resolve(type)`. Concrete previews and bindings
import only the registry and the shared types, and register themselves; the
dispatchers become lookups; containers recurse through `resolve`. This genuinely
removes the cycles. It also introduces registration-order as a new failure mode,
needs a side-effect "install" module imported at the entry point, and works
against tree-shaking — note the current build code-splits `PropertyEditView` and
`CollectionEditorDialog` into their own chunks, which a module that force-imports
every implementation would undo.

**B. Pass the recursive renderer through context.** The dispatcher provides itself;
containers call `useRecursiveRenderer()` instead of importing the dispatcher. This
deletes the static edge with no registration-order problem and preserves code
splitting, at the cost of a context read per nested property and a less obvious
data flow.

**C. Leave the recursion, remove the accident.** Keep the cycles, and make the
thing that is actually fragile impossible. The `DEFAULT_FIELD_CONFIGS` half of
this is **done** — the `Field` getters above. What remains under this option is to
suppress the leftover cycles with reasons, and optionally to stop relying on
declaration style anywhere else by preferring the same lazy treatment wherever a
module-scope literal captures a component from inside a cycle.

## Recommendation

**C for clusters 1 and 3, and split cluster 2 before deciding.**

Recursive rendering of a recursive data structure is not a defect, and options A
and B both pay real complexity to satisfy a metric that is already misreporting
this package. Option C removes the only genuine hazard — the module-scope
evaluation — for a fraction of the risk.

Cluster 3 is worth a small independent move regardless: lift `PropertyFormDialog`
out of `PropertyEditView.tsx` into its own module. Nine files already import it as
though it were one. That is a mechanical change and it shrinks a 940-line file.

**If you only do one thing:** the 48-file component is the actual problem, and
recursion is not what makes it 48 files. Side panel, entity editor, collection
view and the collection editor are mutually reachable because each renders the
others directly. That is accumulated coupling rather than inherent recursion, and
it is the cluster where an extracted module — a navigation/side-panel boundary the
editors depend on instead of each other — would pay for itself. It needs its own
investigation; it is not a refactor to attempt in the same pass as an import
cleanup.
