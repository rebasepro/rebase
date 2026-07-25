/**
 * Typecheck the scaffolded collection files — once per preset, as `rebase init`
 * would actually lay them out.
 *
 * Nothing else checks these quickly. The only thing that compiled them was the CMS
 * init e2e, inside a Docker build about fifteen minutes in, which is how a template
 * carrying a stale collection shape stayed invisible until the last gate. A template
 * is the first code every new project runs.
 *
 * Checking `templates/template/config` in place does not work: the preset directories
 * hold an `index.ts` importing `./users.js`, and `users.ts` only becomes its sibling
 * after `applyPreset` copies the preset up into `collections/`. So each preset is
 * materialized the way init does it, then compiled.
 *
 * Kept in step with `applyPreset` in packages/cli/src/commands/init.ts — if that
 * function's layout changes, this has to follow.
 *
 * Run: pnpm run check:templates
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const templateConfig = path.join(repoRoot, "packages/cli/templates/template/config");
const tsc = path.join(repoRoot, "node_modules/.bin/tsc");

/** Presets offered by `rebase init`, from TemplatePreset. */
const PRESETS = ["blog", "ecommerce", "blank"];

/** Files the blog preset owns; other presets replace them. Mirrors applyPreset. */
const BLOG_FILES = ["posts.ts", "authors.ts", "tags.ts", "index.ts"];

function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) copyDir(src, dest);
        else fs.copyFileSync(src, dest);
    }
}

/** Lay out `collections/` the way applyPreset does for one preset. */
function materialize(preset, into) {
    copyDir(templateConfig, into);
    const collections = path.join(into, "collections");
    const presets = path.join(collections, "presets");

    if (preset !== "blog") {
        for (const file of BLOG_FILES) {
            fs.rmSync(path.join(collections, file), { force: true });
        }
        const presetDir = path.join(presets, preset);
        for (const file of fs.readdirSync(presetDir).filter((f) => f.endsWith(".ts"))) {
            fs.copyFileSync(path.join(presetDir, file), path.join(collections, file));
        }
    }
    // cleanupPresets: the directory never ships in a scaffolded project.
    fs.rmSync(presets, { recursive: true, force: true });
}

const TSCONFIG = {
    compilerOptions: {
        noEmit: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        allowJs: true,
        strict: true,
        jsx: "react-jsx",
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        ignoreDeprecations: "6.0",
        types: ["node"],
        baseUrl: ".",
        paths: {
            "@rebasepro/types": [`${repoRoot}/packages/types/src`],
            "@rebasepro/admin-types": [`${repoRoot}/packages/admin-types/src`],
            "@rebasepro/common": [`${repoRoot}/packages/common/src`],
            "@rebasepro/utils": [`${repoRoot}/packages/utils/src`],
            "@rebasepro/client": [`${repoRoot}/packages/client/src`]
        },
        typeRoots: [
            `${repoRoot}/node_modules/.pnpm/node_modules/@types`,
            `${repoRoot}/node_modules/@types`
        ]
    },
    include: ["**/*.ts"]
};

let failed = 0;
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-template-check-"));

try {
    for (const preset of PRESETS) {
        const dir = path.join(workRoot, preset);
        materialize(preset, dir);
        fs.writeFileSync(
            path.join(dir, "tsconfig.check.json"),
            JSON.stringify(TSCONFIG, null, 4)
        );

        try {
            // cwd is the materialized dir so tsc emits paths relative to it
            // (`collections/posts.ts`), which can be prefixed back onto the real
            // template path. Run from the repo root it emits a `../../../var/...`
            // temp path instead, which is useless to the reader.
            execFileSync(tsc, ["-p", "tsconfig.check.json"], {
                cwd: dir,
                stdio: "pipe",
                encoding: "utf8"
            });
            console.log(`  ok   ${preset}`);
        } catch (error) {
            failed++;
            console.log(`  FAIL ${preset}`);
            // tsc writes diagnostics to stdout. Rewrite the temp path back to the
            // template file the author has to edit.
            const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
            const templateRel = "packages/cli/templates/template/config";
            console.error(
                output
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => `    ${line.replace(/^(collections\/)/, `${templateRel}/$1`)}`)
                    .join("\n")
            );
        }
    }
} finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
}

if (failed > 0) {
    console.error(
        `\n${failed} preset(s) do not compile. These are the files every new project ` +
            `starts from, so this fails the build.\n` +
            `Presentation fields belong under \`admin\` — see ` +
            `scripts/codemod/collections-admin-block.mjs.`
    );
    process.exit(1);
}

console.log(`\nAll ${PRESETS.length} init presets compile.`);
