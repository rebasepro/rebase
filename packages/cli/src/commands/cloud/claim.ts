/**
 * `rebase cloud claim` — the claim link of the project `rebase cloud init
 * --claim` provisioned in this directory, and how long is left to use it.
 *
 * The link is a bearer secret the control plane keeps only a hash of, so the
 * one copy that can be shown again is the one `init` kept in the private
 * credentials file. `status` and `whoami` print it too; this is the command
 * named after the thing a person is looking for, and the one that can open it.
 *
 * It asks the control plane one question before answering: whether the
 * project's own token is still accepted. A claim revokes that token, so a
 * refusal means somebody already claimed it — and printing a link that leads
 * to "already claimed" would send the reader somewhere useless.
 */
import chalk from "chalk";
import {
    readLink,
    storedGrantForLink,
    forgetEphemeralGrant,
    probeToken,
    projectDotenvSetsAppKey,
    appKeyExpiryNote,
    parseCloudArgs,
    openUrl,
    emit,
    keyValues,
    fail
} from "./context";

/** What `rebase cloud claim` parses, beside the global flags. Its page pairs against this. */
export const CLAIM_FLAGS = { "--open": Boolean } as const;

/** "41h", "25m", "under a minute": how long is left, for a person. */
export function timeLeft(expiresAt: string, now: number = Date.now()): string {
    const ms = Date.parse(expiresAt) - now;
    if (!(ms > 0)) return "no time";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "under a minute";
    if (minutes < 120) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
}

export async function claimCommand(rawArgs: string[], now: () => number = Date.now): Promise<void> {
    const { flags } = parseCloudArgs({
        spec: CLAIM_FLAGS,
        rawArgs,
        commandWords: 2, // cloud claim
        command: "cloud claim",
        maxPositionals: 0
    });

    const link = readLink();
    if (!link?.projectId || link.mode === "direct") {
        fail(
            "This directory is not linked to a Rebase Cloud project, so there is nothing to claim here.",
            `${chalk.bold("rebase cloud init --claim")} provisions a project without an account and prints its claim link.`,
            "no_project"
        );
    }
    const project = link.slug ?? link.projectId;

    const stored = storedGrantForLink(link);
    if (!stored) {
        fail(
            `Project ${project} has no claim link on this machine.`,
            "It was claimed already, it was created by a signed-in account, or `rebase cloud init --claim` ran on another machine "
                + `(the link is kept only where it was printed). ${chalk.bold("rebase cloud status")} shows the project.`,
            "no_claim_link"
        );
    }
    const { url, grant } = stored;

    if (!(Date.parse(grant.expiresAt) > now())) {
        fail(
            `Project ${project}'s claim window ended at ${new Date(grant.expiresAt).toLocaleString()}.`,
            "An unclaimed project is deleted when its window ends. Run `rebase cloud unlink`, then "
                + "`rebase cloud init --claim` for a new one.",
            "claim_expired"
        );
    }

    // A claim revokes the project's token, so the token's standing is the
    // claim's: one request, to the route every token may read.
    const verdict = await probeToken(url, grant.token);
    if (verdict === "refused") {
        forgetEphemeralGrant(url, link.projectId);
        fail(
            `Project ${project} has already been claimed: the control plane no longer accepts the token \`rebase cloud init --claim\` stored for it.`,
            `Sign in as the account that claimed it with ${chalk.bold("rebase cloud login")}; the project is in that account's organization.`,
            "already_claimed"
        );
    }

    const verified = verdict === "accepted";
    const appKeyNote = projectDotenvSetsAppKey() ? appKeyExpiryNote(grant.expiresAt) : undefined;
    const left = timeLeft(grant.expiresAt, now());

    emit(
        () => {
            console.log("");
            console.log(`  ${chalk.bold(`Unclaimed: deleted in ${left}`)} ${chalk.gray(`[${project}]`)}`);
            console.log("");
            keyValues([
                ["Claim URL", chalk.bold(grant.claimUrl)],
                ["Expires", new Date(grant.expiresAt).toLocaleString()]
            ]);
            console.log("");
            console.log(chalk.gray("  Open the link and sign in: the project moves into your organization, and nothing is redeployed."));
            if (!verified) {
                console.log(chalk.yellow(`  ${url} could not be asked whether it is still unclaimed; if the link says so, it was claimed already.`));
            }
            if (appKeyNote) console.log(chalk.gray(`  ${appKeyNote}`));
            console.log("");
        },
        {
            projectId: link.projectId,
            slug: link.slug ?? null,
            claimUrl: grant.claimUrl,
            expiresAt: grant.expiresAt,
            // False when the control plane could not be asked: the link is the
            // stored one, and the project may have been claimed meanwhile.
            verified,
            opened: flags["--open"] === true,
            appKeyNote: appKeyNote ?? null
        }
    );

    if (flags["--open"]) openUrl(grant.claimUrl, "Opening the claim link");
}
