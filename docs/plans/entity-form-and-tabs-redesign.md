# Entity form + tabs — diagnosis and redesign

Date: 2026-07-31. Status: **merged to `main`** on 2026-08-01, except where
[§5](#5-what-is-not-done) says otherwise.

Measured on the same form after the change: **2932px → 1587px** of scroll, and
**219px → 24px** of dead space above the first field.

Measurements below were taken against the demo app (`app/`, `pnpm dev`) at a
1440×900 viewport, on `main` @ 544a251bd.

---

## 1. The one-line diagnosis

The entity view has **exactly one layout** — a single centred column of
full-width field cards in property-declaration order — and **exactly one escape
hatch** — `formView.Builder`, which replaces the entire form. There is nothing
in between, and everything else (tabs, the right rail, the JSON dump, revision
history) is bolted onto that column.

That shape is inherited from FireCMS, where it fit: Firestore documents with a
handful of fields, opened in a side panel. Rebase is a Postgres BaaS where
collections routinely carry 15–25 columns, and where the *default* open mode is
now full screen — `resolveOpenEntityMode` returns `full_screen` for both `table`
and `cards` ([view_mode.ts:99](../../packages/cms/src/util/view_mode.ts#L99)).
A flat column at ~175px per field is a 2000–3000px scroll before you have done
anything.

Measured, no config changes:

| Form | Fields | Scroll height | Viewport |
|---|---|---|---|
| `products` | 14 | **2932px** | 651px |
| `posts` (new) | 11 | **2213px** | 651px |

---

## 2. What is actually wrong

### 2.1 Density and layout

1. **Every field is full width, regardless of what it holds.** A 3-digit
   `Stock Quantity` gets the same ~1000px box as the markdown `Description`.
   Average cost is ~175px of vertical space per field, whatever the field is.
2. **No grouping primitive exists.** 25 fields render as one undifferentiated
   list. `getFormFieldKeys`
   ([useColumnsIds.tsx:211](../../packages/app/src/components/common/useColumnsIds.tsx#L211))
   returns a flat array; `FormLayout` is a single `flex flex-wrap`
   (`FormLayout.tsx`, since replaced by `FormSections.tsx`).
3. **The only width knob is `admin.widthPercentage`** — a raw percentage fed to
   `calc(X% - 8px)` in a wrapping flex row
   (`FormEntry.tsx:14`, since replaced by `FieldBlock.tsx`).
   The maths works, but fields only pair into a row by luck of declaration
   order; reordering one property silently reflows every row after it. Nothing
   in the demo config sets it, which is a fair signal about how usable it is.

### 2.2 Two label systems in one column

4. Text and number fields put the label **inside** the box as a small caption.
   Selects, arrays, storage, markdown and read-only fields put the label
   **outside and above**, at a larger size. Both appear in the same scroll —
   `Brand` (inside) sits directly above `Status` (outside) in the products form.
5. Field descriptions render **below the box**, so the rhythm is
   box → description → gap → box, and a caption reads as belonging to the field
   after it about as strongly as the one before it.

### 2.3 The header block is 219px of noise

Measured on a new blog post, from the top of the scroll container to the top of
the first field: **219px**, of which none carries information.

6. **The path chip renders `posts/`** — a bare trailing slash. It is
   `{entity?.path ?? path}/{entityId}` with no id yet
   ([EntityForm.tsx:491](../../packages/cms/src/form/EntityForm.tsx#L491)).
7. **The heading of a new blog post reads `draft`.** The title resolver walks
   candidate properties and returns the first non-empty one; on a new entity the
   only populated value is the `status` default
   ([EntityForm.tsx:319-329](../../packages/cms/src/form/EntityForm.tsx#L319),
   [title-property.ts:255](../../packages/app/src/collections/title-property.ts#L255)).
   There is no `status === "new"` guard.
8. **The id can appear three times.** On `customers` (which uses
   `defaultEntityAction: "view"`): once in the path chip, once as the synthetic
   `Id` row that `EntityViewBinding` always prepends
   ([EntityViewBinding.tsx:38-61](../../packages/cms/src/components/EntityViewBinding.tsx#L38)),
   and once more as the collection's own `id` property. In the ~340px split
   pane the 4/8 grid collapses and each UUID wraps to four lines, so the id
   costs ~350px before the first real field.
9. **72px of dead space** between the path chip and the first field, on every
   form, in every mode.

### 2.4 The right rail

10. `buildSideActions` is a fixed `w-80 2xl:w-96` sticky column
    ([EntityFormActions.tsx:183](../../packages/cms/src/form/EntityFormActions.tsx#L183))
    holding two or three buttons and then ~700px of nothing. That is 22–27% of
    a 1440px viewport permanently reserved for a Save button.
11. The sync-status indicator is an **unlabelled sticky circle** (✓ / pencil /
    spinner) at `top-4` inside an `h-0 overflow-visible` container
    ([EntityForm.tsx:593](../../packages/cms/src/form/EntityForm.tsx#L593)). It
    floats over field content as you scroll — it lands on top of the `Reviews`
    value in the products form. It also duplicates information the Save button
    already carries.

### 2.5 Tabs

12. **Tab order is `[JSON] [History] [Entity] [custom…] [subcollections]`**
    ([EditViewBinding.tsx:645-673](../../packages/cms/src/components/EditViewBinding.tsx#L645)).
    Two developer tools sit *before* the thing you opened the page to edit. The
    primary tab is third.
13. Those two are **icon-only, unlabelled, and have no tooltip**, sitting beside
    labelled tabs.
14. **The strip is right-aligned in an otherwise empty 52px bar.** The entire
    left half of the header is dead — no breadcrumb, no record title, no back
    affordance.
15. **The record title lives inside the scrolling form**, so it disappears on
    first scroll. Nothing in the persistent chrome tells you which record you
    are on.
16. **Four different kinds of thing are peers in one flat strip**: this record's
    fields; alternate renderings of this record (`Preview`); records that belong
    to this record (subcollections); and debug tooling (JSON, history).
17. In the split layout the strip clips — `Customer ›` is cut at the pane edge.
    Scroll arrows exist ([Tabs.tsx:86](../../packages/ui/src/components/Tabs.tsx#L86))
    but the affordance is weak at that width.
18. **`selectedTab` doubles as "am I editing"** — `selectedTab === "edit"`
    ([SidePanelBinding.tsx:102](../../packages/cms/src/components/SidePanelBinding.tsx#L102)).
    Edit mode is encoded as a tab value that is not a tab.

### 2.6 The tab state machine has five sources of truth

`EditViewBindingInner` carries `selectedTabProp`, a resolved
`defaultSelectedView`, a `userHasChangedTab` ref, a `validTabValues` set with an
`activeTab` fallback, and a `mountedTabsRef` keep-alive set
([EditViewBinding.tsx:232-301](../../packages/cms/src/components/EditViewBinding.tsx#L232)).
On top of that, `SidePanelBinding` runs a **one-time correction effect** that
re-navigates after mount because the collection registry resolves late
([SidePanelBinding.tsx:144-168](../../packages/cms/src/components/SidePanelBinding.tsx#L144)).
Six moving parts to answer "which tab is showing".

### 2.7 DX

19. **The layout API is `propertiesOrder` + `widthPercentage` + all-or-nothing
    `formView.Builder`.** Want a two-column layout with status and publish date
    in a sidebar? You rebuild the entire form and lose validation wiring, error
    focus, the local-changes restore menu, autosave and the field registry.
20. **`entityViews` and `formView` are two concepts with near-identical
    `Builder` signatures** and different resolution paths (`resolvedSelectedEntityView`
    vs the inline `FormViewBuilder` at
    [EditViewBinding.tsx:462](../../packages/cms/src/components/EditViewBinding.tsx#L462)).
    Their shared option even disagrees on type: `includeActions?: boolean | "bottom"`
    on `EntityCustomView`, `includeActions?: boolean` on `FormViewConfig`
    ([entity_views.tsx:80,104](../../packages/cms-types/src/types/entity_views.tsx#L80)).
21. **`EntityCustomViewParams` hands you three overlapping views of the same
    data** — `entity`, `modifiedValues`, and `formContext` (which itself exposes
    both `.values` and `.formex.values`). The codebase picks differently in
    adjacent lines: `formContext.formex.values ?? entity.values` at
    [EditViewBinding.tsx:374](../../packages/cms/src/components/EditViewBinding.tsx#L374),
    `formContext.values ?? entity.values` at
    [:393](../../packages/cms/src/components/EditViewBinding.tsx#L393) and
    [:408](../../packages/cms/src/components/EditViewBinding.tsx#L408).
22. **You cannot render one generated field from a custom view.**
    `PropertyFieldBinding` exists but is not part of the public entity-view
    contract, so the escape hatch is binary.

---

## 3. Proposal

### A. A layout tree, with the flat column as the fallback

Add `admin.form` to the collection:

```ts
admin: {
  form: {
    sidebar: ["status", "publish_date", "author", "tags"],
    sections: [
      { key: "content", title: "Content", properties: ["title", "slug", "excerpt", "content"] },
      { key: "media",   title: "Media",   properties: ["hero_image"], collapsed: true },
      { key: "seo",     title: "SEO",     properties: ["meta_title", "meta_description"], collapsed: true }
    ]
  }
}
```

and replace `admin.widthPercentage` with `admin.span: 1 | 2 | 3 | 4 | "full"` on
a 4-column grid (keep `widthPercentage` working, mapped).

Content column plus a metadata rail is the shape every mature record editor
converged on. The rail already exists here — it just holds a Save button.

**The defaults matter more than the API.** With no config at all, derive a
layout: id and timestamp columns into the sidebar (which retires
`hideIdFromForm`), numbers/dates/booleans/short enums at half or quarter span,
long text and markdown at full span. That alone should take the products form
from 2932px to roughly a third of that for people who never touch the config.

### B. One label system

Label above the box, description directly under the label, box last. It is the
only arrangement that generalises — arrays, maps, storage and markdown fields
cannot put a label inside.

### C. Move identity into persistent chrome

The 52px bar's left half is empty. Put the record there:

```
←  Blog posts / Securing Your Node.js Application…   [id ⧉]        [ tabs ]
```

- Title truncated, id as a copy-on-click chip rather than a full-width alert.
- `New blog post` when status is new — never a field value.
- Delete the in-form title/path/dead-space block entirely: **~219px reclaimed
  above the fold on every form**, and the title stops scrolling away.

### D. Make the rail earn its width

- When a sidebar layout resolves: actions on top, sidebar fields under.
- When it does not: no rail. Save/Discard go in the persistent bar (⌘S is
  already wired at [EntityForm.tsx:222](../../packages/cms/src/form/EntityForm.tsx#L222)).

Never 340px of empty rail for one button. And replace the unlabelled sticky
circle with the state of the Save button itself — *Save* / *Saving…* / *Saved* —
which is where people already look.

### E. Split the one tab strip into two things

- **The record is not a tab. It is the page.** Tabs describe views *of* and
  children *of* the record.
- **Left-aligned strip**: the record first (labelled with the singular name),
  then custom views, then subcollections.
- **JSON and history stop being tabs.** They are inspector tools — put them
  behind one affordance on the right of the bar so a content editor never sees
  `<>`.
- **Edit-vs-view stops being a tab value.** Promote it to its own `mode`
  (`view | edit`).

The state machine then reduces to `mode` × `view` (undefined = the record),
both in the URL, with `defaultSelectedView` resolved once at the route level
before render. That deletes `userHasChangedTab`, the `validTabValues` fallback
dance, and the one-time correction effect in `SidePanelBinding`.

### F. Give the escape hatch a middle rung

Export the generated field renderer as a public primitive, so a custom layout
does not cost you the form machinery:

```tsx
Builder: ({ Field, formContext }) => (
  <MyLayout>
    <Field name="title" />
    <MyCustomThing value={formContext.values.x} />
    <Field name="content" />
  </MyLayout>
)
```

This is the thing FireCMS never had, and it is what makes a custom form
adoptable incrementally instead of all-or-nothing.

Then collapse `entityViews` and `formView` into one `views` array where a single
entry can be marked `main`, and cut `EntityCustomViewParams` down to
`{ entity, formContext, Field }` — one source of current values.

---

## 3b. Rules the prototype surfaced

Built as a clickable mock of the same record (`products / OTTO fan`, 16 fields,
real tokens). Two rules only became obvious once it rendered:

- **A span-1 field has no room for prose.** At quarter width a two-line
  description wraps to three and crowds the label. Descriptions render inline at
  span ≥ 2 and collapse to an `ⓘ` tooltip on the label at span 1.
- **The metadata rail belongs to the record tab, not to the chrome.** It holds
  the record's *own fields* (status, category, featured), so it must not persist
  over a subcollection or custom view — those get the full width. Only the
  read-only `Record` block (id, created, updated, revisions) is a candidate for
  persisting.

In-mock, like for like: **2365px → 954px**, and 219px → 0px of dead space above
the first field.

## 4. Staging

1. **Non-breaking rendering fixes.** Header chrome (C), label unification (B),
   auto-derived spans (A defaults), rail-only-when-useful (D), the `draft`
   title, the `posts/` chip, the triple id, the floating status circle. No API
   change, no migration.
2. **`admin.form` sections + sidebar + `span`.** Additive.
3. **Tabs restructure + `mode` split.** URL shape changes; needs a compat
   redirect for the existing `…/edit` segment and `selectedTab=edit`.
4. **`<Field>` primitive + `views` unification.** `entityViews` / `formView`
   keep working through adapters, deprecated.

Steps 1 and 2 carry most of the visible win. Step 3 is the one with real
migration cost.

---

## 5. What is not done

Everything above is implemented except the following, which are deliberately
left for a separate change.

### 5.1 `selectedTab` still doubles as the edit flag

`selectedTab === "edit"` ([SidePanelBinding.tsx:102](../../packages/cms/src/components/SidePanelBinding.tsx#L102))
survives, and with it `userHasChangedTab`, the `validTabValues` fallback and the
one-time correction effect. Splitting `mode` out changes the URL shape, so it
needs a redirect for the existing `/edit` segment and a pass over
`useBuildSidePanel` — a self-contained change that is not worth entangling with
a rendering rewrite. Note that removing JSON and history from the strip already
shrank the tab value space to `undefined | <view key> | <subcollection slug> |
"edit"`, which makes the split smaller than it was.

### 5.2 No `<Field name="…" />` primitive yet

`formView.Builder` is still all-or-nothing, and `entityViews` / `formView`
remain two concepts with near-identical `Builder` signatures. Stage 4 stands as
written.

### 5.3 The detail view still lists the id as a property

The triple duplication is fixed — the synthetic `Id` row is gone and the id is a
copyable chip in the bar. But `PropertyCollectionView` renders every property,
so a collection with an explicit `id` property still shows it once in the table
of values, next to the chip in the bar. Defensible for a "show me everything"
read-only view; worth revisiting if it reads as noise.

### 5.4 Not verified

- The Playwright e2e suites were not run — they need built `dist/`, which a
  worktree with symlinked `node_modules` cannot produce safely
  (see the worktree recipe in memory).
- The collection editor's own UI has no control for `admin.form`; the block
  round-trips through `serializable_types.ts` but must be written by hand.

## 6. Fixed while shipping

Found by using the result rather than by reading it. None of it was specific to
the rewrite; each had been present for a while.

- **The board reported every cross-column drop as a same-column reorder.**
  `handleDragOver` moves the card between columns mid-drag, so looking it up by
  id at drop time finds it in its *destination*. The column property was never
  written and the card snapped back on the next fetch. The placement rules are
  a pure function now — `placeDroppedCard`, with tests.
- **Board order keys were unusable.** The demo seeded `String(i)`, which
  `fractional-indexing` rejects, so every drag fell into the fallback that
  hands out the same key to everything. Keys are base36 and single case now:
  the library's base62 output only sorts correctly under byte ordering, and the
  sort is done by Postgres, whose default collation is not byte ordering.
- **Nothing on the board scrolled.** A `flex-1` item defaults to
  `min-height: auto`, so the view grew to the board's full content height and
  the ancestor's `overflow-hidden` clipped the rest.
- **Concurrent realtime subscriptions hung.** `ensureAuthenticated` published
  its in-flight guard only after an `await`, so every caller arriving in that
  gap started an attempt of its own, and those attempts collided in
  `pendingRequests` under ``auth_${Date.now()}``. One settled; the frames
  behind the others were never sent. A board opening one subscription per
  column hit this on every cold load.
- **Date previews demanded a `Date` instance**, so every audit column in every
  history entry rendered as a red "Unexpected value" — history is raw API
  payload, where a timestamp is still the string Postgres sent.
- **The chip palette had been flattened** from four tones per hue to one,
  leaving `colorScheme="blueDark"` resolving to `undefined` at every call site
  that used it, and making seeded chips repeat colours within a single enum.
- **A shared module inside `app/config/collections/`** stopped the backend
  booting outright: the loader requires a default export from every file there.
