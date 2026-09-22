/**
 * Reading the tsconfigs `rebase init` ships, for `check-templates.mjs`.
 *
 * Its own module so the reading can be tested without running the template
 * gate, which materializes and compiles every preset.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * JSONC → JSON, by scanning rather than by pattern.
 *
 * This was two regular expressions, and the block-comment one —
 * `/\/\*[\s\S]*?\*\//g` — treats any `/*` as an opener. A tsconfig is full of
 * them: `"src/**\/*"` in an `include`, and any comment that mentions a glob.
 * One added comment saying `../config/**` made the regex swallow from there to
 * the next `*\/` anywhere in the file, and the gate reported the tsconfig as
 * unparseable at a line that was fine.
 *
 * A scanner cannot make that mistake, because it knows whether it is inside a
 * string when it meets a slash. Strings are the only context that matters in
 * JSON; there are no template literals or regex literals to worry about.
 */
export function stripJsonComments(source) {
    let out = "";
    let inString = false;
    let i = 0;
    while (i < source.length) {
        const char = source[i];
        if (inString) {
            out += char;
            if (char === "\\") { out += source[i + 1] ?? ""; i += 2; continue; }
            if (char === '"') inString = false;
            i += 1;
            continue;
        }
        if (char === '"') { inString = true; out += char; i += 1; continue; }
        if (char === "/" && source[i + 1] === "/") {
            while (i < source.length && source[i] !== "\n") i += 1;
            continue;
        }
        if (char === "/" && source[i + 1] === "*") {
            i += 2;
            while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
            i += 2;
            continue;
        }
        out += char;
        i += 1;
    }
    // A trailing comma left behind by a removed entry is not our problem, but a
    // comment that ended a line often leaves one dangling before `}` or `]`.
    return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * The compile the template gate runs is not the compile the user gets.
 *
 * Its `TSCONFIG` is synthetic — it has to be, because a scaffolded project
 * resolves `@rebasepro/*` through an install that gate has no install for. But
 * a synthetic tsconfig can silently disagree with the shipped one, and it did:
 * the gate compiled every preset under `moduleResolution: "bundler"` while
 * `backend/tsconfig.json` shipped `"node"`, so the setting the user actually
 * compiles with was the one setting nothing checked. `node` is TypeScript's
 * node10 algorithm — no `exports` maps — and it is deprecated in TS 6.
 *
 * Only module resolution is compared, because it is the option that decides
 * whether an import resolves at all. The rest of the synthetic config differs
 * on purpose (noEmit, paths, typeRoots).
 *
 * Read with {@link stripJsonComments}, and a file that does not parse is a
 * problem, not a skip. This used the two regexes that function replaced, and
 * the comment `../config/**` in `backend/tsconfig.json` — the one file this
 * rule exists for — made it unparseable; the `catch` skipped it, so a
 * regression to `"node"` there would have passed.
 *
 * @param {{ expected: string, tsconfigs: string[], repoRoot: string }} options
 *   `tsconfigs` are absolute paths; a missing one is skipped.
 * @returns {string[]} one line per problem
 */
export function checkResolutionMatchesShipped({ expected, tsconfigs, repoRoot }) {
    const problems = [];

    for (const tsconfigPath of tsconfigs) {
        if (!fs.existsSync(tsconfigPath)) continue;
        const shown = path.relative(repoRoot, tsconfigPath);
        let declared;
        try {
            declared = JSON.parse(stripJsonComments(fs.readFileSync(tsconfigPath, "utf8"))).compilerOptions?.moduleResolution;
        } catch (e) {
            problems.push(`${shown} could not be parsed after stripping comments (${e.message}), so its moduleResolution is unchecked`);
            continue;
        }
        if (declared !== undefined && declared !== expected) {
            problems.push(
                `${shown} sets moduleResolution: "${declared}", ` +
                `but this gate compiles the preset with "${expected}" — so the setting shipped to ` +
                "users is the one nothing checks"
            );
        }
    }

    return problems;
}
