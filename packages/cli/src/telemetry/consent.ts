import chalk from "chalk";
import inquirer from "inquirer";

import { buildEvent, TELEMETRY_SCHEMA_VERSION, TelemetryEventName } from "./payload";
import { readConfig } from "./identity";
import { setConsent, suppressionReason } from "./index";

/**
 * Asking, and what the question looks like.
 *
 * ## Why the prompt comes *after* the work
 *
 * The first `rebase init` on a machine is the event most worth having, and it
 * is the one where no consent exists yet. Asking before scaffolding puts a
 * privacy negotiation in front of someone who has not yet seen the tool do
 * anything — the worst possible moment, and a reliable way to get a reflexive
 * no.
 *
 * So the question is asked once the project exists and the user has seen it
 * work. The event's data is still in memory at that point, so nothing is lost
 * by waiting, and — this is the part that matters — **nothing has been
 * transmitted or written**. Declining leaves no id, no file, no record.
 *
 * ## Why the payload is shown rather than described
 *
 * "Anonymous usage data" is a phrase that has been used to mean almost
 * anything. Printing the exact JSON costs four lines of output and replaces a
 * claim the user has to take on faith with something they can read. It is also
 * the same builder the sender uses, so it cannot drift into a comfortable
 * fiction.
 */

/** True when we may ask: no decision recorded, and nothing else forbids it. */
export function shouldPrompt(env: NodeJS.ProcessEnv = process.env): boolean {
    // `not_asked` is the only reason that is a question rather than an answer.
    // A user who set DO_NOT_TRACK, or is on CI, has already told us.
    return suppressionReason(env) === "not_asked" && Boolean(process.stdin.isTTY);
}

export function renderPreview(event: TelemetryEventName, properties: Record<string, unknown>): string {
    const preview = buildEvent(event, properties, {
        machineId: "<random uuid, generated only if you say yes>",
        projectId: "<random uuid, per checkout>"
    });
    return JSON.stringify(preview, null, 2);
}

/**
 * Ask, record the answer, and report it.
 *
 * Never throws and never blocks a non-interactive run: `rebase init --yes` in
 * CI must behave exactly as it does today, which means not asking and not
 * sending.
 */
export async function promptForConsent(
    event: TelemetryEventName,
    properties: Record<string, unknown>
): Promise<boolean> {
    if (!shouldPrompt()) return false;

    try {
        console.log("");
        console.log(chalk.bold("Help improve Rebase?"));
        console.log("");
        console.log(chalk.gray("  Rebase is self-hosted, so we have no idea what works and what does not"));
        console.log(chalk.gray("  unless you tell us. Sharing is entirely optional and off by default."));
        console.log("");
        console.log(chalk.gray("  This is exactly what would be sent — nothing more, ever:"));
        console.log("");
        console.log(
            renderPreview(event, properties)
                .split("\n")
                .map((line) => chalk.gray("    " + line))
                .join("\n")
        );
        console.log("");
        console.log(chalk.gray("  No project names, paths, schemas, URLs or error messages. Change your"));
        console.log(chalk.gray(`  mind any time with ${chalk.cyan("rebase telemetry disable")}.`));
        console.log("");

        const { accepted } = await inquirer.prompt([
            {
                type: "confirm",
                name: "accepted",
                message: "Share anonymous usage data?",
                default: false
            }
        ] as unknown as Parameters<typeof inquirer.prompt>[0]) as { accepted: boolean };

        setConsent(Boolean(accepted));

        console.log(
            accepted
                ? chalk.green("  Thank you — sharing enabled.")
                : chalk.gray("  Nothing will be sent. You will not be asked again.")
        );
        console.log("");
        return Boolean(accepted);
    } catch {
        // A prompt that fails (piped stdin, a terminal that went away) is a
        // decline, and specifically a decline we do not persist — the user
        // never actually saw the question, so they should still get to answer
        // it another day.
        return false;
    }
}

/** Human-readable current state, for `rebase telemetry status`. */
export function describeState(env: NodeJS.ProcessEnv = process.env): string {
    const reason = suppressionReason(env);
    const config = readConfig();
    switch (reason) {
        case null:
            return `${chalk.green("enabled")} — schema v${TELEMETRY_SCHEMA_VERSION}, machine id ${chalk.gray(config.machineId ?? "unset")}`;
        case "not_asked":
            return `${chalk.yellow("not configured")} — nothing has been sent, and you have not been asked yet`;
        case "declined":
            return `${chalk.gray("disabled")} — you declined${config.decidedAt ? ` on ${config.decidedAt.slice(0, 10)}` : ""}`;
        case "do_not_track":
            return `${chalk.gray("disabled")} — the ${chalk.cyan("DO_NOT_TRACK")} environment variable is set`;
        case "rebase_telemetry_disabled":
            return `${chalk.gray("disabled")} — the ${chalk.cyan("REBASE_TELEMETRY_DISABLED")} environment variable is set`;
        case "ci":
            return `${chalk.gray("disabled")} — this looks like CI (${chalk.cyan("CI")} is set), which is never counted`;
        case "project_opt_out":
            return `${chalk.gray("disabled")} — this project's ${chalk.cyan("rebase.json")} sets ${chalk.cyan('"telemetry": false')}`;
    }
}
