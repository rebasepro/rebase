/**
 * The Rebase Cloud tools past provisioning: status, deploy, logs, env,
 * deployment history and rollback.
 *
 * Each one is `rebase cloud <command> --json`, spawned in the active project
 * directory — the same command a person runs, against the project that
 * directory is linked to, with whatever credential the CLI resolves there
 * (`REBASE_TOKEN`, the token `rebase cloud init --claim` stored, or the
 * `rebase cloud login` session). So there is no second implementation to drift
 * and no second authority: the control plane checks the call exactly as it
 * checks the CLI's.
 *
 * This module turns validated tool arguments into that argv and reads the one
 * JSON value the CLI prints back. It holds no I/O; `index.ts` spawns.
 *
 * The arguments are checked against the tool's own advertised `inputSchema`
 * (`validateToolArgs`), so what a client is told it may send and what is
 * accepted are one declaration, and every string that reaches argv either
 * matches a pattern that rules out a flag or rides in a `--flag=value` form
 * that keeps it a value.
 */

/** One property of a tool's input schema, the subset these tools use. */
export interface PropertySchema {
    type: "string" | "boolean" | "integer";
    description?: string;
    enum?: string[];
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
}

/** A tool's input schema, as it is advertised in `tools/list`. */
export interface ToolInputSchema {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
}

/** A refusal of a tool's arguments: nothing was spawned. */
export class ToolArgumentError extends Error {}

export type ToolArgs = Record<string, string | boolean | number>;

function isPropertySchema(value: unknown): value is PropertySchema {
    if (typeof value !== "object" || value === null || !("type" in value)) return false;
    return value.type === "string" || value.type === "boolean" || value.type === "integer";
}

/**
 * `args` checked against `schema`: unknown keys (under
 * `additionalProperties: false`), missing required keys, wrong types, enums,
 * lengths, patterns and integer bounds are each refused by name.
 */
export function validateToolArgs(toolName: string, schema: ToolInputSchema, args: unknown): ToolArgs {
    if (args === undefined || args === null) args = {};
    if (typeof args !== "object" || Array.isArray(args)) {
        throw new ToolArgumentError(`${toolName} takes an object of arguments.`);
    }
    const given = args as Record<string, unknown>;
    const known = Object.keys(schema.properties);
    if (schema.additionalProperties === false) {
        const unknown = Object.keys(given).filter((key) => !known.includes(key));
        if (unknown.length > 0) {
            throw new ToolArgumentError(
                `${toolName} does not take ${unknown.map((k) => `\`${k}\``).join(", ")}. ` +
                (known.length ? `It takes: ${known.map((k) => `\`${k}\``).join(", ")}.` : "It takes no arguments.")
            );
        }
    }
    for (const key of schema.required ?? []) {
        if (given[key] === undefined) throw new ToolArgumentError(`${toolName} needs \`${key}\`.`);
    }
    const out: ToolArgs = {};
    for (const key of known) {
        const value = given[key];
        if (value === undefined) continue;
        const prop = schema.properties[key];
        if (!isPropertySchema(prop)) throw new ToolArgumentError(`${toolName}: \`${key}\` has no usable schema.`);
        const where = `\`${key}\``;
        if (prop.type === "boolean") {
            if (typeof value !== "boolean") throw new ToolArgumentError(`${where} must be true or false.`);
            out[key] = value;
        } else if (prop.type === "integer") {
            if (typeof value !== "number" || !Number.isInteger(value)) throw new ToolArgumentError(`${where} must be a whole number.`);
            if (prop.minimum !== undefined && value < prop.minimum) throw new ToolArgumentError(`${where} must be at least ${prop.minimum}.`);
            if (prop.maximum !== undefined && value > prop.maximum) throw new ToolArgumentError(`${where} must be at most ${prop.maximum}.`);
            out[key] = value;
        } else {
            if (typeof value !== "string") throw new ToolArgumentError(`${where} must be a string.`);
            if (prop.enum && !prop.enum.includes(value)) {
                throw new ToolArgumentError(`${where} must be one of ${prop.enum.map((v) => `"${v}"`).join(", ")}.`);
            }
            if (prop.minLength !== undefined && value.length < prop.minLength) {
                throw new ToolArgumentError(`${where} must be at least ${prop.minLength} character${prop.minLength === 1 ? "" : "s"}.`);
            }
            if (prop.maxLength !== undefined && value.length > prop.maxLength) {
                throw new ToolArgumentError(`${where} must be at most ${prop.maxLength} characters.`);
            }
            if (prop.pattern !== undefined && !new RegExp(prop.pattern, "u").test(value)) {
                throw new ToolArgumentError(`${where} is not in the accepted form (${prop.pattern}).`);
            }
            out[key] = value;
        }
    }
    return out;
}

