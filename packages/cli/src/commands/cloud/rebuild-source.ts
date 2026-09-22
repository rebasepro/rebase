/**
 * The project's source, uploaded beside its bundle so the platform can rebuild it.
 *
 * A managed deploy ships a built bundle, and a bundle is fixed to the framework
 * release it was built on. When the platform rolls a newer release across the
 * fleet it has to rebuild each project from source — and the bundle path never
 * uploaded any: the control plane held a tarball of compiled output and
 * nothing it could compile again. So every bundle deploy now also packs the
 * source the bundle was built from, uploads it, and names it in the trigger.
 *
 * Three rules shape what goes in:
 *
 *  - **Git decides, when there is a repository.** `git ls-files --cached
 *    --others --exclude-standard` at the repository's top level is exactly what
 *    the developer considers source: `.gitignore` honoured the way git honours
 *    it, and a sibling package the project links (`link:../../packages/editor`)
 *    included, because it is outside the project directory but inside the
 *    repository. Outside a repository — or inside one that ignores the project —
 *    the project is walked, and its `.gitignore` files still decide.
 *  - **Secrets never leave the machine, whatever git says.** A committed `.env`
 *    is still a `.env`. {@link neverUploaded} is applied after git, not instead
 *    of it.
 *  - **It never costs the deploy.** The bundle is what runs; the source only
 *    lets a later platform upgrade rebuild it. Too large, unpackable, refused by
 *    the control plane — each is a warning, and the deploy goes on without it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, spawn } from "child_process";
import dotenv from "dotenv";
import type { RebaseProjectManifest } from "@rebasepro/types";
import { cliUserAgent } from "../../utils/version";

/**
 * The control plane's cap on an uploaded source archive.
 *
 * Keep in sync with its build-context cap (deploy/upload `MAX_BYTES` and the
 * backend's `maxBodySize`). Checked before uploading, so an oversized archive is
 * a message in milliseconds rather than a bare 413 after the upload.
 */
export const MAX_SOURCE_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Env files that are templates by convention, and safe to ship. */
const ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template"]);

/**
 * Whether a file must never be uploaded, whatever the ignore rules said.
 *
 * `relativePath` is POSIX. Installed packages, git's own directory and built
 * bundles are never source. Every `.env` and `.env.*` is excluded except the
 * three template names, and so is direnv's `.envrc`, which is the same thing
 * under another name.
 *
 * So is what the CLI keeps on this machine: `.rebase/`, which holds the
 * development database, and the `.rebase-dev-*` files beside it, one of which
 * is the development signing secrets. And so is a `*.dump`, which is what
 * `rebase db backup` writes: every row of the database, `rebase.users`
 * password hashes included.
 */
export function neverUploaded(relativePath: string): boolean {
    const segments = relativePath.split("/");
    if (segments.some(segment =>
        segment === "node_modules" || segment === ".git" || segment === ".rebase" || segment.startsWith("dist-bundle"))) {
        return true;
    }
    const base = segments[segments.length - 1];
    if (base === ".envrc" || base.startsWith(".rebase-dev-") || base.endsWith(".dump")) return true;
    if ((base === ".env" || base.startsWith(".env.")) && !ENV_TEMPLATES.has(base)) return true;
    return false;
}

/** Directories the walk outside a repository never enters. */
const WALK_SKIP = new Set(["node_modules", ".git", ".rebase", ".turbo", ".next", "coverage"]);

/** The same directories as `ls-files` excludes, plus every `dist*` build directory. */
const WALK_EXCLUDES = [...[...WALK_SKIP].map(name => `--exclude=${name}/`), "--exclude=dist*/"];

/** The file that says what a directory's source is not, which a walk has to honour. */
const IGNORE_FILE = ".gitignore";

export interface SourceListing {
    /** The directory the archive is rooted at: the repository's top level, or the project root. */
    root: string;
    /** Regular files to pack, relative to `root`, POSIX, sorted. */
    files: string[];
    /** The project root relative to `root`, POSIX; `""` when they are the same directory. */
    projectPath: string;
    /** Whether git chose the files. */
    fromGit: boolean;
}

/** `git -C <cwd> …`, returning stdout. Throws when git is missing or refuses. */
export type GitRunner = (cwd: string, args: string[]) => string;

const runGit: GitRunner = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    // `ls-files` on a large monorepo is megabytes; the default 1 MiB buffer
    // would kill it and silently fall back to the walk.
    maxBuffer: 256 * 1024 * 1024
});

