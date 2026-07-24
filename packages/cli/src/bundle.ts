/**
 * Building a project bundle.
 *
 * A bundle is the deployable form of a project: compiled collections, functions,
 * crons and schema, plus a generated manifest describing exactly what it needs
 * to run. It contains no Dockerfile and no repository — the runtime is supplied
 * separately, which is what allows a project to be moved onto a patched runtime
 * without being rebuilt.
 *
 * Compilation runs through a generated tsconfig rooted at the project directory,
 * so the output mirrors the source layout (`config/…`, `backend/functions/…`)
 * and every path in the manifest is predictable. Letting each workspace package
 * emit into its own `dist/` would have meant guessing at three different
 * layouts, since `rootDir` differs between the template flavours.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { execa } from "execa";
import chalk from "chalk";
import {
    BUNDLE_FORMAT_VERSION,
    RUNTIME_CONTRACT_VERSION,
    computeSchemaVersion,
    type CollectionConfig,
    type NativeDependency,
    type RebaseBundleManifest,
    type RebaseBackendAppConfig
} from "@rebasepro/types";
import { resolveBackendPaths } from "./manifest";
import {
    getActiveBackendPlugin,
    resolveLocalBin,
    resolvePluginCliScript,
    resolveTsx
} from "./utils/project";

export const DEFAULT_BUNDLE_DIR = "dist-bundle";

export interface BuildBundleOptions {
    projectRoot: string;
    appName: string;
    app: RebaseBackendAppConfig;
    /** Output directory, absolute or relative to the project root. */
    outDir?: string;
    /** Runtime range from the manifest, recorded for compatibility checks. */
    runtimeRange: string;
    /** Skip type checking. Faster, and strictly worse — for iteration only. */
    skipTypeCheck?: boolean;
    /** Skip regenerating the Drizzle schema from the collections. */
    skipSchema?: boolean;
    /** Emit progress. */
    log?: (message: string) => void;
}

export interface BuildBundleResult {
    outDir: string;
    manifest: RebaseBundleManifest;
    collectionCount: number;
}

/** Packages whose presence means the bundle cannot run on a stock runtime image. */
const KNOWN_NATIVE_PACKAGES = new Set([
    "sharp",
    "canvas",
    "bcrypt",
    "argon2",
    "node-sass",
    "sqlite3",
    "better-sqlite3",
    "grpc",
    "@grpc/grpc-js-native",
    "re2",
    "sodium-native",
    "libpq",
    "pg-native"
]);

/** Dependencies supplied by the runtime image itself, not by the bundle. */
const RUNTIME_PROVIDED = new Set([
    "@rebasepro/server",
    "@rebasepro/types",
    "@rebasepro/client",
    "@rebasepro/common",
    "@rebasepro/utils",
    "hono",
    "@hono/node-server",
    "typescript",
    "tsx"
]);

function log(options: BuildBundleOptions, message: string): void {
    (options.log ?? ((m: string) => console.log(m)))(message);
}

/**
 * Every `node_modules/@types` directory the project can see.
 *
 * Type roots normally resolve by walking up from the tsconfig's own directory,
 * which breaks here for two reasons: the generated config lives in `.rebase/`,
 * and a pnpm workspace puts `@types/node` inside the *package* that depends on
 * it (`config/node_modules/@types`) rather than at the project root. Listing them
 * explicitly, as absolute paths, sidesteps both.
 */
function discoverTypeRoots(projectRoot: string): string[] {
    const candidates: string[] = [];

    for (const relative of [".", "config", "backend", "frontend"]) {
        candidates.push(path.join(projectRoot, relative, "node_modules", "@types"));
    }

    // Walk up as well, for a project nested inside a larger workspace.
    let dir = projectRoot;
    for (let i = 0; i < 4; i++) {
        const parent = path.dirname(dir);
        if (parent === dir) break;
        candidates.push(path.join(parent, "node_modules", "@types"));
        dir = parent;
    }

    return candidates.filter(candidate => fs.existsSync(candidate));
}

