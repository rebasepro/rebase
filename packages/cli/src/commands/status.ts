/**
 * `rebase status` — what this project is, and whether it can reach its things.
 *
 * The model a developer has to hold is small and was nowhere visible:
 *
 *   rebase.json           where the code is, and who runs the server
 *   config/resources.ts   what the project needs
 *   the environment       how to reach each of them
 *
 * Everything else — `rebase.resources.json`, the bundle manifest — is a
 * generated copy of the middle one, for readers that cannot run the code. A
 * developer never writes them and should not have to think about them.
 *
 * This command prints the three together, resolved. It exists because the
 * question people actually arrive with — "why does uploading to `media` answer
 * 501" — was answerable only by knowing the `<BASE>__<KEY>` suffix rule,
 * deriving the variable name by hand, and checking it against a `.env` they had
 * to find first. Every step of that is mechanical, so it is printed instead.
 */
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import { readEnvFile, requireProjectRoot } from "../utils/project";
import { findBackendApp, loadManifest, ManifestError, resolveBackendPaths } from "../manifest";
import { deriveOptionsFor, deriveResourceGraph, RESOURCE_GRAPH_FILENAME, readResourceGraphFile, serializeResourceGraph } from "../resources/derive";
import { computeStatus, type ResourceStatus } from "../resources/status";
import type { RebaseBackendAppConfig } from "@rebasepro/types";

function usage(): void {
    console.log(`
${chalk.bold("rebase status")} — what this project declares, and whether it is configured

${chalk.bold("Usage")}
  rebase status                Show every resource and the variables it reads
  rebase status --json         The same, as JSON

${chalk.bold("Reads")}
  rebase.json                  which apps exist, and who owns the server process
  <config>/resources.ts        the databases, buckets, topics and queues declared
  backend/crons, backend/functions   the crons and functions, by filename
  .env                         whether each one's variables are set
`);
}

const MARK = {
    ready: chalk.green("✓"),
    unconfigured: chalk.yellow("○"),
    broken: chalk.red("✗")
} as const;

function printResource(status: ResourceStatus): void {
    const name = status.key === "(default)" ? chalk.bold("(default)") : chalk.bold(status.key);
    const tags = [chalk.gray(status.engine)];
    if (status.transport !== "server") tags.push(chalk.yellow(status.transport));
    if (status.account) tags.push(chalk.gray(`account:${status.account}`));
    if (status.implicit) tags.push(chalk.gray("implicit"));
    // A stand-in is not a binding. It is shown in yellow beside a green tick:
    // uploads work here, and the same declaration answers 501 in production
    // until the variable is set.
    if (status.standsIn) tags.push(chalk.yellow(`local stand-in for ${status.standsIn}`));

    console.log(`  ${MARK[status.state]} ${name}  ${tags.join(" · ")}`);
    if (status.usedBy && status.usedBy.length > 0) {
        console.log(`      ${chalk.gray("used by")} ${chalk.gray(status.usedBy.join(", "))}`);
    }

    let hiddenOptional = 0;
    for (const binding of status.bindings) {
        if (binding.set) {
            console.log(`      ${chalk.green("✓")} ${chalk.gray(binding.name)}`);
        } else if (binding.fallback?.set) {
            // Not a gap: the account form is the variable this bucket is
            // actually reading, and showing only the unset per-key name would
            // send someone to set the one they were deliberately avoiding.
            console.log(`      ${chalk.green("✓")} ${chalk.gray(binding.fallback.name)} ${chalk.gray(`(shared, for ${binding.name})`)}`);
        } else if (status.state === "ready") {
            // It resolved without this one, so this one is optional — which is
            // the resolver's answer, not a second table of required names kept
            // here. Listing seven unset optionals under a working database is
            // how a status view teaches people to skim past the line that
            // matters.
            hiddenOptional += 1;
        } else {
            const also = binding.fallback ? chalk.gray(` or ${binding.fallback.name}`) : "";
            console.log(`      ${chalk.gray("·")} ${chalk.gray(binding.name)}${also} ${chalk.gray("not set")}`);
        }
    }
    if (hiddenOptional > 0) {
        console.log(chalk.gray(`      ${hiddenOptional} optional variable${hiddenOptional === 1 ? "" : "s"} not set`));
    }

    if (status.detail) {
        const colour = status.state === "broken" ? chalk.red : status.state === "unconfigured" ? chalk.yellow : chalk.gray;
        console.log(`      ${colour(`└ ${status.detail}`)}`);
    }
}