function toPosix(relative: string): string {
    return relative.split(path.sep).join("/");
}

/** A regular file on disk: not missing, not a directory or submodule, not a symlink. */
function isRegularFile(absolute: string): boolean {
    try {
        return fs.lstatSync(absolute).isFile();
    } catch {
        return false;
    }
}

/** One tree the archive carries: a repository's files, or a walked directory's. */
interface SourceUnit {
    root: string;
    /** Relative to `root`, POSIX. */
    files: string[];
    fromGit: boolean;
}

/** Split `-z` output into its entries. */
function nulSeparated(output: string): string[] {
    return [...new Set(output.split("\0").filter(Boolean))];
}

/**
 * Run `fn` with the git directory of a throwaway, empty repository.
 *
 * `git ls-files` reads `.gitignore` files only inside a repository. Pointed at
 * an empty one with `--git-dir`, and at a directory with `--work-tree`, it lists
 * that directory's files the way git would — nested ignore files, negations and
 * the user's global excludes included — without the directory being a
 * repository, or `git init` touching it.
 */
function withScratchRepository<T>(git: GitRunner, fn: (gitDir: string) => T): T {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ignore-"));
    try {
        git(scratch, ["init", "-q"]);
        return fn(path.join(scratch, ".git"));
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

/**
 * The files of the repository `dir` belongs to — tracked and unignored, the way
 * git sees them — or, when no repository holds it, `dir` walked.
 *
 * A repository that lists nothing under `dir` does not hold it: a project in a
 * directory the surrounding repository ignores (`tmp/my-app` under a repository
 * ignoring `tmp/`) has no repository of its own. Uploading that repository sent
 * everything except the project, so the project is walked instead.
 */
function listUnit(dir: string, git: GitRunner): SourceUnit {
    try {
        const toplevel = git(dir, ["rev-parse", "--show-toplevel"]).trim();
        if (toplevel) {
            const root = fs.realpathSync(toplevel);
            const listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
            // `--cached` lists a file once per merge stage during a conflict,
            // and a file deleted from the working tree but still in the index;
            // the set and the disk check take care of both. Submodules and
            // symlinks are listed too, and are not regular files.
            const files = nulSeparated(listed)
                .filter(relative => !neverUploaded(relative) && isRegularFile(path.join(root, relative)));
            const inside = toPosix(path.relative(root, dir));
            if (inside === "" || files.some(file => file.startsWith(`${inside}/`))) {
                return { root, files, fromGit: true };
            }
        }
    } catch {
        // Not a repository, no git, or git refusing the directory: the walk.
    }
    return { root: dir, files: walkFiles(dir, git), fromGit: false };
}

/**
 * `dir`'s files, walked, with its `.gitignore` files honoured.
 *
 * A scaffold made without `git init` still carries the stock `.gitignore`, and
 * it is the only statement of what in the directory is not source: `backups/`
 * with its database dumps, `uploads/` with the users' files. Git reads it,
 * through a throwaway repository (see {@link withScratchRepository}); a
 * repository nested in `dir` lists as one directory entry, and is listed as the
 * repository it is.
 *
 * Without git the walk has fixed excludes alone, and those cannot read an
 * ignore file. So a directory holding one is refused rather than walked past
 * it — the developer wrote down what must stay on this machine.
 */
function walkFiles(dir: string, git: GitRunner): string[] {
    let listed: string[];
    try {
        listed = withScratchRepository(git, gitDir => nulSeparated(git(dir, [
            `--git-dir=${gitDir}`,
            `--work-tree=${dir}`,
            "ls-files", "-z", "--others", "--exclude-standard", ...WALK_EXCLUDES
        ])));
    } catch {
        return walkWithoutGit(dir);
    }

    const files: string[] = [];
    for (const relative of listed) {
        if (relative.endsWith("/")) {
            // A repository of its own inside the walked directory.
            const nested = listUnit(path.join(dir, relative), git);
            const prefix = toPosix(path.relative(dir, nested.root));
            if (prefix.startsWith("..") || path.isAbsolute(prefix)) continue;
            for (const file of nested.files) files.push(prefix ? `${prefix}/${file}` : file);
        } else if (!neverUploaded(relative) && isRegularFile(path.join(dir, relative))) {
            files.push(relative);
        }
    }
    return files;
}

/** The walk with fixed excludes, for a machine with no git. Refuses a tree with an ignore file in it. */
function walkWithoutGit(dir: string): string[] {
    const files: string[] = [];
    const walk = (current: string, prefix: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (WALK_SKIP.has(entry.name) || entry.name.startsWith("dist")) continue;
                walk(path.join(current, entry.name), relative);
            } else if (entry.isFile() && entry.name === IGNORE_FILE) {
                throw new Error(
                    `${relative} says what is not source, and reading it takes git, which is not available here`
                );
            } else if (entry.isFile() && !neverUploaded(relative)) {
                files.push(relative);
            }
        }
    };
    walk(dir, "");
    return files;
}

