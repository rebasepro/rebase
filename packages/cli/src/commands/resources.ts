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
import { findBackendApp, loadManifest, ManifestError } from "../manifest";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import {
    RESOURCE_GRAPH_FILENAME,
    deriveOptionsFor, deriveResourceGraph,
    projectResourceGraph,
    readResourceGraphFile,
    serializeResourceGraph,
    writeResourceGraphFile,
    type ProjectedResource
} from "../resources/derive";
import { declaredSubscriptions, type RebaseBackendAppConfig } from "@rebasepro/types";

function usage(): void {
    console.log(`
${chalk.bold("rebase resources")} — what this project needs

  ${chalk.blue("rebase resources")}            List them, declared and implicit
  ${chalk.blue("rebase resources --write")}    Regenerate ${RESOURCE_GRAPH_FILENAME}
  ${chalk.blue("rebase resources --check")}    Fail if the committed graph is stale
  ${chalk.blue("rebase resources --json")}     The same set, machine-readable

A resource is declared in config code — ${chalk.gray('database("analytics"), bucket("media"), topic("signups")')} —
and never in ${RESOURCE_GRAPH_FILENAME}, which is generated from those declarations so a host
can read what a project needs without building it. A backend also has a default
database and a default storage source nobody declared; both are listed here,
marked ${chalk.gray("implicit")}, and neither is written to that file — the host supplies them.
`);
}

/**
 * Render the projection the way somebody reads it: grouped by kind, key first.
 *
 * The projection, not the raw graph. `rebase status` has always included the
 * implicit default database and bucket and this listing did not, so the two
 * commands answered "what does this project need" differently on the same stock
 * scaffold. There is no "no resources declared" case any more: a backend has a
 * database and a storage source whether or not anyone wrote them down.
 */
function print(resources: ProjectedResource[]): void {
    // Infrastructure first, then code: what needs binding is what a reader
    // is here to check.
    const order = ["database", "bucket", "topic", "queue", "cron", "function"];
    const kinds = [...new Set(resources.map(r => r.kind))]
        .sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
    for (const kind of kinds) {
        console.log(`\n  ${chalk.bold(kind)}`);
        for (const r of resources.filter(x => x.kind === kind)) {
            const bits: string[] = [];
            if (kind === "cron") {
                bits.push(chalk.cyan(String(r.options.schedule)));
                bits.push(chalk.gray(r.options.timezone ? String(r.options.timezone) : "local time"));
            } else if (kind === "function") {
                bits.push(chalk.gray(String(r.options.file ?? "")));
                if (r.options.portable === false) bits.push(chalk.yellow("node-only"));
            } else {
                bits.push(chalk.gray(r.engine));
                if (r.transport !== "server") bits.push(chalk.yellow(r.transport));
                for (const [k, v] of Object.entries(r.options)) bits.push(chalk.gray(`${k}=${String(v)}`));
            }
            // Marked, not hidden: a declared resource is recorded in
            // `rebase.resources.json` for a host to provision, and an implicit
            // one is a default the runtime supplies regardless.
            if (r.implicit) bits.push(chalk.gray("implicit"));
            console.log(`    ${r.key.padEnd(24)} ${bits.join(" · ")}`);
            if (kind === "topic") {
                for (const sub of declaredSubscriptions(r.key)) {
                    console.log(`      ${chalk.gray("→")} ${sub.name}`);
                }
            }
            if (r.usedBy && r.usedBy.length > 0) {
                console.log(`      ${chalk.gray("used by")} ${chalk.gray(r.usedBy.join(", "))}`);
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

    let backendApp: RebaseBackendAppConfig;
    try {
        const loaded = loadManifest(projectRoot);
        const backend = findBackendApp(loaded.manifest);
        if (!backend) {
            console.error(chalk.red("This project declares no backend app, so it declares no resources."));
            process.exitCode = 1;
            return;
        }
        backendApp = backend.app;
    } catch (err) {
        if (err instanceof ManifestError) {
            console.error(chalk.red(err.message));
            for (const issue of err.issues) console.error(`  ${chalk.gray(issue.path)} ${issue.message}`);
            process.exitCode = 1;
            return;
        }
        throw err;
    }

    const { graph, issues } = await deriveResourceGraph(deriveOptionsFor(projectRoot, backendApp));

    if (issues.length > 0) {
        console.error(chalk.red(`\n✗ ${issues.length} problem(s) in the declared resources:\n`));
        for (const issue of issues) console.error(`  ${chalk.bold(issue.path)}  ${issue.message}`);
        console.error("");
        process.exitCode = 1;
        return;
    }

    if (flags["--json"]) {
        // The projection, so this and `rebase status --json` describe the same
        // set. `version` is kept so a reader of either can tell them apart from
        // a future shape.
        console.log(JSON.stringify({ version: graph.version, resources: projectResourceGraph(graph) }, null, 2));
        return;
    }

    if (flags["--check"]) {
        const committed = readResourceGraphFile(projectRoot);
        const expected = serializeResourceGraph(graph);
        if (committed === expected) {
            console.log(chalk.green(`✓ ${RESOURCE_GRAPH_FILENAME} matches the declarations.`));
            return;
        }
        // Declaring nothing and having no file is a consistent state, not a
        // stale one. The file records declarations; a project with none has
        // nothing to record, and its default database and bucket are implicit
        // by design — that is the overwhelmingly common project and it must not
        // be required to commit an empty file saying so.
        //
        // This mattered the moment the check was put in a gate: it would have
        // failed this repository's own reference app, which declares nothing,
        // and every scaffolded project until someone declared a second bucket.
        if (committed === null && graph.resources.length === 0) {
            console.log(chalk.gray("✓ Nothing declared, so there is nothing to record."));
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

    print(projectResourceGraph(graph));
}
