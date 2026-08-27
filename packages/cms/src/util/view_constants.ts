/**
 * Shared tab value constants used by EditViewBinding and DetailViewBinding.
 */
export const MAIN_TAB_VALUE = "__main_##Q$SC^#S6";
export const JSON_TAB_VALUE = "__json";
export const HISTORY_TAB_VALUE = "__rebase_history";

/**
 * The tab row belongs to the header band above the record, not to the record
 * itself, so it carries the same surface the identity bar over it and the form
 * rail beside it carry. Against that, the active tab takes the record's own
 * white and reads as connected to what it opens; on a white row it had to be
 * the tinted one, which is the relationship backwards.
 */
export const ENTITY_VIEW_TAB_BAR_CLASS = "bg-surface-50 dark:bg-surface-900";

/**
 * Every tab in that row, a custom `tabComponent` included.
 *
 * `h-full` over the variant's `h-9`: the row is 40px and the tab 36px, so a
 * centred tab floated ~2px clear of the row's bottom border and the active
 * tab's underline stopped short of the record it opens. Paired with
 * `items-stretch` on the Tabs root, which the variant leaves centred.
 */
export const ENTITY_VIEW_TAB_CLASS = "h-full data-[state=active]:bg-white dark:data-[state=active]:bg-surface-800";

/**
 * Added on top for the tabs this row labels itself — a custom `tabComponent`
 * sizes its own contents. The main tab was the only one rendered without it,
 * and so the only one left at the boxy variant's `text-xs` while its
 * neighbours sat at `text-sm`.
 */
export const ENTITY_VIEW_TAB_LABEL_CLASS = "text-sm min-w-[90px]";
