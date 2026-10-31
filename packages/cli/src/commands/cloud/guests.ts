/**
 * `rebase cloud guests [delete <id> | prune --older-than <age>]`: the guest
 * users anonymous sign-in left behind on a project.
 *
 * Without an action, counts them and lists the ones last seen longest ago.
 * `delete` removes one. `prune` removes the ones not seen for an age: a dry run
 * that prints how many would go, deleting only with `--yes`.
 *
 * ## Which rows can go
 *
 * The app decides, not this command: `/api/admin/guests` only ever lists and
 * deletes a row that is anonymous with no password and no linked identity, in
 * the statement that deletes it. So nothing here can reach an account, even
 * with a stale list.
 *
 * ## How it reaches the app
 *
 * Two legs, like `rebase cloud cron`, with the service key where that has a
 * read-only platform token: deleting users is an administrator's act on the
 * app's own API. `POST env-vars/reveal` answers the key to an owner or admin of
 * the project, the same gate as `rebase cloud env reveal REBASE_SERVICE_KEY`;
 * it stays in memory for this command and goes only to the project's own public
 * address, which is why there is no `--host`.
 *
 * @module
 */
import chalk from "chalk";
import { createRebaseClient, RebaseApiError } from "@rebasepro/client";
import type { AdminGuest, DeleteGuestsResult } from "@rebasepro/types";
import {
    confirmDestructive,
    displayProjectRef,
    emit,
    fail,
    note,
    parseCloudArgs,
    reportError,
    requireClient,
    requireKnownAction,
    requireProject,
    success,
    warn,
    type CloudClient
} from "./context";
import { isMissingRoute } from "./cron";
import { resolveOrigin } from "./debug";
import { cliUserAgent } from "../../utils/version";

export const GUESTS_FLAGS = {
    "--limit": String,
    "--older-than": String
} as const;

export const GUESTS_ACTIONS = ["delete", "prune"] as const;

const AGE_UNITS_MS: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000
};

/**
 * `30d` as milliseconds, or undefined. A unit is required and the age cannot be
 * zero: `--older-than 30` is a typo for something, and `0d` would be everyone.
 */
export function parseAge(value: string): number | undefined {
    const match = /^(\d+)([mhdw])$/.exec(value.trim());
    if (!match) return undefined;
    const ms = Number(match[1]) * AGE_UNITS_MS[match[2]];
    return ms > 0 ? ms : undefined;
}

/** The instant `--older-than` names, or undefined when it was not given. */
function lastSeenBeforeOf(value: string | undefined): Date | undefined {
    if (value === undefined) return undefined;
    const ms = parseAge(value);
    if (ms === undefined) {
        fail(`--older-than takes an age with a unit, e.g. 30d, 12h or 2w (got "${value}").`, undefined, "usage");
    }
    return new Date(Date.now() - ms);
}

type App = ReturnType<typeof createRebaseClient>;

/** The project's own API, holding its service key. */
async function connectToApp(client: CloudClient, origin: string, projectId: string): Promise<App> {
    let serviceKey: string;
    try {
        const revealed = await client.functions.invoke<{ value: string }>(
            "env-vars",
            { projectId, key: "REBASE_SERVICE_KEY" },
            { path: "reveal" }
        );
        serviceKey = revealed.value;
    } catch (e) {
        reportError(e, "Failed to read the project's service key");
    }
    return createRebaseClient({
        baseUrl: origin,
        token: serviceKey,
        realtime: false,
        headers: { "User-Agent": cliUserAgent() },
        auth: { persistSession: false, autoRefresh: false }
    });
}

/**
 * Report a failed call to the app. An older runtime has no guest routes, and
 * its 404 is about the route, not about a guest; a repository without them (a
 * self-hosted Mongo backend) answers 501.
 */
function reportAppError(error: unknown, action: string, origin: string): never {
    if (error instanceof RebaseApiError) {
        if (error.status === 404 && isMissingRoute(error.message)) {
            fail(
                `The app at ${origin} needs a newer runtime: it has no guest routes yet.`,
                "`rebase cloud status` shows the runtime it is on.",
                "runtime_too_old"
            );
        }
        if (error.status === 501) {
            fail(`The app at ${origin} cannot manage guests: ${error.message}`, undefined, "not_supported");
        }
        if (error.status === 0 || error.code === "NETWORK_ERROR") {
            fail(
                `Could not reach the app at ${origin}: ${error.message}`,
                "`rebase cloud debug health` checks whether the deployment is answering at all.",
                "runtime_unreachable"
            );
        }
    }
    reportError(error, action);
}

function printGuests(guests: AdminGuest[], total: number, label: string): void {
    const count = `${total.toLocaleString()} guest${total === 1 ? "" : "s"}`;
    console.log("");
    console.log(chalk.bold(`  👤 ${count} — ${label}`));
    console.log("");
    for (const guest of guests) {
        const created = new Date(guest.createdAt).toLocaleString();
        const seen = new Date(guest.lastSeenAt).toLocaleString();
        console.log(`  ${guest.uid}  ${chalk.gray(`last seen ${seen}, created ${created}`)}`);
    }
    if (guests.length < total) {
        console.log(chalk.gray(`  … and ${(total - guests.length).toLocaleString()} more, seen more recently.`));
    }
    if (guests.length > 0) console.log("");
}

