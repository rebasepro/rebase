/**
 * Tests for the template-pin gate.
 *
 * The failure it exists for compiles cleanly and passes every suite: `main` sat
 * at a published 0.17.3 while the template imported `queue` from
 * `@rebasepro/types`, which 0.17.3 does not export. `check:templates` compiled
 * the template against the working tree, the first-run e2e rewrote the pins to
 * `link:` before installing, and the only thing that ever saw it was a user
 * running `rebase dev` in a fresh scaffold.
 *
 * So the assertions are on the exit code for each combination of (what the
 * template imports) × (what the pinned version exports), driven through the
 * injected readers rather than a repository shaped like a skewed release.
 *
 * Run: node --test tooling/scripts/test/template-pins.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
    checkTemplatePins, templateImports, splitSpecifier, surfaceExports, requiredComposeVars,
    COMPOSE
} from "../check-template-pins.mjs";

/** The published surface of the one package these fixtures pin. */
const PUBLISHED = new Set(["bucket", "database", "topic", "PostgresCollectionConfig"]);

/**
 * Run the gate against a template of `files`, with `@rebasepro/types` pinned to
 * a version that is published unless the test says otherwise.
 */
function run({ files, compose = "", published = true, releasedAs = null, axes = ["imports", "compose"] }) {
    const silence = () => {};
    const { log, error } = console;
    console.log = console.error = silence;
    try {
        return checkTemplatePins({
            axes,
            releasedAs,
            files,
            versionOf: () => "1.2.3",
            // Only the manifest's own version has ever been published; the
            // version a release is cutting has not, by definition.
            isPublished: version => published && version === "1.2.3",
            exportsAt: (tag) => ({
                names: tag === null ? new Set([...PUBLISHED, "queue"]) : PUBLISHED,
                unresolved: [],
                source: tag === null ? "the working tree" : tag
            }),
            composeText: compose,
            readsEnvAt: (tag, name) => (tag === null ? true : name !== "REBASE_ADMIN_EMAIL")
        });
    } finally {
        console.log = log;
        console.error = error;
    }
}

const file = source => [{ file: "config/resources.ts", source }];

test("an import the pinned version exports passes", () => {
    assert.equal(run({
        files: file('import { bucket, database } from "@rebasepro/types";\n'),
        axes: ["imports"]
    }), 0);
});

test("an import the pinned version does not export fails", () => {
    // The shipped failure, exactly: `queue` landed after v0.17.3 and the
    // template imported it anyway.
    assert.equal(run({
        files: file('import { bucket, database, queue, topic } from "@rebasepro/types";\n'),
        axes: ["imports"]
    }), 1);
});

test("a type-only import counts — a vanished type is a compile error in the scaffold", () => {
    assert.equal(run({
        files: file('import type { SecurityRule } from "@rebasepro/types";\n'),
        axes: ["imports"]
    }), 1);
    assert.equal(run({
        files: file('import { isPublic, type PostgresCollectionConfig } from "@rebasepro/types";\n'),
        axes: ["imports"]
    }), 1);
});

test("an unreleased version is measured against this tree, not skipped", () => {
    // `queue` exists in the tree and not at the tag. Unreleased ⇒ it ships with
    // the tree, so the same import is fine.
    const source = file('import { queue } from "@rebasepro/types";\n');
    assert.equal(run({ files: source, published: false, axes: ["imports"] }), 0);
    assert.equal(run({ files: source, published: true, axes: ["imports"] }), 1);
});

test("--released-as moves the baseline to the version being cut", () => {
    // The release preflight runs before publish.yml bumps the manifests, so
    // without the override the gate measures a release against the release it
    // replaces — and refuses the very bump that fixes the skew.
    const source = file('import { queue } from "@rebasepro/types";\n');
    assert.equal(run({ files: source, axes: ["imports"] }), 1);
    assert.equal(run({ files: source, releasedAs: "1.3.0", axes: ["imports"] }), 0);
});

test("a compose variable the pinned image never reads fails", () => {
    assert.equal(run({
        files: [],
        compose: "    environment:\n      REBASE_ADMIN_EMAIL: ${REBASE_ADMIN_EMAIL:?set it in .env}\n",
        axes: ["compose"]
    }), 1);
});

test("a compose variable the pinned image does read passes", () => {
    assert.equal(run({
        files: [],
        compose: "    environment:\n      JWT_SECRET: ${JWT_SECRET:?set it in .env}\n",
        axes: ["compose"]
    }), 0);
});

test("an optional compose variable is not the gate's business", () => {
    // `${VAR:-default}` starts without the operator doing anything, so an image
    // that ignores it costs nobody a boot.
    assert.equal(run({
        files: [],
        compose: "      REBASE_ADMIN_EMAIL: ${REBASE_ADMIN_EMAIL:-}\n",
        axes: ["compose"]
    }), 0);
});

test("a missing compose file is a failure, not a pass", () => {
    assert.equal(run({ files: [], compose: null, axes: ["compose"] }), 1);
});

test("templateImports does not read across an intervening statement", () => {
    // The clause of a lazy match can otherwise run from one import's `{` to the
    // next `@rebasepro` specifier several lines down.
    const found = templateImports(file([
        'import { defineConfig } from "vite";',
        'import react from "@vitejs/plugin-react";',
        'import { rebaseCollectionsPlugin } from "@rebasepro/app/vitePlugin";'
    ].join("\n")));
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].symbols, ["rebaseCollectionsPlugin"]);
});

test("templateImports names a default and a namespace import", () => {
    const found = templateImports(file([
        'import Client from "@rebasepro/client";',
        'import * as types from "@rebasepro/types";'
    ].join("\n")));
    assert.deepEqual(found.map(f => f.symbols), [["default"], ["*"]]);
});

test("templateImports takes the imported name, not the local alias", () => {
    const found = templateImports(file('import { bucket as b } from "@rebasepro/types";\n'));
    assert.deepEqual(found[0].symbols, ["bucket"]);
});

test("splitSpecifier separates the package from its subpath", () => {
    assert.deepEqual(splitSpecifier("@rebasepro/types"), { pkg: "types", subpath: "." });
    assert.deepEqual(splitSpecifier("@rebasepro/app/vitePlugin"), { pkg: "app", subpath: "./vitePlugin" });
    assert.deepEqual(splitSpecifier("@rebasepro/server/functions"), { pkg: "server", subpath: "./functions" });
});

test("surfaceExports reads one package's section of the shared baseline", () => {
    const text = [
        "# a comment",
        "## @rebasepro/server",
        "function defineFunction",
        "## @rebasepro/types",
        "function bucket",
        "interface CronJobContext { client, logger }"
    ].join("\n");
    assert.deepEqual([...surfaceExports(text, "@rebasepro/types")], ["bucket", "CronJobContext"]);
    assert.deepEqual([...surfaceExports(text, "@rebasepro/server")], ["defineFunction"]);
    assert.equal(surfaceExports(text, "@rebasepro/cms"), null);
});

test("requiredComposeVars takes the `:?` ones and leaves the defaulted ones", () => {
    assert.deepEqual(requiredComposeVars([
        "PORT: ${PORT:-3001}",
        "JWT_SECRET: ${JWT_SECRET:?set it}",
        "CORS_ORIGINS: ${CORS_ORIGINS:?set it}",
        "IMAGE: rebasepro/server:${REBASE_VERSION:-latest}"
    ].join("\n")), ["CORS_ORIGINS", "JWT_SECRET"]);
});

test("COMPOSE names the file a scaffold actually ships", () => {
    assert.match(COMPOSE, /templates\/template\/docker-compose\.yml$/);
});