/** Whether `candidate` is `dir` or inside it. */
function isWithin(dir: string, candidate: string): boolean {
    const relative = path.relative(dir, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The deepest directory containing every path given. */
function commonAncestor(paths: string[]): string {
    let ancestor = paths[0];
    for (const p of paths.slice(1)) {
        while (!isWithin(ancestor, p)) ancestor = path.dirname(ancestor);
    }
    return ancestor;
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

/**
 * Directories outside every unit that a unit's `package.json` files link to
 * with `link:` or `file:`.
 *
 * `@rebasepro/*` links are not followed. They point at a local framework
 * checkout, which is not the project's source and would drag a whole monorepo
 * into the archive; a rebuild moves those packages to a published release
 * anyway.
 */
function externalLinkTargets(units: SourceUnit[]): string[] {
    const targets = new Set<string>();
    for (const unit of units) {
        for (const relative of unit.files) {
            if (path.posix.basename(relative) !== "package.json") continue;
            let manifest: unknown;
            try {
                manifest = JSON.parse(fs.readFileSync(path.join(unit.root, relative), "utf8"));
            } catch {
                continue;
            }
            if (typeof manifest !== "object" || manifest === null) continue;
            for (const field of DEPENDENCY_FIELDS) {
                const deps = (manifest as Record<string, unknown>)[field];
                if (typeof deps !== "object" || deps === null) continue;
                for (const [name, spec] of Object.entries(deps)) {
                    if (name.startsWith("@rebasepro/") || typeof spec !== "string") continue;
                    const match = /^(?:link|file):(.+)$/.exec(spec);
                    if (!match) continue;
                    const target = path.resolve(unit.root, path.posix.dirname(relative), match[1]);
                    let real: string;
                    try {
                        real = fs.realpathSync(target);
                        if (!fs.statSync(real).isDirectory()) continue;
                    } catch {
                        continue;
                    }
                    if (!units.some(u => isWithin(u.root, real))) targets.add(real);
                }
            }
        }
    }
    return [...targets];
}

/**
 * The files a source upload carries, and where they are rooted.
 *
 * The project's repository first — or the project walked, outside git. Then
 * every repository a local `link:`/`file:` dependency reaches outside it, until
 * nothing new is reached, rooted together at their deepest common directory.
 * That is dadaki's shape: its Rebase project is a repository of its own, nested
 * inside the editor's repository (which ignores it), and its frontend links
 * `../../packages/editor` from there. A listing of the project's repository
 * alone rebuilt into "Rollup failed to resolve import @dadaki/editor".
 *
 * Paths are resolved through `realpath` first: git reports its top level with
 * symlinks resolved (`/private/var/…` for a macOS temp directory), and a
 * project path computed against the unresolved one would climb out of the
 * archive with `../`.
 */
export function listSourceFiles(projectRoot: string, git: GitRunner = runGit): SourceListing {
    const realRoot = fs.realpathSync(projectRoot);
    const units: SourceUnit[] = [listUnit(realRoot, git)];
    for (let reached = externalLinkTargets(units); reached.length > 0; reached = externalLinkTargets(units)) {
        for (const target of reached) {
            if (units.some(u => isWithin(u.root, target))) continue;
            units.push(listUnit(target, git));
        }
    }

    const root = commonAncestor(units.map(u => u.root));
    const files = new Set<string>();
    for (const unit of units) {
        const prefix = toPosix(path.relative(root, unit.root));
        for (const file of unit.files) files.add(prefix ? `${prefix}/${file}` : file);
    }
    return {
        root,
        files: [...files].sort(),
        projectPath: toPosix(path.relative(root, realRoot)),
        fromGit: units.every(u => u.fromGit)
    };
}

/** The per-directory file of patterns a `--source` build context leaves out, beside `.gitignore`. */
const CONTEXT_IGNORE_FILE = ".rebaseignore";

/**
 * The files of a `--source` build context: `dir` and what is under it, relative
 * to it, POSIX, sorted.
 *
 * The same rules as the rebuild source — git decides, and {@link neverUploaded}
 * after it — restricted to `dir`, which is the context's root, so a Dockerfile
 * in it still reads its paths from there. A `dir` that is a subfolder of a
 * repository is held to that repository's `.gitignore`, which is where a
 * monorepo keeps it.
 *
 * `.rebaseignore` in `dir` leaves out more, read with `.gitignore` syntax and
 * anchored at `dir`. It needs git to be read, like `.gitignore` outside a
 * repository; without git, a context that has one is refused.
 */
export function listContextFiles(dir: string, git: GitRunner = runGit): string[] {
    const root = fs.realpathSync(dir);
    const unit = listUnit(root, git);
    const prefix = toPosix(path.relative(unit.root, root));
    let files = prefix === ""
        ? unit.files
        : unit.files.filter(file => file.startsWith(`${prefix}/`)).map(file => file.slice(prefix.length + 1));

    const contextIgnore = path.join(root, CONTEXT_IGNORE_FILE);
    if (fs.existsSync(contextIgnore)) {
        // Everything under `dir` the patterns match — the only patterns read,
        // since `--exclude-standard` is not passed — through a throwaway
        // repository, so they anchor at `dir` whatever repository holds it.
        const ignored = new Set(withScratchRepository(git, gitDir => nulSeparated(git(root, [
            `--git-dir=${gitDir}`,
            `--work-tree=${root}`,
            "ls-files", "-z", "--others", "--ignored", `--exclude-from=${contextIgnore}`
        ]))));
        files = files.filter(file => !ignored.has(file));
    }
    return [...files].sort();
}

/**
 * Pack a listing into a gzipped tarball at `outPath`.
 *
 * The list goes to tar as a NUL-separated file (`--null -T`), so a path with a
 * space or a newline in it is one path. `--no-xattrs` and `COPYFILE_DISABLE`
 * keep macOS's extended attributes and AppleDouble `._*` sidecars out of the
 * archive, as `packBundle` does; GNU tar accepts both. Every path handed to tar
 * is absolute, because GNU tar resolves a `-T` file after it has applied `-C`.
 */
export function packSource(listing: Pick<SourceListing, "root" | "files">, outPath: string): Promise<void> {
    const listPath = `${outPath}.files`;
    fs.writeFileSync(listPath, listing.files.map(file => `${file}\0`).join(""));
    return new Promise<void>((resolve, reject) => {
        const child = spawn(
            "tar",
            ["-czf", path.resolve(outPath), "--no-xattrs", "--null", "-C", listing.root, "-T", path.resolve(listPath)],
            { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, COPYFILE_DISABLE: "1" } }
        );
        let stderr = "";
        child.stderr.on("data", chunk => (stderr += String(chunk)));
        child.on("error", reject);
        child.on("close", code => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `tar exited ${code}`))));
    }).finally(() => fs.rmSync(listPath, { force: true }));
}