/** Every batch of a prune, until no matching guest is left to try. */
async function pruneAll(app: App, lastSeenBefore: Date): Promise<Omit<DeleteGuestsResult, "remaining">> {
    const pruned: Omit<DeleteGuestsResult, "remaining"> = { deleted: 0, skipped: [] };
    let remaining: number;
    do {
        // A skipped guest stays at the front of the order, so the next batch
        // starts past the ones already tried.
        const batch = await app.admin.deleteGuests({ lastSeenBefore, offset: pruned.skipped.length });
        pruned.deleted += batch.deleted;
        pruned.skipped.push(...batch.skipped);
        ({ remaining } = batch);
    } while (remaining > 0);
    return pruned;
}

async function prune(app: App, age: string, lastSeenBefore: Date, yes: boolean, label: string): Promise<void> {
    const window = { olderThan: age, lastSeenBefore: lastSeenBefore.toISOString() };
    if (!yes) {
        const { total } = await app.admin.listGuests({ lastSeenBefore, limit: 1 });
        emit(() => {
            console.log("");
            console.log(`  ${chalk.bold(total.toLocaleString())} guest${total === 1 ? "" : "s"} not seen for ${age} would go from ${label}. Nothing was deleted.`);
            if (total > 0) note(`Delete them with \`rebase cloud guests prune --older-than ${age} --yes\`.`);
            console.log("");
        }, { dryRun: true, ...window, wouldDelete: total });
        return;
    }

    const pruned = await pruneAll(app, lastSeenBefore);
    emit(() => {
        success(`Deleted ${pruned.deleted.toLocaleString()} guest${pruned.deleted === 1 ? "" : "s"} not seen for ${age} from ${label}.`);
        if (pruned.skipped.length > 0) {
            warn(`${pruned.skipped.length.toLocaleString()} could not go. The first: ${pruned.skipped[0].uid}: ${pruned.skipped[0].message}`);
        }
    }, { dryRun: false, ...window, ...pruned });
}

export async function guestsCommand(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: GUESTS_FLAGS,
        rawArgs,
        commandWords: 2, // cloud guests
        command: "cloud guests",
        maxPositionals: 2
    });
    const [action, id] = positionals;
    requireKnownAction("guests", action, GUESTS_ACTIONS);

    // Everything this line can get wrong is refused before the service key is read.
    if (action === "delete" && !id) {
        fail("Name the guest to delete.", "Usage: rebase cloud guests delete <id>. `rebase cloud guests` lists them.", "usage");
    }
    if (action !== "delete" && id) {
        fail(`Unexpected argument: ${id}`, "Only `rebase cloud guests delete` takes an id.", "usage");
    }
    if (action === "prune" && !flags["--older-than"]) {
        fail("Say how old a guest has to be.", "Usage: rebase cloud guests prune --older-than 30d [--yes]", "usage");
    }
    if (action === "delete" && flags["--older-than"]) {
        fail("`rebase cloud guests delete` removes one guest, by id.", "`rebase cloud guests prune --older-than <age>` removes them by age.", "usage");
    }
    // Refused on an action rather than ignored: `prune --limit 5` reads as a bound it would not have.
    if (action && flags["--limit"]) {
        fail("--limit only applies to the list.", undefined, "usage");
    }
    const age = flags["--older-than"];
    const lastSeenBefore = lastSeenBeforeOf(age);
    const limit = flags["--limit"] === undefined ? undefined : Number(flags["--limit"]);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        fail(`--limit takes a whole number above 0 (got "${flags["--limit"]}").`, undefined, "usage");
    }

    const { client, url } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const label = `project ${displayProjectRef(rawArgs) || projectId}`;

    if (action === "delete") {
        await confirmDestructive({
            yes: Boolean(flags["--yes"]),
            prompt: `Delete guest ${id} from ${label}? Its sessions end, and whatever the project's own tables cascade from it goes too.`
        });
    }

    const origin = await resolveOrigin(rawArgs, client, url, projectId);
    const app = await connectToApp(client, origin, projectId);
    try {
        if (action === "delete") {
            const result = await app.admin.deleteGuest(id);
            emit(() => success(`Deleted guest ${id} from ${label}.`), result);
        } else if (action === "prune" && age && lastSeenBefore) {
            await prune(app, age, lastSeenBefore, Boolean(flags["--yes"]), label);
        } else {
            const listed = await app.admin.listGuests({ limit, lastSeenBefore });
            emit(() => printGuests(listed.guests, listed.total, label), listed);
        }
    } catch (e) {
        reportAppError(e, "Failed to manage the project's guests", origin);
    }
}
