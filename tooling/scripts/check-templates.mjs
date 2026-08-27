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

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const templateRoot = path.join(repoRoot, "packages/cli/templates/template");
const templateConfig = path.join(templateRoot, "config");
const baasOverlay = path.join(repoRoot, "packages/cli/templates/overlays/baas");
const tsc = path.join(repoRoot, "node_modules/.bin/tsc");

/** Presets offered by `rebase init`, from TemplatePreset. */
const PRESETS = ["blog", "ecommerce", "blank"];

/** The `--headless` scaffold, checked as its own variant. */
const BAAS = "baas";

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

/**
 * Add the thing a user adds the moment they want a custom field: a component, an
 * image inside it, and a collection pointing at it with a lazy `import()` thunk.
 *
 * This is checked because it is not free. The thunk is *type-checked*, so every
 * program that compiles the collection resolves the component and then the
 * component's own imports — including `import icon from "./icon.png"`, which is
 * Vite's doing and means nothing to `tsc`. The frontend gets away with it through
 * `vite/client` types, but those belong to the frontend's program, not this one, so
 * the config build fails on an import the author never thought of as risky.
 *
 * `config/frontend-assets.d.ts` is what answers it, and this probe is what keeps it
 * from being deleted as an unexplained file.
 *
 * The component lives inside the materialized config directory rather than at
 * `../frontend/src`, because only `config/` is materialized here — where the file
 * sits changes nothing about the asset question.
 */
function addCustomComponentProbe(into) {
    fs.writeFileSync(path.join(into, "__probe_component.tsx"), `
import icon from "./__probe_icon.png";

export const iconPath: string = icon;

export default function ProbeField() {
    return null;
}
`.trimStart(), "utf8");

    fs.writeFileSync(path.join(into, "__probe_collection.ts"), `
import type { PostgresCollectionConfig } from "@rebasepro/types";

const probe: PostgresCollectionConfig = {
    slug: "probe",
    name: "Probe",
    table: "probe",
    properties: {
        logo: {
            name: "Logo",
            type: "string",
            admin: { Field: () => import("./__probe_component") }
        }
    }
};

export default probe;
`.trimStart(), "utf8");
}

/**
 * Lay out the headless scaffold the way `applyHeadless` does: drop `frontend/`, `config/`
 * and the generated schema, then copy the overlay over the top.
 *
 * This is the only template *backend* that can be typechecked standalone — the CMS
 * one imports `./schema.generated.js`, which does not exist until `db generate` runs.
 * It is also the flavour with no Docker coverage at all: `cli-init-baas-e2e.ts` boots
 * the project directly and never runs `docker compose up`, so a boot-time config
 * mistake here would only ever be found by a user.
 */
function materializeBaas(into) {
    copyDir(templateRoot, into);
    // Mirrors `applyHeadless` in commands/init.ts. It deletes the collections, NOT
    // the config package: storage is not under row-level security, so the
    // headless flavour still needs somewhere to put `storageAuthorize`, and the
    // overlay replaces config/index.ts with one that exports only that.
    fs.rmSync(path.join(into, "frontend"), { recursive: true, force: true });
    fs.rmSync(path.join(into, "config/collections"), { recursive: true, force: true });
    for (const stray of ["admin.d.ts", "frontend-assets.d.ts"]) {
        fs.rmSync(path.join(into, "config", stray), { force: true });
    }
    fs.rmSync(path.join(into, "backend/src/schema.generated.ts"), { force: true });
    copyDir(baasOverlay, into);
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
            "@rebasepro/cms-types": [`${repoRoot}/packages/cms-types/src`],
            "@rebasepro/common": [`${repoRoot}/packages/common/src`],
            "@rebasepro/utils": [`${repoRoot}/packages/utils/src`],
            "@rebasepro/client": [`${repoRoot}/packages/client/src`],
            "@rebasepro/server": [`${repoRoot}/packages/server/src`],
            "@rebasepro/server-postgres": [`${repoRoot}/packages/server-postgres/src`]
            // Third-party deps (hono, zod, dotenv) resolve through a node_modules
            // symlink rather than `paths`: `hono/cors` is an exports-map subpath, and
            // a path mapping would point at a file that does not exist on disk.
        },
        typeRoots: [
            `${repoRoot}/node_modules/.pnpm/node_modules/@types`,
            `${repoRoot}/node_modules/@types`
        ]
    },
    include: ["**/*.ts"]
};

