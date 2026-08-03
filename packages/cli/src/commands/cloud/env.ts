/**
 * `rebase cloud env` — a project's environment variables.
 *
 *   env list                Keys only — a value is NEVER printed here
 *   env set KEY=VALUE        Create/replace one variable (`--secret` ⇒ write-only)
 *   env unset KEY            Remove one variable
 *   env reveal KEY           Release one non-secret value (a secret var 403s)
 *   env pull [--out .env]    Write revealable values to a local dotenv file
 *
 * Values are the sharp edge here. The list endpoint returns keys and never
 * values by design (a page load is not consent to spray a customer's secrets
 * through caches and logs), and a `--secret` variable is write-only: it can be
 * replaced but never read back. This mirrors `env-vars` exactly and refuses to
 * offer reveal for a secret variable rather than letting the server 403.
 */
import arg from "arg";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    cloudPositionals,
    emit,
    isJsonMode,
    confirmDestructive,
    keyValues,
    success,
    fail,
    reportError,
    type CloudClient
} from "./context";

interface EnvVarView {
    id: string;
    key: string;
    secret: boolean;
    valueSet: boolean;
    createdAt: string | null;
    updatedAt: string | null;
}

interface EnvVarListResponse {
    vars: EnvVarView[];
    pendingRedeploy: boolean | null;
    pendingSince: string | null;
    limits: {
        maxVars: number;
        maxValueBytes: number;
        maxTotalBytes: number;
        keyPattern: string;
        reservedKeys: string[];
    };
}

async function fetchEnvVars(client: CloudClient, projectId: string): Promise<EnvVarListResponse> {
    return client.functions.invoke<EnvVarListResponse>("env-vars", undefined, {
        method: "GET",
        path: projectId
    });
}

export async function envCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    switch (action) {
        case "list":
        case undefined:
            await listEnv(rawArgs);
            break;
        case "set":
            await setEnv(rawArgs);
            break;
        case "unset":
        case "delete":
        case "rm":
            await unsetEnv(rawArgs);
            break;
        case "reveal":
            await revealEnv(rawArgs);
            break;
        case "pull":
            await pullEnv(rawArgs);
            break;
        case "--help":
            printEnvHelp();
            break;
        default:
            fail(`Unknown env command: ${action}`, "Try `rebase cloud env --help`.");
    }
}

/** A short human hint about redeploy state (the JSON carries `pendingRedeploy`). */
function pendingHint(pending: boolean | null): string | undefined {
    if (pending === true) return chalk.yellow("A variable changed since the last deploy — run `rebase cloud deploy` to apply it.");
    if (pending === null) return chalk.gray("Redeploy state is unknown (deployment history unavailable).");
    return undefined;
}

