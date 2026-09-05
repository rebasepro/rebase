/**
 * `rebase cloud resources` — what a project declares against what the platform
 * holds for it, and the one removal a deploy is not allowed to make.
 *
 * `rebase resources` reads the code. This reads the platform: each database
 * and bucket the project's deploys recorded, whether the last deploy's code
 * still declares it, and whether the platform made it. The two disagree in
 * exactly two ways worth a line — declared and not configured, which is a 501
 * waiting to happen, and provisioned and no longer declared, which is a
 * database the platform keeps, binds and bills until somebody prunes it.
 *
 * Pruning is here rather than in the deploy on purpose. A deploy that deleted
 * a database because a line went missing from a commit would be data deleted
 * by a push; this asks, names the key, and needs the project's admin role.
 */
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    parseCloudArgs,
    emit,
    confirmDestructive,
    success,
    fail,
    reportError
} from "./context";

interface ResourceRow {
    kind: "database" | "bucket";
    key: string;
    engine?: string;
    declared: boolean;
    provisioned: boolean;
    note?: string;
}

export async function declaredResourcesCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    switch (action) {
        case undefined:
        case "list":
            await listResources(rawArgs);
            break;
        case "prune":
            await pruneResource(rawArgs);
            break;
        case "--help":
            printDeclaredResourcesHelp();
            break;
        default:
            fail(`Unknown resources command: ${action}`, "Try `rebase cloud resources --help`.");
    }
}

export function printDeclaredResourcesHelp(): void {
    console.log(`
${chalk.bold("rebase cloud resources")} — what this project declares, against what the platform holds

  ${chalk.blue("rebase cloud resources")}                          List each database and bucket: declared? provisioned?
  ${chalk.blue("rebase cloud resources prune database <key>")}     Remove a provisioned database the code no longer declares

A deploy records what your code declares and provisions what it can. It never removes
anything: a database that vanishes from a commit is kept, bound and billed until you
prune it here. For what the code declares, run ${chalk.blue("rebase resources")}; for CPU, memory
and cost, ${chalk.blue("rebase cloud compute")}.
`);
}

async function listResources(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    try {
        const res = await client.functions.invoke<{ resources: ResourceRow[] }>("resources", undefined, {
            method: "GET",
            path: projectId
        });
        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  Resources — project ${projectRef}`));
                if (res.resources.length === 0) {
                    console.log(chalk.gray("  Nothing recorded beyond the default database. Deploy once and this fills in."));
                    console.log("");
                    return;
                }
                for (const kind of ["database", "bucket"] as const) {
                    const rows = res.resources.filter(r => r.kind === kind);
                    if (rows.length === 0) continue;
                    console.log("");
                    console.log(`  ${chalk.bold.underline(`${kind}s`)}`);
                    for (const row of rows) {
                        const mark = row.declared && (row.provisioned || row.kind === "bucket")
                            ? chalk.green("✓")
                            : row.note ? chalk.yellow("○") : chalk.gray("·");
                        const tags = [
                            row.engine ? chalk.gray(row.engine) : "",
                            row.declared ? chalk.gray("declared") : chalk.yellow("not declared"),
                            row.provisioned ? chalk.gray("platform-provisioned") : chalk.gray("your own")
                        ].filter(Boolean);
                        console.log(`  ${mark} ${chalk.bold(row.key)}  ${tags.join(" · ")}`);
                        if (row.note) console.log(chalk.yellow(`      └ ${row.note}`));
                    }
                }
                console.log("");
            },
            { projectId, resources: res.resources }
        );
    } catch (e) {
        reportError(e, "Failed to list resources");
    }
}

async function pruneResource(rawArgs: string[]): Promise<void> {
    const { flags: args, positionals } = parseCloudArgs({
        spec: { "--yes": Boolean },
        rawArgs,
        commandWords: 3, // cloud resources prune
        command: "cloud resources prune",
        maxPositionals: 2 // <kind> <key>
    });
    const [kind, key] = positionals;
    if (kind !== "database" || !key) {
        fail(
            "Say what to prune: `rebase cloud resources prune database <key>`.",
            "Only a database can be pruned here; a bucket and its files are removed in the project's storage settings.",
            "invalid_argument"
        );
    }

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    await confirmDestructive({
        yes: Boolean(args["--yes"]),
        prompt: `Drop database "${key}" from project ${projectRef}? Its rows are gone for good; the platform keeps no copy.`
    });

    try {
        const res = await client.functions.invoke<{ removed: boolean; pendingRedeploy?: boolean }>(
            "resources",
            { projectId, kind, key },
            { path: "prune" }
        );
        success(`Removed database ${chalk.bold(key)} from project ${projectRef}.`);
        if (res.pendingRedeploy) {
            console.log(chalk.gray("  Its connection string leaves the running backend at the next deploy."));
        }
        emit(() => {}, { projectId, kind, key, removed: res.removed });
    } catch (e) {
        reportError(e, `Failed to prune database "${key}"`);
    }
}
