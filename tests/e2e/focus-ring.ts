/**
 * Focus rings must be whole, checked against the real painted geometry.
 *
 * ## The defect this exists to prevent
 *
 * The focus ring used to be a box-shadow painted *outside* the border box.
 * A box-shadow is paint, and paint is cut by any ancestor that clips — a
 * scroller, a cell that truncates, a `max-height` collapse animation. The
 * drawer's navigation groups clip for their collapse transition and the rows
 * inside them run full-bleed, so tabbing down the rail drew a ring with three
 * of its four sides missing: a blue sliver under one row, a blue sliver beside
 * the next. Same for the first and last chip of the filter-preset scroller and
 * the first and last tab of a scrolling tab strip.
 *
 * It is not a thing you can see from the CSS of either component. The ring is
 * declared in one file and the clipping in another, usually several levels up
 * the tree, and each is correct on its own. It is only visible in the rendered
 * geometry, which is what this measures.
 *
 * ## Why it walks the tab order rather than querying for focusables
 *
 * Because the bug is "tab into things and the outline is cut", and the tab
 * order is the thing under test. A `querySelectorAll` sweep also focuses
 * elements the keyboard never reaches, and — more importantly — programmatic
 * `.focus()` does not reliably match `:focus-visible`, which is the selector
 * that draws the ring at all. Pressing Tab is the only way to observe what the
 * user observes.
 *
 * ## Why it waits between stops
 *
 * Half the surfaces here carry `transition-all`. Read the computed style in the
 * same tick as the keypress and the ring is still interpolating from
 * transparent: every element reports no ring, and the audit says the product is
 * perfect. That false clean is worse than no check.
 */
import type { Page } from "@playwright/test";

/** One control whose focus ring is painted outside its box and then cut off. */
export type ClippedFocusRing = {
    /** The focused control, as tag + a few classes. */
    control: string;
    /** Its accessible name or leading text, for finding it on screen. */
    label: string;
    /** The nearest ancestor doing the clipping. */
    clipper: string;
    /** That ancestor's overflow, and whether a mask is also cutting. */
    overflow: string;
    /** Which sides of the ring are missing. */
    edges: string;
    /** How far outside its own box the control paints. */
    reachPx: number;
};

/**
 * Long enough for `duration-200` plus a frame. Shorter and the first stops of a
 * run read as unindicated; see the file header.
 */
const SETTLE_MS = 260;

/**
 * Default number of Tab presses.
 *
 * 35 covers the drawer rail end to end plus the toolbar of whatever page is
 * open, which is where every instance of this defect has been found. It is a
 * budget, not a claim of exhaustiveness: at ~260ms a stop, walking every
 * control of a long list view would cost more than the test timeout allows.
 */
const DEFAULT_TAB_STOPS = 35;

/**
 * Runs in the page. Returns the clipping finding for the currently focused
 * element, or null when its ring is whole (or when it paints nothing outside
 * its own box, which is the case an inset ring is meant to produce).
 */
