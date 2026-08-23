/**
 * The `rebase eject infra` handler: derive the graph, write the infra config.
 *
 * Kept apart from the pure builder so the builder stays trivially testable —
 * it takes a graph and returns an object, with no project, no filesystem and
 * no console in it.
 */
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { findBackendApp, loadManifest, ManifestError, resolveBackendPaths } from "../manifest";
import { deriveResourceGraph } from "./derive";
import { buildInfraConfig, describeEjectedInfra, serializeInfraConfig } from "./eject-infra";

/** The conventional filename, matching what the runtime binder looks for. */
export const INFRA_CONFIG_FILENAME = "rebase.infra.json";

export interface EjectInfraOptions {
    dryRun: boolean;
    force: boolean;
}

export async function ejectInfra(projectRoot: string, options: EjectInfraOptions): Promise<void> {
    const target = path.join(projectRoot, INFRA_CONFIG_FILENAME);

    // Checked before the graph is derived: refusing after evaluating a
    // project's config makes the user wait to be told no.
    if (fs.existsSync(target) && !options.force && !options.dryRun) {
        console.error(chalk.red(`✗ ${INFRA_CONFIG_FILENAME} already exists.`));
        console.error(
            "\n  Overwriting it would discard whatever you edited, which is the whole\n" +
            "  point of having ejected. Pass --force if that is what you want.\n"
        );
        process.exitCode = 1;
        return;
    }

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
        console.error("\n  Fix these first — an infra config generated from a broken graph would\n  be missing exactly the resources you could not declare.\n");
        process.exitCode = 1;
        return;
    }

    const config = buildInfraConfig(graph);
    const contents = serializeInfraConfig(config);

    if (options.dryRun) {
        console.log(chalk.gray(`\n  Would write ${INFRA_CONFIG_FILENAME}:\n`));
        console.log(contents);
        return;
    }

    fs.writeFileSync(target, contents);
    console.log(chalk.green(`\n✓ ${describeEjectedInfra(config, INFRA_CONFIG_FILENAME)}`));
}