async function listEnv(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    try {
        const res = await fetchEnvVars(client, projectId);
        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  🔑 Environment — project ${projectRef}`));
                console.log("");
                if (!res.vars.length) {
                    console.log(chalk.gray("  No variables. Add one with `rebase cloud env set KEY=VALUE`."));
                    console.log("");
                    return;
                }
                for (const v of res.vars) {
                    const badges = [
                        v.secret ? chalk.magenta("secret") : undefined,
                        v.valueSet ? undefined : chalk.gray("empty")
                    ]
                        .filter(Boolean)
                        .join(" ");
                    // Deliberately no value — reveal is the only way to read one.
                    console.log(`  ${chalk.bold(v.key)}${badges ? `  ${badges}` : ""}`);
                }
                const hint = pendingHint(res.pendingRedeploy);
                if (hint) {
                    console.log("");
                    console.log(`  ${hint}`);
                }
                console.log("");
            },
            {
                projectId,
                pendingRedeploy: res.pendingRedeploy,
                pendingSince: res.pendingSince,
                // Never a value: keys + shape only.
                vars: res.vars.map((v) => ({
                    key: v.key,
                    secret: v.secret,
                    valueSet: v.valueSet,
                    createdAt: v.createdAt,
                    updatedAt: v.updatedAt
                })),
                limits: res.limits
            }
        );
    } catch (e) {
        reportError(e, "Failed to list environment variables");
    }
}

/** Parse `KEY=VALUE` or `KEY VALUE` from the positional operands. */
export function parseEnvAssignment(operands: string[]): { key: string; value: string } | null {
    const first = operands[0];
    if (!first) return null;
    const eq = first.indexOf("=");
    if (eq > 0) {
        return { key: first.slice(0, eq).trim(),
value: first.slice(eq + 1) };
    }
    // `set KEY VALUE` form — VALUE is the next operand (may be absent ⇒ empty).
    return { key: first.trim(),
value: operands[1] ?? "" };
}

/**
 * Prefixes whose variables are read by a BUNDLER at build time, not by the
 * process at run time.
 *
 * These are the ones this command cannot deliver. A project's environment is
 * applied at rollout — after Kaniko has already built the image — so a
 * `VITE_API_URL` set here is present in the running container and absent from
 * the JavaScript that was compiled minutes earlier. Nothing fails: the variable
 * exists, the deploy succeeds, and the bundle carries `undefined` where the
 * value should be. The bug then presents in the browser as missing
 * configuration, which is several steps away from the cause.
 *
 * `import.meta.env` inlining is Vite's; `NEXT_PUBLIC_`/`PUBLIC_`/`REACT_APP_`
 * are the same contract in Next, Astro/SvelteKit and CRA.
 */
const BUILD_TIME_ENV_PREFIXES = ["VITE_", "NEXT_PUBLIC_", "PUBLIC_", "REACT_APP_"];

/** The prefix that makes `key` a build-time variable, or undefined. */
export function buildTimeEnvPrefix(key: string): string | undefined {
    return BUILD_TIME_ENV_PREFIXES.find((prefix) => key.toUpperCase().startsWith(prefix));
}

async function setEnv(rawArgs: string[]): Promise<void> {
    const args = arg(
        { "--secret": Boolean,
"--force": Boolean,
"--project": String,
"-p": "--project" },
        { argv: rawArgs.slice(2),
permissive: true }
    );
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    const operands = cloudPositionals(rawArgs).slice(2); // after `env set`
    const parsed = parseEnvAssignment(operands);
    if (!parsed || !parsed.key) {
        fail("Usage: rebase cloud env set KEY=VALUE [--secret]", undefined, "usage");
    }

    // Refused rather than warned. A warning is the wrong instrument here: this
    // command is most often run non-interactively, where a warning scrolls past
    // and the variable is stored anyway — leaving a project that looks
    // configured, deploys clean, and is broken in the browser. `--force` exists
    // because a custom build could legitimately read one of these at run time.
    const buildTimePrefix = buildTimeEnvPrefix(parsed!.key);
    if (buildTimePrefix && !args["--force"]) {
        fail(
            `${parsed!.key} is read by your bundler at BUILD time, and project variables are applied at ` +
                "rollout — after the image is built. Setting it here would not reach the bundle.",
            `Put ${buildTimePrefix}* variables in the source you deploy (a committed .env, or your build ` +
                "config), then `rebase cloud deploy`. Pass --force if your build genuinely reads this at run time.",
            "build_time_variable"
        );
    }

    const body: { key: string; value: string; secret?: boolean } = { key: parsed!.key,
value: parsed!.value };
    if (args["--secret"]) body.secret = true;

    try {
        const res = await client.functions.invoke<{ success: boolean; var: EnvVarView; pendingRedeploy: true }>(
            "env-vars",
            body,
            { path: projectId }
        );
        emit(
            () => {
                success(`Set ${chalk.bold(res.var.key)}${res.var.secret ? chalk.magenta(" (secret)") : ""}`);
                console.log(`  ${chalk.yellow("Pending redeploy")} — run \`rebase cloud deploy\` to apply it.`);
                console.log("");
            },
            {
                success: true,
                key: res.var.key,
                secret: res.var.secret,
                valueSet: res.var.valueSet,
                pendingRedeploy: res.pendingRedeploy
            }
        );
    } catch (e) {
        reportError(e, "Failed to set environment variable");
    }
}

async function unsetEnv(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    const key = cloudPositionals(rawArgs).slice(2)[0];
    if (!key) fail("Usage: rebase cloud env unset KEY", undefined, "usage");

    try {
        const res = await client.functions.invoke<{ success: boolean; pendingRedeploy: true }>("env-vars", undefined, {
            method: "DELETE",
            path: `${projectId}/${encodeURIComponent(key!)}`
        });
        emit(
            () => {
                success(`Removed ${chalk.bold(key!)}`);
                console.log(`  ${chalk.yellow("Pending redeploy")} — run \`rebase cloud deploy\` to apply it.`);
                console.log("");
            },
            { success: true,
key,
pendingRedeploy: res.pendingRedeploy }
        );
    } catch (e) {
        reportError(e, "Failed to remove environment variable");
    }
}

