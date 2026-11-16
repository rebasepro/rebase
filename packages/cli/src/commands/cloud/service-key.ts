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
 * ## `--preview <name>`
 *
 * A backend preview (`rebase cloud deploy --preview`) runs with a service key
 * of its own, minted on its first deploy and kept across redeploys; production's
 * key answers 401 there. `service-key --preview <name>` prints that key, and
 * `rotate --preview <name>` writes a new one and restarts only the preview's
 * pod onto it. Calls `POST /previews/:projectId/:name/service-key/reveal` and
 * `…/rotate`, which ask what production's reveal asks: the organization's owner
 * or admin role, `project:env` on an access token, and a claimed project. So an
 * access token with the `env` capability reaches it, as it reaches `env
 * reveal`, and a login is not required.
 *
 * @module
 */
import chalk from "chalk";
import {
    confirmDestructive,
    displayProjectRef,
    emit,
    fail,
    note,
    parseCloudArgs,
    requireClient,
    requireKnownAction,
    requireProject,
    requireSessionClient,
    success,
    type CloudClient
} from "./context";
import { reportCallError, type Unserved } from "./not-served";

/** What `service-key` says on a control plane that has no `credentials` function yet. */
const SERVICE_KEY_UNSERVED: Unserved = {
    what: "service-key rotation",
    hint: "Nothing was changed. `rebase cloud env reveal REBASE_SERVICE_KEY` still reads the current key."
};

/** What `service-key --preview` says on a control plane without the preview key routes. */
const PREVIEW_SERVICE_KEY_UNSERVED: Unserved = {
    what: "a preview's own service key",
    hint: "Nothing was changed. The preview still runs with the key its first deploy gave it."
};

export const SERVICE_KEY_FLAGS = {
    /**
     * A backend preview's own key instead of production's, the preview named by
     * the positional after the action. A switch, as `deploy --preview` and
     * `logs --preview <name>` have it: the dispatcher's list of flags that take
     * a value is one list for the family (`value-flags.test.ts`).
     */
    "--preview": Boolean
} as const;
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
    console.log(chalk.gray(`  A backend preview has a key of its own: ${chalk.bold("rebase cloud service-key --preview <name>")}.`));
    console.log("");
}

/** What `POST /previews/:projectId/:name/service-key/reveal` answers. */
export interface CliPreviewServiceKey {
    preview: string;
    url: string;
    key: "REBASE_SERVICE_KEY";
    value: string;
}

/** What a preview's rotation answers. Never the key. */
export interface CliPreviewServiceKeyRotation {
    preview: string;
    url: string;
    state: "restarting" | "pending";
}

/**
 * The preview `--preview` names, as the control plane spells it.
 *
 * Only trimmed and lowercased: the control plane decides which names exist,
 * and answers `not_found` for the rest. `deploy`'s stricter name check is for
 * a name about to be created.
 */
export function previewNameArg(raw: string | undefined, usage: string): string {
    const name = (raw ?? "").trim().toLowerCase();
    if (name === "") fail(`Name the preview: \`${usage}\`.`, "`rebase cloud previews` lists them.", "usage");
    return name;
}

function previewKeyPath(projectId: string, name: string, action: "reveal" | "rotate"): string {
    return `${encodeURIComponent(projectId)}/${encodeURIComponent(name)}/service-key/${action}`;
}

/** Read a backend preview's own key. `env reveal REBASE_SERVICE_KEY --preview <name>` lands here too. */
export async function revealPreviewServiceKey(client: CloudClient, projectId: string, name: string): Promise<void> {
    let res: CliPreviewServiceKey;
    try {
        res = await client.functions.invoke<CliPreviewServiceKey>("previews", {}, { path: previewKeyPath(projectId, name, "reveal") });
    } catch (e) {
        reportCallError(e, "Failed to read the preview's service key", PREVIEW_SERVICE_KEY_UNSERVED);
    }
    emit(() => {
        console.log("");
        console.log(`  ${chalk.bold(res.key)}=${res.value}`);
        console.log("");
        console.log(chalk.gray(`  Preview ${chalk.bold(res.preview)} (${res.url}) only. Production's key is \`rebase cloud env reveal REBASE_SERVICE_KEY\`.`));
        console.log("");
    }, res);
}

