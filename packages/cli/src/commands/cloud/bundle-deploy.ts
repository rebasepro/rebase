/**
 * Deploying a project as a managed **bundle** rather than a source build.
 *
 * `rebase cloud deploy --bundle` builds the bundle, tars it, uploads it to the
 * control plane's bundle endpoint, and triggers a deploy carrying the bundle id
 * and its generated manifest. The control plane resolves a runtime from the
 * manifest's range and runs the platform image with this bundle — the managed
 * path. A project not in managed mode, or one whose bundle fails intake, is told
 * so by the control plane; this side just packages and hands it over.
 *
 * The pieces here are separated from the network calls so they can be tested: the
 * manifest read, the tar packaging, and the request body assembly are pure enough
 * to check without a control plane.
 */
import fs from "fs";
import path from "path";
import { spawn, execFileSync } from "child_process";
import type { RebaseBundleManifest } from "@rebasepro/types";

/** Read and shallow-validate a built bundle's manifest. */
export function readBundleManifest(bundleDir: string): RebaseBundleManifest {
    const manifestPath = path.join(bundleDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        throw new Error(
            `No manifest.json in ${bundleDir}. Run \`rebase build\` first.`
        );
    }
    let manifest: RebaseBundleManifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RebaseBundleManifest;
    } catch (err) {
        throw new Error(`${manifestPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (typeof manifest.bundleFormat !== "number" || !manifest.runtime?.range) {
        throw new Error(`${manifestPath} is not a valid bundle manifest.`);
    }
    return manifest;
}

/**
 * Tar a built bundle into a gzipped archive.
 *
 * `node_modules` is excluded on purpose: the bundle ships a `package.json`, and
 * the managed runtime installs the declared dependencies at boot. Uploading an
 * installed `node_modules` would bloat the archive and could carry a
 * platform-specific build that will not run on the runtime image.
 */
export function packBundle(bundleDir: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            "tar",
            // `--no-xattrs` (plus COPYFILE_DISABLE) keeps macOS from writing
            // `LIBARCHIVE.xattr.com.apple.provenance` headers into the archive,
            // which GNU tar on the runtime image then warns about once per file.
            // Harmless, but it buries real extraction errors in noise.
            ["-czf", outPath, "--no-xattrs", "--exclude", "node_modules", "-C", bundleDir, "."],
            { stdio: "inherit",
env: { ...process.env,
COPYFILE_DISABLE: "1" } }
        );
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))));
    });
}

/**
 * Assemble the deploy-trigger body for a bundle deploy.
 *
 * The manifest travels with the trigger so the control plane can validate intake
 * without unpacking the uploaded archive first — a rejection (native deps, no
 * matching runtime) is then a fast, cheap answer.
 */
/** The commit a bundle was built from, as far as the working directory knows. */
export interface BundleCommit {
    hash: string;
    message: string;
}

/**
 * The commit HEAD is on, read here because here is the only place it exists.
 *
 * A bundle deploy has no repository anywhere near the control plane: the CLI
 * builds a tarball and uploads it, so the three paths `deploy.ts` documents for
 * learning a commit — clone, `ls-remote`, or "there is no repo at all" — all
 * resolve to the third. Every bundle deployment therefore recorded an empty
 * hash, which is 291 of the 305 rows in production: a Deployments list where
 * almost nothing says what it shipped.
 *
 * But the CLI is standing IN the repository. `git -C <dir> log -1` answers
 * exactly, message included — the one thing even the git-build path cannot get
 * from `ls-remote`.
 *
 * Returns null rather than guessing, for every reason it can fail: no git, not a
 * repository, no commits yet. The server records what it is given and nothing
 * more, so null here stays `UNKNOWN_COMMIT_HASH` there.
 *
 * A dirty tree is NOT reported as a different commit. The bundle may contain
 * uncommitted work, and the honest statement about that is "built from a tree at
 * <hash>", not a fabricated identifier — the same rule the rest of this file
 * follows about inventing values.
 */
export function bundleCommit(cwd: string, run: (args: string[]) => string = gitIn(cwd)): BundleCommit | null {
    try {
        const hash = run(["rev-parse", "--short=7", "HEAD"]).trim();
        if (!/^[0-9a-f]{7,40}$/.test(hash)) return null;
        // `%s` is the subject alone. A full body would put newlines into a
        // single-line column that the console renders in a table row.
        const message = run(["log", "-1", "--pretty=%s"]).trim();
        return { hash, message };
    } catch {
        return null;
    }
}

/** `git -C <cwd> …`, as a function, so `bundleCommit` is testable without a repo. */
function gitIn(cwd: string): (args: string[]) => string {
    return (args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

export function bundleDeployBody(input: {
    projectId: string;
    bundleId: string;
    manifest: RebaseBundleManifest;
    app?: string;
    message?: string;
    /**
     * Every app this repository declares in `rebase.json`, so the platform can
     * register the whole set rather than only the one being deployed.
     */
    declaredApps?: DeclaredApp[];
    /**
     * What HEAD said when this bundle was built, or null outside a repository.
     *
     * Omitted from the body entirely when null — an absent field and an empty
     * one are the same to the server, and sending `""` would make "we did not
     * look" indistinguishable from "we looked and there was nothing".
     */
    commit?: BundleCommit | null;
}): Record<string, unknown> {
    return {
        projectId: input.projectId,
        bundleId: input.bundleId,
        bundleManifest: input.manifest,
        app: input.app ?? input.manifest.app ?? "backend",
        client: "cli",
        frameworkVersion: input.manifest.runtime?.builtAgainst,
        ...(input.declaredApps?.length ? { declaredApps: input.declaredApps } : {}),
        ...(input.message ? { message: input.message } : {}),
        ...(input.commit
            ? { gitCommitHash: input.commit.hash, gitCommitMessage: input.commit.message }
            : {})
    };
}

/** An app as `rebase.json` declares it, reduced to what the registry stores. */
export interface DeclaredApp {
    name: string;
    type: string;
}

/**
 * The apps a project manifest declares.
 *
 * A deploy only ever ships ONE app's bundle, so the trigger alone could never
 * tell the platform that the repository also contains a web frontend and an
 * admin panel — and the Apps page, whose whole job is to show the set, listed a
 * single entry called "backend". Sending the declared set fixes that without
 * pretending the others are deployed: the platform registers them, and their
 * status says what is actually true.
 */
export function declaredAppsFrom(manifest: { apps?: Record<string, { type?: string }> } | null | undefined): DeclaredApp[] {
    const apps = manifest?.apps;
    if (!apps || typeof apps !== "object") return [];
    return Object.entries(apps)
        .filter(([name]) => name.trim().length > 0)
        // Two types, and the control plane accepts exactly those — anything else
        // is a registration it would reject, which shows up as deploy noise
        // rather than as the manifest error it actually is. `backend` is the
        // narrow case; everything a repository declares that is not the backend
        // is served as files.
        .map(([name, value]) => ({ name,
type: value?.type === "backend" ? "backend" : "static" }));
}

/** Upload a bundle archive; returns the control-plane bundle id. */
export async function uploadBundle(
    url: string,
    token: string,
    projectId: string,
    tarPath: string
): Promise<string> {
    const bytes = fs.readFileSync(tarPath);
    const res = await fetch(
        `${url}/api/functions/deploy/bundle/upload?projectId=${encodeURIComponent(projectId)}`,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`,
"Content-Type": "application/gzip" },
            body: bytes
        }
    );
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Bundle upload failed (${res.status}): ${body || res.statusText}`);
    }
    const data = (await res.json()) as { bundleId?: string };
    if (!data.bundleId) throw new Error("Bundle upload endpoint did not return a bundle id.");
    return data.bundleId;
}