/** Upload a source archive; returns the control plane's id for it. */
export async function uploadRebuildSource(url: string, token: string, projectId: string, tarPath: string): Promise<string> {
    const bytes = fs.readFileSync(tarPath);
    const res = await fetch(`${url}/api/functions/deploy/source/upload?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/gzip",
            "User-Agent": cliUserAgent()
        },
        body: bytes
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`the upload was refused (${res.status}): ${body || res.statusText}`);
    }
    const data: unknown = await res.json();
    const sourceId = typeof data === "object" && data !== null && "sourceId" in data ? data.sourceId : undefined;
    if (typeof sourceId !== "string" || !/^[0-9a-f]{32}$/i.test(sourceId)) {
        throw new Error("the control plane did not return a source id");
    }
    return sourceId;
}

/** The env files Vite reads for a production build, lowest precedence first. */
const PRODUCTION_ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"];

/**
 * The `VITE_*` values a rebuild of this project's frontend needs.
 *
 * The `.env` files are never uploaded, so the values a static app is built with
 * have to travel separately — and only the `VITE_*` ones, which Vite inlines
 * into the client bundle and are public by construction. Nothing else is read.
 *
 * Read the way Vite reads them for `vite build`: `.env`, `.env.local`,
 * `.env.production`, `.env.production.local`, later winning — from the project
 * root, then from each static app's own `root`, which is where its Vite config
 * usually points. `process.env` wins over every file, as it does in Vite.
 *
 * `VITE_API_URL` is the one exception, taken from `process.env` only.
 * `staticBuildEnv` sets it to `process.env.VITE_API_URL ?? ""` for every
 * static build, so a value in a `.env` file never reaches a deployed bundle —
 * it is the `http://localhost:3001` of local development. Sending it would make
 * the rebuild bake in exactly the address the local build refuses to.
 */
export function collectBuildEnv(
    projectRoot: string,
    appRoots: string[],
    env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
    const collected: Record<string, string> = {};
    const seen = new Set<string>();
    for (const dir of [projectRoot, ...appRoots.map(root => path.resolve(projectRoot, root))]) {
        const resolved = path.resolve(dir);
        if (seen.has(resolved) || !fs.existsSync(resolved)) continue;
        seen.add(resolved);
        for (const name of PRODUCTION_ENV_FILES) {
            let parsed: Record<string, string>;
            try {
                parsed = dotenv.parse(fs.readFileSync(path.join(resolved, name), "utf8"));
            } catch {
                continue;
            }
            for (const [key, value] of Object.entries(parsed)) {
                if (key.startsWith("VITE_")) collected[key] = value;
            }
        }
    }
    delete collected.VITE_API_URL;
    for (const [key, value] of Object.entries(env)) {
        if (key.startsWith("VITE_") && value !== undefined) collected[key] = value;
    }
    return collected;
}

/** The `root` of every static app a manifest declares, in declaration order. */
export function staticAppRoots(manifest: RebaseProjectManifest | undefined): string[] {
    if (!manifest) return [];
    const roots: string[] = [];
    for (const app of Object.values(manifest.apps)) {
        if (app.type === "static" && typeof app.root === "string" && app.root !== "") roots.push(app.root);
    }
    return roots;
}

/** What the deploy trigger carries about an uploaded source. */
export interface RebuildSource {
    sourceId: string;
    projectPath: string;
    buildEnv: Record<string, string>;
}

/** The steps, injectable so a test can fail any one of them. */
export interface RebuildSourceSteps {
    list: (projectRoot: string) => SourceListing;
    pack: (listing: SourceListing, outPath: string) => Promise<void>;
    upload: (url: string, token: string, projectId: string, tarPath: string) => Promise<string>;
}

const DEFAULT_STEPS: RebuildSourceSteps = {
    list: projectRoot => listSourceFiles(projectRoot),
    pack: packSource,
    upload: uploadRebuildSource
};

/**
 * List, pack and upload the project's source. Never throws.
 *
 * Returns what the trigger should carry, or null — after a warning saying why
 * and what it costs — when the source could not be sent. The caller deploys
 * either way.
 */
export async function prepareRebuildSource(opts: {
    projectRoot: string;
    url: string;
    token: string;
    projectId: string;
    manifest?: RebaseProjectManifest;
    progress: (line: string) => void;
    warn: (message: string, hint?: string) => void;
    steps?: Partial<RebuildSourceSteps>;
    maxBytes?: number;
}): Promise<RebuildSource | null> {
    const steps = { ...DEFAULT_STEPS, ...opts.steps };
    const maxBytes = opts.maxBytes ?? MAX_SOURCE_UPLOAD_BYTES;
    const tarPath = path.join(os.tmpdir(), `rebase-rebuild-src-${process.pid}-${Date.now()}.tar.gz`);
    const cost = "Platform upgrades will not rebuild this project until a later deploy uploads its source.";

    try {
        const listing = steps.list(opts.projectRoot);
        await steps.pack(listing, tarPath);
        const size = fs.statSync(tarPath).size;
        const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);
        if (size > maxBytes) {
            opts.warn(
                `The project source is ${mb(size)} MB compressed, over the ${Math.round(maxBytes / 1024 / 1024)} MB ` +
                    `upload limit, so it was not uploaded. ${cost}`,
                listing.fromGit
                    ? "Stop tracking large assets and build output in git, or pass --no-source to skip it on purpose."
                    : "Initialise a git repository with a .gitignore to choose what is source, or pass --no-source."
            );
            return null;
        }
        opts.progress(`  Uploading source (${listing.files.length} files, ${mb(size)} MB)...`);
        const sourceId = await steps.upload(opts.url, opts.token, opts.projectId, tarPath);
        return {
            sourceId,
            projectPath: listing.projectPath,
            buildEnv: collectBuildEnv(opts.projectRoot, staticAppRoots(opts.manifest))
        };
    } catch (err) {
        opts.warn(
            `The project source was not uploaded: ${err instanceof Error ? err.message : String(err)}. ${cost}`,
            "The deploy continues with the bundle alone."
        );
        return null;
    } finally {
        fs.rmSync(tarPath, { force: true });
    }
}
