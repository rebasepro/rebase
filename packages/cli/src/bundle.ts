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
import { spawnSync } from "child_process";
import { execa } from "execa";
import chalk from "chalk";
import {
    BUNDLE_FORMAT_VERSION,
    RUNTIME_CONTRACT_VERSION,
    computeSchemaVersion,
    findStorageSuffixCollision,
    type CollectionConfig,
    type ResourceGraph,
    type NativeDependency,
    type RebaseBundleManifest,
    type RebaseBundleFunction,
    type RebaseBackendAppConfig
} from "@rebasepro/types";
import { resolveBackendPaths } from "./manifest";
import { analyseFunctionsDirectory, summarisePortability } from "./function-portability";
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
    /**
     * The `storage` block of `rebase.json` — which buckets this project uses.
     *
     * Passed in rather than re-read here so `rebase.json` is parsed and validated
     * once, by the command that owns it.
     */
    /**
     * The project's resource graph, derived from its config.
     *
     * Recorded in the bundle manifest so a host can read what the project needs
     * without running it — which is what lets a console show "wants a `media`
     * bucket, has none" before a first deploy has produced anything.
     */
    resources?: ResourceGraph;
    /**
     * Install the declared dependencies into the bundle at build time.
     *
     * Omitted means "when it is safe to" — which is every bundle whose closure
     * has no native code. `false` is the escape hatch for a build that must not
     * shell out to npm at all (an air-gapped CI, a offline reproducibility
     * check); the bundle still works, it simply installs at boot as before.
     */
    vendor?: boolean;
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
    /**
     * Whether the dependency tree was installed into the bundle, and why not
     * when it was not. Reported rather than silent: "your pods will take a
     * minute to start" is a consequence a developer should hear at build time,
     * not discover during an incident.
     */
    vendor: VendorResult;
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
 * Whether the compiled config package exports a `storageAuthorize` hook.
 *
 * Recorded in the manifest so a host can refuse a deploy that would enable file
 * storage with no access model, rather than let the runtime's boot guard turn it
 * into a crash loop the developer cannot read.
 *
 * Read from the *compiled* index, deliberately: that is the exact module the
 * runtime imports and reads the export off, so this cannot disagree with what
 * actually happens at boot. It is a textual check rather than an import because
 * a freshly built bundle cannot resolve its own dependencies until it is
 * deployed — the same reason schema hashing reads source.
 *
 * Errs toward `false`: a missed detection costs a deploy rejection whose message
 * says exactly how to proceed, while a false positive would hand back the crash
 * loop this exists to prevent.
 */
export function detectStorageAuthorize(compiledConfigDir: string, depth = 0): boolean {
    const indexPath = [".js", ".mjs", ".ts"]
        .map(ext => path.join(compiledConfigDir, `index${ext}`))
        .find(candidate => fs.existsSync(candidate));
    if (!indexPath) return false;
    return moduleExportsStorageAuthorize(indexPath, depth);
}

/**
 * Whether one compiled module re-exports or defines `storageAuthorize`.
 *
 * Split out from {@link detectStorageAuthorize} so a wildcard re-export can be
 * followed. `export * from "./storage.js"` is an ordinary way to write a config
 * barrel, and treating it as "no hook" rejected deploys that were correct — with
 * a message telling the developer to add a hook they had already written.
 */
function moduleExportsStorageAuthorize(modulePath: string, depth: number): boolean {
    let source: string;
    try {
        source = fs.readFileSync(modulePath, "utf8");
    } catch {
        return false;
    }

    // `export const/let/var/function/async function storageAuthorize`
    if (/\bexport\s+(?:async\s+)?(?:const|let|var|function)\s+storageAuthorize\b/.test(source)) {
        return true;
    }
    // `export { storageAuthorize }` / `export { x as storageAuthorize }`,
    // including re-export forms (`export { storageAuthorize } from "./storage"`).
    for (const clause of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
        const names = clause[1].split(",").map(entry => {
            const parts = entry.split(/\bas\b/);
            return parts[parts.length - 1].trim();
        });
        if (names.includes("storageAuthorize")) return true;
    }

    // `export * from "./storage.js"` — follow it. Bounded to a few levels: a
    // barrel of barrels is realistic, an infinite chain is not, and the cost of
    // giving up is a rejection message rather than a wrong answer.
    if (depth < 3) {
        for (const clause of source.matchAll(/\bexport\s*\*\s*from\s*["']([^"']+)["']/g)) {
            const specifier = clause[1];
            if (!specifier.startsWith(".")) continue;
            const resolved = resolveRelativeModule(path.dirname(modulePath), specifier);
            if (resolved && moduleExportsStorageAuthorize(resolved, depth + 1)) return true;
        }
    }
    return false;
}

