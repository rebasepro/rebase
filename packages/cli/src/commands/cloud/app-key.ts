/**
 * `rebase cloud app-key [rotate]`: the key `rebase cloud init --claim` minted
 * on the project's app and wrote into `.env` as `REBASE_API_TOKEN`, and the
 * way its owner replaces it.
 *
 * A claim hands that key over to the person who claimed the project: it stops
 * expiring, because the app's `.env` runs on it. The agent that ran `init`
 * still holds a copy, so `rotate` mints a new key on the app, revokes every
 * earlier agent key, and answers the new one once. In a directory whose `.env`
 * sets `REBASE_API_TOKEN`, it is written there; anywhere else (CI, a hosted
 * frontend) the old key is refused until it is given the new one.
 *
 * Reads `GET /credentials/:projectId/app-key` and `POST
 * /credentials/:projectId/app-key/rotate` on the control plane, the same calls
 * as the console's Settings. Owners and admins, signed in: the routes require
 * `project:configure`, which no access-token capability grants.
 *
 * @module
 */
import path from "path";
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
    warn,
    type CloudClient
} from "./context";
import { API_TOKEN_ENV, dotenvSets, upsertDotenv } from "./init";
import { findProjectRoot } from "../../utils/project";

export const APP_KEY_FLAGS = {} as const;
export const APP_KEY_ACTIONS = ["rotate"] as const;

/** An agent key on the app, as the control plane lists it. Never the key itself. */
export interface CliAgentKey {
    id: string;
    prefix: string | null;
    createdAt: string | null;
    expiresAt: string | null;
}

/** What a rotation answers: the new key, once. */
export interface CliRotatedAppKey {
    apiKey: string;
    keyId: string;
    scopes: string[];
    expiresAt: string | null;
    revoked: string[];
}

function isRotated(value: unknown): value is CliRotatedAppKey {
    return typeof value === "object" && value !== null
        && "apiKey" in value && typeof value.apiKey === "string" && value.apiKey.startsWith("rk_")
        && "keyId" in value && typeof value.keyId === "string"
        && "revoked" in value && Array.isArray(value.revoked);
}

async function listKeys(client: CloudClient, projectId: string): Promise<{ keys: CliAgentKey[] }> {
    return client.functions.invoke<{ keys: CliAgentKey[] }>("credentials", undefined, {
        method: "GET",
        path: `${encodeURIComponent(projectId)}/app-key`
    });
}

async function rotateKey(client: CloudClient, projectId: string): Promise<unknown> {
    return client.functions.invoke<unknown>("credentials", {}, {
        path: `${encodeURIComponent(projectId)}/app-key/rotate`
    });
}

function printKeys(keys: CliAgentKey[], label: string): void {
    console.log("");
    console.log(chalk.bold(`  🔑 App key — ${label}`));
    console.log("");
    if (keys.length === 0) {
        console.log(chalk.gray("  This app holds no agent key. Keys made in the project's admin panel are managed there."));
        console.log("");
        return;
    }
    for (const key of keys) {
        const when = key.createdAt ? `created ${new Date(key.createdAt).toLocaleString()}, ` : "";
        const expiry = key.expiresAt ? `expires ${new Date(key.expiresAt).toLocaleString()}` : "does not expire";
        console.log(`  ${key.prefix ? `${key.prefix}…` : key.id}  ${chalk.gray(`${when}${expiry}`)}`);
    }
    console.log("");
    console.log(chalk.gray(`  Replace it with ${chalk.bold("rebase cloud app-key rotate")}: the old key stops working at once.`));
    console.log("");
}

export async function appKeyCommand(rawArgs: string[]): Promise<void> {
    const parsed = parseCloudArgs({
        spec: APP_KEY_FLAGS,
        rawArgs,
        commandWords: 2, // cloud app-key
        command: "cloud app-key",
        maxPositionals: 1
    });
    const action = parsed.positionals[0];
    requireKnownAction("app-key", action, APP_KEY_ACTIONS);

    const { client } = await requireSessionClient(rawArgs, "replace a project's app key");
    const projectId = await requireProject(rawArgs, client);
    const label = `project ${displayProjectRef(rawArgs) || projectId}`;

    if (action !== "rotate") {
        let listed: { keys: CliAgentKey[] };
        try {
            listed = await listKeys(client, projectId);
        } catch (e) {
            reportError(e, "Failed to read the app's keys");
        }
        emit(() => printKeys(listed.keys, label), listed);
        return;
    }

    await confirmDestructive({
        yes: Boolean(parsed.flags["--yes"]),
        prompt: `Rotate the app key of ${label}? Every earlier agent key stops working at once.`
    });

    let answer: unknown;
    try {
        answer = await rotateKey(client, projectId);
    } catch (e) {
        reportError(e, "Failed to rotate the app key");
    }
    if (!isRotated(answer)) {
        reportError(new Error("The control plane's answer did not carry a key."), "Failed to rotate the app key");
    }
    const rotated = answer;

    // Where the old key was written, the new one goes: a directory whose `.env`
    // sets it is the one `init` wrote. Nowhere else — a `.env` that does not
    // set it is somebody else's.
    const root = findProjectRoot() ?? process.cwd();
    const dotenv = path.join(root, ".env");
    const wroteDotenv = dotenvSets(dotenv, API_TOKEN_ENV);
    if (wroteDotenv) upsertDotenv(dotenv, API_TOKEN_ENV, rotated.apiKey);

    emit(() => {
        success(`Rotated the app key of ${label}.`);
        if (wroteDotenv) note(`Wrote the new key to ${dotenv} as ${API_TOKEN_ENV}.`);
        else {
            console.log("");
            console.log(`  ${chalk.bold(rotated.apiKey)}`);
            console.log("");
            note(`Shown once. Set it as ${API_TOKEN_ENV} wherever the old key was used.`);
        }
        if (rotated.revoked.length > 0) note(`Revoked ${rotated.revoked.length} earlier agent key${rotated.revoked.length === 1 ? "" : "s"}.`);
        else warn("No earlier agent key was revoked: there was none, or the app did not answer the clean-up.");
    }, wroteDotenv
        // Not repeated where it was written: this output can reach an agent's
        // transcript, and the point of rotating is a key the agent never saw.
        ? { keyId: rotated.keyId, scopes: rotated.scopes, expiresAt: rotated.expiresAt, revoked: rotated.revoked, dotenv }
        : { ...rotated, dotenv: null });
}
