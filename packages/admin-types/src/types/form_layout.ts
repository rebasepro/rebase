import type { ColumnKey } from "../admin_collection";

/**
 * The number of columns the form grid is divided into. A field's
 * {@link AdminPropertyOptions.span} is expressed against this.
 *
 * Fixed rather than configurable on purpose: the whole point of a span is that
 * two fields written by two different people line up, and they only do that if
 * everyone is counting against the same grid.
 *
 * @group Models
 */
export const FORM_GRID_COLUMNS = 4;

/**
 * How wide a field sits on the {@link FORM_GRID_COLUMNS}-column form grid.
 *
 * `4` is the full width of the main column. A field always takes at least a
 * whole row on narrow layouts (the side panel, the split pane, mobile), where
 * the grid collapses to one column and spans are ignored.
 *
 * @group Entity properties
 */
export type PropertySpan = 1 | 2 | 3 | 4;

/**
 * A titled group of fields in the main column of the form.
 *
 * @group Models
 */
export interface FormSection<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Stable identity for this section. Used as the React key and to remember
     * the collapsed state across visits, so renaming `title` does not lose it.
     */
    key: string;

    /**
     * Shown above the group. A section with no title renders its fields with no
     * heading and no rule — useful for the first group, which rarely needs one.
     */
    title?: string;

    /**
     * Property and additional-field keys in this section, in render order.
     *
     * Keys naming a property that does not exist, is hidden, or has been routed
     * to {@link FormLayoutConfig.sidebar} are skipped. Any property *not* named
     * by a section lands in the last section that has no explicit title, or in
     * an untitled trailing group if there is none — a new column is never
     * silently dropped from the form.
     */
    properties: ColumnKey<M>[];

    /**
     * Start collapsed. Defaults to `false`.
     *
     * Only meaningful when the section can be collapsed at all; a section with
     * no `title` has nothing to click, so this is ignored there.
     */
    collapsed?: boolean;

    /**
     * Can the user collapse this section. Defaults to `true` for a titled
     * section, `false` for an untitled one.
     *
     * A section holding a required field is still collapsible — but a
     * validation error inside a collapsed section expands it, so an error can
     * never hide.
     */
    collapsible?: boolean;

    /**
     * How this section arranges itself in the **read-only** view of a record.
     * Defaults to `"grid"` — the same grid the form uses.
     *
     * `"summary"` stacks the fields as right-aligned label/value rows with the
     * last one emphasised, which is what a run of related figures wants: a
     * subtotal, a tax, a discount and a total are one calculation, and four
     * equal cells on a four-column grid is the one arrangement that says they
     * are unrelated. Opt in per section — nothing about a group of numbers tells
     * us it adds up, so this is never derived.
     *
     * Read-only only, and named for it. The form goes on rendering the grid:
     * a summary row is a reading arrangement, and shrinking a control to fit one
     * would make the fields harder to edit to make them prettier to skim.
     */
    readVariant?: "grid" | "summary";
}

/**
 * How the generated form is laid out.
 *
 * Everything here is optional, and the defaults are the point: with no config
 * at all the layout is derived from the properties themselves —
 *
 * - the id and the `createdAt`/`updatedAt` timestamps go to the rail, read-only
 * - short enums, booleans, dates and numbers take a narrow span
 * - long text, markdown, arrays, maps and storage fields take the full width
 * - everything else takes half
 *
 * so a collection that never mentions `form` still gets a two-column layout
 * rather than one flat run of full-width fields. Use this block when the
 * derived answer is wrong for your domain.
 *
 * @group Models
 */
export interface FormLayoutConfig<M extends Record<string, unknown> = Record<string, unknown>> {
    /**
     * Property keys shown in the metadata rail beside the main column instead
     * of in it — status, ownership, publication dates, flags.
     *
     * The rail is narrow and does not use the grid, so `span` is ignored for
     * these. On layouts too narrow for a rail (the side panel, the split pane,
     * mobile) they render as an ordinary leading section, so nothing is lost.
     *
     * Set to `[]` to suppress the derived rail entirely and keep every field in
     * the main column.
     */
    sidebar?: ColumnKey<M>[];

    /**
     * Groups for the main column. When omitted, every field lands in a single
     * untitled group, which is the pre-existing behaviour.
     */
    sections?: FormSection<M>[];

    /**
     * Show the read-only record block (id, created, updated) at the foot of the
     * rail. Defaults to `true` when a rail is shown.
     *
     * This is what replaces `hideIdFromForm` for most collections: the id stops
     * being a field in the middle of the form and becomes a copyable line of
     * metadata.
     */
    showRecordMeta?: boolean;
}
