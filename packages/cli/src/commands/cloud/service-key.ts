/**
 * `rebase cloud service-key [rotate]`: the project's `REBASE_SERVICE_KEY`,
 * admin on the app's own API, and replacing it.
 *
 * The control plane derives the key from the project and a generation, and
 * injects it into the app. `rotate` issues the next generation and restarts
 * the app onto it in the background; the old key keeps working until that
 * restart has come up, and nothing after. Anything that copied the old key —
 * a script, a CI job, an agent's deployed code that printed it — is refused
 * from then on. A claim rotates it too.
 *
 * Without an action, prints the generation, when it was last rotated and
 * whether a rotation is still restarting the app. The key itself is
 * `rebase cloud env reveal REBASE_SERVICE_KEY`. Calls `GET` and `POST
 * /credentials/:projectId/service-key[/rotate]`, owners and admins, signed in.
 *
 * @module
 */
import chalk from "chalk";
import {
    confirmDestructive,
    displayProjectRef,
    emit,
    note,
    parseCloudArgs,
    reportError,
    requireKnownAction,
    requireProject,
    requireSessionClient,
    success,
    type CloudClient
} from "./context";

export const SERVICE_KEY_FLAGS = {} as const;
export const SERVICE_KEY_ACTIONS = ["rotate"] as const;

/** What `GET /credentials/:projectId/service-key` answers. Never the key. */
export interface CliServiceKeyStatus {
    generation: number;
    liveGeneration: number;
    rotatedAt: string | null;
    pending: boolean;
}

/** What a rotation answers. */
export interface CliServiceKeyRotation {
    generation: number;
    state: "restarting" | "pending";
}

async function readStatus(client: CloudClient, projectId: string): Promise<CliServiceKeyStatus> {
    return client.functions.invoke<CliServiceKeyStatus>("credentials", undefined, {
        method: "GET",
        path: `${encodeURIComponent(projectId)}/service-key`
    });
}

function printStatus(status: CliServiceKeyStatus, label: string): void {
    console.log("");
    console.log(chalk.bold(`  🛡  Service key — ${label}`));
    console.log("");
    console.log(`  Generation  ${status.generation}`);
    console.log(`  Rotated     ${status.rotatedAt ? new Date(status.rotatedAt).toLocaleString() : chalk.gray("never")}`);
    if (status.pending) {
        console.log("");
        console.log(chalk.yellow("  The app has not restarted onto the newest key yet; the previous one still works until it has."));
    }
    console.log("");
    console.log(chalk.gray(`  Read it with ${chalk.bold("rebase cloud env reveal REBASE_SERVICE_KEY")}; replace it with ${chalk.bold("rebase cloud service-key rotate")}.`));
    console.log("");
}

export async function serviceKeyCommand(rawArgs: string[]): Promise<void> {
    const parsed = parseCloudArgs({
        spec: SERVICE_KEY_FLAGS,
        rawArgs,
        commandWords: 2, // cloud service-key
        command: "cloud service-key",
        maxPositionals: 1
    });
    const action = parsed.positionals[0];
    requireKnownAction("service-key", action, SERVICE_KEY_ACTIONS);

    const { client } = await requireSessionClient(rawArgs, "rotate a project's service key");
    const projectId = await requireProject(rawArgs, client);
    const label = `project ${displayProjectRef(rawArgs) || projectId}`;

    if (action !== "rotate") {
        let status: CliServiceKeyStatus;
        try {
            status = await readStatus(client, projectId);
        } catch (e) {
            reportError(e, "Failed to read the service key's state");
        }
        emit(() => printStatus(status, label), status);
        return;
    }

    await confirmDestructive({
        yes: Boolean(parsed.flags["--yes"]),
        prompt: `Rotate the service key of ${label}? The app restarts onto a new key, and anything using the old one is refused once it has.`
    });

    let rotation: CliServiceKeyRotation;
    try {
        rotation = await client.functions.invoke<CliServiceKeyRotation>("credentials", {}, {
            path: `${encodeURIComponent(projectId)}/service-key/rotate`
        });
    } catch (e) {
        reportError(e, "Failed to rotate the service key");
    }
    emit(() => {
        success(`Issued service key generation ${rotation.generation} for ${label}.`);
        note(rotation.state === "pending"
            ? "A deploy is running: the next deploy carries the new key. The old one works until then."
            : "The app is restarting onto it; the old key works until the restart has finished. Follow it with `rebase cloud service-key`.");
        note("Read the new key with `rebase cloud env reveal REBASE_SERVICE_KEY` once the restart is done.");
    }, rotation);
}
