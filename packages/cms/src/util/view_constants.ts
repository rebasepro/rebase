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
 * card surface and reads as connected to what it opens; on a card-coloured row it had to be
 * the tinted one, which is the relationship backwards.
 */
export const ENTITY_VIEW_TAB_BAR_CLASS = "bg-surface-sheet";

/**
 * Every tab in that row, a custom `tabComponent` included.
 *
 * A fixed `h-9`, and the row sizes itself to it: the boxy list adds `pt-1.5`
 * above the tab and aligns it to the bottom, so the active tab's top border
 * sits clear of the identity bar's line above (it used to touch it) and its
 * bottom overlaps the row's own border, joining the record it opens. The row
 * had a fixed `h-10` and the tab `h-full`, which put the two borders on top
 * of each other.
 */
export const ENTITY_VIEW_TAB_CLASS = "h-9";

/**
 * Added on top for the tabs this row labels itself — a custom `tabComponent`
 * sizes its own contents. The main tab was the only one rendered without it,
 * and so the only one left at the boxy variant's `text-xs` while its
 * neighbours sat at `text-sm`.
 */
export const ENTITY_VIEW_TAB_LABEL_CLASS = "text-sm min-w-[90px]";