/**
 * Resolve a relative ESM specifier to a file on disk.
 *
 * Compiled output carries explicit `.js` extensions, but the same function reads
 * TypeScript sources during a source boot, where the specifier may be
 * extensionless or point at a directory index.
 */
function resolveRelativeModule(fromDir: string, specifier: string): string | null {
    const base = path.resolve(fromDir, specifier);
    const candidates = [
        base,
        `${base}.js`,
        `${base}.mjs`,
        `${base}.ts`,
        path.join(base, "index.js"),
        path.join(base, "index.mjs"),
        path.join(base, "index.ts")
    ];
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
        } catch {
            continue;
        }
    }
    // A `.js` specifier that only exists as `.ts` — the shape every compiled-from-
    // TypeScript barrel has when this runs against sources rather than output.
    if (/\.js$/.test(base)) {
        const asTs = base.replace(/\.js$/, ".ts");
        try {
            if (fs.existsSync(asTs) && fs.statSync(asTs).isFile()) return asTs;
        } catch {
            return null;
        }
    }
    return null;
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

/** One `@rebasepro/*` dependency as some package.json in the project declares it. */
export interface DeclaredFrameworkDep {
    name: string;
    range: string;
    /** Project-relative package.json it was declared in. */
    file: string;
}

export interface FrameworkDepDrift {
    /** Declared at a version that can never reach the CLI's own. */
    behind: DeclaredFrameworkDep[];
    /**
     * The distinct lower bounds found across all declared `@rebasepro/*`, when
     * there is more than one — the project is pinning mixed-era framework
     * packages against each other.
     */
    disagreeing: string[];
}

/**
 * Lowest version a range could resolve to, or null if it is not a range.
 *
 * Kept deliberately tiny and local. The published range grammar here is a caret,
 * a tilde, an exact version or a `>=` floor, and the alternative — a semver
 * dependency in the CLI — buys breadth this does not need.
 */
function lowerBoundOf(range: string): [number, number, number] | null {
    const raw = range.trim().replace(/^[\^~]/, "").replace(/^>=\s*/, "").replace(/^v/, "");
    if (!/^\d+(\.\d+){0,2}$/.test(raw)) return null;
    const [major, minor = 0, patch = 0] = raw.split(".").map(Number);
    return [major, minor, patch];
}

/** Highest version a range could resolve to (exclusive), or null. */
function upperBoundOf(range: string): [number, number, number] | null {
    const trimmed = range.trim();
    const min = lowerBoundOf(trimmed);
    if (!min) return null;
    if (trimmed.startsWith(">=")) return null; // open — reaches anything
    const [major, minor, patch] = min;
    if (trimmed.startsWith("^")) {
        if (major > 0) return [major + 1, 0, 0];
        if (minor > 0) return [0, minor + 1, 0];
        return [0, 0, patch + 1];
    }
    if (trimmed.startsWith("~")) {
        return trimmed.replace(/^~v?/, "").split(".").length >= 2
            ? [major, minor + 1, 0]
            : [major + 1, 0, 0];
    }
    const parts = trimmed.replace(/^v/, "").split(".").length;
    if (parts === 1) return [major + 1, 0, 0];
    if (parts === 2) return [major, minor + 1, 0];
    return [major, minor, patch + 1];
}

function compareTriples(a: [number, number, number], b: [number, number, number]): number {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
}

/**
 * Whether a declared range could EVER resolve at or above `target`.
 *
 * The same question the control plane asks at intake, asked here first. Only a
 * range whose entire span sits below the target is reported — `^0.10.0` can
 * never cross to 0.12 whatever npm publishes — because a false alarm on a build
 * that would have worked trains people to ignore the warning that matters.
 */
function canReach(range: string, target: string): boolean | null {
    const ceiling = upperBoundOf(range);
    const floor = lowerBoundOf(target);
    if (!floor || !lowerBoundOf(range)) return null;
    if (!ceiling) return true;
    return compareTriples(ceiling, floor) > 0;
}

