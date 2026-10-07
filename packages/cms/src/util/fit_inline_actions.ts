export interface InlineActionsFit {
    /** How many of the actions, from the front, stay in the bar. */
    count: number;
    /** Icon-only, the name moving to a tooltip. */
    compact: boolean;
}

/**
 * How many of a bar's inline actions fit in `available` pixels, and in which
 * form.
 *
 * Labelled while they all fit. Then icon-only, all of them — an action with no
 * icon keeps its label, so its compact width is its labelled one. Then as many
 * icon-only buttons as fit, from the front: the developer declared the most
 * important first, so the last ones fold into the menu.
 *
 * Widths that are all zero mean nothing was laid out — a hidden tab, a test
 * DOM. Every action is shown, labelled, and the observer that called this
 * measures again once there is layout.
 */
export function fitInlineActions(available: number, labelled: number[], compact: number[], gap: number): InlineActionsFit {
    const n = labelled.length;
    if (n === 0) return { count: 0, compact: false };
    if (labelled.every(width => width === 0)) return { count: n, compact: false };

    const span = (widths: number[], k: number) =>
        widths.slice(0, k).reduce((sum, width) => sum + width, 0) + gap * Math.max(0, k - 1);

    if (span(labelled, n) <= available) return { count: n, compact: false };

    let count = n;
    while (count > 0 && span(compact, count) > available) count--;
    return { count, compact: true };
}