export async function statusCommand(rawArgs: string[]): Promise<void> {
    if (wantsHelp(rawArgs)) return usage();

    const { flags } = parseCommandArgs({
        spec: { "--json": Boolean },
        rawArgs,
        commandWords: 1,
        command: "status",
        maxPositionals: 0
    });

    const projectRoot = requireProjectRoot();

    let backend: { name: string; app: RebaseBackendAppConfig };
    try {
        const loaded = loadManifest(projectRoot);
        const found = findBackendApp(loaded.manifest);
        if (!found) {
            console.error(chalk.red("This project declares no backend app, so it declares no resources."));
            process.exitCode = 1;
            return;
        }
        backend = found;
    } catch (err) {
        if (err instanceof ManifestError) {
            console.error(chalk.red(err.message));
            for (const issue of err.issues) console.error(`  ${chalk.gray(issue.path)} ${issue.message}`);
            process.exitCode = 1;
            return;
        }
        throw err;
    }

    const { name: backendName, app: backendApp } = backend;
    const paths = resolveBackendPaths(backendApp, projectRoot);
    const configDir = path.join(projectRoot, paths.config);

    const { graph, issues } = await deriveResourceGraph(deriveOptionsFor(projectRoot, backendApp));
    if (issues.length > 0) {
        console.error(chalk.red(`\n✗ ${issues.length} problem(s) in the declared resources:\n`));
        for (const issue of issues) console.error(`  ${chalk.bold(issue.path)}  ${issue.message}`);
        console.error("");
        process.exitCode = 1;
        return;
    }

    // The project's own `.env`, not this process's environment: `rebase status`
    // is asking what a deployment of THIS repository would do, and the shell a
    // developer happens to be standing in is not that.
    const env = readEnvFile(projectRoot);

    const server = await import("@rebasepro/server");
    const { resources, blocked } = computeStatus(graph, env, {
        resolverFor: server.resourceResolver as never,
        resolveDataSources: server.resolveDataSources as never,
        // Judged as production when the .env says so; a stand-in local
        // directory for an unbound bucket is only ever offered to development.
        production: env.NODE_ENV === "production"
    });

    if (flags["--json"]) {
        console.log(JSON.stringify({ backend: backendName, runtime: backendApp.runtime, resources, blocked }, null, 2));
        return;
    }

    const ownership = backendApp.runtime === "managed"
        ? "Rebase's runtime boots your bundle"
        : "this project builds its own image and entrypoint";

    console.log("");
    console.log(`  ${chalk.bold(backendName)}  ${chalk.gray("·")}  ${chalk.cyan(backendApp.runtime)}  ${chalk.gray(ownership)}`);
    // Named whether or not it exists, and said plainly when it does not. A
    // project with no `resources.ts` is legal — it has one default database and
    // one default bucket — but "declared in <a file you do not have>" reads as
    // a broken install rather than as the default it is.
    const resourcesFile = path.join(paths.config, "resources.ts");
    const declaresAnything = fs.existsSync(path.join(projectRoot, resourcesFile));
    console.log(`  ${chalk.gray("declared in")}  ${chalk.gray(resourcesFile)}${
        declaresAnything ? "" : chalk.gray("  (none — the defaults below are implicit)")}`);
    console.log(`  ${chalk.gray("configured by")}  ${chalk.gray(".env")}`);

    const kinds = [...new Set(resources.map(r => r.kind))];
    for (const kind of kinds) {
        console.log("");
        console.log(`  ${chalk.bold.underline(`${kind}s`)}`);
        for (const status of resources.filter(r => r.kind === kind)) printResource(status);
    }

    if (blocked) {
        console.log("");
        console.log(`  ${chalk.red("✗")} ${chalk.red(blocked)}`);
    }

    // Only worth a line when it is wrong. A generated file that matches its
    // declarations is not news, and a status view that reports its own
    // bookkeeping as an item trains people to skim past the items that matter.
    const committed = readResourceGraphFile(projectRoot);
    const expected = serializeResourceGraph(graph);
    if (committed !== expected && !(committed === null && graph.resources.length === 0)) {
        console.log("");
        console.log(`  ${chalk.yellow("○")} ${RESOURCE_GRAPH_FILENAME} is ${committed === null ? "missing" : "stale"} — ${chalk.blue("rebase resources --write")}`);
        console.log(chalk.gray("      a host reads it to decide what to provision before it runs anything"));
    }

    console.log("");
}
