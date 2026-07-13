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
import { requireClient, colorStatus, fail, reportError, type CloudClient } from "./context";
import { latestDeployment } from "./projects";

interface Deployment {
    id: string | number;
    status?: string;
    logs?: string;
    createdAt?: string;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min hard stop

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function run(cmd: string, cmdArgs: string[], cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, cmdArgs, { cwd,
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
        await run("tar", tarArgs, dir);
    } catch (e) {
        fail(`Failed to package source: ${e instanceof Error ? e.message : String(e)}`);
    }
    return tarPath;
}

/** Upload a build-context tarball; returns the opaque `source` ref for deploy. */
async function uploadSource(url: string, token: string, projectId: string, tarPath: string): Promise<string> {
    const bytes = fs.readFileSync(tarPath);
    const sizeMb = (bytes.length / 1024 / 1024).toFixed(1);
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

export async function deployCommand(rawArgs: string[], projectId: string): Promise<void> {
    const args = arg(
        { "--no-follow": Boolean,
"--source": String },
        { argv: rawArgs.slice(2),
permissive: true }
    );
    const { client, url } = await requireClient(rawArgs);

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
    console.log(`  🚀 Triggering deployment for project ${chalk.bold(projectId)}${source ? " from uploaded source" : ""}...`);

    let deploymentId: string;
    try {
        const res = await client.functions.invoke<{ success: boolean; deployment: { id: string | number } }>(
            "deploy",
            source ? { projectId,
source } : { projectId }
        );
        if (!res?.deployment?.id) fail("Control plane did not return a deployment id.");
        deploymentId = String(res.deployment.id);
    } catch (e) {
        const err = e as { status?: number; message?: string; code?: string };
        if (err?.status === 409) {
            fail("A deployment is already in progress for this project.");
        }
        if (err?.status === 402) {
            // Billing gate: no card on file, card declined, or needs auth.
            fail(
                err.message || "Payment required before deploying.",
                "Attach a card once with `rebase cloud billing setup`, then deploy again."
            );
        }
        reportError(e, "Failed to trigger deployment");
    }

    console.log(chalk.gray(`  Deployment ${deploymentId} created.`));
    if (args["--no-follow"]) {
        console.log(chalk.gray("  Not following logs (--no-follow). Check status with `rebase cloud logs`."));
        console.log("");
        return;
    }
    console.log(chalk.gray("  Streaming build logs (Ctrl-C to stop watching — the build keeps running):"));
    console.log("");

    await streamBuildLogs(client, deploymentId);
}

/** Poll a deployment record and print new log output as it arrives. */
async function streamBuildLogs(client: CloudClient, deploymentId: string): Promise<void> {
    let printed = 0;
    const started = Date.now();

    for (;;) {
        let dep: Deployment | undefined;
        try {
            dep = (await client.data.collection("deployments").findById(deploymentId)) as unknown as Deployment | undefined;
        } catch (e) {
            reportError(e, "Failed to read deployment status");
        }
        if (!dep) fail(`Deployment ${deploymentId} disappeared.`);

        const logs = dep.logs ?? "";
        if (logs.length > printed) {
            process.stdout.write(logs.slice(printed));
            printed = logs.length;
        }

        if (dep.status && dep.status !== "deploying") {
            console.log("");
            if (dep.status === "success") {
                console.log(chalk.bold.green("  ✓ Deployment succeeded"));
            } else {
                console.log(chalk.bold.red(`  ✗ Deployment ${dep.status}`));
                console.log("");
                process.exit(1);
            }
            console.log("");
            return;
        }

        if (Date.now() - started > POLL_TIMEOUT_MS) {
            console.log("");
            fail(
                "Timed out waiting for the build to finish.",
                "The deployment may still be running — check `rebase cloud logs`."
            );
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

export async function logsCommand(rawArgs: string[], projectId: string): Promise<void> {
    const args = arg(
        { "--runtime": Boolean,
"--follow": Boolean,
"-f": "--follow" },
        { argv: rawArgs.slice(2),
permissive: true }
    );
    const { client } = await requireClient(rawArgs);

    if (args["--runtime"]) {
        try {
            const res = await client.functions.invoke<{ logs?: string; error?: string }>(
                "runtime-logs",
                undefined,
                { method: "GET",
path: projectId }
            );
            console.log("");
            console.log(chalk.bold(`  📄 Runtime logs — project ${projectId}`));
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
