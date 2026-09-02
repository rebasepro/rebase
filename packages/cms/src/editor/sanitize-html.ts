import { sanitizeUrl } from "../preview/util";

/**
 * HTML the editor is willing to put into the document.
 *
 * Three places in the editor took a string of HTML and assigned it to
 * `innerHTML` on an element belonging to the live document: the loading
 * decoration that renders an AI completion as it streams, the final result of
 * that completion, and the paste transform. All three are the same mistake, and
 * the middle word is the one that matters — `innerHTML` on a LIVE element runs
 * the content. `<img src=x onerror=…>` fires during the assignment; an
 * `<iframe src>` loads; a `<script>` is inert but `<svg><script>` and
 * `<object data>` are not, depending on the browser.
 *
 * Inside the Cloud console that is the console's own origin: the session, the
 * project list, the deploy API, and an env-var reveal route are all one fetch
 * away from anything that runs there.
 *
 * ## Why not "the AI is ours, so its output is trusted"
 *
 * Because it is not the AI's output. `autocomplete` is given the surrounding
 * document text as context, and the document is a customer's content —
 * frequently content some other person typed into their app. So the payload
 * route is: put HTML in a record, ask an editor's AI to continue writing near
 * it, and have the model repeat it back. Prompt injection is the ordinary case
 * here, not the exotic one.
 *
 * ## The shape of the fix
 *
 * Parse INERTLY, then keep an allowlist.
 *
 * `new DOMParser().parseFromString(html, "text/html")` builds a document with
 * no browsing context: scripts do not run, and `src` attributes do not fetch.
 * That alone closes the live-execution half. The allowlist then decides what
 * survives, and it is an allowlist rather than a list of banned tags because
 * the set of dangerous elements is not one anybody can finish writing — but the
 * set of elements a rich-text editor can actually represent is small, closed,
 * and already written down in its schema.
 *
 * Anything not on the list is UNWRAPPED rather than dropped: a `<div>` around a
 * paragraph is not an attack, and deleting its contents would lose a person's
 * writing to a tag they never chose. Elements that carry no text worth keeping
 * — script, style, iframe — are removed outright.
 */

/** Elements the editor's own schema can represent. */
const ALLOWED_ELEMENTS = new Set([
    "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "s", "strike", "del", "mark", "sub", "sup",
    "a", "img",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "span", "div"
]);

/**
 * Elements removed with their contents, rather than unwrapped.
 *
 * Everything else that is not allowed keeps its text, because the text is
 * somebody's writing. These four have no text worth keeping and every reason
 * to be gone: `script` and `style` are code, `iframe`/`object`/`embed` are
 * another document, and `template`'s contents are invisible to a
 * `querySelectorAll` sweep, which makes it a good place to hide things.
 */
const DROPPED_ELEMENTS = new Set([
    "script", "style", "iframe", "object", "embed", "template", "noscript",
    "link", "meta", "base", "form", "input", "button", "textarea", "select"
]);

/** Attributes each allowed element may keep. */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
    a: new Set(["href", "title", "target", "rel"]),
    img: new Set(["src", "alt", "title", "width", "height"]),
    td: new Set(["colspan", "rowspan"]),
    th: new Set(["colspan", "rowspan", "scope"]),
    ol: new Set(["start"])
};

/** Attributes any element may keep. Deliberately almost empty. */
const GLOBAL_ATTRIBUTES = new Set(["title"]);

/** Attributes whose value is a URL, and so goes through {@link sanitizeUrl}. */
const URL_ATTRIBUTES = new Set(["href", "src"]);

/**
 * Sanitize a fragment of HTML into something safe to insert.
 *
 * Returns a string, because all three call sites are handing HTML to something
 * that wants HTML — ProseMirror's DOM parser, or an element being built.
 */
export function sanitizeEditorHtml(html: string): string {
    if (!html) return "";

    // Inert: no browsing context, so nothing runs and nothing is fetched while
    // this function is deciding what to keep.
    const doc = new DOMParser().parseFromString(html, "text/html");
    sanitizeNode(doc.body);
    return doc.body.innerHTML;
}

/**
 * Parse and sanitize into a detached element, for a caller that wants nodes
 * rather than a string.
 *
 * Same work, one serialize-and-reparse fewer. The element belongs to an inert
 * document until the caller adopts it.
 */
export function parseSanitizedHtml(html: string): HTMLElement {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    sanitizeNode(doc.body);
    return doc.body;
}

/** Walk children depth-first, editing in place. */
function sanitizeNode(parent: Element): void {
    // A static copy: the loop reparents and removes, and a live HTMLCollection
    // would skip elements as the indices shift underneath it.
    for (const child of Array.from(parent.children)) {
        const tag = child.tagName.toLowerCase();

        if (DROPPED_ELEMENTS.has(tag)) {
            child.remove();
            continue;
        }

        // Recurse first, so an unwrapped element's children are already clean
        // when they are lifted into its parent.
        sanitizeNode(child);

        if (!ALLOWED_ELEMENTS.has(tag)) {
            // Keep the writing, lose the tag.
            while (child.firstChild) parent.insertBefore(child.firstChild, child);
            child.remove();
            continue;
        }

        sanitizeAttributes(child, tag);
    }
}

function sanitizeAttributes(element: Element, tag: string): void {
    const allowed = ALLOWED_ATTRIBUTES[tag];

    for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();

        // Every event handler, without needing to know their names. `on*` is
        // the whole family and it grows with the platform.
        if (name.startsWith("on")) {
            element.removeAttribute(attribute.name);
            continue;
        }

        if (!GLOBAL_ATTRIBUTES.has(name) && !allowed?.has(name)) {
            element.removeAttribute(attribute.name);
            continue;
        }

        if (URL_ATTRIBUTES.has(name)) {
            // The same allowlist the previews use: http, https, mailto, tel, or
            // a relative path. `javascript:` in an `href` is a click away from
            // being the same hole.
            const safe = sanitizeUrl(attribute.value);
            if (safe === "about:blank") element.removeAttribute(attribute.name);
            else element.setAttribute(attribute.name, safe);
        }
    }

    // A link that opens elsewhere gets the opener protection, whether or not
    // whoever wrote the HTML thought of it.
    if (tag === "a" && element.getAttribute("target")) {
        element.setAttribute("rel", "noopener noreferrer");
    }
}
