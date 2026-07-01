# Deprecated Public Exports — 1.0 Cleanup Tracker

> **Purpose**: Track every `@deprecated` symbol that is still exported from the
> public API surface so they can be batch-removed before the 1.0 release.
>
> Last audited: 2026-06-25

---

## `@rebasepro/types`

| Symbol | Replacement | Internal usage | Action needed before removal |
|--------|-------------|----------------|------------------------------|
| `CollectionWithRelations` | ✅ **Removed.** All ~15 internal call sites migrated to use `EntityCollection` directly. `table`, `relations`, and `securityRules` are on `BaseEntityCollection`. |

### Not yet deprecated but should be reviewed

| Symbol | Notes |
|--------|-------|
| `CollectionWithSubcollections` | Companion intersection type to `CollectionWithRelations`. Review whether `subcollections` has been promoted to `BaseEntityCollection`; if so, deprecate and schedule for removal alongside `CollectionWithRelations`. |

---

## `@rebasepro/admin`

| Symbol | Replacement | Internal usage | Action needed before removal |
|--------|-------------|----------------|------------------------------|
| `RebaseEditorTextSize` | `RichTextEditorTextSize` | **None** — zero references. | Safe to remove immediately. |
| `RebaseEditorProps` | `RichTextEditorProps` | **None** — zero references. | Safe to remove immediately. |
| `RebaseEditor` | `RichTextEditor` | **None** — zero references. | Safe to remove immediately. |

> [!NOTE]
> The three `RebaseEditor*` aliases are re-exports from the old `FireCMS` branding.
> They have zero internal consumers and can be deleted at any time without an
> internal migration. The only risk is external consumers who adopted the old names
> — consider a minor-version bump when removing.

---

## Process

1. Before removing a symbol, search the codebase for all usages:
   ```bash
   grep -rn "SymbolName" packages/ app/
   ```
2. Migrate internal consumers first.
3. Remove the `export` and the deprecated alias in a single commit.
4. Document the removal in the changelog as a **BREAKING CHANGE**.
