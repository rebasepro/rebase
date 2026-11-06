/**
 * Every docs page's frontmatter parses, the way the site build parses it.
 *
 * 2026-11-06: two Spanish pages carried a `description:` with an unquoted
 * ": " in it. YAML reads that as a second key and refuses the block, so
 * `astro build` stopped at content sync and rebase.pro could not deploy. This
 * gate was green the whole time: every other stage reads page bodies, and a
 * body extracted with a regex does not care whether the YAML above it is
 * valid. The translator writes these lines, so the next one is a matter of
 * which sentence it happens to produce.
 *
 * The parser is the one Astro loads (js-yaml, resolved through Astro's own
 * dependencies), so "parses here" and "parses in the build" are the same
 * statement, all six locales.
 */
import { readFileSync, globSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const CONTENT = "website/src/content/docs";

/** js-yaml as Astro resolves it, so a version bump there is a version bump here. */
function astroYaml(root) {
    const fromWebsite = createRequire(path.join(root, "website", "package.json"));
    const fromAstro = createRequire(fromWebsite.resolve("astro/package.json"));
    return fromAstro("js-yaml");
}

/** The frontmatter block of a page, without its `---` fences, or null when it has none. */
export function frontmatterOf(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    return match ? match[1] : null;
}

/** `contentDir` (relative to `root`, or absolute) is for tests; the gate reads the site's. */
export function checkFrontmatter(root, { contentDir = CONTENT } = {}) {
    const yaml = astroYaml(root);
    const findings = [];
    const base = path.resolve(root, contentDir);
    const files = globSync("**/*.{md,mdx}", { cwd: base }).map((file) => path.relative(root, path.join(base, file)));
    for (const file of files) {
        const block = frontmatterOf(readFileSync(path.join(root, file), "utf8"));
        if (block === null) continue;
        try {
            yaml.load(block);
        } catch (error) {
            // js-yaml counts lines inside the block; the file has `---` above it.
            const line = (error.mark?.line ?? 0) + 2;
            findings.push({
                file,
                line,
                message: `${String(error.reason ?? error.message).split("\n")[0]}: the site build stops here. ` +
                    "Quote the value (a \": \" inside an unquoted one starts a second key).",
            });
        }
    }
    return { findings, scanned: files.length };
}