/**
 * The `admin` block reaches a collection file only if the config package can resolve
 * `@rebasepro/cms-types` — the augmentation is what declares the field, and a
 * `/// <reference types>` needs the package to be a real dependency.
 *
 * The typecheck below maps `@rebasepro/*` through `paths`, so it would compile happily
 * even if the manifest never declared it. saas/config was in exactly that state: a
 * reference file, no dependency, 42 errors the moment anything checked it for real.
 */
function checkAdminTypesDeclared() {
    const manifest = path.join(templateConfig, "package.json");
    const ref = path.join(templateConfig, "admin.d.ts");
    const problems = [];

    const hasRef = fs.existsSync(ref)
        && /reference\s+types\s*=\s*["']@rebasepro\/cms-types["']/.test(fs.readFileSync(ref, "utf8"));
    if (!hasRef) problems.push("config/cms.d.ts is missing its /// <reference types=\"@rebasepro/cms-types\" />");

    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (!deps["@rebasepro/cms-types"]) {
        problems.push("config/package.json does not depend on @rebasepro/cms-types, so the reference cannot resolve");
    }
    return problems;
}

/**
 * The headless config package must declare `@rebasepro/common`.
 *
 * `rebase schema introspect` writes its collections against `defineCollection`, and
 * which one it imports is *detected* from the manifests above the output directory —
 * `@rebasepro/cms-types` for a CMS project, `@rebasepro/common` for this one. Drop
 * the dependency and the detection silently falls back to a plain
 * `PostgresCollectionConfig` annotation, which widens the property keys to `string`
 * and takes the checking on `propertiesOrder` and friends away again.
 *
 * The typecheck below cannot see this: `node_modules` is symlinked at the pnpm
 * store, so the import resolves whether or not the manifest declares it. Same reason
 * `checkAdminTypesDeclared` exists, one flavour over.
 */
function checkHeadlessBuilderDeclared() {
    const manifest = path.join(baasOverlay, "config", "package.json");
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return deps["@rebasepro/common"]
        ? []
        : ["overlays/baas/config/package.json does not depend on @rebasepro/common, "
            + "so introspection has no defineCollection to generate against"];
}

/**
 * Every ambient type library a template tsconfig pins must be a declared
 * dependency of the workspace that pins it.
 *
 * This is `checkAdminTypesDeclared`'s sibling, and it exists for the same reason:
 * a reference to a package the manifest never declares. `config/tsconfig.json`
 * pins `types: ["node"]` — deliberately, to stop tsc sweeping the pnpm virtual
 * store — but `config/package.json` never depended on `@types/node`. Under
 * pnpm's isolated layout there is no `@types/node` reachable from `config/`, so
 * the workspace could not compile itself:
 *
 *     config build$ tsc
 *     error TS2688: Cannot find type definition file for 'node'
 *
 * That is `pnpm -r build` — and the config workspace's own `build` script —
 * failing in a project one minute after `rebase init`.
 *
 * The compile step below cannot catch it and should not try. It writes its own
 * tsconfig with `typeRoots` pointed at the repo's `node_modules`, because it is
 * checking the *collection files*, not the project's dependency graph. Those
 * synthetic typeRoots resolve `node` no matter what the template declares, which
 * is exactly why the omission survived: the only program that ever compiled
 * these files was one that had been handed the answer.
 *
 * So assert it on the manifests instead — cheap, and resolution cannot fool it.
 */
function checkPinnedTypesAreDeclared() {
    const problems = [];

    /** Which package supplies `types: ["<entry>"]`. */
    const providerOf = (entry) => {
        // `vite/client` is shipped by `vite` itself; `node` comes from `@types/node`.
        if (entry.includes("/")) return entry.startsWith("@") ? entry.split("/").slice(0, 2).join("/") : entry.split("/")[0];
        return `@types/${entry}`;
    };

    for (const workspace of ["config", "backend", "frontend"]) {
        const tsconfigPath = path.join(templateRoot, workspace, "tsconfig.json");
        const manifestPath = path.join(templateRoot, workspace, "package.json");
        if (!fs.existsSync(tsconfigPath) || !fs.existsSync(manifestPath)) continue;

        // The template tsconfigs carry explanatory comments, so this is JSONC.
        const raw = fs.readFileSync(tsconfigPath, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/.*$/gm, "$1");
        let pinned;
        try {
            pinned = JSON.parse(raw).compilerOptions?.types;
        } catch (e) {
            problems.push(`${workspace}/tsconfig.json could not be parsed after stripping comments: ${e.message}`);
            continue;
        }
        if (!Array.isArray(pinned)) continue;

        const pkg = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));

        for (const entry of pinned) {
            const provider = providerOf(entry);
            if (!declared.has(provider)) {
                problems.push(
                    `${workspace}/tsconfig.json pins types: ["${entry}"] but ${workspace}/package.json ` +
                    `does not depend on ${provider} — under pnpm the workspace cannot compile itself ` +
                    `(TS2688)`
                );
            }
        }
    }

    return problems;
}