/**
 * Read a tsconfig's own `compilerOptions`.
 *
 * Parsed with the project's own TypeScript, because a tsconfig is not JSON: it
 * permits comments and trailing commas. Hand-rolled comment stripping gets this
 * wrong in a way that is easy to miss — a `paths` entry like
 * `"@acme/types/*": ["src/*"]` contains the character sequence that opens a
 * block comment, so a regex happily eats the rest of the file and the result
 * parses as *something*, just not the config the developer wrote.
 *
 * One level only, and only `paths` is used from it.
 */
async function readCompilerOptions(
    projectRoot: string,
    file: string
): Promise<Record<string, unknown> | undefined> {
    if (!fs.existsSync(file)) return undefined;

    const text = fs.readFileSync(file, "utf8");

    try {
        const require = createRequire(path.join(projectRoot, "package.json"));
        const ts = require("typescript") as {
            parseConfigFileTextToJson(fileName: string, text: string): {
                config?: { compilerOptions?: Record<string, unknown> };
                error?: unknown;
            };
        };
        const { config } = ts.parseConfigFileTextToJson(file, text);
        return config?.compilerOptions;
    } catch {
        // TypeScript is not resolvable from the project root. Fall back to
        // stripping whole-line comments only — never block comments, for the
        // reason above — and give up quietly if that still is not valid JSON.
        try {
            const parsed = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as {
                compilerOptions?: Record<string, unknown>;
            };
            return parsed.compilerOptions;
        } catch {
            return undefined;
        }
    }
}

/**
 * Drop path aliases that resolve outside the project.
 *
 * A monorepo commonly aliases its workspace packages to their **source**
 * (`"@acme/types": ["packages/types/src/index.ts"]`) so editors jump to real
 * files. That is right for developing the monorepo and wrong for building a
 * bundle: it drags foreign `.ts` files into the program, none of which are under
 * the project's `rootDir`, and the compile fails on files the developer never
 * asked to build.
 *
 * A bundle is built against *installed packages*. Aliases pointing inside the
 * project are kept, because those are the project's own code.
 */
function filterProjectPaths(
    baseDir: string,
    projectRoot: string,
    paths: Record<string, string[]>,
    baseUrl: string
): { kept: Record<string, string[]>; dropped: string[] } {
    const kept: Record<string, string[]> = {};
    const dropped: string[] = [];

    for (const [alias, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets)) continue;
        const resolved = targets.map(target => path.resolve(baseUrl, target));
        const allInside = resolved.every(target => {
            const relative = path.relative(projectRoot, target);
            return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
        });
        if (allInside) {
            kept[alias] = resolved.map(target => {
                const relative = path.relative(baseDir, target);
                return relative.split(path.sep).join("/");
            });
        } else {
            dropped.push(alias);
        }
    }

    return { kept,
dropped };
}

/**
 * Compose the tsconfig used to compile the bundle.
 *
 * Extends the config package's own tsconfig when there is one, so the project's
 * choices about target, JSX and strictness are respected. It has to be `extends`
 * rather than a copy of `compilerOptions`: TypeScript resolves relative paths
 * against the file they were written in, so copying a value like
 * `baseUrl: "../../"` into a config in a different directory silently repoints
 * it at the wrong place.
 */
