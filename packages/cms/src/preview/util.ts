import { CollectionSize } from "@rebasepro/cms-types";
import type { PreviewSize } from "../types/components/PropertyPreviewProps";
/**
 * The schemes a preview link may use — everything else becomes `about:blank`.
 *
 * An allowlist, because the blocklist it replaces could be walked around and
 * the walk-arounds are not exotic. Browsers strip tabs, newlines and carriage
 * returns from a URL before parsing the scheme, so `java\tscript:alert(1)` and
 * `java%0ascript:…` navigate exactly as `javascript:` does while matching none
 * of the names a blocklist knows. A leading control character does the same.
 *
 * Turned around, none of that matters: a string is either one of these four
 * schemes or it is not a link this panel will follow. `mailto:` and `tel:` are
 * here because a contact field is an ordinary thing to preview; `data:` is not,
 * even for images — a preview renders an `<img>` from its own value rather than
 * navigating to one.
 *
 * Relative URLs are allowed and deliberately: a preview commonly holds
 * `/uploads/x.png`, and a string with no scheme cannot carry one.
 */
const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

export function sanitizeUrl(url: string | undefined): string {
    if (!url) return "about:blank";

    // The characters a browser removes before it decides what the scheme is.
    // Stripped here for the same reason, so this function is looking at the
    // string the browser will act on rather than the one it was handed.
    //
    // The control characters are the point, so the rule that objects to them is
    // off for this line rather than the expression rewritten to hide them from
    // it: `java\tscript:` and `java\nscript:` are the bypasses this exists to
    // close, and a regex that cannot name a control character cannot remove one.
    // eslint-disable-next-line no-control-regex
    const trimmed = url.trim().replace(/[\u0000-\u001F\u007F]/g, "");
    if (!trimmed) return "about:blank";

    // No scheme at all — a relative link, which cannot navigate anywhere the
    // page could not already reach.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;

    try {
        // `new URL` normalizes percent-encoding and case, so
        // `JaVaScRiPt%3aalert(1)` is judged as what it resolves to. The base is
        // there only so a protocol-relative `//host/path` parses.
        const parsed = new URL(trimmed, "https://example.invalid");
        return ALLOWED_URL_SCHEMES.has(parsed.protocol) ? trimmed : "about:blank";
    } catch {
        return "about:blank";
    }
}

export const SMALL_THUMBNAIL = 40;
export const MEDIUM_THUMBNAIL = 100;
export const LARGE_THUMBNAIL = 200;

export function getThumbnailMeasure(size: PreviewSize): number {
    if (size === "small")
        return SMALL_THUMBNAIL;
    else if (size === "medium")
        return MEDIUM_THUMBNAIL;
    else if (size === "large")
        return LARGE_THUMBNAIL;
    else throw Error("Thumbnail size not mapped");
}

export function getPreviewSizeFrom(size: CollectionSize): PreviewSize {
    switch (size) {
        case "xs":
        case "s":
            return "small";
        case "m":
            return "medium";
        case "l":
        case "xl":
            return "large";
        default:
            throw Error("Missing mapping value in getPreviewSizeFrom: " + size);
    }
}
