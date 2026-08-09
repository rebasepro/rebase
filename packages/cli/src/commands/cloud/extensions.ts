/**
 * `rebase cloud extensions` — allowlisted Postgres extensions.
 *
 *   extensions list                Every allowlisted extension + its real state
 *   extensions enable <name> [-y]   Install one (may restart the DB ⇒ needs -y)
 *   extensions disable <name>       Drop one (and remove any preload library)
 *
 * `manageable === false` is the anti-brick guard reaching the CLI: the server
 * has already said it will refuse, so enable/disable is never offered for such an
 * extension — its `manageableReason` is surfaced instead. Enabling one that
 * restarts the customer's database requires `--yes` in non-interactive use. The
 * `pgvector` alias resolves to `vector`, and a 202 (`pending`) means the database
 * is restarting and the extension is not installed yet — re-drive later.
 */
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    parseCloudArgs,
    emit,
    emitHelp,
    confirmDestructive,
    keyValues,
    success,
    fail,
    reportError,
    type CloudClient
} from "./context";

interface ExtensionStatus {
    name: string;
    displayName: string;
    description: string;
    requiresRestart: boolean;
    enabled: boolean;
    version: string | null;
    enabledAt: string | null;
    available: boolean;
    pendingRestart: boolean;
    manageable: boolean;
    manageableReason: string | null;
}

interface ExtensionListResponse {
    databaseType: "managed" | "byodb" | "none";
    reason: string;
    source: "database" | "record";
    extensions: ExtensionStatus[];
}

interface EnableResult {
    success: boolean;
    extension: string;
    pending?: boolean;
    restarted?: boolean;
    requiresRestart?: boolean;
    alreadyEnabled?: boolean;
    version?: string | null;
    recordWritten?: boolean;
    message: string;
}

interface DisableResult {
    success: boolean;
    extension: string;
    dropped: boolean;
    preloadRemoved: boolean;
    restarted?: boolean;
    message: string;
}

/** The identifier CREATE EXTENSION takes. `pgvector` is a common alias. */
export function resolveExtensionAlias(name: string): string {
    return name.toLowerCase() === "pgvector" ? "vector" : name;
}

async function fetchExtensions(client: CloudClient, projectId: string): Promise<ExtensionListResponse> {
    return client.functions.invoke<ExtensionListResponse>("extensions", undefined, {
        method: "GET",
        path: `list/${projectId}`
    });
}

export async function extensionsCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    switch (action) {
        case "list":
        case undefined:
            await listExtensions(rawArgs);
            break;
        case "enable":
            await enableExtension(rawArgs);
            break;
        case "disable":
            await disableExtension(rawArgs);
            break;
        case "--help":
            printExtensionsHelp();
            break;
        default:
            fail(`Unknown extensions command: ${action}`, "Try `rebase cloud extensions --help`.");
    }
}