async function rotatePreviewServiceKey(client: CloudClient, projectId: string, label: string, name: string, yes: boolean): Promise<void> {
    await confirmDestructive({
        yes,
        prompt: `Rotate the service key of ${label}? Its pod restarts onto a new key, and anything using the old one is refused once it has. Production is not touched.`
    });
    let rotation: CliPreviewServiceKeyRotation;
    try {
        rotation = await client.functions.invoke<CliPreviewServiceKeyRotation>("previews", {}, { path: previewKeyPath(projectId, name, "rotate") });
    } catch (e) {
        reportCallError(e, "Failed to rotate the preview's service key", PREVIEW_SERVICE_KEY_UNSERVED);
    }
    emit(() => {
        success(`Issued a new service key for ${label}.`);
        note(rotation.state === "pending"
            ? "The preview has no pod running: its next deploy starts on the new key."
            : "Its pod is restarting onto it; the old key works until the new pod is ready.");
        note(`Read it with \`rebase cloud service-key --preview ${name}\`.`);
    }, rotation);
}

export async function serviceKeyCommand(rawArgs: string[]): Promise<void> {
    const parsed = parseCloudArgs({
        spec: SERVICE_KEY_FLAGS,
        rawArgs,
        commandWords: 2, // cloud service-key
        command: "cloud service-key",
        maxPositionals: 2 // [rotate] and, with --preview, the preview's name
    });
    const preview = parsed.flags["--preview"] === true;
    // `--preview` is a switch, so `--preview new-quiz rotate` reads as the
    // words `new-quiz rotate`; put the action first either way round.
    const words = preview && parsed.positionals.length === 2 && parsed.positionals[1] === "rotate"
        ? [parsed.positionals[1], parsed.positionals[0]]
        : parsed.positionals;
    // With --preview the last word names the preview, and a first word before
    // it is the action. A lone `rotate` names no preview.
    const action = preview ? (words.length === 2 || words[0] === "rotate" ? words[0] : undefined) : words[0];
    if (!preview && words.length > 1) {
        fail(`\`rebase cloud service-key ${words.join(" ")}\`: one action at most.`, "A preview is named after --preview.", "usage");
    }
    requireKnownAction("service-key", action, SERVICE_KEY_ACTIONS);

    if (preview) {
        const name = previewNameArg(words.length === 2 ? words[1] : action === undefined ? words[0] : undefined,
            `rebase cloud service-key ${action ? `${action} ` : ""}--preview <name>`);
        const { client } = await requireClient(rawArgs);
        const projectId = await requireProject(rawArgs, client);
        if (action === "rotate") {
            const label = `preview "${name}" of project ${displayProjectRef(rawArgs) || projectId}`;
            return rotatePreviewServiceKey(client, projectId, label, name, Boolean(parsed.flags["--yes"]));
        }
        return revealPreviewServiceKey(client, projectId, name);
    }

    const { client } = await requireSessionClient(rawArgs, "rotate a project's service key");
    const projectId = await requireProject(rawArgs, client);
    const label = `project ${displayProjectRef(rawArgs) || projectId}`;

    if (action !== "rotate") {
        let status: CliServiceKeyStatus;
        try {
            status = await readStatus(client, projectId);
        } catch (e) {
            reportCallError(e, "Failed to read the service key's state", SERVICE_KEY_UNSERVED);
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
        reportCallError(e, "Failed to rotate the service key", SERVICE_KEY_UNSERVED);
    }
    emit(() => {
        success(`Issued service key generation ${rotation.generation} for ${label}.`);
        note(rotation.state === "pending"
            ? "A deploy is running: the next deploy carries the new key. The old one works until then."
            : "The app is restarting onto it; the old key works until the restart has finished. Follow it with `rebase cloud service-key`.");
        note("Read the new key with `rebase cloud env reveal REBASE_SERVICE_KEY` once the restart is done.");
    }, rotation);
}
