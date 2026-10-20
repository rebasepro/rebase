/**
 * Two texts as the rows of a side-by-side diff: what the target has on the
 * left, what the branch has on the right, an unchanged line on both.
 *
 * A longest-common-subsequence over lines. The texts are one table's
 * `CREATE TABLE` or one policy — tens of lines — so the quadratic table is
 * nothing, and exact beats a heuristic that can pair the wrong lines.
 */
export interface SplitDiffRow {
    /** The target's line, or `null` where the branch added one. */
    left: string | null;
    /** The branch's line, or `null` where it removed one. */
    right: string | null;
    /** Whether the two sides hold the same line. */
    same: boolean;
}

export function splitLineDiff(before: string | undefined, after: string | undefined): SplitDiffRow[] {
    const a = before === undefined ? [] : before.split("\n");
    const b = after === undefined ? [] : after.split("\n");

    // lcs[i][j]: the common lines of a[i..] and b[j..].
    const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }

    const rows: SplitDiffRow[] = [];
    let removed: string[] = [];
    let added: string[] = [];
    // A run of removals and additions becomes rows side by side, so a changed
    // line sits next to what replaced it.
    const flush = () => {
        for (let k = 0; k < Math.max(removed.length, added.length); k += 1) {
            rows.push({ left: removed[k] ?? null, right: added[k] ?? null, same: false });
        }
        removed = [];
        added = [];
    };
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            flush();
            rows.push({ left: a[i], right: b[j], same: true });
            i += 1;
            j += 1;
        } else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
            added.push(b[j]);
            j += 1;
        } else {
            removed.push(a[i]);
            i += 1;
        }
    }
    flush();
    return rows;
}
