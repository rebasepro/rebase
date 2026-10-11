/**
 * Which mounted record form a ⌘S / ⌘Z belongs to.
 *
 * Every record form listens on `window`, and more than one can be mounted at
 * once: a related record opened in a panel above another, the split view's
 * form beside its table. Each used to act on every keystroke — in practice
 * the first one mounted, which marks the event handled — so ⌘S typed in the
 * top panel saved the one under it, and ⌘Z typed in a table cell's editor
 * undid the record form beside it.
 *
 * The keystroke belongs to the form the focus is in. With the focus in no
 * form, it belongs to the form opened last (the top panel) — unless the focus
 * is in an editor of its own, which keeps its own undo.
 */

type KeyboardScope = { element: () => HTMLElement | null };

const scopes: KeyboardScope[] = [];

/** Register a mounted form; the returned function unregisters it. */
export function registerKeyboardScope(element: () => HTMLElement | null): KeyboardScope & { unregister: () => void } {
    const scope: KeyboardScope = { element };
    scopes.push(scope);
    return {
        ...scope,
        unregister: () => {
            const index = scopes.indexOf(scope);
            if (index >= 0) scopes.splice(index, 1);
        }
    };
}

function isEditor(node: Node): boolean {
    if (!(node instanceof HTMLElement)) return false;
    if (node.isContentEditable) return true;
    return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement;
}

/** Whether the form registered as `scope` should act on `event`. */
export function ownsKeystroke(scope: { element: () => HTMLElement | null }, event: KeyboardEvent): boolean {
    const target = event.target instanceof Node ? event.target : null;
    const own = scopes.find((s) => s.element === scope.element);
    if (!own) return false;
    if (target) {
        // The innermost form holding the focus; the last registered wins a tie.
        let holder: KeyboardScope | undefined;
        for (const s of scopes) {
            const element = s.element();
            if (element && element.contains(target)) holder = s;
        }
        if (holder) return holder === own;
        if (isEditor(target)) return false;
    }
    return scopes[scopes.length - 1] === own;
}
