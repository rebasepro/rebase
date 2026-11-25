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

/**
 * Below this many bytes a compressed response saves less than its headers
 * cost: the runtime's on-the-fly compression threshold, and the floor under
 * which a build writes no `.br`/`.gz` sibling.
 */
export const PRECOMPRESS_MIN_BYTES = 1024;

/**
 * Extensions whose content type the runtime compresses
 * (`COMPRESSIBLE_CONTENT_TYPE_REGEX`). All of them, because a build with any
 * sibling switches the runtime's cache of gzipped hashed files off: a hashed
 * type left out here would be compressed on every request instead of once.
 *
 * A regex literal, not a `new Set(…)`: a call at module scope is a side
 * effect to a bundler, so it would ride in every client app that imports
 * this package, used or not.
 */
const PRECOMPRESSIBLE_EXTENSION = /\.(?:js|mjs|cjs|css|html|htm|txt|csv|md|xml|json|webmanifest|svg|wasm|ttf|otf|eot|ico|bmp)$/i;

/**
 * Whether a build writes `.br` and `.gz` beside this file: content-hashed (so
 * the runtime serves it `immutable` and a sibling can never go stale) and of a
 * type worth compressing. The size floor is {@link PRECOMPRESS_MIN_BYTES}.
 *
 * One rule for `rebase build` (`precompressStaticAssets` in the CLI) and the
 * Vite plugin (`rebasePrecompress` in `@rebasepro/app/vitePlugin`).
 */
export function isPrecompressibleAsset(fileName: string): boolean {
    return PRECOMPRESSIBLE_EXTENSION.test(fileName) && isContentHashedFileName(fileName);
}
