/**
 * `rebase cloud deploy-hooks` — URLs that start a build of the project's
 * connected repository when something POSTs to them: a git host's webhook, a
 * CMS's publish button, a CI step.
 *
 *   deploy-hooks [list]                       The project's hooks: name, branch, last used
 *   deploy-hooks create [--name] [--branch]   Mint one, and print its URL once
 *   deploy-hooks revoke <id>                  Delete one; its URL stops working
 *
 * The control plane's `deploy` function serves them (`/hooks`), the same routes
 * the console's Settings use. The URL carries the hook's token, which is the
 * whole credential: the control plane keeps only its hash, so the URL is shown
 * once, at `create`, and never again.
 */
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    parseCloudArgs,
    requireKnownAction,
    confirmDestructive,
    emit,
    keyValues,
    note,
    success,
    fail,
    reportError,
    type CloudClient
} from "./context";

/** The action words `rebase cloud deploy-hooks` dispatches. No word means `list`. */
export const DEPLOY_HOOKS_ACTIONS = ["list", "create", "revoke"] as const;

/** What `deploy-hooks` parses. `--name` and `--branch` belong to `create`. */
export const DEPLOY_HOOKS_FLAGS = {
    "--name": String,
    "--branch": String
} as const;

/** A hook as the control plane lists it. Never its token. */
export interface CliDeployHook {
    id: string;
    name: string;
    /** The branch it builds; empty for the project's configured branch. */
    branch: string;
    createdAt: string | null;
    lastUsedAt: string | null;
}

/** The control plane's `deploy` function, where the hooks routes live. */
const DEPLOY_FUNCTION = "deploy";

function text(value: unknown): string | null {
    return typeof value === "string" && value !== "" ? value : null;
}

/** One hook from the wire, or null for one with no id. */
export function readHook(value: unknown): CliDeployHook | null {
    if (typeof value !== "object" || value === null) return null;
    const id = "id" in value ? value.id : undefined;
    if (typeof id !== "string" && typeof id !== "number") return null;
    return {
        id: String(id),
        name: ("name" in value ? text(value.name) : null) ?? "Deploy hook",
        branch: ("branch" in value ? text(value.branch) : null) ?? "",
        createdAt: "createdAt" in value ? text(value.createdAt) : null,
        lastUsedAt: "lastUsedAt" in value ? text(value.lastUsedAt) : null
    };
}

async function listHooks(client: CloudClient, projectId: string): Promise<CliDeployHook[]> {
    const res = await client.functions.invoke<{ hooks?: unknown[] }>(DEPLOY_FUNCTION, undefined, {
        method: "GET",
        path: `hooks?projectId=${encodeURIComponent(projectId)}`
    });
    return (res.hooks ?? []).map(readHook).filter((h): h is CliDeployHook => h !== null);
}