async function listExtensions(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    try {
        const res = await fetchExtensions(client, projectId);
        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  🧩 Extensions — project ${projectRef}`) + chalk.gray(`  (${res.databaseType}, source: ${res.source})`));
                console.log("");
                if (res.source === "record") {
                    console.log(chalk.yellow("  ⚠ Database unreachable — showing cached state, not live catalog."));
                    console.log("");
                }
                for (const e of res.extensions) {
                    const state = e.enabled ? chalk.green("enabled") : chalk.gray("disabled");
                    const restart = e.requiresRestart ? chalk.yellow(" ⟳ restarts DB") : "";
                    const locked = !e.manageable ? chalk.gray(" [not manageable]") : "";
                    console.log(`  ${chalk.bold(e.name)} ${state}${e.version ? chalk.gray(` v${e.version}`) : ""}${restart}${locked}`);
                    if (!e.manageable && e.manageableReason) console.log(chalk.gray(`    ${e.manageableReason}`));
                }
                console.log("");
            },
            { projectId,
databaseType: res.databaseType,
reason: res.reason,
source: res.source,
extensions: res.extensions }
        );
    } catch (e) {
        reportError(e, "Failed to list extensions");
    }
}

/**
 * The extension `enable`/`disable` names, plus the flags that gate it.
 *
 * Under the old operand filter `rebase cloud extensions enable -p acme` read
 * `--project`'s value as the extension name and asked the server to install one
 * called "acme"; `extensions disable -p acme vector` dropped "acme" rather than
 * vector. Strict parsing consumes the flag with its value.
 */
export function resolveExtensionArgs(rawArgs: string[], action: "enable" | "disable") {
    const { flags, positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud extensions <action>
        command: `cloud extensions ${action}`,
        maxPositionals: 1
    });
    return { flags,
name: positionals[0] };
}

async function enableExtension(rawArgs: string[]): Promise<void> {
    const { flags: args, name: raw } = resolveExtensionArgs(rawArgs, "enable");
    if (!raw) fail("Usage: rebase cloud extensions enable <name>", undefined, "usage");
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const name = resolveExtensionAlias(raw!);

    try {
        // Consult the catalog first: never offer enable where the server says it
        // is not manageable, and gate a DB-restarting enable behind --yes.
        const list = await fetchExtensions(client, projectId);
        const ext = list.extensions.find((e) => e.name === name);
        if (ext && !ext.manageable) {
            fail(
                `Extension ${name} cannot be managed on this project.`,
                ext.manageableReason ?? undefined,
                "not_manageable"
            );
        }
        if (ext?.requiresRestart && !ext.enabled) {
            await confirmDestructive({
                yes: Boolean(args["--yes"]),
                prompt: `Enabling ${name} restarts the project's database. Continue?`
            });
        }

        const res = await client.functions.invoke<EnableResult>("extensions", { projectId,
extensionName: name }, { path: "enable" });
        emit(
            () => {
                if (res.pending) {
                    console.log("");
                    console.log(chalk.yellow(`  ⏳ ${res.message}`));
                    console.log(chalk.gray("  The database is restarting; re-run this once it is back to finish installing."));
                    console.log("");
                } else {
                    success(res.message || `Enabled ${name}`);
                    keyValues([["Version", res.version ?? undefined]]);
                }
            },
            {
                success: res.success,
                extension: res.extension,
                pending: res.pending ?? false,
                restarted: res.restarted ?? false,
                alreadyEnabled: res.alreadyEnabled ?? false,
                version: res.version ?? null,
                message: res.message
            }
        );
    } catch (e) {
        reportError(e, "Failed to enable extension");
    }
}

async function disableExtension(rawArgs: string[]): Promise<void> {
    const { flags: args, name: raw } = resolveExtensionArgs(rawArgs, "disable");
    if (!raw) fail("Usage: rebase cloud extensions disable <name>", undefined, "usage");
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const name = resolveExtensionAlias(raw!);

    try {
        const list = await fetchExtensions(client, projectId);
        const ext = list.extensions.find((e) => e.name === name);
        if (ext && !ext.manageable) {
            fail(
                `Extension ${name} cannot be managed on this project.`,
                ext.manageableReason ?? undefined,
                "not_manageable"
            );
        }
        if (ext?.requiresRestart && ext.enabled) {
            await confirmDestructive({
                yes: Boolean(args["--yes"]),
                prompt: `Disabling ${name} restarts the project's database. Continue?`
            });
        }

        const res = await client.functions.invoke<DisableResult>("extensions", { projectId,
extensionName: name }, { path: "disable" });
        emit(
            () => success(res.message || `Disabled ${name}`),
            {
                success: res.success,
                extension: res.extension,
                dropped: res.dropped,
                preloadRemoved: res.preloadRemoved,
                restarted: res.restarted ?? false,
                message: res.message
            }
        );
    } catch (e) {
        reportError(e, "Failed to disable extension");
    }
}

export function printExtensionsHelp(): void {
    emitHelp("extensions", ["list", "enable", "disable"], () => {
        console.log(`
${chalk.bold("rebase cloud extensions")} — Postgres extensions

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("list")}                      List extensions and their state
  ${chalk.blue.bold("enable")} ${chalk.gray("<name> [-y]")}        Enable one ${chalk.gray("(pgvector alias ⇒ vector)")}
  ${chalk.blue.bold("disable")} ${chalk.gray("<name>")}            Disable one

${chalk.green.bold("Options")}
  ${chalk.blue("--yes, -y")}                 Confirm a DB-restarting change
  ${chalk.blue("--json")}                    Machine-readable output
  ${chalk.blue("--project, -p")}             Project slug ${chalk.gray("(defaults to the linked project)")}
`);
    });
}