/**
 * Find `@rebasepro/*` dependencies pinned to a version older than this CLI.
 *
 * This is the only place a developer can be told. In development, every
 * `@rebasepro/*` resolves through pnpm's `link:`/`workspace:` overrides to the
 * checkout, so the version STRINGS in package.json are never exercised — the
 * project runs fine locally on whatever is on disk, and the declared numbers are
 * first honoured when the runtime npm-installs them from a bundle in the cloud.
 * A project scaffolded at 0.10.0 therefore keeps working on a developer's
 * machine indefinitely while being, in the cloud, a 0.10.0 driver.
 *
 * That matters because the image supplies only `@rebasepro/server`; the database
 * driver comes from these declarations and a newer runtime never updates it.
 * Every package.json is scanned, `dependencies` and `devDependencies` both,
 * because they have to be bumped together and the one that gets forgotten is the
 * one nobody looks at.
 */
export function detectFrameworkDepDrift(projectRoot: string, cliVersion: string): FrameworkDepDrift {
    const found: DeclaredFrameworkDep[] = [];

    for (const relative of [
        "package.json",
        "backend/package.json",
        "config/package.json",
        "frontend/package.json"
    ]) {
        const file = path.join(projectRoot, relative);
        if (!fs.existsSync(file)) continue;
        try {
            const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };
            for (const block of [pkg.dependencies, pkg.devDependencies]) {
                for (const [name, range] of Object.entries(block ?? {})) {
                    if (!name.startsWith("@rebasepro/")) continue;
                    if (typeof range !== "string") continue;
                    found.push({ name,
range,
file: relative });
                }
            }
        } catch {
            // Unparseable package.json: nothing to judge from it.
        }
    }

    const behind = found.filter(d => canReach(d.range, cliVersion) === false);

    // Mixed-era pins. Compared by lower bound rather than by string so `^0.12.0`
    // and `0.12.0` are not reported as a disagreement — they are not one.
    const bounds = new Set(
        found
            .map(d => lowerBoundOf(d.range))
            .filter((b): b is [number, number, number] => b != null)
            .map(b => b.join("."))
    );

    return { behind,
disagreeing: bounds.size > 1 ? [...bounds].sort() : [] };
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
 * A hand-written server entrypoint that a bundle does not use.
 *
 * `rebase dev` runs `backend/src/index.ts` whenever a project has one, so for
 * the whole of local development that file *is* the server and every route
 * written in it works. A bundle has no entrypoint of its own: the runtime boots
 * the bundle and mounts what the manifest points at — the config package,
 * functions, crons and the schema. The file is not compiled, not shipped, and
 * never imported.
 *
 * Nothing said so. A project with custom routes in its entrypoint built clean,
 * deployed green, and answered 404 on every one of them, with the file still
 * sitting in the repository looking exactly like the server.
 *
 * A project that means to own its server process runs `rebase eject`, which
 * writes an entrypoint, a Dockerfile and a compose file together and flips the
 * backend to `runtime: "custom"`. The warning names that route rather than
 * implying the file is a mistake — but eject writes *its* entrypoint, so the
 * warning must not read as "eject will keep what you wrote here".
 */
export function findUnusedServerEntry(projectRoot: string, functionsDir: string): string | undefined {
    // A project that relocated its functions keeps the entrypoint beside them,
    // so the second candidate is derived rather than only the default known.
    const candidates = [
        path.join("backend", "src", "index.ts"),
        path.join(path.dirname(functionsDir), "src", "index.ts")
    ];

    const found = candidates.find(candidate => fs.existsSync(path.join(projectRoot, candidate)));
    return found ? found.split(path.sep).join("/") : undefined;
}

/**
 * Compile and assemble a bundle.
 */
