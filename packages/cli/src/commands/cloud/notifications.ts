/**
 * `rebase cloud notifications`: where the linked project's events are POSTed —
 * a Slack or Discord incoming webhook, a chat-ops bot, any https URL.
 *
 *   rebase cloud notifications [list]
 *   rebase cloud notifications add <url> [--events a,b] [--format json|slack] [--name <name>]
 *   rebase cloud notifications test <id>
 *   rebase cloud notifications remove <id> [--yes]
 *
 * The control plane's `/api/functions/notifications/webhooks` routes, the same
 * as the console's Settings → Notifications card. Any member of the
 * organization may list (URLs masked: a Slack webhook URL is a credential);
 * adding, testing and removing take the organization's owner or admin role.
 * The control plane refuses a URL that is not https or that resolves to a
 * private, loopback, link-local or metadata address, at add time and again at
 * every delivery. Each POST is signed: `X-Webhook-Signature: sha256=<hex HMAC
 * of the body>` with the secret `add` prints once.
 */
import chalk from "chalk";
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
    type CloudClient
} from "./context";

/** The events the control plane notifies about. */
export const NOTIFICATION_EVENTS = [
    "deploy.failed",
    "deploy.succeeded",
    "deploy.rolled_back",
    "backup.unhealthy",
    "billing.payment_failed",
    "usage.threshold",
    "preview.paused"
] as const;

export const NOTIFICATIONS_ACTIONS = ["list", "add", "test", "remove"] as const;
export const NOTIFICATIONS_ADD_FLAGS = { "--events": String, "--format": String, "--name": String } as const;

/** A destination, as the control plane lists it. */
export interface CliNotificationWebhook {
    id: string;
    name: string;
    url: string;
    events: string[];
    format: "json" | "slack";
    enabled: boolean;
    lastStatus: number | null;
    lastError: string;
    lastDeliveredAt: string | null;
    failureCount: number;
    createdAt: string | null;
}

/**
 * `--events deploy.failed,backup.unhealthy` as a list, refused when it names an
 * event that does not exist. Exported so its test drives the real parser.
 */
export function parseNotificationEvents(raw: string | undefined): string[] {
    if (raw === undefined) return ["deploy.failed"];
    const events = raw.split(",").map((e) => e.trim()).filter(Boolean);
    if (events.length === 0) fail("--events is empty.", `Pick from: ${NOTIFICATION_EVENTS.join(", ")}.`, "usage");
    for (const event of events) {
        if (!(NOTIFICATION_EVENTS as readonly string[]).includes(event)) {
            fail(`"${event}" is not a notification event.`, `Pick from: ${NOTIFICATION_EVENTS.join(", ")}.`, "usage");
        }
    }
    return [...new Set(events)];
}

function lastDelivery(h: CliNotificationWebhook): string {
    if (!h.enabled) return chalk.gray("switched off");
    if (!h.lastDeliveredAt || h.lastStatus === null) return chalk.gray("nothing sent yet");
    const when = h.lastDeliveredAt.replace("T", " ").slice(0, 16) + " UTC";
    if (h.failureCount > 0 || h.lastStatus < 200 || h.lastStatus >= 300) {
        const status = h.lastStatus ? `HTTP ${h.lastStatus}` : "no response";
        return chalk.red(`failing: ${status} at ${when}, ${h.failureCount} in a row${h.lastError ? ` — ${h.lastError}` : ""}`);
    }
    return chalk.green(`delivered (HTTP ${h.lastStatus}) at ${when}`);
}

async function listWebhooks(client: CloudClient, projectId: string): Promise<CliNotificationWebhook[]> {
    const res = await client.functions.invoke<{ webhooks?: CliNotificationWebhook[] }>("notifications", undefined, {
        method: "GET",
        path: `webhooks?projectId=${encodeURIComponent(projectId)}`
    });
    return res.webhooks ?? [];
}