/** The names of the tools this module builds calls for. */
export const CLOUD_COMMAND_TOOLS = [
    "rebase_cloud_status",
    "rebase_cloud_deploy",
    "rebase_cloud_logs",
    "rebase_cloud_env_list",
    "rebase_cloud_env_set",
    "rebase_cloud_deployments_list",
    "rebase_cloud_rollback"
] as const;

export type CloudCommandTool = (typeof CLOUD_COMMAND_TOOLS)[number];

export function isCloudCommandTool(name: string): name is CloudCommandTool {
    return (CLOUD_COMMAND_TOOLS as readonly string[]).includes(name);
}

/** What `rebase_cloud_logs` returns when no `tail` is given. */
export const CLOUD_LOGS_DEFAULT_TAIL = 200;

/** The runtime-log arguments a build log has no meaning for. */
const RUNTIME_ONLY_LOG_ARGS = ["since", "grep", "level", "previous"] as const;

/** One spawn of the CLI, ready to run. */
export interface CloudCall {
    /** After `rebase`. Always ends in a `--json` somewhere. */
    argv: string[];
    /** Written to the child's stdin, then closed. Only `env set` uses it, for the value. */
    stdin?: string;
    /** Never to appear in what the tool returns: a variable's value. */
    secrets: string[];
    /** The command as a person would read it, for messages. */
    command: string;
    /** How many lines of any `logs` in the result to keep. */
    tailLines: number;
}

/** `validateToolArgs`, then the argv for that tool. Throws `ToolArgumentError`. */
export function cloudToolCall(name: CloudCommandTool, schema: ToolInputSchema, rawArgs: unknown): CloudCall {
    const args = validateToolArgs(name, schema, rawArgs);
    const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : undefined);
    const num = (key: string) => (typeof args[key] === "number" ? (args[key] as number) : undefined);
    const flag = (key: string) => args[key] === true;

    switch (name) {
        case "rebase_cloud_status":
            return { argv: ["cloud", "status", "--json"], secrets: [], command: "rebase cloud status", tailLines: CLOUD_LOGS_DEFAULT_TAIL };

        case "rebase_cloud_deploy": {
            const argv = ["cloud", "deploy"];
            const app = str("app");
            if (app) argv.push(app);
            argv.push("--json");
            if (flag("bundle")) argv.push("--bundle");
            const message = str("message");
            if (message !== undefined) argv.push(`--message=${message}`);
            if (args.wait === true) argv.push("--wait");
            if (args.wait === false) {
                if (num("timeoutSeconds") !== undefined) {
                    throw new ToolArgumentError("`timeoutSeconds` bounds the wait, and `wait: false` does not wait. Pass one of them.");
                }
                argv.push("--no-follow");
            }
            const timeout = num("timeoutSeconds");
            if (timeout !== undefined) argv.push(`--timeout=${timeout}`);
            const previewName = str("previewName");
            if (previewName !== undefined) argv.push(`--preview-name=${previewName}`);
            else if (flag("preview")) argv.push("--preview");
            return { argv, secrets: [], command: `rebase cloud deploy${app ? ` ${app}` : ""}`, tailLines: CLOUD_LOGS_DEFAULT_TAIL };
        }

        case "rebase_cloud_logs": {
            const source = str("source") ?? "runtime";
            const tailLines = num("tail") ?? CLOUD_LOGS_DEFAULT_TAIL;
            const argv = ["cloud", "logs"];
            if (source === "runtime") {
                argv.push("--runtime", "--json", `--tail=${tailLines}`);
                const since = str("since");
                if (since !== undefined) argv.push(`--since=${since}`);
                const grep = str("grep");
                if (grep !== undefined) argv.push(`--grep=${grep}`);
                const level = str("level");
                if (level !== undefined) argv.push(`--level=${level}`);
                if (flag("previous")) argv.push("--previous");
            } else {
                const stray = RUNTIME_ONLY_LOG_ARGS.filter((key) => args[key] !== undefined);
                if (stray.length > 0) {
                    throw new ToolArgumentError(
                        `${stray.map((k) => `\`${k}\``).join(", ")} ${stray.length === 1 ? "reads" : "read"} the running app's log, ` +
                        "and `source: \"build\"` is the latest build's. Drop them, or use `source: \"runtime\"`."
                    );
                }
                argv.push("--json");
            }
            const preview = str("preview");
            if (preview !== undefined) argv.push("--preview", preview);
            return { argv, secrets: [], command: `rebase cloud logs${source === "runtime" ? " --runtime" : ""}`, tailLines };
        }

        case "rebase_cloud_env_list": {
            const argv = ["cloud", "env", "list", "--json"];
            if (flag("preview")) argv.push("--preview");
            return { argv, secrets: [], command: "rebase cloud env list", tailLines: CLOUD_LOGS_DEFAULT_TAIL };
        }

        case "rebase_cloud_env_set": {
            const key = str("key") ?? "";
            const value = str("value") ?? "";
            // The value goes through stdin: on argv every process on the
            // machine could read it, and it would be in this server's own
            // spawn arguments.
            const argv = ["cloud", "env", "set", key, "--stdin", "--json"];
            if (flag("secret")) argv.push("--secret");
            if (flag("preview")) argv.push("--preview");
            return { argv, stdin: value, secrets: value ? [value] : [], command: `rebase cloud env set ${key}`, tailLines: CLOUD_LOGS_DEFAULT_TAIL };
        }

        case "rebase_cloud_deployments_list": {
            const argv = ["cloud", "deployments", "list", "--json"];
            const limit = num("limit");
            if (limit !== undefined) argv.push(`--limit=${limit}`);
            return { argv, secrets: [], command: "rebase cloud deployments list", tailLines: CLOUD_LOGS_DEFAULT_TAIL };
        }

        case "rebase_cloud_rollback": {
            const argv = ["cloud", "rollback"];
            const id = str("deploymentId");
            if (id) argv.push(id);
            // The tool call is the confirmation: an MCP call has no terminal to
            // prompt on, and the CLI refuses to roll back without one or this.
            argv.push("--yes", "--json");
            return { argv, secrets: [], command: `rebase cloud rollback${id ? ` ${id}` : ""}`, tailLines: CLOUD_LOGS_DEFAULT_TAIL };
        }
    }
}