async function revealEnv(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    const key = cloudPositionals(rawArgs).slice(2)[0];
    if (!key) fail("Usage: rebase cloud env reveal KEY", undefined, "usage");

    // Pre-check: a secret variable is write-only. Don't even ask the server — it
    // would 403 — say so plainly and never offer reveal for it. Done OUTSIDE the
    // reveal try so a deliberate refusal is not re-wrapped as a server error.
    let list: EnvVarListResponse;
    try {
        list = await fetchEnvVars(client, projectId);
    } catch (e) {
        reportError(e, "Failed to reveal environment variable");
    }
    const found = list!.vars.find((v) => v.key === key);
    if (!found) fail(`No variable named ${key} in project ${projectRef}.`, undefined, "not_found");
    if (found!.secret) {
        fail(
            `${key} is a secret (write-only) variable; its value cannot be revealed.`,
            "Replace it with `rebase cloud env set KEY=VALUE` if you need to change it.",
            "secret_write_only"
        );
    }

    try {
        const res = await client.functions.invoke<{ key: string; value: string }>(
            "env-vars",
            { projectId,
key },
            { path: "reveal" }
        );
        emit(
            () => {
                console.log("");
                console.log(`  ${chalk.bold(res.key)}=${res.value}`);
                console.log("");
            },
            { key: res.key,
value: res.value }
        );
    } catch (e) {
        reportError(e, "Failed to reveal environment variable");
    }
}

async function pullEnv(rawArgs: string[]): Promise<void> {
    const args = arg({ "--out": String,
"--yes": Boolean,
"-y": "--yes",
"--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    const outPath = path.resolve(args["--out"] || ".env");

    try {
        const list = await fetchEnvVars(client, projectId);

        if (fs.existsSync(outPath)) {
            await confirmDestructive({ yes: Boolean(args["--yes"]),
prompt: `Overwrite ${outPath}?` });
        }

        // Only non-secret, value-set variables can be written — a secret var is
        // write-only and reveal 403s, so it is honestly skipped, not faked.
        const written: string[] = [];
        const skipped: Array<{ key: string; reason: string }> = [];
        const lines: string[] = [];
        for (const v of list.vars) {
            if (v.secret) {
                skipped.push({ key: v.key,
reason: "secret (write-only)" });
                continue;
            }
            if (!v.valueSet) {
                lines.push(`${v.key}=`);
                written.push(v.key);
                continue;
            }
            const revealed = await client.functions.invoke<{ key: string; value: string }>(
                "env-vars",
                { projectId,
key: v.key },
                { path: "reveal" }
            );
            // Quote values that contain whitespace or a hash so a dotenv reader
            // keeps them intact.
            const needsQuote = /[\s#'"]/.test(revealed.value);
            lines.push(`${v.key}=${needsQuote ? JSON.stringify(revealed.value) : revealed.value}`);
            written.push(v.key);
        }

        fs.writeFileSync(outPath, lines.length ? lines.join("\n") + "\n" : "", { mode: 0o600 });

        emit(
            () => {
                success(`Wrote ${written.length} variable${written.length === 1 ? "" : "s"} to ${outPath}`);
                if (skipped.length) {
                    console.log(chalk.gray(`  Skipped ${skipped.length} secret variable(s): ${skipped.map((s) => s.key).join(", ")}`));
                    console.log("");
                }
            },
            { success: true,
path: outPath,
written,
skipped }
        );
    } catch (e) {
        reportError(e, "Failed to pull environment variables");
    }
}

function printEnvHelp(): void {
    if (isJsonMode()) {
        printEnvHelpJson();
        return;
    }
    console.log(`
${chalk.bold("rebase cloud env")} — Environment variables

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("list")}                      List keys ${chalk.gray("(values are never printed)")}
  ${chalk.blue.bold("set")} ${chalk.gray("KEY=VALUE [--secret]")}  Create or replace a variable
  ${chalk.blue.bold("unset")} ${chalk.gray("KEY")}                 Remove a variable
  ${chalk.blue.bold("reveal")} ${chalk.gray("KEY")}                Print one non-secret value
  ${chalk.blue.bold("pull")} ${chalk.gray("[--out .env] [-y]")}    Write revealable values to a dotenv file

${chalk.green.bold("Options")}
  ${chalk.blue("--secret")}                  Mark a variable write-only ${chalk.gray("(set)")}
  ${chalk.blue("--force")}                   Set a build-time key anyway ${chalk.gray("(set)")}
  ${chalk.blue("--json")}                    Machine-readable output
  ${chalk.blue("--project, -p")}             Project slug ${chalk.gray("(defaults to the linked project)")}

${chalk.gray("Values are encrypted at rest (AES-256-GCM) and only decrypted at deploy time.")}
${chalk.gray("VITE_* / NEXT_PUBLIC_* / PUBLIC_* / REACT_APP_* are read by your bundler at BUILD time;")}
${chalk.gray("these are applied at rollout, after the image is built, so they never reach the bundle.")}
`);
}

function printEnvHelpJson(): void {
    process.stdout.write(
        JSON.stringify({
            command: "env",
            actions: ["list", "set", "unset", "reveal", "pull"]
        }) + "\n"
    );
}
