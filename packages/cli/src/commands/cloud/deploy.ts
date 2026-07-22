/**
 * `rebase cloud deploy` and `rebase cloud logs`.
 *
 * `deploy` triggers the control-plane `deploy` function, then tails the build
 * logs from the deployment record until it succeeds or fails. `logs` shows the
 * latest build log, or runtime logs with `--runtime`.
 */
import arg from "arg";
import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import {
    requireClient,
    resolveProjectRef,
    colorStatus,
    emit,
    isJsonMode,
    printJson,
    fail,
    reportError,
    type CloudClient
} from "./context";
import { latestDeployment, fmtDate } from "./projects";

interface Deployment {
    id: string | number;
    status?: string;
    logs?: string;
    createdAt?: string;
}

/**
 * What the control plane says about the deployment holding the lock, when it
 * refuses a trigger. Absent on control planes older than that change.
 */
interface BlockingDeployment {
    id?: string;
    createdAt?: string | null;
    status?: string | null;
    triggerSource?: string;
    /** Whether the blocking deployment was triggered by THIS user. */
    mine?: boolean;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min hard stop

// Keep in sync with the control plane's build-context cap (deploy/upload
// MAX_BYTES and the backend's maxBodySize). Checked before uploading so an
// oversized context fails in milliseconds with a hint, not after the upload
// with a bare 413.
const MAX_SOURCE_UPLOAD_BYTES = 100 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function run(cmd: string, cmdArgs: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, cmdArgs, { cwd,
env: env ? { ...process.env, ...env } : undefined,
stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || `${cmd} exited ${code}`))));
    });
}

/**
 * Package `sourceDir` into a gzipped tarball, honoring `.gitignore`/`.rebaseignore`
 * and always excluding `.git` and `node_modules`. Returns the temp archive path.
 */
async function createSourceTarball(sourceDir: string): Promise<string> {
    const dir = path.resolve(sourceDir);
    if (!fs.existsSync(dir)) fail(`Source directory not found: ${dir}`);

    const tarPath = path.join(os.tmpdir(), `rebase-src-${Date.now()}.tar.gz`);
    const tarArgs = ["-czf", tarPath, "--exclude=.git", "--exclude=node_modules"];
    for (const ignore of [".gitignore", ".rebaseignore"]) {
        if (fs.existsSync(path.join(dir, ignore))) tarArgs.push(`--exclude-from=${ignore}`);
    }
    tarArgs.push(".");

    try {
        // COPYFILE_DISABLE: macOS bsdtar otherwise emits an AppleDouble sidecar
        // (`._foo.ts`) for every file carrying an xattr — and macOS stamps the
        // SIP-protected `com.apple.provenance` xattr routinely, so a stock
        // checkout ships `._*` binary junk that crashes schema generation in
        // the builder. GNU tar ignores the variable, so this is safe everywhere.
        await run("tar", tarArgs, dir, { COPYFILE_DISABLE: "1" });
    } catch (e) {
        fail(`Failed to package source: ${e instanceof Error ? e.message : String(e)}`);
    }
    return tarPath;
}

/**
 * The `@rebasepro/*` version this source directory actually resolves.
 *
 * Recorded on the deployment so a row in Deployment History says which
 * framework build shipped. Nothing else on the platform knows: an app that
 * links the framework locally pins it at package time, and a silent bump is
 * invisible afterwards — it has already cost one debugging session.
 *
 * `@rebasepro/server` first, because that is what the deployed backend runs;
 * `@rebasepro/client` is the fallback for a frontend-only bundle. Resolution is
 * a plain walk up from the source directory rather than `require.resolve`,
 * which would answer for the CLI's own install tree instead of the app's.
 *
 * Best effort by construction: a version that cannot be read is simply not
 * recorded. Nothing about a deploy should fail over a bookkeeping string.
 */