/**
 * The other direction, which nothing asserted: the BaaS flavour must not carry the
 * admin layer at all.
 *
 * A typecheck cannot show this. `materializeBaas` symlinks `node_modules` at the pnpm
 * store, so `@rebasepro/cms-types` resolves there no matter what `paths` says —
 * dropping the mapping and importing the package anyway still compiled cleanly. And
 * one import is enough to matter: the package index side-effect-imports `augment.ts`,
 * which declares `admin` for the whole program, so a single stray import in the
 * backend would hand a BaaS project the admin surface it is defined by not having.
 *
 * So assert it on the files instead. Cheap, and it cannot be fooled by resolution.
 */
function checkBaasHasNoAdminTypes() {
    const problems = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") walk(full);
                continue;
            }
            if (!/\.(ts|tsx|json|mjs|js)$/.test(entry.name)) continue;
            const source = fs.readFileSync(full, "utf8");
            if (source.includes("@rebasepro/cms-types")) {
                problems.push(`${path.relative(repoRoot, full)} references @rebasepro/cms-types`);
            }
        }
    };
    walk(baasOverlay);
    return problems;
}

let failed = 0;
const baasProblems = checkBaasHasNoAdminTypes();
if (baasProblems.length > 0) {
    failed++;
    console.log("  FAIL baas has no admin layer");
    for (const p of baasProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   baas has no admin layer");
}

const pinnedTypeProblems = checkPinnedTypesAreDeclared();
if (pinnedTypeProblems.length > 0) {
    failed++;
    console.log("  FAIL pinned ambient types are declared dependencies");
    for (const p of pinnedTypeProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   pinned ambient types are declared dependencies");
}

const declarationProblems = checkAdminTypesDeclared();
if (declarationProblems.length > 0) {
    failed++;
    console.log("  FAIL cms-types wiring");
    for (const p of declarationProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   cms-types wiring");
}

const headlessBuilderProblems = checkHeadlessBuilderDeclared();
if (headlessBuilderProblems.length > 0) {
    failed++;
    console.log("  FAIL headless builder wiring");
    for (const p of headlessBuilderProblems) console.error(`    ${p}`);
} else {
    console.log("  ok   headless builder wiring");
}

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-template-check-"));

/**
 * Make `@rebasepro/cms-types` resolvable the way a scaffolded project resolves
 * it — as a dependency in `node_modules`, found by walking up from the file.
 *
 * `config/cms.d.ts` opts the project in with
 * `/// <reference types="@rebasepro/cms-types" />`, and a triple-slash type
 * reference is resolved through `typeRoots` and `node_modules` — **not** through
 * tsconfig `paths`. The `paths` entry below therefore does nothing for it.
 *
 * This check happened to pass on a developer machine anyway, because pnpm's hoisted
 * store (`node_modules/.pnpm/node_modules`, which the per-preset symlink points at)
 * had an `@rebasepro/cms-types` entry left in it. A fresh `pnpm install
 * --frozen-lockfile` has no such entry, so CI failed with twelve `'admin' does not
 * exist` errors on files that compile locally. A gate that depends on a stray link
 * in someone's store is not a gate.
 *
 * The shim sits one directory above each materialized project, so resolution finds
 * the store symlink first (third-party packages) and this second (@rebasepro). It
 * points at `src` rather than the package directory on purpose: `check:templates`
 * runs before `pnpm build` in CI, so `dist` may not exist yet.
 */
function linkCmsTypes(into) {
    const shim = path.join(into, "node_modules", "@rebasepro", "cms-types");
    fs.mkdirSync(shim, { recursive: true });
    fs.writeFileSync(
        path.join(shim, "package.json"),
        JSON.stringify({ name: "@rebasepro/cms-types", version: "0.0.0", types: "index.d.ts" }, null, 2),
        "utf8"
    );
    fs.writeFileSync(
        path.join(shim, "index.d.ts"),
        `export * from ${JSON.stringify(path.join(repoRoot, "packages/cms-types/src/index"))};\n`,
        "utf8"
    );
}

linkCmsTypes(workRoot);

try {
    for (const preset of [...PRESETS, BAAS]) {
        const dir = path.join(workRoot, preset);
        if (preset === BAAS) materializeBaas(dir);
        else {
            materialize(preset, dir);
            // BaaS has no config/ and no components, so this applies to CMS only.
            addCustomComponentProbe(dir);
        }

        // Real resolution for third-party specifiers, exports maps included.
        fs.symlinkSync(
            path.join(repoRoot, "node_modules/.pnpm/node_modules"),
            path.join(dir, "node_modules"),
            "dir"
        );
        fs.writeFileSync(
            path.join(dir, "tsconfig.check.json"),
            JSON.stringify(
                preset === BAAS
                    // The BaaS flavour keeps a config package — holding
                    // `storageAuthorize` and nothing else — so it is checked the
                    // same way every other variant is. It used to be narrowed to
                    // `backend/src/**/*.ts` on the premise that there was no
                    // config/ at all; that premise stopped being true, and the
                    // narrowed include then matched an EMPTY directory, which tsc
                    // reports as TS18003 rather than as "nothing to do".
                    //
                    // Note this program can still *resolve* @rebasepro/cms-types,
                    // and deliberately so — dropping the `paths` entry changes
                    // nothing, because resolution falls through to the pnpm store
                    // that `node_modules` is symlinked to. What keeps the admin layer
                    // out of this flavour is `checkBaasHasNoAdminTypes` below, and
                    // the guarantee that writing `admin` is an error is asserted by
                    // its own program in `tests/e2e/baas-typecheck`.
                    ? { ...TSCONFIG }
                    : TSCONFIG,
                null,
                4
            )
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
                    .map((line) => `    ${line
                        .replace(/^(collections\/)/, `${templateRel}/$1`)
                        .replace(/^(backend\/src\/)/, preset === BAAS
                            ? "packages/cli/templates/overlays/baas/$1"
                            : `packages/cli/templates/template/$1`)}`)
                    .join("\n")
            );
        }
    }
} finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
}

if (failed > 0) {
    console.error(
        `\n${failed} variant(s) do not compile. These are the files every new project ` +
            `starts from, so this fails the build.\n` +
            `Presentation fields belong under \`admin\` — see ` +
            `tooling/scripts/codemod/collections-admin-block.mjs.`
    );
    process.exit(1);
}

console.log(`\nAll ${PRESETS.length} init presets compile, and the baas backend.`);
