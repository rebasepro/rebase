import chalk from "chalk";

import { describeState } from "../telemetry/consent";
import { configPath, endpoint, previewEvent, readConfig, readProjectPolicy, setConsent } from "../telemetry";
import { unknownCommand } from "../utils/unknown-command";

/**
 * `rebase telemetry` — the command that makes the rest of it inspectable.
 *
 * The whole subsystem asks for trust it cannot otherwise earn, and the cheapest
 * way to earn it is to stop describing the payload and print it. `show` runs
 * the same builder the sender uses, so what appears here is what would go, not
 * a documentation comment that quietly fell out of date two releases ago.
 */
/** Everything the switch below dispatches, for the did-you-mean. */
const TELEMETRY_SUBCOMMANDS = ["status", "show", "enable", "disable"] as const;

export async function telemetryCommand(rawArgs: string[]): Promise<void> {
    const subcommand = rawArgs.slice(3).filter((a) => !a.startsWith("-"))[0];

    // Checked before the switch because the line above strips flags, so
    // `rebase telemetry --help` reached `case undefined` and printed the status
    // page — an answer to a question nobody asked, with the flag ignored in
    // silence. `printHelp` already existed; nothing routed to it.
    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
        printHelp();
        return;
    }

    switch (subcommand) {
        case "status":
        case undefined:
            printStatus();
            return;
        case "show":
            printPayload();
            return;
        case "enable":
            if (!setConsent(true)) {
                console.error(chalk.red(`Could not write ${configPath()} — sharing was not enabled.`));
                process.exitCode = 1;
                return;
            }
            console.log(chalk.green("Anonymous usage sharing enabled."));
            console.log(chalk.gray(`Inspect what gets sent with ${chalk.cyan("rebase telemetry show")}.`));
            return;
        case "disable":
            if (!setConsent(false)) {
                // The failure direction that matters. Someone turning sharing
                // off must never be left believing it worked — so this is loud,
                // non-zero, and points at the switch that needs no disk.
                console.error(chalk.red(`Could not write ${configPath()} — sharing is still ON.`));
                console.error(chalk.yellow(`Set ${chalk.cyan("REBASE_TELEMETRY_DISABLED=1")} in your environment instead; it needs no file.`));
                process.exitCode = 1;
                return;
            }
            console.log(chalk.gray("Anonymous usage sharing disabled. Nothing further will be sent."));
            return;
        default:
            // Printing the help and setting exit 1 said nothing about *why*:
            // the page that came back looked like the page `rebase telemetry
            // --help` prints, and the only difference was an exit code nobody
            // reads at a prompt.
            unknownCommand(subcommand, TELEMETRY_SUBCOMMANDS, "telemetry");
    }
}

function printStatus(): void {
    console.log("");
    console.log(`  Status:   ${describeState()}`);
    if (readProjectPolicy() === "ignored_opt_in") {
        // Said out loud rather than silently ignored: a maintainer who wrote
        // `"telemetry": true` believes they turned something on, and leaving
        // them to believe it is worse than refusing.
        console.log("");
        console.log(chalk.yellow("  Note: this project's rebase.json sets \"telemetry\": true, which is ignored."));
        console.log(chalk.gray("        A committed file cannot consent on behalf of everyone who clones it."));
        console.log(chalk.gray(`        Only "telemetry": false is honoured there. Use ${chalk.cyan("rebase telemetry enable")}.`));
    }
    console.log(`  Endpoint: ${chalk.gray(endpoint())}`);
    console.log(`  Config:   ${chalk.gray(configPath())}`);
    console.log("");
    console.log(chalk.gray(`  ${chalk.cyan("rebase telemetry show")} prints the exact payload.`));
    console.log("");
}

function printPayload(): void {
    const config = readConfig();
    if (config.enabled !== true) {
        console.log("");
        console.log(`  ${describeState()}`);
        console.log("");
        console.log(chalk.gray("  Nothing is being sent, so there is no payload to show."));
        console.log(chalk.gray(`  Run ${chalk.cyan("rebase telemetry enable")} first if you want to inspect one.`));
        console.log("");
        return;
    }

    // A representative event rather than a synthetic one: `cli.dev` is the
    // event that fires most often, so it is the one worth being sure about.
    const event = previewEvent("cli.dev", { first_run: false }, process.cwd());
    console.log("");
    console.log(chalk.gray("  Sent to ") + chalk.gray(endpoint()) + chalk.gray(", for example:"));
    console.log("");
    console.log(JSON.stringify(event, null, 2).split("\n").map((l) => "  " + l).join("\n"));
    console.log("");
    console.log(chalk.gray("  Both ids are random. Neither is derived from your machine, your"));
    console.log(chalk.gray("  hostname, your project name or anything you have typed."));
    console.log("");
}

function printHelp(): void {
    console.log(`
${chalk.bold("rebase telemetry")} — anonymous usage sharing (opt-in, off by default)

${chalk.bold("Commands")}
  ${chalk.blue("status")}     Whether anything is being shared, and why ${chalk.gray("(default)")}
  ${chalk.blue("show")}       Print the exact payload that would be sent
  ${chalk.blue("enable")}     Start sharing
  ${chalk.blue("disable")}    Stop sharing, permanently

${chalk.bold("Project policy")}
  ${chalk.blue('"telemetry": false')} in ${chalk.blue("rebase.json")} disables sharing for everyone who
  clones the repository, overriding each developer's own choice.
  ${chalk.gray('"telemetry": true is ignored — a committed file cannot consent for others.')}

${chalk.bold("Environment")}
  ${chalk.blue("DO_NOT_TRACK")}                 Set to disable, across every tool that honours it
  ${chalk.blue("REBASE_TELEMETRY_DISABLED")}    Set to disable Rebase specifically
  ${chalk.blue("REBASE_TELEMETRY_ENDPOINT")}    Send elsewhere — your own collector, for instance

${chalk.gray("Never shared: project names, paths, collection or table names, database")}
${chalk.gray("URLs, hostnames, error messages, stack traces, or exact record counts.")}
`);
}
