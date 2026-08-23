/**
 * CLI command: rebase resources
 *
 * Shows what a project declares, and keeps the committed graph honest.
 *
 * The graph is generated, so it can drift the moment somebody adds a bucket and
 * does not regenerate. Drift here is not cosmetic: the committed file is what a
 * host reads to decide what to provision, so a stale one means the console
 * offers a project one set of resources while the runtime asks for another.
 * `--check` is the gate that makes that impossible to land.
 */
import chalk from "chalk";
import path from "path";
import { requireProjectRoot } from "../utils/project";
import { findBackendApp, loadManifest, ManifestError, resolveBackendPaths } from "../manifest";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import {
    RESOURCE_GRAPH_FILENAME,
    deriveResourceGraph,
    readResourceGraphFile,
    serializeResourceGraph,
    writeResourceGraphFile
} from "../resources/derive";
import { declaredSubscriptions, type ResourceGraph } from "@rebasepro/types";

function usage(): void {
    console.log(`
${chalk.bold("rebase resources")} — what this project declares it needs

  ${chalk.blue("rebase resources")}            List the declared resources
  ${chalk.blue("rebase resources --write")}    Regenerate ${RESOURCE_GRAPH_FILENAME}
  ${chalk.blue("rebase resources --check")}    Fail if the committed graph is stale
  ${chalk.blue("rebase resources --json")}     The graph, machine-readable

A resource is declared in config code — ${chalk.gray('database("analytics"), bucket("media"), topic("signups")')} —
and never in ${RESOURCE_GRAPH_FILENAME}, which is generated from those declarations so a host
can read what a project needs without building it.
`);
}

/** Render the graph the way somebody reads it: grouped by kind, key first. */
function print(graph: ResourceGraph): void {
    if (graph.resources.length === 0) {
        console.log(chalk.gray("\n  No resources declared. A backend still has its default database.\n"));
        return;
    }
    const kinds = [...new Set(graph.resources.map(r => r.kind))];
    for (const kind of kinds) {
        console.log(`\n  ${chalk.bold(kind)}`);
        for (const r of graph.resources.filter(x => x.kind === kind)) {
            const bits = [chalk.gray(r.engine)];
            if (r.transport !== "server") bits.push(chalk.yellow(r.transport));
            for (const [k, v] of Object.entries(r.options)) bits.push(chalk.gray(`${k}=${String(v)}`));
            console.log(`    ${r.key.padEnd(24)} ${bits.join(" · ")}`);
            if (kind === "topic") {
                for (const sub of declaredSubscriptions(r.key)) {
                    console.log(`      ${chalk.gray("→")} ${sub.name}`);
                }
            }
        }
    }
    console.log("");
}

export async function resourcesCommand(rawArgs: string[]): Promise<void> {
    if (wantsHelp(rawArgs)) return usage();

    const { flags } = parseCommandArgs({
        spec: {
            "--write": Boolean,
            "--check": Boolean,
            "--json": Boolean
        },
        rawArgs,
        commandWords: 1,
        command: "resources",
        maxPositionals: 0
    });

    const projectRoot = requireProjectRoot();

    let configDir: string;
    try {
        const loaded = loadManifest(projectRoot);
        const backend = findBackendApp(loaded.manifest);
        if (!backend) {
            console.error(chalk.red("This project declares no backend app, so it declares no resources."));
            process.exitCode = 1;
            return;
        }
        configDir = path.join(projectRoot, resolveBackendPaths(backend.app, projectRoot).config);
    } catch (err) {
        if (err instanceof ManifestError) {
            console.error(chalk.red(err.message));
            for (const issue of err.issues) console.error(`  ${chalk.gray(issue.path)} ${issue.message}`);
            process.exitCode = 1;
            return;
        }
        throw err;
    }

    const { graph, issues } = await deriveResourceGraph({ configDir });

    if (issues.length > 0) {
        console.error(chalk.red(`\n✗ ${issues.length} problem(s) in the declared resources:\n`));
        for (const issue of issues) console.error(`  ${chalk.bold(issue.path)}  ${issue.message}`);
        console.error("");
        process.exitCode = 1;
        return;
    }

    if (flags["--json"]) {
        console.log(JSON.stringify(graph, null, 2));
        return;
    }

    if (flags["--check"]) {
        const committed = readResourceGraphFile(projectRoot);
        const expected = serializeResourceGraph(graph);
        if (committed === expected) {
            console.log(chalk.green(`✓ ${RESOURCE_GRAPH_FILENAME} matches the declarations.`));
            return;
        }
        console.error(chalk.red(`\n✗ ${RESOURCE_GRAPH_FILENAME} is ${committed === null ? "missing" : "stale"}.\n`));
        console.error(
            "  A host reads this file to decide what to provision, so a stale one means the\n" +
            "  console offers one set of resources while the runtime asks for another.\n"
        );
        console.error(`  Regenerate it:  ${chalk.blue("rebase resources --write")}\n`);
        process.exitCode = 1;
        return;
    }

    if (flags["--write"]) {
        const { changed, file } = writeResourceGraphFile(projectRoot, graph);
        console.log(changed
            ? chalk.green(`✓ Wrote ${path.relative(projectRoot, file)}`)
            : chalk.gray(`${path.relative(projectRoot, file)} already matched the declarations.`));
        return;
    }

    print(graph);
}