export async function buildBundle(options: BuildBundleOptions): Promise<BuildBundleResult> {
    const { projectRoot, app, appName } = options;
    const paths = resolveBackendPaths(app, projectRoot);
    const outDir = path.resolve(projectRoot, options.outDir ?? DEFAULT_BUNDLE_DIR);

    const includes: string[] = [];
    const addIfExists = (relative: string, pattern: string): void => {
        if (fs.existsSync(path.join(projectRoot, relative))) includes.push(pattern);
    };

    // The whole config package, not just its collections: a headless project
    // has no `config/collections` but still ships `storageAuthorize` here.
    if (paths.hasConfig) {
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
    if (paths.hasCollections && options.skipSchema !== true) {
        await regenerateSchema(projectRoot, paths.config, options);
    }

    // Say out loud what this build is NOT going to include. See
    // `findUnusedServerEntry` for why silence here was expensive.
    const unusedEntry = findUnusedServerEntry(projectRoot, paths.functions);
    if (unusedEntry) {
        const parts = [
            ...(paths.hasCollections ? [`${paths.config}/`] : []),
            `${paths.functions}/`,
            "the schema"
        ];
        const compiled = `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
        console.log(chalk.yellow(`  ⚠ ${unusedEntry} is not the bundle's entry point — it is not compiled or shipped.`));
        console.log(chalk.dim(`      The runtime boots the bundle itself and mounts ${compiled}.`));
        console.log(chalk.dim(`      Routes defined there will not exist once deployed: move them to ${paths.functions}/,`));
        console.log(chalk.dim("      or run `rebase eject`, which writes an entrypoint of its own and owns"));
        console.log(chalk.dim("      the image — it does not adopt this file, and will not replace it"));
        console.log(chalk.dim("      without --force."));
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
    if (paths.hasCollections) {
        collections = await loadSourceCollections(path.join(projectRoot, paths.config, "collections"));
        if (collections.length === 0) {
            throw new Error(
                "No collections were found in " +
                `${path.join(paths.config, "collections")}. ` +
                "Define at least one collection there, or remove the directory to have the " +
                "runtime introspect collections from the live database instead."
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
    const declaresStorageAuthorize = detectStorageAuthorize(path.join(outDir, paths.config));

    // Resolve the declared buckets now, and refuse the build if two of them would
    // read the same environment variables. Catching it here means a rename, not a
    // tenant that silently served one bucket's files from another's credentials.
    const resourceGraph: ResourceGraph = options.resources ?? { version: 1, resources: [] };
    const storageSources = resourceGraph.resources
        .filter(r => r.kind === "bucket")
        .map(r => ({
            key: r.key,
            engine: r.engine,
            transport: r.transport,
            ...(r.label !== undefined ? { label: r.label } : {})
        }));
    const collision = findStorageSuffixCollision(storageSources.map(s => s.key));
    if (collision) {
        throw new Error(
            `Buckets "${collision.a}" and "${collision.b}" both map to the environment variable ` +
            `suffix "${collision.suffix || "(none)"}", so they would read each other's ` +
            "configuration. Rename one of them."
        );
    }

    const schemaOut = paths.schema.replace(/\.ts$/, ".js");
    const relative = (target: string): string | undefined =>
        fs.existsSync(path.join(outDir, target)) ? target : undefined;

    // What is in the functions directory, and what each one needs from its
    // host. Read from the *source*, not the compiled output, because the answer
    // is about imports and `tsc` has already resolved some of them away.
    const functionReports = analyseFunctionsDirectory(
        path.join(projectRoot, paths.functions),
        projectRoot
    );
    const bundledFunctions: RebaseBundleFunction[] = functionReports.map(report => {
        const requires = [...new Set(
            report.issues
                .filter(issue => issue.kind === "node-builtin" || issue.kind === "node-only-package")
                .map(issue => issue.message)
        )];
        return {
            name: report.name,
            // The path as it exists *in the bundle*: sources are compiled 1:1,
            // so this is the same relative path with a `.js` extension.
            file: report.file.replace(/\.ts$/, ".js"),
            portable: report.portable,
            ...(requires.length > 0 ? { requires } : {})
        };
    });

    for (const line of summarisePortability(functionReports)) {
        console.log(line.trimStart().startsWith("⚠") ? chalk.yellow(line) : chalk.dim(line));
    }

    const manifest: RebaseBundleManifest = {
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime: {
            range: options.runtimeRange,
            builtAgainst: resolveServerVersion(projectRoot),
            contract: RUNTIME_CONTRACT_VERSION
        },
        // A build with no config directory genuinely does not know the schema —
        // collections are introspected from the live database at boot. Recording
        // a version here would stamp the hash of an empty list, and the runtime
        // would then serve that as the identity of whatever it actually found.
        // Empty means "ask the runtime", which is the honest answer.
        schemaVersion: paths.hasCollections ? computeSchemaVersion(collections) : "",
        app: appName,
        kind: "backend",
        entry: {
            config: paths.hasConfig ? relative(paths.config) : undefined,
            collections: paths.hasCollections ? relative(path.join(paths.config, "collections")) : undefined,
            functions: relative(paths.functions),
            crons: relative(paths.crons),
            schema: relative(schemaOut),
            usersCollection: paths.hasCollections
                ? relative(path.join(paths.config, `${paths.usersCollection}.js`))
                : undefined
        },
        collections: collections
            .map(collection => collection.slug)
            .filter((slug): slug is string => Boolean(slug))
            .sort(),
        ...(bundledFunctions.length > 0 ? { functions: bundledFunctions } : {}),
        hooks: {
            native: nativeModules.length > 0,
            nativeModules: nativeModules.length > 0 ? nativeModules : undefined
        },
        storage: {
            // The hook, not the buckets. Those live in `resources` now, with
            // every other kind, so a host reads one list instead of one per
            // kind — which is what let databases and buckets drift apart.
            authorize: declaresStorageAuthorize
        },
        resources: resourceGraph,
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

    const vendor = vendorDependencies({
        outDir,
        declared,
        nativeModules,
        // The driver is the one package the image does not supply, so it is the
        // one a vendored tree must actually contain.
        required: [getActiveBackendPlugin(path.join(projectRoot, "backend"))].filter(
            (name): name is string => Boolean(name)),
        requested: options.vendor
    });
    if (vendor.vendored) {
        manifest.deps.vendored = true;
        manifest.deps.vendorTarget = vendor.target;
        // Rewritten rather than assembled differently above: the install needs
        // the package.json this function already wrote, so the manifest cannot
        // know the answer until afterwards.
        fs.writeFileSync(
            path.join(outDir, "manifest.json"),
            `${JSON.stringify(manifest, null, 2)}\n`,
            "utf8"
        );
    }

    return { outDir,
manifest,
collectionCount: collections.length,
vendor };
}

/** Default install target: what the published runtime image runs. */
export const VENDOR_TARGET_OS = "linux";
export const VENDOR_TARGET_CPU = "x64";

export interface VendorResult {
    vendored: boolean;
    target?: { os: string; cpu: string; node: string };
    /** Why nothing was installed. Present exactly when `vendored` is false. */
    skipped?: string;
    /** Size of the installed tree on disk, when one was installed. */
    bytes?: number;
}

/**
 * Where a vendored bundle starts being too big to upload.
 *
 * The control plane refuses a bundle over 100 MB, and that ceiling is not
 * arbitrary or easily raised: its pod has a 512Mi memory limit and the upload
 * route holds the body while it writes it, so the cap protects the process that
 * also serves the console, deploys and billing. Vendoring is the one change that
 * can push a bundle near it.
 *
 * So the warning is here, at build time, where the remedy is one flag away —
 * rather than at deploy time as a 413 nobody can act on without rebuilding. The
 * threshold sits below the real cap because this measures the tree on disk and
 * the upload is compressed: crossing it means "getting close", not "will fail".
 */
export const VENDOR_SIZE_WARN_BYTES = 150 * 1024 * 1024;

/**
 * Where vendoring stops being an optimisation and becomes a bundle nobody can
 * deploy.
 *
 * Past this, shipping the tree anyway trades a faster cold start for a 413 — and
 * the 413 arrives at deploy time, after a build nobody watches, with a remedy
 * (`--no-vendor`) that requires knowing this happened. Unvendoring here costs
 * 40–60s of cold start and produces a bundle that uploads; that is the better
 * side of the trade to be on by default.
 *
 * 200 MB assumes a **2x** floor on compression, which is pessimistic for a tree
 * of JavaScript (3–5x is typical) and deliberately so: source maps and prebuilt
 * binaries compress far worse than source, and the failure this prevents is
 * asymmetric — a bundle refused at the door versus a minute of cold start.
 * `--vendor` overrides it, for a deploy path with no upload at all (a Dockerfile
 * built from source, where the tree is copied into an image and the control
 * plane never sees it).
 */
export const VENDOR_SIZE_MAX_BYTES = 200 * 1024 * 1024;

/** Bytes on disk under `dir`. Bounded so a pathological tree cannot hang a build. */
function directorySize(dir: string, budget = 200_000): number {
    let total = 0;
    let visited = 0;
    const stack = [dir];
    while (stack.length > 0 && visited < budget) {
        const current = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            visited++;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile()) {
                try {
                    total += fs.statSync(full).size;
                } catch {
                    // A file that vanished between readdir and stat contributes
                    // nothing; it is not worth failing a build over.
                }
            }
        }
    }
    return total;
}

/**
 * Install the bundle's declared dependencies into the bundle itself.
 *
 * ## What this buys
 *
 * A managed pod's bundle lives on an `emptyDir`, so it is re-fetched and
 * re-installed on **every** start — an eviction, a node failure, an OOM, a
 * runtime rollout. The install is 35–55 seconds of a 40–60 second cold start,
 * which makes it the price of every unplanned restart a tenant suffers. Doing it
 * once at build time instead of every time at boot takes that to roughly the
 * cost of untarring.
 *
 * The pod side needs no change to benefit: the init container already skips
 * installing when `node_modules` is present, a guard that existed for
 * pre-baked images and turns out to be exactly the hook this needs.
 *
 * ## Why it refuses to vendor native code
 *
 * A compiled binary is valid only for the platform it was built for, and a
 * developer's machine is rarely the deployment's. The managed runtime already
 * refuses bundles containing native modules for the same reason, so this refusal
 * costs nothing there — but a self-hosted project may legitimately use them, and
 * for those the honest answer is to install in the container, where the platform
 * is known.
 *
 * ## Why `--os` and `--cpu` are not optional
 *
 * The dangerous case is not native code, which is detectable. It is a pure-JS
 * package whose real work lives in a **platform-specific optional dependency** —
 * `esbuild` being the one everybody meets. Installing on an Apple Silicon Mac
 * resolves `@esbuild/darwin-arm64`, produces a tree that looks complete, and
 * fails at import inside a linux/amd64 pod. npm resolves optional dependencies
 * for the declared target rather than the host when told to, so it is told to.
 */
export function vendorDependencies(options: {
    outDir: string;
    declared: Record<string, string>;
    nativeModules: NativeDependency[];
    /**
     * Packages the runtime resolves *from the bundle* and cannot boot without —
     * in practice the database driver, which the image deliberately does not
     * supply. A vendored tree missing one of these is refused; see below.
     */
    required?: string[];
    /** `false` disables; `undefined` means "when it is safe to". */
    requested?: boolean;
    /** Injected in tests. */
    run?: (cmd: string, args: string[], cwd: string) => void;
}): VendorResult {
    if (options.requested === false) {
        return { vendored: false, skipped: "disabled with --no-vendor" };
    }
    if (Object.keys(options.declared).length === 0) {
        // Not a failure and not worth a warning: a project using only what the
        // runtime already provides installs nothing at boot either way.
        return { vendored: false, skipped: "the bundle declares no dependencies" };
    }
    if (options.nativeModules.length > 0) {
        const names = options.nativeModules.map(m => m.name).join(", ");
        return {
            vendored: false,
            skipped:
                `the dependency closure contains native code (${names}), which is only valid on the ` +
                "platform it was compiled for"
        };
    }

    const target = {
        os: VENDOR_TARGET_OS,
        cpu: VENDOR_TARGET_CPU,
        node: process.versions.node.split(".")[0]
    };

    const run = options.run ?? ((cmd, args, cwd) => {
        const result = spawnSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" });
        if (result.error) throw result.error;
        if (result.status !== 0) {
            throw new Error(
                `${cmd} ${args.join(" ")} exited ${result.status}\n${result.stderr || result.stdout || ""}`.trim()
            );
        }
    });

    try {
        run(
            "npm",
            [
                "install",
                "--omit=dev",
                // Matches what the runtime image's entrypoint insists on, and
                // what the init container passes. A bundle whose dependencies
                // ran lifecycle scripts at build time would arrive at the pod
                // carrying whatever they produced.
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                `--os=${target.os}`,
                `--cpu=${target.cpu}`
            ],
            options.outDir
        );
    } catch (error: unknown) {
        // Never fatal. A bundle that could not be vendored is exactly the bundle
        // every project shipped before this existed — slower to start, entirely
        // functional — and failing the build over a speed optimisation would
        // trade a working deploy for a faster one that does not happen.
        return {
            vendored: false,
            skipped: `npm install failed: ${error instanceof Error ? error.message : String(error)}`
        };
    }

    const installed = path.join(options.outDir, "node_modules");
    if (!fs.existsSync(installed)) {
        return { vendored: false, skipped: "npm install produced no node_modules" };
    }

    // An *incomplete* vendored tree is worse than none, because of the very
    // guard that makes vendoring free: the init container skips installing when
    // `node_modules` is present. So a tree missing the database driver does not
    // start slowly — it does not start at all, with the boot dying on
    // `Cannot find package "@rebasepro/server-postgres"`, and the step that
    // would have installed it declining to run precisely because this directory
    // exists.
    //
    // A driver goes missing whenever the project declares it in a way the
    // registry cannot serve — `workspace:*` in a monorepo, a `link:` override —
    // since `collectDeclaredDependencies` drops exactly those. Such a project
    // could never deploy this bundle anyway; what it must not do is have a
    // *build-time* optimisation quietly remove its ability to boot from source.
    // Refusing leaves the bundle in the state every project shipped before
    // vendoring existed.
    const missing = (options.required ?? []).filter(name =>
        !fs.existsSync(path.join(installed, ...name.split("/"), "package.json")));
    if (missing.length > 0) {
        fs.rmSync(installed, { recursive: true, force: true });
        fs.rmSync(path.join(options.outDir, "package-lock.json"), { force: true });
        return {
            vendored: false,
            skipped:
                `the installed tree is missing ${missing.join(", ")}, which the runtime resolves from ` +
                "the bundle — the bundle declares it at a version no registry can serve (a workspace " +
                "link), so nothing was vendored rather than shipping a tree that boots without a driver"
        };
    }

    const bytes = directorySize(installed);
    if (bytes > VENDOR_SIZE_MAX_BYTES && options.requested !== true) {
        fs.rmSync(installed, { recursive: true, force: true });
        fs.rmSync(path.join(options.outDir, "package-lock.json"), { force: true });
        return {
            vendored: false,
            skipped:
                `the installed tree is ${Math.round(bytes / (1024 * 1024))} MB, past the point where the ` +
                "upload can be expected to fit under the control plane's 100 MB limit — a bundle that " +
                "is refused at the door is worse than one that installs at boot. Pass --vendor to keep " +
                "it anyway (a deploy that builds from source never uploads the tree), or shrink the " +
                "declared dependencies"
        };
    }

    return { vendored: true, target, bytes };
}

/**
 * Package a built static app (a `static` or bundled-`admin` app) into a bundle.
 *
 * A static bundle is the counterpart to a backend bundle: the same shape, the
 * same runtime image runs it, but its manifest says `mode: "static"` and it
 * carries only the built assets under `static/`. That is what lets a frontend or
 * admin app be its own deployable, scalable unit rather than something baked into
 * the backend container.
 *
 * `assetsDir` is the app's built output (e.g. `frontend/dist`), already produced
 * by its own build command. This copies it into the bundle and writes the
 * manifest — no compilation, no dependency closure (a static bundle installs
 * nothing at boot).
 */
/**
 * Fold a built static app into a backend bundle, so one runtime serves both.
 *
 * ## Why this exists
 *
 * A managed tenant runs one pod, and `bootFromBundle` on the backend path already
 * knows how to serve a SPA — it looks for `entry.static` and mounts `serveSPA`
 * last, behind `REBASE_SERVE_STATIC`. What was missing was anything putting the
 * assets there.
 *
 * The consequence was not subtle. A project whose custom image served its website
 * at `/` and its API at `/api` — the shape the scaffolded template produces — lost
 * the website the moment it moved to the managed runtime: the API answered
 * perfectly and every page 404'd. Managed could not be a drop-in replacement for
 * custom while the frontend simply vanished.
 *
 * Folding restores parity with the container it replaces, which is the only
 * honest baseline. It is deliberately the FIRST implementation and not the last:
 * a static app on its own bucket behind a CDN is better for cache behaviour and
 * lets the frontend deploy independently. But that needs infrastructure that does
 * not exist yet, and "your site is gone" is not an acceptable state to leave a
 * project in while it gets built.
 *
 * The trade it makes, stated plainly: frontend and backend now deploy together
 * and the bundle carries the built assets. For a project that was shipping both
 * in one image already, that is exactly what it had.
 */
export function foldStaticIntoBundle(options: {
    /** The backend bundle directory, already written. */
    bundleDir: string;
    /** Directory of built frontend assets (the static app's `output`). */
    assetsDir: string;
    /** The app's name in `rebase.json`. Names its directory inside the bundle. */
    appName: string;
    /** Public base path this app is served under. */
    path: string;
    /** Serve `index.html` for unmatched paths under `path`. */
    spa: boolean;
}): { fileCount: number; dir: string } {
    const { bundleDir, assetsDir, appName, path: basePath, spa } = options;
    const manifestPath = path.join(bundleDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`No manifest at ${manifestPath} — build the backend bundle first.`);
    }
    if (!fs.existsSync(assetsDir)) {
        throw new Error(`No built assets at ${assetsDir}.`);
    }

    // Each app gets its own directory, and only its own is cleared. Folding used
    // to wipe `static/` wholesale and write a single `entry.static` string, so a
    // second app silently replaced the first — both in the tree and in the
    // manifest — and the bundle deployed looking complete.
    const dir = path.posix.join("static", appName);
    const staticOut = path.join(bundleDir, "static", appName);
    fs.rmSync(staticOut, { recursive: true,
force: true });
    fs.mkdirSync(staticOut, { recursive: true });
    fs.cpSync(assetsDir, staticOut, { recursive: true });

    let fileCount = 0;
    const count = (target: string): void => {
        for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
            if (entry.isDirectory()) count(path.join(target, entry.name));
            else fileCount++;
        }
    };
    count(staticOut);

    // Record it, because the runtime finds the assets through the manifest —
    // not by guessing a directory name.
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RebaseBundleManifest;
    const existing = (manifest.entry?.static ?? []).filter(entry => entry.dir !== dir);
    manifest.entry = {
        ...manifest.entry,
        static: [...existing, { path: basePath,
dir,
spa }]
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    return { fileCount,
dir };
}

export function buildStaticBundle(options: {
    projectRoot: string;
    appName: string;
    assetsDir: string;
    outDir: string;
    runtimeRange: string;
    /** Public base path. Default `/` — a standalone bundle owns its origin. */
    path?: string;
    /** Serve `index.html` for unmatched paths. Default `true`. */
    spa?: boolean;
}): { outDir: string; manifest: RebaseBundleManifest; fileCount: number } {
    const { projectRoot, appName, assetsDir, outDir, runtimeRange } = options;
    const basePath = options.path ?? "/";

    cleanOutDir(projectRoot, outDir);

    const staticOut = path.join(outDir, "static");
    fs.mkdirSync(staticOut, { recursive: true });
    fs.cpSync(assetsDir, staticOut, { recursive: true });

    let fileCount = 0;
    const count = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) count(path.join(dir, entry.name));
            else fileCount++;
        }
    };
    count(staticOut);

    const manifest: RebaseBundleManifest = {
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime: {
            range: runtimeRange,
            builtAgainst: resolveServerVersion(projectRoot),
            contract: RUNTIME_CONTRACT_VERSION
        },
        // A static app has no collections and therefore no schema contract.
        schemaVersion: "",
        app: appName,
        kind: "static",
        // Normally `/` — a standalone bundle owns its origin. It carries the
        // app's declared path rather than hardcoding one so that the bundle
        // agrees with what the assets were actually *built* for; serving a
        // `/admin`-built app at `/` is the blank-page failure in reverse.
        entry: { static: [{ path: basePath,
dir: "static",
spa: options.spa ?? true }] },
        hooks: { native: false },
        // Nothing to install beside a static bundle — it is just files.
        deps: { declared: {} },
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
    // An empty package.json keeps the runtime's boot-time install a clean no-op.
    fs.writeFileSync(
        path.join(outDir, "package.json"),
        `${JSON.stringify({ name: "rebase-bundle",
private: true,
type: "module",
dependencies: {} }, null, 2)}\n`,
        "utf8"
    );

    return { outDir,
manifest,
fileCount };
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

export function resolveCliVersion(): string {
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
