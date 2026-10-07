import type { EntityAction } from "@rebasepro/cms-types";

const reservedKeys = ["edit", "copy", "delete"];

export function mergeEntityActions(currentActions: EntityAction[], newActions: EntityAction[]): EntityAction[] {
    // given the current actions, replace the ones with the same key
    // and append the new ones
    const updatedActions: EntityAction[] = [];
    currentActions.forEach(action => {
        const newAction = newActions.find(a => a.key === action.key);
        if (newAction) {
            const mergedAction = {
                ...action,
                ...newAction
            }
            updatedActions.push(mergedAction);
        } else {
            updatedActions.push(action);
        }
    });
    newActions.forEach(action => {
        if (!currentActions.find(a => a.key === action.key) && (!action.key || !reservedKeys.includes(action.key))) {
            updatedActions.push(action);
        }
    });
    return updatedActions;

}

const genericKeys = ["edit", "copy"];
const destructiveKeys = ["delete", "unlink"];

export interface PlacedEntityActions<A = EntityAction> {
    /** Declared `collapsed: false`: buttons of their own, in declaration order. */
    inline: A[];
    /** The collection's own actions that wait in the menu. */
    own: A[];
    /** The built-ins that work on any record: Edit, Copy. */
    generic: A[];
    /** Delete, or Remove on a linked tab. */
    destructive: A[];
}

/**
 * Where each of a record's actions goes — the same answer on every surface
 * that shows them, the record's bar and a table row alike.
 *
 * Built-ins used to come first, so the menu read Copy, Delete, then the
 * collection's own: Delete sat second, between two harmless items, and the
 * operations a collection adds — the reason someone opened this record — came
 * after it. The menu leads with those now, Copy follows, and Delete is last
 * and set apart, where it is not hit while reaching for a neighbour.
 *
 * Whether an action is a button is the developer's call, by `collapsed`, and
 * that holds for the built-ins too: a Delete declared `collapsed: false` is a
 * button.
 */
export function placeEntityActions<A extends Pick<EntityAction, "key" | "collapsed">>(actions: A[]): PlacedEntityActions<A> {
    const placed: PlacedEntityActions<A> = { inline: [], own: [], generic: [], destructive: [] };
    for (const action of actions) {
        if (action.collapsed === false) placed.inline.push(action);
        else if (action.key && destructiveKeys.includes(action.key)) placed.destructive.push(action);
        else if (action.key && genericKeys.includes(action.key)) placed.generic.push(action);
        else placed.own.push(action);
    }
    return placed;
}
