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
import { spawn } from "child_process";
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
}): Record<string, unknown> {
    return {
        projectId: input.projectId,
        bundleId: input.bundleId,
        bundleManifest: input.manifest,
        app: input.app ?? input.manifest.app ?? "backend",
        client: "cli",
        frameworkVersion: input.manifest.runtime?.builtAgainst,
        ...(input.declaredApps?.length ? { declaredApps: input.declaredApps } : {}),
        ...(input.message ? { message: input.message } : {})
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