async function writeBundleTsconfig(
    projectRoot: string,
    outDir: string,
    includes: string[],
    skipTypeCheck: boolean
): Promise<string> {
    // Paths written *here* resolve against this file's directory. Posix
    // separators, because tsconfig wants them on every platform.
    const tsconfigDir = path.join(projectRoot, ".rebase");
    const fromTsconfig = (target: string): string => {
        const relative = path.relative(tsconfigDir, path.resolve(projectRoot, target));
        return relative.split(path.sep).join("/");
    };

    const configTsconfigPath = path.join(projectRoot, "config", "tsconfig.json");
    const extendsFrom = fs.existsSync(configTsconfigPath)
        ? fromTsconfig(path.join("config", "tsconfig.json"))
        : undefined;

    // Neutralize aliases that escape the project (see `filterProjectPaths`).
    let pathOverrides: Record<string, unknown> = {};
    const baseOptions = await readCompilerOptions(projectRoot, configTsconfigPath);
    if (baseOptions?.paths && typeof baseOptions.paths === "object") {
        const baseDir = path.dirname(configTsconfigPath);
        const baseUrl = path.resolve(
            baseDir,
            typeof baseOptions.baseUrl === "string" ? baseOptions.baseUrl : "."
        );
        const { kept, dropped } = filterProjectPaths(
            tsconfigDir,
            projectRoot,
            baseOptions.paths as Record<string, string[]>,
            baseUrl
        );
        pathOverrides = { baseUrl: fromTsconfig("."),
paths: kept };
        if (dropped.length > 0) {
            console.log(chalk.dim(
                `    ignoring ${dropped.length} path alias(es) pointing outside the project ` +
                `(${dropped.join(", ")}) — resolving those from node_modules instead`
            ));
        }
    }

    const compilerOptions: Record<string, unknown> = {
        // Defaults, used when there is no project tsconfig to extend. When there
        // is one, its values win over these and are overridden only by the block
        // below.
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022"],
        jsx: "react-jsx",
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        forceConsistentCasingInFileNames: true,

        // Everything below is the bundle's contract and is not negotiable.
        rootDir: fromTsconfig("."),
        outDir: fromTsconfig(path.relative(projectRoot, outDir) || "."),
        typeRoots: discoverTypeRoots(projectRoot),
        ...pathOverrides,
        declaration: false,
        declarationMap: false,
        sourceMap: true,
        noEmit: false,
        skipLibCheck: true,
        // The runtime imports the emitted files directly with Node's ESM loader,
        // so they stay ES modules regardless of what the project targets for its
        // own builds.
        allowJs: true,
        ...(skipTypeCheck ? { noCheck: true } : {})
    };

    const tsconfig = {
        ...(extendsFrom ? { extends: extendsFrom } : {}),
        compilerOptions,
        include: includes.map(fromTsconfig),
        exclude: [
            "node_modules",
            "**/*.test.ts",
            "**/*.spec.ts",
            "**/dist/**",
            DEFAULT_BUNDLE_DIR
        ].map(pattern => (pattern.startsWith("**") ? pattern : fromTsconfig(pattern)))
    };

    fs.mkdirSync(tsconfigDir, { recursive: true });
    const tsconfigPath = path.join(tsconfigDir, "tsconfig.bundle.json");
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf8");
    return tsconfigPath;
}

/**
 * Detect native code in the dependency closure.
 *
 * Walks declared runtime dependencies breadth-first through `node_modules`,
 * flagging anything with a `binding.gyp`, a prebuilt `.node` binary, or an
 * install script that builds one. The managed runtime cannot run these: a
 * binary compiled for one image will not load in another, and finding that out
 * at deploy time is far better than in a crash loop.
 *
 * The walk is bounded. A dependency graph can be enormous, and this is a
 * heuristic gate whose false negatives are caught at deploy time anyway.
 */