export async function notificationsCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    requireKnownAction("notifications", action, NOTIFICATIONS_ACTIONS);

    // Every line is parsed before the client is built: a line the parser will
    // refuse costs no login round-trip.
    if (action === "add") {
        const { flags, positionals } = parseCloudArgs({
            spec: NOTIFICATIONS_ADD_FLAGS,
            rawArgs,
            commandWords: 3, // cloud notifications add
            command: "cloud notifications add",
            maxPositionals: 1
        });
        const url = positionals[0];
        if (!url) {
            fail(
                "Usage: rebase cloud notifications add <url> [--events a,b] [--format json|slack]",
                "The URL is a positional argument: `--url` names the control plane in every cloud command.",
                "usage"
            );
        }
        const events = parseNotificationEvents(flags["--events"]);
        const format = flags["--format"] ?? "json";
        if (format !== "json" && format !== "slack") fail(`--format must be json or slack, not "${format}".`, undefined, "usage");
        const { client } = await requireClient(rawArgs);
        const projectId = await requireProject(rawArgs, client);
        let created: { webhook: CliNotificationWebhook; secret: string };
        try {
            created = await client.functions.invoke<{ webhook: CliNotificationWebhook; secret: string }>(
                "notifications",
                { projectId, url, events, format, ...(flags["--name"] ? { name: flags["--name"] } : {}) },
                { path: "webhooks" }
            );
        } catch (e) {
            reportError(e, "Failed to add the notification webhook");
        }
        emit(() => {
            success(`Notifications for ${events.join(", ")} now go to ${chalk.bold(created.webhook.url)} [${created.webhook.id}]`);
            note(`Signing secret (shown once): ${chalk.bold(created.secret)}`);
            note(chalk.gray("Each POST carries X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the body with this secret>."));
            note(chalk.gray(`Check it now: rebase cloud notifications test ${created.webhook.id}`));
            console.log("");
        }, { projectId, webhook: created.webhook, secret: created.secret });
        return;
    }

    if (action === "test" || action === "remove") {
        const { flags, positionals } = parseCloudArgs({
            spec: {},
            rawArgs,
            commandWords: 3,
            command: `cloud notifications ${action}`,
            maxPositionals: 1
        });
        const id = positionals[0];
        if (!id) {
            fail(`Usage: rebase cloud notifications ${action} <id>`, "`rebase cloud notifications list` shows the ids.", "usage");
        }
        const { client } = await requireClient(rawArgs);

        if (action === "remove") {
            await confirmDestructive({
                yes: Boolean(flags["--yes"]),
                prompt: `Remove notification webhook ${id}? Events stop going to it at once.`
            });
            try {
                await client.functions.invoke("notifications", undefined, { method: "DELETE", path: `webhooks/${encodeURIComponent(id)}` });
            } catch (e) {
                reportError(e, "Failed to remove the notification webhook");
            }
            success(`Notification webhook ${chalk.bold(id)} removed`);
            emit(() => {}, { success: true, id });
            return;
        }

        let result: { success: boolean; statusCode: number; error: string; attempts: number };
        try {
            result = await client.functions.invoke<{ success: boolean; statusCode: number; error: string; attempts: number }>(
                "notifications",
                {},
                { path: `webhooks/${encodeURIComponent(id)}/test` }
            );
        } catch (e) {
            reportError(e, "Failed to send the test event");
        }
        if (!result.success) {
            // A delivery the receiver refused is the answer, and a failure: exit 1.
            fail(
                `The test event was not delivered: ${result.statusCode ? `HTTP ${result.statusCode}` : "no response"}.`,
                result.error || undefined,
                "delivery_failed"
            );
        }
        success(`Test event delivered (HTTP ${result.statusCode})`);
        emit(() => {}, { id, ...result });
        return;
    }

    // list
    parseCloudArgs({ spec: {}, rawArgs, commandWords: action ? 3 : 2, command: "cloud notifications", maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    let webhooks: CliNotificationWebhook[];
    try {
        webhooks = await listWebhooks(client, projectId);
    } catch (e) {
        reportError(e, "Failed to list notification webhooks");
    }
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🔔 Notifications — project ${displayProjectRef(rawArgs) || projectId}`));
            console.log("");
            if (webhooks.length === 0) {
                console.log(chalk.gray("  No notification webhooks. Add one with `rebase cloud notifications add <url>`."));
                console.log(chalk.gray("  Which emails you get: the console's Account → Notifications."));
                console.log("");
                return;
            }
            for (const h of webhooks) {
                console.log(`  ${chalk.bold(h.name || h.url)} ${chalk.gray(`[${h.id}]`)}${h.format === "slack" ? chalk.gray(" (Slack message)") : ""}`);
                if (h.name) console.log(`    ${chalk.gray(h.url)}`);
                console.log(`    ${chalk.gray(h.events.join(", "))}`);
                console.log(`    ${lastDelivery(h)}`);
            }
            console.log("");
        },
        { projectId, webhooks }
    );
}