/** Every secret in `text` replaced. Short values too: a value is never echoed, whatever its length. */
export function redactSecrets(text: string, secrets: string[]): string {
    let out = text;
    for (const secret of secrets) {
        if (secret) out = out.split(secret).join("[redacted]");
    }
    return out;
}

/**
 * The one JSON value the CLI printed on stdout, or undefined when it printed
 * none. A build tool a deploy runs can write to stdout ahead of it, so when
 * the whole of stdout does not parse, the last object that starts a line and
 * runs to the end is the result.
 */
export function parseCliJson(stdout: string): unknown {
    const text = stdout.trim();
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        // fall through to the trailing object
    }
    for (let at = text.lastIndexOf("\n{"); at !== -1; at = text.lastIndexOf("\n{", at - 1)) {
        try {
            return JSON.parse(text.slice(at + 1));
        } catch {
            if (at === 0) break;
        }
    }
    return undefined;
}

/** A refusal the CLI printed (`{ error: { code, message, … } }`), or null. */
export function cliRefusal(value: unknown): { code: string; status: number | null; message: string; error: Record<string, unknown> } | null {
    if (typeof value !== "object" || value === null || !("error" in value)) return null;
    const error = value.error;
    if (typeof error !== "object" || error === null) return null;
    const record = error as Record<string, unknown>;
    return {
        code: typeof record.code === "string" ? record.code : "error",
        status: typeof record.status === "number" ? record.status : null,
        message: typeof record.message === "string" ? record.message : "",
        error: record
    };
}

/** The last `count` lines of a log, and whether any were dropped. */
export function tailLog(logs: string, count: number): { logs: string; dropped: number } {
    const lines = logs.replace(/\n$/, "").split("\n");
    if (lines.length <= count) return { logs, dropped: 0 };
    return { logs: lines.slice(-count).join("\n"), dropped: lines.length - count };
}

/**
 * A value with every `logs` string in it cut to its last `count` lines: a
 * failed deploy's error carries the whole build log, and a build log has no
 * tail of its own. What was dropped is said beside it.
 */
export function withTailedLogs(value: unknown, count: number): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
        if (key === "logs" && typeof field === "string") {
            const { logs, dropped } = tailLog(field, count);
            out.logs = logs;
            if (dropped > 0) out.logsLinesDropped = dropped;
        } else if (key === "error") {
            out.error = withTailedLogs(field, count);
        } else {
            out[key] = field;
        }
    }
    return out;
}

/**
 * The way forward after a refusal this server recognises, or null. Written
 * here, so it is trusted text; the CLI's own message stays fenced as untrusted
 * data beside it.
 */
