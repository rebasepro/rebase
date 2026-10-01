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

/** A tab stop whose focused and unfocused renderings are (nearly) the same. */
export type InvisibleFocus = {
    /** The focused control, as tag + a few classes. */
    control: string;
    /** Its accessible name or leading text, for finding it on screen. */
    label: string;
    /** Pixels that changed between blurred and focused. */
    changedPx: number;
    /** What it had to reach: a quarter of the control's perimeter. */
    neededPx: number;
};

/**
 * Margin around the control's box in each screenshot: an outset ring
 * (Checkbox, Switch) paints up to 4px outside it.
 */
const SHOT_MARGIN = 6;

/**
 * Counts pixels that differ between two PNG screenshots of the same size, in
 * the page: the browser decodes PNG, so this needs no image library. A pixel
 * counts when its summed RGB difference passes 30 — anti-aliasing jitter
 * stays below, a 2px ring at any contrast worth having does not.
 */
async function changedPixels(page: Page, a: Buffer, b: Buffer): Promise<number> {
    return page.evaluate(async ([first, second]) => {
        const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = "data:image/png;base64," + src;
        });
        const [A, B] = await Promise.all([load(first), load(second)]);
        const canvas = document.createElement("canvas");
        canvas.width = A.width;
        canvas.height = A.height;
        const context = canvas.getContext("2d");
        if (!context) return -1;
        context.drawImage(A, 0, 0);
        const da = context.getImageData(0, 0, A.width, A.height).data;
        context.clearRect(0, 0, A.width, A.height);
        context.drawImage(B, 0, 0);
        const db = context.getImageData(0, 0, A.width, A.height).data;
        let changed = 0;
        for (let i = 0; i < da.length; i += 4) {
            const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
            if (d > 30) changed++;
        }
        return changed;
    }, [a.toString("base64"), b.toString("base64")] as const);
}

/**
 * Walks the tab order (from the top of the document, or from whatever has focus
 * with `fromCurrentFocus`) and returns every stop whose focus indicator cannot be
 * seen: the control screenshotted focused and then blurred differs in fewer
 * pixels than a quarter of its perimeter.
 *
 * {@link findClippedFocusRings} asks whether a ring is cut off; this asks
 * whether there is one to see at all. The first question alone let a fix
 * through that drew the inset ring in the primary colour on a primary fill —
 * whole, unclipped, and invisible on every main action in the product, every
 * switch, and the multi-select trigger. Only the rendered pixels can tell a
 * ring the colour of its background from no ring.
 */
export async function findInvisibleFocus(
    page: Page,
    { tabStops = DEFAULT_TAB_STOPS, fromCurrentFocus = false }: { tabStops?: number; fromCurrentFocus?: boolean } = {}
): Promise<InvisibleFocus[]> {
    await page.mouse.move(0, 0); // no hover state in either shot
    if (!fromCurrentFocus) await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const found: InvisibleFocus[] = [];
    const seen = new Set<string>();
    const viewport = page.viewportSize();
    for (let i = 0; i < tabStops; i++) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(SETTLE_MS);
        const stop = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return null;
            const box = el.getBoundingClientRect();
            const classes = typeof el.className === "string"
                ? el.className.split(/\s+/).filter(Boolean).slice(0, 5).join(".")
                : "";
            return {
                control: `${el.tagName.toLowerCase()}${classes ? "." + classes : ""}`,
                label: (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
                x: box.x, y: box.y, width: box.width, height: box.height
            };
        });
        if (!stop || stop.width < 4 || stop.height < 4) continue;
        const key = `${stop.control}|${stop.label}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const clip = {
            x: Math.max(0, stop.x - SHOT_MARGIN),
            y: Math.max(0, stop.y - SHOT_MARGIN),
            width: stop.width + SHOT_MARGIN * 2,
            height: stop.height + SHOT_MARGIN * 2
        };
        // Off screen, or partly: a screenshot would not be of the control.
        if (viewport && (clip.x + clip.width > viewport.width || clip.y + clip.height > viewport.height)) continue;

        const focused = await page.screenshot({ clip });
        await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            (window as unknown as { __focusProbe?: HTMLElement | null }).__focusProbe = el;
            el?.blur();
        });
        await page.waitForTimeout(SETTLE_MS);
        const blurred = await page.screenshot({ clip });
        // Back onto the same control, so the next Tab continues from it. A
        // script focus right after a key press still matches :focus-visible.
        await page.evaluate(() => (window as unknown as { __focusProbe?: HTMLElement | null }).__focusProbe?.focus());

        const changedPx = await changedPixels(page, focused, blurred);
        const neededPx = Math.round((stop.width + stop.height) * 2 / 4);
        if (changedPx < neededPx) found.push({ control: stop.control, label: stop.label, changedPx, neededPx });
    }
    return found;
}

/** The assertion message: which controls show nothing when focused. */
export function describeInvisibleFocus(found: InvisibleFocus[], where: string): string {
    if (!found.length) return `Every tab stop on ${where} shows its focus.`;
    const lines = found.map(f =>
        `  • ${f.control} "${f.label}" — ${f.changedPx}px changed on focus, needed ${f.neededPx}`);
    return `${found.length} control(s) on ${where} look the same focused and unfocused.\n` +
        `A ring in the colour of the fill, or a utility ring that replaces the focus ring,\n` +
        `draws nothing a keyboard user can see. See the :focus-visible rule in packages/ui/src/index.css.\n` +
        lines.join("\n");
}
