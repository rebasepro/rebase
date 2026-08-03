import * as React from "react";

/**
 * How many relation previews deep the current render is.
 *
 * A relation preview renders the target row through `EntityPreview`, which
 * renders each of that row's preview properties through `PropertyPreview` —
 * and if one of those is itself a relation, out comes another full relation
 * card, with its own border and its own "open this row" button, nested inside
 * the first. It reads as a selector inside a selector, and the inner button
 * navigates somewhere the outer card never claimed to be about.
 *
 * Depth rather than a boolean because it is the honest quantity, and because a
 * boolean invites the next reader to reset it. Anything at depth ≥ 1 renders as
 * text: still the row's title, still resolved, just not a second control.
 *
 * A context and not a prop, because the chain it has to cross includes
 * `EntityPreview`, which is a component override — a prop would be dropped by
 * the first app that supplies its own.
 */
export const RelationPreviewDepthContext = React.createContext(0);

/** @see RelationPreviewDepthContext */
export function useRelationPreviewDepth(): number {
    return React.useContext(RelationPreviewDepthContext);
}

/** Mark everything rendered inside as one relation preview deeper. */
export function RelationPreviewDepthProvider({ children }: { children: React.ReactNode }) {
    const depth = useRelationPreviewDepth();
    const next = React.useMemo(() => depth + 1, [depth]);
    return (
        <RelationPreviewDepthContext.Provider value={next}>
            {children}
        </RelationPreviewDepthContext.Provider>
    );
}
