/**
 * Whether a static build's file name carries a content hash: the files the
 * runtime serves `immutable` for a year, and the ones `rebase build` writes
 * `.br` and `.gz` beside. One rule for both, so a file is never precompressed
 * and revalidated, or cached for a year and compressed on every request.
 *
 * Two shapes count:
 *
 * - **Vite's own**, `[name]-[hash]`: the last eight characters of the name,
 *   after a `-`. They are base64url, an alphabet with `-` and `_` in it, so
 *   about one hash in eight holds a `-` (`index-C-WpENHZ.js`,
 *   `page10-D6Dq--fD.js`), and the last `-` is not where it starts.
 * - **A longer one** with no `-` in it, eight characters or more after the last
 *   `-` (`[hash:12]`, another bundler's names).
 *
 * Either must hold a digit or a capital. That is the evidence of a hash: a
 * hand-written `vendor-analytics.js` is not taken for one, and gets revalidated
 * rather than pinned in every visitor's cache with no way to recall it.
 */
export function isContentHashedFileName(fileName: string): boolean {
    const dot = fileName.lastIndexOf(".");
    if (dot <= 0) return false;
    const stem = fileName.slice(0, dot);

    if (stem.length > 9 && stem[stem.length - 9] === "-" && looksLikeHash(stem.slice(-8))) return true;

    const dash = stem.lastIndexOf("-");
    if (dash < 0) return false;
    const suffix = stem.slice(dash + 1);
    return suffix.length >= 8 && looksLikeHash(suffix);
}

/** Base64url throughout, with a digit or a capital somewhere in it. */
function looksLikeHash(text: string): boolean {
    return /^[A-Za-z0-9_-]+$/.test(text) && /[0-9A-Z]/.test(text);
}