export async function deployHooksCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: DEPLOY_HOOKS_FLAGS,
        rawArgs,
        commandWords: 2, // cloud deploy-hooks — the action is the first positional
        command: "cloud deploy-hooks",
        maxPositionals: 2
    });
    const word = positionals[0] ?? action;
    requireKnownAction("deploy-hooks", word, DEPLOY_HOOKS_ACTIONS);
    const verb = word ?? "list";
    const id = positionals[1];
    if (verb !== "create" && (flags["--name"] !== undefined || flags["--branch"] !== undefined)) {
        fail("--name and --branch go with `deploy-hooks create`.", "Run `rebase cloud deploy-hooks --help`.", "usage");
    }
    if (verb !== "revoke" && id !== undefined) {
        fail(`Too many arguments for \`deploy-hooks ${verb}\`: ${id}`, "Run `rebase cloud deploy-hooks --help`.", "usage");
    }
    if (verb === "revoke" && !id) {
        fail("Name the hook to revoke.", "`rebase cloud deploy-hooks` lists them with their ids.", "usage");
    }

    const { client, url } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const label = `project ${displayProjectRef(rawArgs) || projectId}`;

    if (verb === "create") return createHook(client, url, projectId, label, flags["--name"], flags["--branch"]);
    if (verb === "revoke") return revokeHook(client, projectId, label, id!, flags["--yes"] === true);

    let hooks: CliDeployHook[];
    try {
        hooks = await listHooks(client, projectId);
    } catch (e) {
        reportError(e, "Failed to list deploy hooks");
    }
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🪝 Deploy hooks — ${label}`));
            console.log("");
            if (hooks.length === 0) {
                console.log(chalk.gray("  None. Mint one with `rebase cloud deploy-hooks create`."));
                console.log("");
                return;
            }
            for (const h of hooks) {
                const used = h.lastUsedAt ? `last used ${new Date(h.lastUsedAt).toLocaleString()}` : "never used";
                console.log(`  ${chalk.bold(h.name)} ${chalk.gray(`[${h.id}]`)}  ${h.branch || chalk.gray("project branch")}  ${chalk.gray(used)}`);
            }
            console.log("");
            note(chalk.gray("A hook's URL is shown only when it is created. Lost one? Revoke it and create another."));
            console.log("");
        },
        { projectId, hooks }
    );
}

async function createHook(
    client: CloudClient,
    url: string,
    projectId: string,
    label: string,
    name: string | undefined,
    branch: string | undefined
): Promise<void> {
    const body: Record<string, unknown> = { projectId };
    if (name?.trim()) body.name = name.trim();
    if (branch?.trim()) body.branch = branch.trim();

    let res: { hook?: unknown; token?: string; path?: string };
    try {
        res = await client.functions.invoke<{ hook?: unknown; token?: string; path?: string }>(DEPLOY_FUNCTION, body, { path: "hooks" });
    } catch (e) {
        reportError(e, "Failed to create the deploy hook");
    }
    const hook = readHook(res.hook);
    if (!hook || typeof res.token !== "string" || typeof res.path !== "string") {
        fail("The control plane created a hook but did not return its URL.", "Revoke it with `rebase cloud deploy-hooks revoke <id>` and try again.");
    }
    const hookUrl = `${url}${res.path.startsWith("/") ? "" : "/"}${res.path}`;
    emit(
        () => {
            success(`Created deploy hook ${chalk.bold(hook.name)} for ${label}.`);
            keyValues([
                ["Id", hook.id],
                ["Builds", hook.branch || "the project's configured branch"]
            ]);
            console.log("");
            console.log(`  ${chalk.cyan(hookUrl)}`);
            console.log("");
            note(chalk.gray("Shown once: the URL is the credential, and the control plane keeps only its hash."));
            note(chalk.gray("POST to it to build and ship the connected repository. A push to another branch, or a tag, is ignored."));
            console.log("");
        },
        { projectId, hook, url: hookUrl, token: res.token }
    );
}

async function revokeHook(client: CloudClient, projectId: string, label: string, id: string, yes: boolean): Promise<void> {
    let hooks: CliDeployHook[];
    try {
        hooks = await listHooks(client, projectId);
    } catch (e) {
        reportError(e, "Failed to list deploy hooks");
    }
    const hook = hooks.find(h => h.id === id);
    if (!hook) {
        fail(`${label} has no deploy hook ${id}.`, "`rebase cloud deploy-hooks` lists them with their ids.", "not_found");
    }
    await confirmDestructive({
        yes,
        prompt: `Revoke deploy hook "${hook.name}" (${hook.id}) of ${label}? Anything that POSTs to its URL is refused from then on.`
    });
    try {
        await client.functions.invoke(DEPLOY_FUNCTION, undefined, { method: "DELETE", path: `hooks/${encodeURIComponent(id)}` });
    } catch (e) {
        reportError(e, "Failed to revoke the deploy hook");
    }
    emit(() => success(`Revoked deploy hook ${hook.name}; its URL no longer works.`), { projectId, revoked: hook });
}
