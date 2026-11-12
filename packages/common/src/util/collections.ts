
/**
 * A copy of `collections` ordered by slug.
 *
 * Every generator that turns collections into a file is order-dependent, and
 * every one of them is compared against its own output — `rebase doctor`
 * regenerates in memory and diffs, `generate-sdk && git diff --exit-code` gates
 * CI. While only the *writers* sorted, a project whose `readdirSync` order
 * differed from its slug order was reported permanently out of date, and the
 * fix the message printed rewrote the file in the order it was already in. The
 * generators sort themselves now, so no caller can get this wrong.
 *
 * A slug-less collection is left to the generator's own validation, which names
 * the offending collection; sorting must not throw first.
 */
export function sortCollectionsBySlug<C extends { slug?: string }>(collections: readonly C[]): C[] {
    return [...collections].sort((a, b) => (a.slug ?? "").localeCompare(b.slug ?? ""));
}
