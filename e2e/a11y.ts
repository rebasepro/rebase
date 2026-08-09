/**
 * Accessible-name auditing, run against the real DOM.
 *
 * ## Why this is hand-rolled rather than axe-core
 *
 * Two reasons, and the second is the important one.
 *
 * 1. axe-core is not a dependency of this repo, and adding one means editing
 *    `pnpm-lock.yaml`.
 *
 * 2. **axe would not have caught the defect this file exists to prevent.**
 *    axe's `label` rule treats a non-empty `placeholder` as an acceptable
 *    accessible name (its `non-empty-placeholder` check *passes*, at "minor"
 *    impact). The bug being fixed here was a login form whose password field
 *    was named only by `placeholder="••••••••"` — announced as eight bullets —
 *    and whose email field was named `"you@example.com"`. A stock axe run over
 *    that page reports no violation of the name rules.
 *
 * So the rule enforced below is deliberately stricter than axe: a control must
 * get its name from something that is *authored as a label* — `aria-label`,
 * `aria-labelledby`, `label[for]`, an ancestor `<label>`, or `title` — and
 * never from its own placeholder or its own value. That is the property that
 * actually regressed, so that is the property under test.
 *
 * Everything runs in the page so it reads the DOM the browser built, not
 * Playwright's accessibility snapshot: during the audit the a11y *tree* gave one
 * reading that the DOM contradicted, so the tree is not trusted here.
 */
import type { Page } from "@playwright/test";

/**
 * Which control families to audit.
 *
 * Defaults to `["field", "link"]`, and that is a deliberate, documented scope
 * rather than an oversight. Form fields and links are what the accompanying fix
 * makes whole, and they are clean: zero unnamed fields and zero unnamed links on
 * all three screens at both widths.
 *
 * `"button"` is **not** in the default because the admin panel still has icon-only
 * buttons with no accessible name — at the time of writing, 2 on the login screen,
 * 24 on the collection list (mostly the Radix `role="checkbox"` row selectors and
 * the column header menus) and 4 on the entity form. That is a real defect, but a
 * different and much larger one than the audit findings this guards, and turning it
 * on here would make the suite red for a reason unrelated to any regression it is
 * meant to catch. Pass `["button"]` explicitly to see the outstanding list.
 */
export type ControlFamily = "field" | "link" | "button";

export type NamelessControl = {
    kind: "input" | "control";
    tag: string;
    type: string | null;
    id: string | null;
    /** Only ever a placeholder/value — i.e. the name it *would* have fallen back to. */
    fallbackWouldBe: string | null;
    outer: string;
};

/**
 * Every focusable control on the page whose accessible name is missing, or comes
 * only from its placeholder or its own value.
 */
export async function findNamelessControls(
    page: Page,
    families: ControlFamily[] = ["field", "link"]
): Promise<NamelessControl[]> {
    return page.evaluate((wanted: ControlFamily[]) => {

        const isHidden = (el: Element): boolean => {
            let node: Element | null = el;
            while (node) {
                if (node.getAttribute?.("aria-hidden") === "true") return true;
                const style = getComputedStyle(node);
                if (style.display === "none" || style.visibility === "hidden") return true;
                node = node.parentElement;
            }
            // A control that is present but not rendered at all (rects collapsed)
            // is not something a user can reach.
            const rect = (el as HTMLElement).getBoundingClientRect();
            return rect.width === 0 && rect.height === 0;
        };

        const textOf = (el: Element | null): string => (el?.textContent ?? "").trim();

        /**
         * The authored name only. Placeholder and value are deliberately *not*
         * consulted — see the file header.
         */
        const authoredName = (el: Element): string => {
            const labelledBy = el.getAttribute("aria-labelledby");
            if (labelledBy) {
                const named = labelledBy
                    .split(/\s+/)
                    .map(id => textOf(document.getElementById(id)))
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                if (named) return named;
            }

            const ariaLabel = (el.getAttribute("aria-label") ?? "").trim();
            if (ariaLabel) return ariaLabel;

            const id = el.getAttribute("id");
            if (id) {
                // CSS.escape: React's useId produces ":r13:", which is not a
                // valid bare selector.
                const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                if (textOf(forLabel)) return textOf(forLabel);
            }

            const wrapping = el.closest("label");
            if (textOf(wrapping)) return textOf(wrapping);

            const title = (el.getAttribute("title") ?? "").trim();
            if (title) return title;

            // Buttons and links are named by their own content; form fields are not.
            if (!el.matches("input, textarea, select")) {
                const own = textOf(el);
                if (own) return own;
                const img = el.querySelector("img[alt]");
                const alt = (img?.getAttribute("alt") ?? "").trim();
                if (alt) return alt;
            }

            return "";
        };

        const results: Array<{
            kind: "input" | "control";
            tag: string;
            type: string | null;
            id: string | null;
            fallbackWouldBe: string | null;
            outer: string;
        }> = [];

        // Form fields. `hidden` carries no name by design; the button-like input
        // types are named by their `value`, which is legitimate for them.
        if (wanted.includes("field")) {
            const fields = Array.from(
                document.querySelectorAll<HTMLElement>(
                    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), textarea, select"
                )
            );
            for (const el of fields) {
                if (isHidden(el)) continue;
                if (authoredName(el)) continue;
                const input = el as HTMLInputElement;
                results.push({
                    kind: "input",
                    tag: el.tagName.toLowerCase(),
                    type: el.getAttribute("type"),
                    id: el.getAttribute("id"),
                    fallbackWouldBe: input.placeholder || input.value || null,
                    outer: el.outerHTML.slice(0, 200)
                });
            }
        }

        // Links — this is what a collapsed, icon-only nav rail fails.
        const selectors: string[] = [];
        if (wanted.includes("link")) selectors.push("a[href]");
        if (wanted.includes("button")) selectors.push("button");
        if (selectors.length > 0) {
            for (const el of Array.from(
                document.querySelectorAll<HTMLElement>(selectors.join(", "))
            )) {
                if (isHidden(el)) continue;
                if (authoredName(el)) continue;
                results.push({
                    kind: "control",
                    tag: el.tagName.toLowerCase(),
                    type: el.getAttribute("type"),
                    id: el.getAttribute("id"),
                    fallbackWouldBe: null,
                    outer: el.outerHTML.slice(0, 200)
                });
            }
        }

        return results;
    }, families);
}

/** Readable failure text: one line per offender, with the markup that caused it. */
export function describeNamelessControls(found: NamelessControl[], where: string): string {
    const lines = found.map(f => {
        const from = f.fallbackWouldBe
            ? ` (would fall back to ${JSON.stringify(f.fallbackWouldBe)})`
            : "";
        return `  <${f.tag}${f.type ? ` type="${f.type}"` : ""}${f.id ? ` id="${f.id}"` : ""}>${from}\n     ${f.outer}`;
    });
    return (
        `${found.length} control(s) on ${where} have no accessible name of their own.\n` +
        "A name must come from aria-label, aria-labelledby, label[for], an ancestor " +
        "<label>, or title — not from a placeholder and not from the value.\n\n" +
        lines.join("\n\n")
    );
}

/** The two widths that matter: the nav rail is icon-only at the smaller one. */
export const RAIL_COLLAPSED = { width: 1280,
height: 900 };
export const RAIL_EXPANDED = { width: 1440,
height: 900 };
