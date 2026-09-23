import * as React from "react";

/**
 * How deep the current entity preview is nested inside another one.
 *
 * A reference or relation rendered on its own (a form field, a table cell) is
 * at depth 0 and gets the full card treatment: image slot, id, title, preview
 * properties and a link to the side panel. A reference rendered *inside*
 * another entity preview is at depth 1+, where repeating that card produces a
 * box-inside-a-box with its own borders, id line and action button. Nested
 * previews collapse to a compact chip instead.
 */
const EntityPreviewDepthContext = React.createContext<number>(0);

/**
 * Current entity preview nesting depth. 0 means "not inside another preview".
 */
export function useEntityPreviewDepth(): number {
    return React.useContext(EntityPreviewDepthContext);
}

/**
 * True when the preview being rendered lives inside another entity preview,
 * and should therefore render its compact variant.
 */
export function useIsNestedEntityPreview(): boolean {
    return useEntityPreviewDepth() > 0;
}

/**
 * Marks its children as being rendered inside an entity preview, so any
 * reference or relation below collapses to a chip.
 */
export function NestedEntityPreviewBoundary({ children }: { children: React.ReactNode }) {
    const depth = useEntityPreviewDepth();
    return <EntityPreviewDepthContext.Provider value={depth + 1}>
        {children}
    </EntityPreviewDepthContext.Provider>;
}

/**
 * Resets the nesting depth back to 0. Used by surfaces that open a fresh
 * rendering context for an entity — a side panel, a dialog — from within a
 * preview, where the children are no longer visually nested.
 */
export function RootEntityPreviewBoundary({ children }: { children: React.ReactNode }) {
    return <EntityPreviewDepthContext.Provider value={0}>
        {children}
    </EntityPreviewDepthContext.Provider>;
}

/**
 * How a top-level reference or relation preview is laid out.
 *
 * `card` is the form's: a bordered box with the record's id, title, preview
 * properties and a button to open it. `row` is a table cell's: the same
 * record as a line of the row it sits in — image, a title that opens it, one
 * supporting line — with no box of its own, because the cell is the box and
 * a card is taller than a row.
 */
export type EntityPreviewLayout = "card" | "row";

const EntityPreviewLayoutContext = React.createContext<EntityPreviewLayout>("card");

export function useEntityPreviewLayout(): EntityPreviewLayout {
    return React.useContext(EntityPreviewLayoutContext);
}

/** Lays out the previews below it as rows. See {@link EntityPreviewLayout}. */
export function RowEntityPreviewLayout({ children }: { children: React.ReactNode }) {
    return <EntityPreviewLayoutContext.Provider value={"row"}>
        {children}
    </EntityPreviewLayoutContext.Provider>;
}
