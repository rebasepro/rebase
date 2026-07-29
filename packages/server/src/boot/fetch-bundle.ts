/**
 * Fetching a bundle at boot, for platforms with no init container.
 *
 * A bundle normally arrives on disk before the process starts: `rebase build`
 * writes one, a container image carries one, and on Kubernetes an init container
 * fetches one into a shared volume before the runtime container runs. All three
 * mean `runFromBundle` can assume the files are already there.
 *
 * Serverless platforms have no init container. Cloud Run starts one container
 * and nothing else, so the choice is between baking a per-tenant image — a build
 * on every deploy and an image per tenant to garbage-collect — or fetching at
 * boot. This is the second.
 *
 * ## Every start, not just the first
 *
 * The fetch has to be cheap and repeatable because it runs on *every* cold
 * start: a scale-from-zero, an instance recycled after an hour idle, a new
 * revision. That is also why the platform's bundle URL is deliberately a stable
 * endpoint rather than a signed expiring one — an instance starting for the
 * first time in three days needs the same URL to work.
 *
 * ## It refuses rather than half-unpacking
 *
 * Every failure here — a URL that 403s, a truncated download, a tarball that
 * unpacks to something without a manifest — exits non-zero before the runtime
 * boots. A partially-unpacked bundle would boot into a confusing failure much
 * later: missing collections read as an empty schema, and
 * `REBASE_MIGRATE_ON_BOOT=ensure` would then happily create nothing and report
 * success. Failing at the fetch is the only place the error still says what is
 * actually wrong.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Where the runtime is told to fetch its bundle from. */
export const BUNDLE_URL_ENV = "REBASE_BUNDLE_URL";
/** Bearer token for that fetch. Does not expire — see the module note. */
export const BUNDLE_TOKEN_ENV = "REBASE_BUNDLE_TOKEN";

export interface FetchBundleOptions {
    url: string;
    token?: string;
    /** Where to unpack. Defaults to a fresh directory under the OS temp dir. */
    destination?: string;
    /** Injected for tests. */
    fetchImpl?: typeof fetch;
    /** Injected for tests. */
    extract?: (tarball: string, destination: string) => Promise<void>;
    /** How long the download may take before it is abandoned. */
    timeoutMs?: number;
}

/**
 * Whether this process should fetch its bundle rather than read one from disk.
 *
 * An explicit `REBASE_BUNDLE` — a path — always wins. A platform that mounted a
 * bundle AND set a URL means somebody is mid-migration between the two, and the
 * local copy is the one that is definitely there.
 */
export function shouldFetchBundle(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env[BUNDLE_URL_ENV]) && !env.REBASE_BUNDLE;
}

/** Untar with the system `tar`, which every base image has. */
async function extractWithTar(tarball: string, destination: string): Promise<void> {
    // `-m` (do not restore mtimes) because some sandboxes reject utimes on
    // extracted files and the failure looks like a corrupt archive.
    await run("tar", ["-xzmf", tarball, "-C", destination]);
}

/**
 * Download and unpack a bundle, returning the directory it landed in.
 *
 * Downloads to a file rather than streaming into `tar`, deliberately. A stream
 * that dies mid-transfer leaves `tar` having successfully extracted a prefix of
 * the archive and exiting 0 — the half-unpacked bundle this module exists to
 * refuse. Writing the whole tarball first means a truncated download is caught
 * by `tar` as a corrupt archive, which is an error.
 */
export async function fetchBundle(options: FetchBundleOptions): Promise<string> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const extract = options.extract ?? extractWithTar;

    const destination = options.destination
        ?? fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-"));
    fs.mkdirSync(destination, { recursive: true });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);

    let response: Response;
    try {
        response = await fetchImpl(options.url, {
            headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
            signal: controller.signal
        });
    } catch (error: unknown) {
        throw new Error(
            `Could not download the bundle from ${options.url}: ` +
                (error instanceof Error ? error.message : String(error))
        );
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        // The status is the diagnosis: 401/403 is a bad or missing token, 404 is
        // a bundle that was garbage-collected out from under a running service.
        throw new Error(
            `Could not download the bundle from ${options.url}: ${response.status} ${response.statusText}`
        );
    }

    const tarball = path.join(destination, "bundle.tar.gz");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) {
        throw new Error(`The bundle at ${options.url} is empty.`);
    }
    fs.writeFileSync(tarball, body);

    try {
        await extract(tarball, destination);
    } catch (error: unknown) {
        throw new Error(
            `The bundle downloaded from ${options.url} could not be unpacked ` +
                `(${body.length} bytes): ` + (error instanceof Error ? error.message : String(error))
        );
    } finally {
        // The archive is dead weight in an instance whose memory-backed temp
        // directory counts against its limit, and a Cloud Run instance's /tmp is
        // a tmpfs — leaving it there costs real memory for the life of the
        // instance.
        fs.rmSync(tarball, { force: true });
    }

    const root = bundleRootIn(destination);
    if (!root) {
        throw new Error(
            `The bundle downloaded from ${options.url} unpacked without a rebase-bundle.json. ` +
                `It is not a Rebase bundle, or it was truncated.`
        );
    }
    return root;
}

/**
 * Find the bundle root inside an unpacked directory.
 *
 * Tolerates one level of nesting, because whether a tarball has a top-level
 * directory depends on how it was created — `tar czf x.tgz dist-bundle` and
 * `tar czf x.tgz -C dist-bundle .` produce different shapes from the same
 * files, and both are things a build script does.
 */
export function bundleRootIn(directory: string): string | null {
    if (fs.existsSync(path.join(directory, "rebase-bundle.json"))) return directory;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(directory, entry.name);
        if (fs.existsSync(path.join(nested, "rebase-bundle.json"))) return nested;
    }
    return null;
}
