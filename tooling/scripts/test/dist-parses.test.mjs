/**
 * Every built file a package publishes must parse.
 *
 * This sounds too obvious to check, and it is exactly what shipped. The
 * `server-postgres` build prepends a banner to EVERY output chunk, and the
 * banner declared `import process from "process"`. Any chunk that also
 * contained a bundled module importing `node:process` — chalk's supports-color
 * does — therefore declared the identifier twice and failed to parse.
 *
 * Nothing noticed, for two reasons worth remembering. The chunk layout decides
 * which modules share a file, so the collision appeared only in the image's
 * build and not in the local one, from identical source. And the failure is a
 * *load-time* SyntaxError, so every unit test passed: nothing in the suite
 * imports the built artifact, only the source it was built from.
 *
 * `node --check` is the whole check. It parses without executing, so it is
 * fast, has no side effects, and answers precisely the question the type
 * checker and the test suite both cannot: is the thing we are about to publish
 * syntactically a program?
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PACKAGES = path.join(ROOT, "packages");

/** Publishable packages that have been built. */
function builtPackages() {
    return readdirSync(PACKAGES, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .filter(name => {
            const manifest = path.join(PACKAGES, name, "package.json");
            if (!existsSync(manifest)) return false;
            if (JSON.parse(readFileSync(manifest, "utf8")).private === true) return false;
            return existsSync(path.join(PACKAGES, name, "dist"));
        });
}

function jsFiles(dir) {
    const out = [];
    const walk = d => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            // `.cjs`/`.mjs` too: `node --check` picks the goal symbol from the
            // extension, so each is checked as what Node will treat it as.
            else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(full);
        }
    };
    walk(dir);
    return out;
}

const packages = builtPackages();

test("some packages are built (otherwise this gate proves nothing)", () => {
    assert.ok(
        packages.length > 0,
        "No packages/*/dist found — run `pnpm build` before `pnpm test:gates`."
    );
});

for (const name of packages) {
    test(`${name}: every built file parses`, () => {
        const failures = [];
        for (const file of jsFiles(path.join(PACKAGES, name, "dist"))) {
            try {
                execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
            } catch (error) {
                const detail = String(error.stderr ?? error.message).split("\n").slice(0, 3).join(" ").trim();
                failures.push(`${path.relative(ROOT, file)} — ${detail}`);
            }
        }
        assert.deepEqual(
            failures,
            [],
            `Built files that are not valid JavaScript:\n  ${failures.join("\n  ")}\n\n` +
            "A build can emit an unparseable file from perfectly good source — a banner or an " +
            "injected preamble that collides with something the bundler put in the same chunk. " +
            "Nothing else catches it: the type checker reads the source, and the suite never " +
            "imports the artifact."
        );
    });
}
