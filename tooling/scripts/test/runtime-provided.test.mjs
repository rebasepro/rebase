/**
 * The bundler and the entrypoint have to agree about who supplies what.
 *
 * `packages/cli/src/bundle.ts` REMOVES a set of packages from a bundle's
 * declared dependencies, on the stated grounds that the runtime image supplies
 * them. `infra/docker/entrypoint.mjs` is what supplies them, by linking the image's
 * copy into `/bundle/node_modules` — Node resolves a bare specifier by walking
 * up from the importing file, and `/bundle/backend/functions/foo.js` never
 * reaches the image's `/app/node_modules`.
 *
 * When the two lists disagree, the bundler removes a dependency that nothing
 * then provides, and every function and cron importing it fails to load with
 * `Cannot find package`. The routes 404 and the container still reports itself
 * healthy, because the runtime is fine — only a WARNING in the boot log
 * separates a deployment whose custom code runs from one where none of it does.
 *
 * They did disagree, by four packages, for as long as both files have existed.
 *
 * A third party has to hold too: the image must actually ship each of them, or
 * the entrypoint links nothing and silently falls back to the same failure.
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The `@rebasepro/*` entries of a `RUNTIME_PROVIDED` declaration, by source text. */
function runtimeProvided(file) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    const match = source.match(/RUNTIME_PROVIDED(?:_PACKAGES)?\s*=\s*(?:new Set\()?\[([\s\S]*?)\]/);
    assert.ok(match, `${file} declares no RUNTIME_PROVIDED array`);
    return match[1]
        .split(",")
        .map(entry => entry.trim().replace(/^["']|["'].*$/g, ""))
        .filter(name => name.startsWith("@rebasepro/"));
}

const fromBundler = runtimeProvided("packages/cli/src/bundle.ts");
const fromEntrypoint = runtimeProvided("infra/docker/entrypoint.mjs");
const fromFetchPath = runtimeProvided("packages/server/src/boot/fetch-bundle.ts");

test("both files actually declare some @rebasepro packages", () => {
    // Guards the parser itself: a regex that silently matched nothing would make
    // every assertion below vacuously true.
    assert.ok(fromBundler.length > 0, "parsed nothing out of bundle.ts");
    assert.ok(fromEntrypoint.length > 0, "parsed nothing out of entrypoint.mjs");
});

test("every package the bundler strips is one the entrypoint supplies", () => {
    const unsupplied = fromBundler.filter(name => !fromEntrypoint.includes(name));
    assert.deepEqual(
        unsupplied,
        [],
        `bundle.ts removes ${unsupplied.join(", ")} from a bundle's dependencies, but `
        + "entrypoint.mjs does not link it in. Functions and crons importing it will fail "
        + "to load with \"Cannot find package\", behind a container that reports itself healthy."
    );
});

test("the entrypoint supplies nothing the bundler still expects a bundle to install", () => {
    // The other direction matters too, and differently: linking a package the
    // bundle also installed replaces a complete dependency tree with the image's
    // deliberately narrow one. That is how redirecting @rebasepro/server-postgres
    // once took the database driver down.
    const unexpected = fromEntrypoint.filter(name => !fromBundler.includes(name));
    assert.deepEqual(
        unexpected,
        [],
        `entrypoint.mjs links ${unexpected.join(", ")} over whatever the bundle installed, `
        + "but bundle.ts still expects the bundle to supply it. Add it to both lists or neither."
    );
});

test("the image ships every package the entrypoint promises to link", () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, "infra", "docker", "server.Dockerfile"), "utf8");
    for (const name of fromEntrypoint) {
        const shortName = name.slice("@rebasepro/".length);
        assert.ok(
            dockerfile.includes(`./node_modules/@rebasepro/${shortName}/package.json`),
            `${name} is linked by the entrypoint but server.Dockerfile never copies it into the image, `
            + "so the link would point at nothing."
        );
    }
});

// ── The fetch path ───────────────────────────────────────────────────────────
//
// A bundle can arrive two ways, and only one of them goes through
// entrypoint.mjs. When the runtime fetches its own bundle, the entrypoint's
// loop is skipped (it would dedupe an empty directory — the download has not
// happened yet) and `dedupeRuntimePackages` in
// `packages/server/src/boot/fetch-bundle.ts` does the same stitch afterwards.
//
// So that file is a THIRD copy of this contract, and it was written before the
// four-package fix landed: the bundler stripped five and it supplied one. The
// tests above could not see it, which is the only reason it survived.

test("the fetch path declares some @rebasepro packages", () => {
    assert.ok(fromFetchPath.length > 0, "parsed nothing out of fetch-bundle.ts");
});

test("the fetch path supplies exactly what the entrypoint does", () => {
    assert.deepEqual(
        [...fromFetchPath].sort(),
        [...fromEntrypoint].sort(),
        "infra/docker/entrypoint.mjs and packages/server/src/boot/fetch-bundle.ts stitch the same "
        + "packages into a bundle, one for a baked-in bundle and one for a fetched one. They "
        + "disagree, so the same project would get different packages depending on how its "
        + "bundle arrived."
    );
});