const PROBE = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;
    const cs = getComputedStyle(el);

    // How far outside the border box does this element paint? Only paint that
    // lands outside can be clipped by an ancestor, so an inset ring — or no
    // ring — scores zero and is never reported.
    let reach = 0;
    if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) {
        reach = Math.max(reach, parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset || "0"));
    }
    // Split on commas that are not inside a colour function.
    for (const layer of (cs.boxShadow || "").split(/,(?![^(]*\))/)) {
        const shadow = layer.trim();
        if (!shadow || shadow === "none" || shadow.includes("inset")) continue;
        if (/rgba\([^)]*,\s*0\)/.test(shadow)) continue; // fully transparent
        const nums = (shadow.match(/-?[\d.]+px/g) || []).map(parseFloat);
        if (nums.length < 4) continue; // x, y, blur, spread
        const [x, y, blur, spread] = nums;
        reach = Math.max(reach, spread + blur / 2 + Math.max(Math.abs(x), Math.abs(y)));
    }
    if (reach <= 0.5) return null;

    const describe = (node: Element) => {
        const classes = typeof node.className === "string"
            ? node.className.split(/\s+/).filter(Boolean).slice(0, 5).join(".")
            : "";
        return `${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}${classes ? "." + classes : ""}`;
    };

    const box = el.getBoundingClientRect();
    const ring = {
        top: box.top - reach,
        bottom: box.bottom + reach,
        left: box.left - reach,
        right: box.right + reach
    };

    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const ncs = getComputedStyle(node);
        const clipsX = ncs.overflowX !== "visible";
        const clipsY = ncs.overflowY !== "visible";
        const masked = ncs.maskImage !== "none";
        if (!clipsX && !clipsY && !masked) continue;

        // Overflow clips at the padding box.
        const nb = node.getBoundingClientRect();
        const clip = {
            top: nb.top + parseFloat(ncs.borderTopWidth),
            bottom: nb.bottom - parseFloat(ncs.borderBottomWidth),
            left: nb.left + parseFloat(ncs.borderLeftWidth),
            right: nb.right - parseFloat(ncs.borderRightWidth)
        };

        // A control scrolled out of its own scrollport is not a ring bug — half
        // of it is legitimately hidden. Only a control that is *fully visible*
        // and still has its ring cut counts.
        const fullyVisible = box.top >= clip.top - 0.5 && box.bottom <= clip.bottom + 0.5 &&
            box.left >= clip.left - 0.5 && box.right <= clip.right + 0.5;
        if (!fullyVisible) continue;

        const edges: string[] = [];
        if ((clipsY || masked) && ring.top < clip.top - 0.5) edges.push("top");
        if ((clipsY || masked) && ring.bottom > clip.bottom + 0.5) edges.push("bottom");
        if ((clipsX || masked) && ring.left < clip.left - 0.5) edges.push("left");
        if ((clipsX || masked) && ring.right > clip.right + 0.5) edges.push("right");
        if (!edges.length) continue;

        return {
            control: describe(el),
            label: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
            clipper: describe(node),
            overflow: `${ncs.overflowX}/${ncs.overflowY}${masked ? " +mask" : ""}`,
            edges: edges.join(","),
            reachPx: Math.round(reach)
        };
    }
    return null;
};

/**
 * Walks the tab order from the top of the document and returns every control
 * whose focus ring is painted outside its box and cut off by an ancestor.
 */
export async function findClippedFocusRings(
    page: Page,
    { tabStops = DEFAULT_TAB_STOPS }: { tabStops?: number } = {}
): Promise<ClippedFocusRing[]> {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const found: ClippedFocusRing[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < tabStops; i++) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(SETTLE_MS);
        const hit = await page.evaluate(PROBE);
        if (!hit) continue;
        const key = `${hit.clipper}|${hit.edges}|${hit.control}|${hit.label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(hit);
    }
    return found;
}

/** The assertion message: what was cut, where, and by what. */
export function describeClippedFocusRings(found: ClippedFocusRing[], where: string): string {
    if (!found.length) return `No clipped focus rings on ${where}.`;
    const lines = found.map(f =>
        `  • ${f.control} "${f.label}"\n` +
        `      ring reaches ${f.reachPx}px outside its box; ${f.edges} cut off by\n` +
        `      ${f.clipper} (overflow ${f.overflow})`
    );
    return `${found.length} focus ring(s) cut off on ${where}.\n` +
        `A ring painted outside the border box is cut by any clipping ancestor.\n` +
        `Draw it inside instead — see the :focus-visible rule in packages/ui/src/index.css.\n` +
        lines.join("\n");
}

/**
 * Is the focus ring on the currently focused control drawn inside its own box?
 *
 * The direct assertion of the fix, for the one row the defect was reported on:
 * a whole ring can also be achieved by an ancestor happening not to clip today,
 * which would pass {@link findClippedFocusRings} and break again tomorrow.
 */
export async function focusedRingIsInset(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return false;
        return getComputedStyle(el).boxShadow
            .split(/,(?![^(]*\))/)
            .some(layer => layer.includes("inset") && !/rgba\([^)]*,\s*0\)/.test(layer));
    });
}
