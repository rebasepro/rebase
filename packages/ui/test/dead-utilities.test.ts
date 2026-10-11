import fs from "fs";
import path from "path";

/**
 * Class names that generate no CSS in this repo's Tailwind v4 build, and so
 * style nothing while reading as if they did:
 * - `ring-opacity-*` / `bg-opacity-*` — Tailwind v3; v4 uses the `/50` form;
 * - `animate-in`, `animate-out`, `fade-in-*`, `fade-out`, `zoom-in-*` — the
 *   `tw-animate-css` plugin, which is not loaded;
 * - `focused:` — not a variant;
 * - `ring-ring`, `ring-offset-background`, `text-unset` — shadcn tokens and
 *   values this theme does not declare.
 *
 * `check:theme-tokens` sees only colour families this repo declares, so these
 * passed it. A ratchet until a compiler-backed dead-utility check exists.
 */
const ROOT = path.resolve(__dirname, "../..");
const PACKAGES = ["ui", "cms", "studio", "app"];
const DEAD = /(?<![\w-])(?:[\w-]+:)*(ring-opacity-\d+|bg-opacity-\d+|animate-in|animate-out|fade-in-\d+|fade-in|fade-out|zoom-in-\d+|focused:[\w-]+|ring-ring|ring-offset-background|text-unset)(?![\w-])/;

function sourceFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

test("no class name in the admin packages is one Tailwind v4 here does not generate", () => {
    const hits: string[] = [];
    for (const pkg of PACKAGES) {
        for (const file of sourceFiles(path.join(ROOT, pkg, "src"))) {
            fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
                const code = line.trim();
                if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
                // Only inside string literals: a prop named `focused` is not a class.
                const strings = code.match(/"[^"]*"|`[^`]*`/g) ?? [];
                for (const s of strings) {
                    const m = s.match(DEAD);
                    if (m) hits.push(`${path.relative(ROOT, file)}:${i + 1} ${m[1]}`);
                }
            });
        }
    }
    expect(hits).toEqual([]);
});
