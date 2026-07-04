import type { SnapshotAction } from "@rebasepro/types";

const reservedKeys = ["edit", "copy", "delete"];

export function mergeSnapshotActions(currentActions: SnapshotAction[], newActions: SnapshotAction[]): SnapshotAction[] {
    // given the current actions, replace the ones with the same key
    // and append the new ones
    const updatedActions: SnapshotAction[] = [];
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
