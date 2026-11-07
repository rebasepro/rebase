import React, { useContext } from "react";
import type { CollectionViewState } from "./useCollectionViewState";

/**
 * The state of the collection view a part is drawn in, for the parts that
 * are placed rather than wired: the toolbar and its pieces, and the actions on
 * a card. They read it here so a caller can put them anywhere in the view
 * without passing the view's controllers along.
 */
export const CollectionViewScopeContext = React.createContext<CollectionViewState | null>(null);

/**
 * The enclosing collection view's state. Throws outside one, naming the part:
 * a toolbar piece placed anywhere else has nothing to search, filter or add to.
 */
export function useCollectionViewScope(part: string): CollectionViewState {
    const scope = useContext(CollectionViewScopeContext);
    if (!scope) {
        throw new Error(`${part} must be drawn inside a collection view — in the \`toolbar\` of a CollectionPanel, say.`);
    }
    return scope;
}
