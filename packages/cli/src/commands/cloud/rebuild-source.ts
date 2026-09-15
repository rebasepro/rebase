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
 *    repository.
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
 */
export function neverUploaded(relativePath: string): boolean {
    const segments = relativePath.split("/");
    if (segments.some(segment => segment === "node_modules" || segment === ".git" || segment.startsWith("dist-bundle"))) {
        return true;
    }
    const base = segments[segments.length - 1];
    if (base === ".envrc") return true;
    if ((base === ".env" || base.startsWith(".env.")) && !ENV_TEMPLATES.has(base)) return true;
    return false;
}

/** Directories the walk outside a repository never enters. */
const WALK_SKIP = new Set(["node_modules", ".git", ".rebase", ".turbo", ".next", "coverage"]);

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

/**
 * The files a source upload carries, and where they are rooted.
 *
 * Paths are resolved through `realpath` first: git reports its top level with
 * symlinks resolved (`/private/var/…` for a macOS temp directory), and a
 * project path computed against the unresolved one would climb out of the
 * archive with `../`.
 */
export function listSourceFiles(projectRoot: string, git: GitRunner = runGit): SourceListing {
    const realRoot = fs.realpathSync(projectRoot);

    try {
        const toplevel = git(realRoot, ["rev-parse", "--show-toplevel"]).trim();
        if (toplevel) {
            const root = fs.realpathSync(toplevel);
            const listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
            // `--cached` lists a file once per merge stage during a conflict,
            // and a file deleted from the working tree but still in the index;
            // the set and the disk check take care of both. Submodules and
            // symlinks are listed too, and are not regular files.
            const files = [...new Set(listed.split("\0").filter(Boolean))]
                .filter(relative => !neverUploaded(relative) && isRegularFile(path.join(root, relative)))
                .sort();
            return { root, files, projectPath: toPosix(path.relative(root, realRoot)), fromGit: true };
        }
    } catch {
        // Not a repository, no git, or git refusing the directory: the walk.
    }

    const files: string[] = [];
    const walk = (dir: string, prefix: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (WALK_SKIP.has(entry.name) || entry.name.startsWith("dist")) continue;
                walk(path.join(dir, entry.name), relative);
            } else if (entry.isFile() && !neverUploaded(relative)) {
                files.push(relative);
            }
        }
    };
    walk(realRoot, "");
    return { root: realRoot, files: files.sort(), projectPath: "", fromGit: false };
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
export function packSource(listing: SourceListing, outPath: string): Promise<void> {
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