function resolveFrameworkVersion(sourceDir: string): string | undefined {
    let dir = path.resolve(sourceDir);
    for (;;) {
        for (const pkg of ["@rebasepro/server", "@rebasepro/client"]) {
            try {
                const manifest = path.join(dir, "node_modules", ...pkg.split("/"), "package.json");
                const version = (JSON.parse(fs.readFileSync(manifest, "utf8")) as { version?: unknown }).version;
                if (typeof version === "string" && version.trim() !== "") return version.trim();
            } catch {
                /* not here — keep walking */
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/** Upload a build-context tarball; returns the opaque `source` ref for deploy. */
async function uploadSource(url: string, token: string, projectId: string, tarPath: string): Promise<string> {
    const bytes = fs.readFileSync(tarPath);
    const sizeMb = (bytes.length / 1024 / 1024).toFixed(1);
    if (bytes.length > MAX_SOURCE_UPLOAD_BYTES) {
        fail(
            `Source context is ${sizeMb} MB — the upload cap is ${Math.round(MAX_SOURCE_UPLOAD_BYTES / 1024 / 1024)} MB.`,
            "Trim the build context: exclude sourcemaps (*.map), build output and large assets via .rebaseignore or .gitignore."
        );
    }
    console.log(chalk.gray(`  Uploading source (${sizeMb} MB)...`));
    const res = await fetch(`${url}/api/functions/deploy/upload?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`,
"Content-Type": "application/gzip" },
        body: bytes
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        fail(`Source upload failed (${res.status}): ${body || res.statusText}`);
    }
    const data = (await res.json()) as { source?: string };
    if (!data.source) fail("Upload endpoint did not return a source reference.");
    return data.source;
}

export async function deployCommand(rawArgs: string[], projectRef: string): Promise<void> {
    const args = arg(
        { "--no-follow": Boolean,
"--source": String,
"--message": String,
"-m": "--message" },
        { argv: rawArgs.slice(2),
permissive: true }
    );
    const { client, url } = await requireClient(rawArgs);
    const projectId = await resolveProjectRef(projectRef, client);

    // Optional fly-style local source upload: `deploy --source .`
    let source: string | undefined;
    if (args["--source"]) {
        const tarPath = await createSourceTarball(args["--source"]);
        try {
            const token = client.auth.getSession()?.accessToken;
            if (!token) fail("Not authenticated.", "Run `rebase cloud login`.");
            source = await uploadSource(url, token, projectId, tarPath);
        } finally {
            fs.rmSync(tarPath, { force: true });
        }
    }

    console.log("");
    console.log(`  🚀 Triggering deployment for project ${chalk.bold(projectRef)}${source ? " from uploaded source" : ""}...`);

    const body: Record<string, unknown> = { projectId };
    if (source) body.source = source;
    if (args["--message"]) body.message = args["--message"];
    // `client` is what the control plane records as `triggerSource`. Omitting it
    // is why every deployment this command has ever created reads `unknown` in
    // Deployment History — `rollback` next door has always sent it.
    body.client = "cli";
    const frameworkVersion = resolveFrameworkVersion(args["--source"] ?? process.cwd());
    if (frameworkVersion) body.frameworkVersion = frameworkVersion;

    let triggered: { deploymentId: string; deduplicated: boolean };
    try {
        const res = await client.functions.invoke<{
            success: boolean;
            deployment: { id: string | number };
            deduplicated?: boolean;
        }>("deploy", body);
        if (!res?.deployment?.id) fail("Control plane did not return a deployment id.");
        triggered = { deploymentId: String(res.deployment.id),
deduplicated: res.deduplicated === true };
    } catch (e) {
        triggered = resolveTriggerFailure(e);
    }
    const { deploymentId, deduplicated } = triggered;

    if (!isJsonMode()) {
        console.log(
            chalk.gray(
                deduplicated
                    ? `  Deployment ${deploymentId} is already running — following it.`
                    : `  Deployment ${deploymentId} created.${frameworkVersion ? `  (@rebasepro/* ${frameworkVersion})` : ""}`
            )
        );
    }

    if (args["--no-follow"]) {
        emit(
            () => {
                console.log(chalk.gray("  Not following logs (--no-follow). Check status with `rebase cloud logs`."));
                console.log("");
            },
            { deploymentId,
deduplicated,
frameworkVersion: frameworkVersion ?? null,
following: false }
        );
        return;
    }

    if (!isJsonMode()) {
        console.log(chalk.gray("  Streaming build logs (Ctrl-C to stop watching — the build keeps running):"));
        console.log("");
    }

    // In JSON mode the build log is not streamed: interleaving it with the
    // result object would make neither parseable. The deploy is still followed
    // to completion — a caller waiting on the exit code still waits — and the
    // one object printed at the end carries the outcome.
    const status = await streamBuildLogs(client, deploymentId, { quiet: isJsonMode() });
    emit(
        () => {},
        { deploymentId,
deduplicated,
frameworkVersion: frameworkVersion ?? null,
following: true,
status }
    );
}

/**
 * Turn a failed trigger into either a deployment to follow, or an exit.
 *
 * The 409 is the interesting one. A deploy trigger can reach the control plane
 * twice without anybody asking twice — the SDK transport replays a request once
 * after refreshing an expired token, and any lost response has the same effect
 * — so "a deployment is already in progress" was routinely describing the
 * deployment this very command had just created. With no id in the message the
 * only available reading was "someone else is deploying, back off", and the
 * build stream was lost either way.
 *
 * So: if the control plane says the blocking deployment is ours, we attach to
 * it. If it is not ours, we still name it, because "which one, since when, from
 * where" is the difference between an actionable refusal and a dead end.
 */
function resolveTriggerFailure(e: unknown): { deploymentId: string; deduplicated: boolean } {
    const err = e as {
        status?: number;
        message?: string;
        code?: string;
        details?: { deployment?: BlockingDeployment };
    };

    if (err?.status === 409) {
        const blocking = err.details?.deployment;
        if (blocking?.id && blocking.mine) {
            return { deploymentId: String(blocking.id),
deduplicated: true };
        }
        // Older control planes send a bare 409 with no `details`; the message
        // then stays the honest general one rather than a fabricated id.
        fail(
            blocking?.id
                ? `Deployment ${blocking.id} is already in progress for this project` +
                      `${blocking.triggerSource && blocking.triggerSource !== "unknown" ? `, triggered from the ${blocking.triggerSource}` : ""}` +
                      `${blocking.createdAt ? ` at ${fmtDate(blocking.createdAt)}` : ""}.`
                : "A deployment is already in progress for this project.",
            blocking?.id
                ? `Follow it with \`rebase cloud logs -f\`, or stop it with \`rebase cloud cancel ${blocking.id}\`.`
                : "Follow it with `rebase cloud logs -f`.",
            "deploy_in_progress"
        );
    }

    if (err?.status === 402) {
        // Billing gate: no card on file, card declined, or needs auth.
        fail(
            err.message || "Payment required before deploying.",
            "Attach a card once with `rebase cloud billing setup`, then deploy again.",
            "payment_required"
        );
    }

    reportError(e, "Failed to trigger deployment");
}

/**
 * Poll a deployment record and print new log output as it arrives. Returns the
 * terminal status; a non-success still exits non-zero, as it always has.
 *
 * `quiet` follows without printing — JSON mode, where the log stream would
 * corrupt the one object the caller is parsing.
 */
async function streamBuildLogs(
    client: CloudClient,
    deploymentId: string,
    opts: { quiet?: boolean } = {}
): Promise<string> {
    const quiet = opts.quiet === true;
    let printed = 0;
    const started = Date.now();

    for (;;) {
        let dep: Deployment | undefined;
        try {
            dep = (await client.data.collection("deployments").findById(deploymentId)) as unknown as Deployment | undefined;
        } catch (e) {
            reportError(e, "Failed to read deployment status");
        }
        if (!dep) fail(`Deployment ${deploymentId} disappeared.`, undefined, "not_found");

        const logs = dep.logs ?? "";
        if (!quiet && logs.length > printed) {
            process.stdout.write(logs.slice(printed));
        }
        printed = logs.length;

        if (dep.status && dep.status !== "deploying") {
            if (dep.status !== "success") {
                if (quiet) {
                    // The failure still has to be reportable, and in JSON mode
                    // the build log is the only place that says why.
                    printJson({
                        error: {
                            message: `Deployment ${deploymentId} ${dep.status}.`,
                            code: "deploy_failed",
                            status: null,
                            deploymentId,
                            logs
                        }
                    });
                    process.exit(1);
                }
                console.log("");
                console.log(chalk.bold.red(`  ✗ Deployment ${dep.status}`));
                console.log("");
                process.exit(1);
            }
            if (!quiet) {
                console.log("");
                console.log(chalk.bold.green("  ✓ Deployment succeeded"));
                console.log("");
            }
            return dep.status;
        }

        if (Date.now() - started > POLL_TIMEOUT_MS) {
            if (!quiet) console.log("");
            fail(
                "Timed out waiting for the build to finish.",
                "The deployment may still be running — check `rebase cloud logs`.",
                "timeout"
            );
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

export async function logsCommand(rawArgs: string[], projectRef: string): Promise<void> {
    const args = arg(
        { "--runtime": Boolean,
"--follow": Boolean,
"-f": "--follow" },
        { argv: rawArgs.slice(2),
permissive: true }
    );
    const { client } = await requireClient(rawArgs);
    const projectId = await resolveProjectRef(projectRef, client);

    if (args["--runtime"]) {
        try {
            const res = await client.functions.invoke<{ logs?: string; error?: string }>(
                "runtime-logs",
                undefined,
                { method: "GET",
path: projectId }
            );
            console.log("");
            console.log(chalk.bold(`  📄 Runtime logs — project ${projectRef}`));
            console.log("");
            console.log(res.logs ?? chalk.gray("  (no logs)"));
            console.log("");
        } catch (e) {
            reportError(e, "Failed to fetch runtime logs");
        }
        return;
    }

    // Build logs: latest deployment, optionally follow if still running.
    try {
        const dep = (await latestDeployment(client, projectId)) as unknown as Deployment | undefined;
        if (!dep) {
            console.log("");
            console.log(chalk.gray("  No deployments yet for this project."));
            console.log("");
            return;
        }

        console.log("");
        console.log(chalk.bold(`  📄 Build logs — deployment ${dep.id}`) + `  ${colorStatus(dep.status)}`);
        console.log("");

        if (args["--follow"] && dep.status === "deploying") {
            // Hand off to the streamer, which prints from the top and tails live.
            await streamBuildLogs(client, String(dep.id));
        } else {
            console.log(dep.logs ?? chalk.gray("  (no logs)"));
            console.log("");
        }
    } catch (e) {
        reportError(e, "Failed to fetch build logs");
    }
}