export function detectNativeDependencies(
    projectRoot: string,
    declared: Record<string, string>,
    limit = 2000
): NativeDependency[] {
    const found: NativeDependency[] = [];
    const seen = new Set<string>();
    const queue = Object.keys(declared);
    let visited = 0;

    const searchRoots = [
        path.join(projectRoot, "node_modules"),
        path.join(projectRoot, "backend", "node_modules"),
        path.join(projectRoot, "config", "node_modules")
    ].filter(dir => fs.existsSync(dir));

    while (queue.length > 0 && visited < limit) {
        const name = queue.shift()!;
        if (seen.has(name)) continue;
        seen.add(name);
        visited++;

        if (KNOWN_NATIVE_PACKAGES.has(name)) {
            found.push({ name,
reason: "known native module" });
            continue;
        }

        const packageDir = searchRoots
            .map(root => path.join(root, ...name.split("/")))
            .find(dir => fs.existsSync(path.join(dir, "package.json")));

        if (!packageDir) continue;

        let pkg: {
            dependencies?: Record<string, string>;
            scripts?: Record<string, string>;
            gypfile?: boolean;
        };
        try {
            pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
        } catch {
            continue;
        }

        if (pkg.gypfile || fs.existsSync(path.join(packageDir, "binding.gyp"))) {
            found.push({ name,
reason: "builds a native addon (binding.gyp)" });
            continue;
        }

        const install = `${pkg.scripts?.install ?? ""} ${pkg.scripts?.preinstall ?? ""} ${pkg.scripts?.postinstall ?? ""}`;
        if (/node-gyp|prebuild|node-pre-gyp|cmake-js/.test(install)) {
            found.push({ name,
reason: "install script compiles native code" });
            continue;
        }

        if (hasNodeBinary(packageDir)) {
            found.push({ name,
reason: "ships a prebuilt .node binary" });
            continue;
        }

        for (const dep of Object.keys(pkg.dependencies ?? {})) {
            if (!seen.has(dep)) queue.push(dep);
        }
    }

    return found;
}

/** Shallow scan for `.node` binaries — deep enough for the usual `build/Release`. */
function hasNodeBinary(dir: string, depth = 0): boolean {
    if (depth > 3) return false;
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return false;
    }
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".node")) return true;
        if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".bin") {
            if (hasNodeBinary(path.join(dir, entry.name), depth + 1)) return true;
        }
    }
    return false;
}

/**
 * Whether a dependency name resolves to a package *inside this repository* — a
 * workspace package rather than a registry one.
 *
 * The bundle's declared deps are installed with `npm install` from the public
 * registry beside the bundle at boot. A workspace package is not there, so
 * declaring it guarantees a boot-time install failure. The most common case is
 * the standard `config` package: the backend depends on it by name, but it is
 * *carried in the bundle* (as `entry.config`), so it must never also be an npm
 * dependency. Projects often express this as a `workspace:` range — caught
 * separately — but a plain `"*"` against a workspace symlink is just as common
 * and looks like a registry range, so the symlink is what actually settles it.
 *
 * Detection: the installed `node_modules/<name>` is a symlink whose real path is
 * inside the project and not within a pnpm virtual store (`.pnpm`). That is
 * exactly a workspace link and nothing else.
 */
function resolvesToWorkspacePackage(projectRoot: string, name: string): boolean {
    // Resolve the root's own symlinks too: on macOS a temp/checkout path under
    // `/var/...` realpaths to `/private/var/...`, so comparing a realpath'd link
    // target against a non-realpath'd root would never match.
    let realRoot: string;
    try {
        realRoot = fs.realpathSync(projectRoot);
    } catch {
        realRoot = projectRoot;
    }

    for (const base of [projectRoot, path.join(projectRoot, "backend"), path.join(projectRoot, "config")]) {
        const link = path.join(base, "node_modules", name);
        try {
            // A workspace link is a *symlink*; a normal (non-pnpm) registry
            // install is a real directory inside node_modules, which would also
            // sit "inside the repo" — so the symlink is what separates the two.
            if (!fs.lstatSync(link).isSymbolicLink()) continue;
            const real = fs.realpathSync(link);
            const insideRepo = real.startsWith(realRoot + path.sep);
            // pnpm links registry packages into its virtual store; those live
            // under node_modules/.pnpm and are not workspace packages.
            const inStore = real.includes(`${path.sep}.pnpm${path.sep}`)
                || real.includes(`${path.sep}node_modules${path.sep}`);
            if (insideRepo && !inStore) return true;
        } catch {
            // No such entry, broken link, or race: let it be declared.
        }
    }
    return false;
}

/**
 * Collect the runtime dependencies a bundle needs installed beside it.
 *
 * Packages the runtime image already provides are excluded — reinstalling a
 * second copy of the server next to the one running the process is at best
 * wasted space and at worst a version conflict. Workspace packages are excluded
 * too: they are not on the registry the runtime installs from, and the project's
 * own config package already travels inside the bundle.
 */
