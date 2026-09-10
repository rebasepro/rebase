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

/** Where the question is being asked from, which decides how often it may be. */
export interface PromptOptions {
    /**
     * Ask again even though this machine already declined.
     *
     * Set by `rebase init`, and only there. Scaffolding a project is a
     * deliberate, occasional act with a natural pause in it — not something
     * anyone does in a loop — so asking each time is an offer rather than
     * nagging, and it reaches the person whose first answer was a reflex before
     * they had seen the tool do anything.
     *
     * It does **not** re-ask someone who accepted: they are already sharing, so
     * the only thing another prompt could do is talk them out of it.
     *
     * Nothing else changes. `DO_NOT_TRACK`, `REBASE_TELEMETRY_DISABLED`, `CI`
     * and a project's `"telemetry": false` are answers, not questions, and they
     * still suppress the prompt entirely — a re-ask that could override a
     * committed repository policy would be exactly the consent-by-proxy the
     * policy exists to prevent.
     */
    reAskDeclined?: boolean;
}

/** True when we may ask: nothing forbids it, and there is a question to ask. */
export function shouldPrompt(
    env: NodeJS.ProcessEnv = process.env,
    { reAskDeclined = false }: PromptOptions = {}
): boolean {
    if (!process.stdin.isTTY) return false;

    const reason = suppressionReason(env);
    // `not_asked` is the only reason that is a question rather than an answer.
    // A user who set DO_NOT_TRACK, or is on CI, has already told us — and so
    // has one who is already sharing (`null`), whom we never re-ask.
    if (reason === "not_asked") return true;
    return reAskDeclined && reason === "declined";
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
export async function promptForConsent(options: PromptOptions = {}): Promise<boolean> {
    if (!shouldPrompt(process.env, options)) return false;

    // Only true when this is a second (or later) asking, which the closing line
    // needs to know: "you will not be asked again" is false at `init`.
    const askedBefore = suppressionReason(process.env) === "declined";

    try {
        console.log("");
        console.log(chalk.bold("Help improve Rebase?"));
        console.log("");
        console.log(chalk.gray("  Rebase is self-hosted, so we only learn what works if you tell us."));
        console.log(chalk.gray("  Anonymous: random ids, the CLI version, your OS, and which template and"));
        console.log(chalk.gray("  package manager you used. Never project names, paths, schemas, URLs or"));
        console.log(chalk.gray("  error messages."));
        console.log("");
        console.log(chalk.gray(`  Print the exact payload with ${chalk.cyan("rebase telemetry show")}; change your mind`));
        console.log(chalk.gray(`  any time with ${chalk.cyan("rebase telemetry disable")}.`));
        if (askedBefore) {
            console.log("");
            console.log(chalk.gray("  You declined before; that stands unless you change it here."));
        }
        console.log("");

        const { accepted } = await inquirer.prompt([
            {
                type: "confirm",
                name: "accepted",
                message: "Share anonymous usage data?",
                // Defaults to yes: this is the question the project most needs
                // answered, and a bare Enter is the commonest answer to any
                // prompt. It is still a question — nothing is sent until it is
                // answered, `n` is one keystroke, and the decision is
                // reversible with the command named two lines above. What it
                // is NOT is "off by default" any more; anything that used to
                // say so had to change with it.
                default: true
            }
        ] as Parameters<typeof inquirer.prompt>[0]) as { accepted: boolean };

        setConsent(Boolean(accepted));

        console.log(
            accepted
                ? chalk.green("  Thank you — sharing enabled.")
                : chalk.gray(
                    "  Nothing will be sent."
                    + (options.reAskDeclined
                        ? " You will be asked again the next time you scaffold a project."
                        : " You will not be asked again.")
                )
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
