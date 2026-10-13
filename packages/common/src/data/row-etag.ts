/**
 * A row's version — the `ETag` the read that produced it reported — kept on
 * the row without being part of it.
 *
 * @module
 */

/**
 * Where a fetched row's version is kept.
 *
 * Non-enumerable, so it does not appear in `Object.keys`, in `JSON.stringify`,
 * in a spread into an update body, or in the generated `Row` type — a row's
 * version is a fact about the *response*, not a column, and putting it in the
 * row proper would mean the server having to strip it back off every write.
 *
 * A string key rather than a symbol so it survives the structured clone an
 * offline store or a worker boundary does… which it does not, and that is the
 * honest position: an etag is per-read, and a row that has been through a cache
 * has not been read from the server. `etagOf` answers `undefined` there, and a
 * conditional write without a tag is an unconditional one.
 */
export const ETAG_KEY = "__etag";

/**
 * The version of a row, when it came straight from a read that reported one.
 *
 * ```ts
 * const post = await client.data.posts.get(1);
 * await client.data.posts.update(1, { title: "New" }, { ifMatch: etagOf(post) });
 * ```
 *
 * Set on a row from `findById()`/`get()`, from `update()`, and on every row
 * `listenById()` delivers (the SDK asks the server to tag each frame).
 * `undefined` for a row from `find()` (a list response carries one ETag at
 * most, and it would not be this row's), from the offline cache, or from a
 * server that does not send them. Passing `undefined` as `ifMatch` sends no
 * precondition, so the call above degrades to an ordinary update rather than
 * failing — which is the right default, and the reason to read this at the call
 * site where the choice is visible.
 */
export function etagOf(row: unknown): string | undefined {
    if (!row || typeof row !== "object") return undefined;
    const value = (row as Record<string, unknown>)[ETAG_KEY];
    return typeof value === "string" ? value : undefined;
}

/**
 * Attach a version to a row without making it part of the row: a
 * non-enumerable `__etag`, so it stays out of `Object.keys`, a spread and
 * `JSON.stringify`, and a row copied through any of them has no tag — which
 * is right, since the copy was not read from the server.
 */
export function withETag<T>(row: T, etag: string | undefined): T {
    if (!etag || !row || typeof row !== "object") return row;
    Object.defineProperty(row, ETAG_KEY, {
        value: etag,
        enumerable: false,
        configurable: true,
        writable: true
    });
    return row;
}