export function collectDeclaredDependencies(projectRoot: string): Record<string, string> {
    const declared: Record<string, string> = {};

    for (const relative of ["backend/package.json", "config/package.json", "package.json"]) {
        const file = path.join(projectRoot, relative);
        if (!fs.existsSync(file)) continue;
        try {
            const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as {
                dependencies?: Record<string, string>;
            };
            for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
                if (RUNTIME_PROVIDED.has(name)) continue;
                // A workspace protocol means nothing outside this repository.
                if (typeof version === "string" && version.startsWith("workspace:")) continue;
                // A plain range that nonetheless resolves to an in-repo workspace
                // package (e.g. `"config": "*"` symlinked to `../../config`) —
                // the runtime cannot install it from the registry.
                if (resolvesToWorkspacePackage(projectRoot, name)) continue;
                declared[name] = version;
            }
        } catch {
            // Unparseable package.json: nothing to declare from it.
        }
    }

    return declared;
}

/**
 * Rewrite relative import specifiers in emitted JavaScript so Node can resolve them.
 *
 * TypeScript deliberately does not touch specifiers: `moduleResolution: "bundler"`
 * lets a project write `from "./posts"` or `from "./collections"`, and TypeScript
 * emits them unchanged on the assumption that a bundler will finish the job.
 * Nothing bundles a Rebase bundle — the runtime imports these files directly with
 * Node's ESM loader, which requires a full path with an extension and refuses
 * directory imports outright.
 *
 * Without this, adopting the bundle would mean asking every project written in
 * the (extremely common) extensionless style to rewrite all of its imports. The
 * rewrite is mechanical and verifiable: only relative specifiers are touched, and
 * only when the target file actually exists on disk.
 */
export function normalizeEsmSpecifiers(outDir: string): { rewritten: number; unresolved: string[] } {
    const unresolved: string[] = [];
    let rewritten = 0;

    // The specifier of a static import/export, a bare side-effect import, or a
    // dynamic import. Emitted output is not minified, so these forms are stable.
    const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.[^"']*)\2/g;

    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules") continue;
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith(".js")) {
                rewriteFile(full);
            }
        }
    };

    const rewriteFile = (file: string): void => {
        const original = fs.readFileSync(file, "utf8");
        const dir = path.dirname(file);

        const updated = original.replace(SPECIFIER, (match, prefix, quote, specifier) => {
            // Already resolvable: has a real extension.
            if (/\.(js|mjs|cjs|json|node)$/.test(specifier)) return match;

            const target = path.resolve(dir, specifier);

            if (fs.existsSync(`${target}.js`)) {
                rewritten++;
                return `${prefix}${quote}${specifier}.js${quote}`;
            }
            if (fs.existsSync(path.join(target, "index.js"))) {
                rewritten++;
                const suffix = specifier.endsWith("/") ? "index.js" : "/index.js";
                return `${prefix}${quote}${specifier}${suffix}${quote}`;
            }

            // A `.ts` extension written explicitly in source becomes `.js` on disk.
            if (specifier.endsWith(".ts") && fs.existsSync(`${target.slice(0, -3)}.js`)) {
                rewritten++;
                return `${prefix}${quote}${specifier.slice(0, -3)}.js${quote}`;
            }

            unresolved.push(`${path.basename(file)} → ${specifier}`);
            return match;
        });

        if (updated !== original) {
            fs.writeFileSync(file, updated, "utf8");
        }
    };

    if (fs.existsSync(outDir)) walk(outDir);
    return { rewritten,
unresolved };
}

/**
 * Remove a previous build so stale output cannot masquerade as current.
 *
 * The containment check matters because this is a recursive force-delete of a
 * path that came from a command-line flag: `rebase build --out ../..` would
 * otherwise erase the parent of the project. The manifest's own paths are
 * checked the same way; a flag deserves no less.
 */
