/**
 * The names `db push` hands Atlas's `--exclude`, spelled so they match.
 *
 * An exclude is the only thing between `atlas schema apply --auto-approve` and
 * an object Rebase does not own: a table no collection backs, a hand-written
 * index, a CHECK constraint, the search and vector columns Rebase applies
 * itself. Atlas reads each one as a glob split on `.`, so a name is not a
 * pattern as it stands. Measured against the pinned 1.2.3:
 *
 *  - a `.` in a name makes one more part, and Atlas refuses the whole command,
 *    `too many parts in pattern` — so every push fails on that database;
 *  - `[`, `]`, `*` and `?` are glob syntax. `[v1]` is a class matching `v` or
 *    `1`, so `idx[v1]` matches `idxv` and not the index called `idx[v1]`:
 *    nothing is excluded, nothing is reported, and Atlas plans the drop. For
 *    an index that drop is not gated, so it applied without a word.
 *
 * So each part is escaped on its own and the parts are joined: a `.` becomes
 * `?`, which matches it (and any one character, so a pattern that also keeps a
 * near-namesake errs on the side of keeping), and glob syntax is escaped with
 * `\`, which Atlas reads as the literal.
 *
 * Code that reads these patterns back — the migration stripper, the generated
 * column ownership check, the index ownership check — reads them with
 * {@link excludePatternParts}, the exact inverse for a pattern built here.
 */

/** One part of an Atlas `--exclude` pattern that matches exactly this name. */
export function atlasExcludeSegment(name: string): string {
    return name.replace(/[\\*?[\]]/g, ch => `\\${ch}`).replace(/\./g, "?");
}

/**
 * The pattern that matches exactly the object these names qualify:
 * `(schema, table)` for a table, `(schema, table, object)` for a column, an
 * index or a constraint. Three parts for anything on a table: a two-part
 * pattern reads as a table, matches nothing, and reports no error.
 */
export function atlasExcludePattern(...parts: string[]): string {
    return parts.map(atlasExcludeSegment).join(".");
}

/**
 * The names a pattern from {@link atlasExcludePattern} was built from, or
 * `undefined` for one that is not a plain name — a wildcard such as `auth.*`.
 *
 * Exact for every pattern built there: a `\` escapes the character after it,
 * and an unescaped `?` can only be a dot.
 */
export function excludePatternParts(pattern: string): string[] | undefined {
    const parts: string[] = [];
    for (const segment of pattern.split(".")) {
        let name = "";
        for (let i = 0; i < segment.length; i++) {
            const ch = segment[i];
            if (ch === "\\" && i + 1 < segment.length) {
                name += segment[++i];
            } else if (ch === "?") {
                name += ".";
            } else if (ch === "*" || ch === "[" || ch === "]") {
                return undefined;
            } else {
                name += ch;
            }
        }
        parts.push(name);
    }
    return parts;
}
