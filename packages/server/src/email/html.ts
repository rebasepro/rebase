/**
 * HTML escaping for email bodies.
 *
 * Every default template interpolates values the server does not control — a
 * `displayName` chosen at registration, an `appName` from config, a link base a
 * host set — into markup that is then mailed, signed by the sending domain, to
 * an address the same request chose. Unescaped, that turns `POST /auth/register`
 * into a way to deliver arbitrary HTML (a heading, an anchor) from a domain
 * whose SPF and DKIM check out.
 *
 * The fix is deliberately not five escaping calls at five interpolation sites:
 * a sixth template would simply forget. Templates are built with the {@link html}
 * tag, which escapes *every* interpolated value by default, and markup that is
 * meant to pass through verbatim — the static style strings, a nested fragment —
 * must say so with {@link raw}. Forgetting `raw` produces visibly escaped text
 * in a test; forgetting to escape is invisible until someone exploits it.
 */

/**
 * Markup that has already been vetted and must be interpolated verbatim.
 *
 * Only ever construct this from a string literal in this package's own source
 * (or from the {@link html} tag, which produces one). Wrapping user input in
 * `raw()` defeats the entire mechanism.
 */
export class RawHtml {
    constructor(readonly value: string) {}

    toString(): string {
        return this.value;
    }
}

/**
 * Mark a static, author-controlled string as safe to interpolate unescaped.
 */
export function raw(markup: string): RawHtml {
    return new RawHtml(markup);
}

/**
 * Escape the five characters that can change the meaning of HTML text or of a
 * quoted attribute value.
 *
 * `&` goes first: escaping it after the others would double-escape the entities
 * they just produced. `'` is included because it is a legal attribute delimiter,
 * and `"` because it is the one this file uses.
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Render one interpolated value: pass {@link RawHtml} through, drop nullish,
 * escape everything else.
 */
function interpolate(value: unknown): string {
    if (value instanceof RawHtml) return value.value;
    if (value === null || value === undefined) return "";
    return escapeHtml(String(value));
}

/**
 * Tagged template for email markup. Every `${...}` is escaped unless it is
 * {@link RawHtml}.
 *
 * Returns `RawHtml` so fragments nest without being escaped a second time:
 *
 * ```ts
 * const button = url ? html`<a href="${url}">Open</a>` : raw("");
 * const body = html`<div>${button}</div>`;
 * ```
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): RawHtml {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) {
        out += interpolate(values[i]) + strings[i + 1];
    }
    return new RawHtml(out);
}