function cleanOutDir(projectRoot: string, outDir: string): void {
    const relative = path.relative(projectRoot, outDir);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(
            `Refusing to build into "${outDir}": the output directory must be inside the project.`
        );
    }

    if (fs.existsSync(outDir)) {
        fs.rmSync(outDir, { recursive: true,
force: true });
    }
    fs.mkdirSync(outDir, { recursive: true });
}

/**
 * Regenerate the Drizzle schema from the collections.
 *
 * Delegated to the database driver's own CLI — the same code `rebase schema
 * generate` runs — so there is one implementation of what a schema is. When no
 * driver is resolvable the build continues with a warning rather than failing:
 * a `baas` project has no schema to generate, and a project mid-install should
 * get a clear message rather than a hard stop.
 */
async function regenerateSchema(
    projectRoot: string,
    configDir: string,
    options: BuildBundleOptions
): Promise<void> {
    const backendDir = path.join(projectRoot, "backend");
    if (!fs.existsSync(backendDir)) return;

    const plugin = getActiveBackendPlugin(backendDir);
    const script = plugin ? resolvePluginCliScript(backendDir, plugin) : null;
    if (!script) {
        log(options, chalk.dim("  (no database driver found — skipping schema generation)"));
        return;
    }

    const runner = script.endsWith(".ts") ? resolveTsx(projectRoot) : "node";
    if (!runner) {
        log(options, chalk.dim("  (tsx not installed — skipping schema generation)"));
        return;
    }

    const collectionsPath = path.join("..", configDir, "collections");
    try {
        await execa(
            runner,
            [script, "schema", "generate", "--collections", collectionsPath],
            { cwd: backendDir,
stdio: "pipe" }
        );
        log(options, chalk.dim("  regenerated database schema from collections"));
    } catch (err) {
        // A schema that cannot be generated means the bundle would carry a stale
        // one, and a stale schema is how a deploy quietly writes to the wrong
        // columns. Fail rather than ship it.
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
            `Schema generation failed, so the bundle was not written.\n${detail}\n` +
            "Run `rebase schema generate` to see the full output, or pass --skip-schema " +
            "if the committed schema is deliberately hand-maintained."
        );
    }
}

/**
 * Compile and assemble a bundle.
 */