export function cloudRefusalNext(tool: CloudCommandTool, refusal: { code: string; status: number | null; message: string }): string | null {
    switch (refusal.code) {
        case "no_project":
            return "This directory is not linked to a Rebase Cloud project. rebase_cloud_provision gives it one without an account; " +
                "otherwise ask the user to run `rebase cloud link` (or `rebase cloud projects create --link`) here.";
        case "not_logged_in":
        case "session_expired":
            return "The CLI holds no usable credential for the control plane here. Ask the user to run `rebase cloud login`, " +
                "or to set REBASE_TOKEN (from `rebase cloud tokens create`) in this server's environment.";
        case "token_rejected":
            return "The control plane refused the CLI's token. An unclaimed project's token stops working once it is claimed or expires: " +
                "ask the user to sign in with `rebase cloud login` as the account that claimed it.";
        case "session_required":
            return "This needs a person's signed-in session, and the CLI here holds a token. Ask the user to run it.";
        case "payment_required":
            return "The project's organization has no payment method on file, so nothing was deployed. Only the user can add one: " +
                "`rebase cloud billing setup`.";
        case "managed_project":
            return "This project runs on the managed runtime: call rebase_cloud_deploy again with `bundle: true`. " +
                "Moving it off the managed runtime is the user's decision, and no tool here makes it.";
        case "FRAMEWORK_DOWNGRADE":
            return "The bundle was built on an older framework release than the project runs, so nothing was deployed. " +
                "Run `rebase upgrade` in the project and deploy again. Deploying the older release on purpose is the user's call.";
        case "deploy_failed":
            return "The deploy failed: `reason` and the end of `logs` below say why. Fix it and deploy again; " +
                "rebase_cloud_rollback puts the last good deployment back if production is broken.";
        case "build_time_variable":
            return "Nothing was set: the bundler reads this variable at build time, before project variables are applied. " +
                "It belongs in the build (the shell running the deploy, or the app's .env.production), not here.";
        case "deploy_not_rollbackable":
        case "no_deployments":
            return "Nothing was rolled back. rebase_cloud_deployments_list marks the deployments that can be returned to (`rollbackable: true`).";
        case "already_claimed":
            return "The project was claimed: ask the user to sign in with `rebase cloud login` as the account that claimed it.";
        default:
            break;
    }
    if (tool === "rebase_cloud_env_set" && refusal.code === "usage" && refusal.message.includes("--stdin")) {
        return "This project's rebase CLI predates `env set --stdin`, so the value was not sent. Upgrade @rebasepro/cli in the project " +
            "(this server never puts a value on a command line).";
    }
    if (refusal.status === 403 || refusal.code === "platform_permission_denied") {
        return "The credential the CLI used may not do this on this project. Ask the user; a token from `rebase cloud tokens create` " +
            "can be granted the capability.";
    }
    return null;
}

/** What to do with a successful result, as trusted text placed before the fenced data. */
export function cloudSuccessNext(tool: CloudCommandTool, call: CloudCall): string {
    switch (tool) {
        case "rebase_cloud_status":
            return "When `unclaimed` is set, the project is deleted at `unclaimed.expiresAt` unless the user opens `unclaimed.claimUrl` " +
                "and signs in: give them that link. A non-null `blockedOn` names something only the user can do; polling will not change it.";
        case "rebase_cloud_deploy":
            return call.argv.includes("--no-follow")
                ? "The deploy was triggered and not followed. rebase_cloud_status shows when it finishes; rebase_cloud_logs with " +
                    "`source: \"build\"` shows its build log."
                : "The deploy finished. `live` says whether the new version answered; rebase_cloud_logs shows what it prints.";
        case "rebase_cloud_logs":
            return call.argv.includes("--runtime")
                ? "Pass `nextSinceTime` back as `since` to read only what came after."
                : "This is the latest deployment's build log.";
        case "rebase_cloud_env_list":
            return "Values are never listed. rebase_cloud_env_set replaces one; a change applies on the next rebase_cloud_deploy.";
        case "rebase_cloud_env_set":
            return "It applies on the next deploy: run rebase_cloud_deploy.";
        case "rebase_cloud_deployments_list":
            return "`rollbackable: true` marks the deployments rebase_cloud_rollback can return to.";
        case "rebase_cloud_rollback":
            return "The rollback is a new deployment. rebase_cloud_status shows when it is live; rebase_cloud_logs with `source: \"build\"` shows its progress.";
    }
}

/**
 * What `rebase_cloud_env_set` hands back: the shape of what was stored, from
 * its own arguments and the CLI's booleans — never a value, and nothing the
 * control plane wrote, so it needs no fence.
 */
export function envSetResult(call: CloudCall, value: unknown): Record<string, unknown> {
    const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const bool = (key: string) => (typeof record[key] === "boolean" ? record[key] : null);
    return {
        key: call.argv[3],
        secret: bool("secret"),
        preview: call.argv.includes("--preview"),
        pendingRedeploy: bool("pendingRedeploy")
    };
}