export async function buildBundle(options: BuildBundleOptions): Promise<BuildBundleResult> {
    const { projectRoot, app, appName } = options;
    const paths = resolveBackendPaths(app);
    const outDir = path.resolve(projectRoot, options.outDir ?? DEFAULT_BUNDLE_DIR);

    const includes: string[] = [];
    const addIfExists = (relative: string, pattern: string): void => {
        if (fs.existsSync(path.join(projectRoot, relative))) includes.push(pattern);
    };

    if (paths.mode === "cms") {
        addIfExists(paths.config, `${paths.config}/**/*.ts`);
    }
    addIfExists(paths.functions, `${paths.functions}/**/*.ts`);
    addIfExists(paths.crons, `${paths.crons}/**/*.ts`);
    if (fs.existsSync(path.join(projectRoot, paths.schema))) {
        includes.push(paths.schema);
    }

    if (includes.length === 0) {
        throw new Error(
            `Nothing to build for app "${appName}". Expected a config directory at ` +
            `"${paths.config}" or functions at "${paths.functions}".`
        );
    }

    // Regenerate the Drizzle schema from the collections first.
    //
    // The template's backend build did this, so a project moving to the bundle
    // flow would otherwise silently ship whatever `schema.generated.ts` happened
    // to be on disk — stale by exactly the edits just made.
    if (paths.mode === "cms" && options.skipSchema !== true) {
        await regenerateSchema(projectRoot, paths.config, options);
    }

    log(options, chalk.dim(`  compiling ${includes.length} source group(s) → ${path.relative(projectRoot, outDir)}/`));

    cleanOutDir(projectRoot, outDir);
    const tsconfigPath = await writeBundleTsconfig(projectRoot, outDir, includes, options.skipTypeCheck === true);

    const tsc = resolveLocalBin(projectRoot, "tsc");
    if (!tsc) {
        throw new Error(
            "TypeScript is not installed in this project. Run your package manager's install first."
        );
    }

    try {
        await execa(tsc, ["-p", tsconfigPath], { cwd: projectRoot,
stdio: "inherit" });
    } catch {
        throw new Error("TypeScript compilation failed — the bundle was not written.");
    }

    // Node resolves these files directly, so their specifiers must be complete.
    const normalized = normalizeEsmSpecifiers(outDir);
    if (normalized.rewritten > 0) {
        log(options, chalk.dim(`  resolved ${normalized.rewritten} relative import(s) for Node ESM`));
    }
    if (normalized.unresolved.length > 0) {
        console.log(chalk.yellow(
            `  ⚠ ${normalized.unresolved.length} import(s) could not be resolved to a file:`
        ));
        for (const item of normalized.unresolved.slice(0, 5)) {
            console.log(chalk.dim(`      ${item}`));
        }
        if (normalized.unresolved.length > 5) {
            console.log(chalk.dim(`      … and ${normalized.unresolved.length - 5} more`));
        }
    }

    // ── Inspect what was produced ────────────────────────────────────────────
    const compiledConfigDir = path.join(outDir, paths.config);
    const compiledCollectionsDir = path.join(compiledConfigDir, "collections");

    let collections: CollectionConfig[] = [];
    if (paths.mode === "cms") {
        collections = await loadSourceCollections(path.join(projectRoot, paths.config, "collections"));
        if (collections.length === 0) {
            throw new Error(
                "No collections were found in " +
                `${path.join(paths.config, "collections")}. ` +
                "A cms-mode project must define at least one collection."
            );
        }
        if (!fs.existsSync(compiledCollectionsDir)) {
            throw new Error(
                "Compilation produced no collections directory at " +
                `${path.relative(projectRoot, compiledCollectionsDir)}.`
            );
        }
    }

    const declared = collectDeclaredDependencies(projectRoot);
    const nativeModules = detectNativeDependencies(projectRoot, declared);

    const schemaOut = paths.schema.replace(/\.ts$/, ".js");
    const relative = (target: string): string | undefined =>
        fs.existsSync(path.join(outDir, target)) ? target : undefined;

    const manifest: RebaseBundleManifest = {
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime: {
            range: options.runtimeRange,
            builtAgainst: resolveServerVersion(projectRoot),
            contract: RUNTIME_CONTRACT_VERSION
        },
        // A `baas` build genuinely does not know the schema — collections are
        // introspected from the live database at boot. Recording a version here
        // would stamp the hash of an empty list, and the runtime would then
        // serve that as the identity of whatever it actually found. Empty means
        // "ask the runtime", which is the honest answer.
        schemaVersion: paths.mode === "baas" ? "" : computeSchemaVersion(collections),
        app: appName,
        mode: paths.mode,
        entry: {
            config: paths.mode === "cms" ? relative(paths.config) : undefined,
            collections: paths.mode === "cms" ? relative(path.join(paths.config, "collections")) : undefined,
            functions: relative(paths.functions),
            crons: relative(paths.crons),
            schema: relative(schemaOut),
            usersCollection: paths.mode === "cms"
                ? relative(path.join(paths.config, `${paths.usersCollection}.js`))
                : undefined
        },
        collections: collections
            .map(collection => collection.slug)
            .filter((slug): slug is string => Boolean(slug))
            .sort(),
        hooks: {
            native: nativeModules.length > 0,
            nativeModules: nativeModules.length > 0 ? nativeModules : undefined
        },
        deps: { declared },
        build: {
            cli: resolveCliVersion(),
            node: process.versions.node.split(".")[0],
            createdAt: new Date().toISOString()
        }
    };

    fs.writeFileSync(
        path.join(outDir, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
    );

    // A package.json beside the bundle lets a deployment install exactly the
    // dependencies the project declared, with no access to the repository.
    fs.writeFileSync(
        path.join(outDir, "package.json"),
        `${JSON.stringify({
            name: "rebase-bundle",
            private: true,
            type: "module",
            dependencies: declared
        }, null, 2)}\n`,
        "utf8"
    );

    return { outDir,
manifest,
collectionCount: collections.length };
}

/**
 * Which files in a collections directory are collections.
 *
 * Mirrors the runtime loader's rules exactly, and must keep mirroring them: the
 * set of files counted here decides the schema version, and the runtime decides
 * what it serves the same way. A divergence would show up as a client that is
 * permanently "out of date" against a server that agrees with it.
 *
 * (`._*` guards macOS AppleDouble files, which look like sources and are not.)
 */
function isCollectionSourceFile(name: string): boolean {
    if (name.startsWith(".")) return false;
    if (name.includes(".test.") || name.includes(".spec.")) return false;
    if (name.endsWith(".d.ts")) return false;
    if (name === "index.ts" || name === "index.js") return false;
    return name.endsWith(".ts") || name.endsWith(".js");
}

/**
 * Load collections from **source**, for hashing and for the manifest's slug list.
 *
 * Deliberately not the compiled output. A compiled bundle imports its
 * dependencies from beside itself — that is the whole point of shipping a
 * `package.json` with it — but at build time nothing has been installed there
 * yet, and under pnpm the project's own `node_modules` lives one directory per
 * package, so the emitted files genuinely cannot resolve their imports until
 * they are deployed.
 *
 * Reading source costs nothing in fidelity: compilation erases types, it does
 * not change the values a collection module exports, so the hash is the same
 * either way.
 */
async function loadSourceCollections(collectionsDir: string): Promise<CollectionConfig[]> {
    if (!fs.existsSync(collectionsDir)) return [];

    const { createJiti } = await import("jiti") as {
        createJiti: (filename: string, options?: Record<string, unknown>) => {
            import: (id: string) => Promise<unknown>;
        };
    };
    const jiti = createJiti(path.join(collectionsDir, "index.ts"), {
        interopDefault: true,
        esmResolve: true
    });

    const files = fs.readdirSync(collectionsDir)
        .filter(isCollectionSourceFile)
        .sort();

    const collections: CollectionConfig[] = [];
    const failures: string[] = [];

    for (const file of files) {
        try {
            const mod = await jiti.import(path.join(collectionsDir, file)) as
                { default?: CollectionConfig } | CollectionConfig;
            const collection = (mod as { default?: CollectionConfig }).default
                ?? (mod as CollectionConfig);
            if (collection && typeof collection === "object" && "slug" in collection) {
                collections.push(collection);
            } else {
                failures.push(`${file}: no default-exported collection`);
            }
        } catch (err) {
            failures.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    if (failures.length > 0) {
        throw new Error(
            `Could not read ${failures.length} collection file(s):\n` +
            failures.map(f => `  • ${f}`).join("\n")
        );
    }

    return collections;
}

/** The `@rebasepro/server` version the project resolves — what it was built against. */
function resolveServerVersion(projectRoot: string): string {
    const candidates = [
        path.join(projectRoot, "node_modules", "@rebasepro", "server", "package.json"),
        path.join(projectRoot, "backend", "node_modules", "@rebasepro", "server", "package.json")
    ];
    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
            return (JSON.parse(fs.readFileSync(candidate, "utf8")) as { version: string }).version;
        } catch {
            // fall through
        }
    }
    return "unknown";
}

function resolveCliVersion(): string {
    try {
        const here = path.dirname(new URL(import.meta.url).pathname);
        let dir = here;
        for (let i = 0; i < 5; i++) {
            const candidate = path.join(dir, "package.json");
            if (fs.existsSync(candidate)) {
                const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as {
                    name?: string;
                    version?: string;
                };
                if (pkg.name === "@rebasepro/cli" && pkg.version) return pkg.version;
            }
            dir = path.dirname(dir);
        }
    } catch {
        // Version is informational; an unknown value must not fail a build.
    }
    return "unknown";
}
