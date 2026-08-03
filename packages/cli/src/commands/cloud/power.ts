/**
 * `rebase cloud start | stop | restart` — power operations.
 *
 * These flip the project's `status`, exactly as the console's `handleServerAction`
 * does: stop → `stopped`, start → `active`, restart → stop then start with a
 * brief pause in between (a real stop→start with genuine downtime). Stop and
 * restart cause downtime, so they require `--yes` in non-interactive use.
 */
import arg from "arg";
import { requireClient, requireProject, displayProjectRef, emit, confirmDestructive, success, reportError, type CloudClient } from "./context";

type PowerAction = "start" | "stop" | "restart";

async function setStatus(client: CloudClient, projectId: string, status: "active" | "stopped"): Promise<void> {
    await client.data.collection("projects").update(projectId, { status });
}

export async function powerCommand(action: PowerAction, rawArgs: string[]): Promise<void> {
    const args = arg({ "--yes": Boolean,
"-y": "--yes",
"--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    // start is benign; stop and restart cause downtime and are gated.
    if (action !== "start") {
        await confirmDestructive({
            yes: Boolean(args["--yes"]),
            prompt: `${action === "stop" ? "Stop" : "Restart"} project ${projectRef}? This causes downtime.`
        });
    }

    try {
        if (action === "stop") {
            await setStatus(client, projectId, "stopped");
            emit(() => success(`Stopped project ${projectRef}`), { success: true,
projectId,
status: "stopped" });
        } else if (action === "start") {
            await setStatus(client, projectId, "active");
            emit(() => success(`Started project ${projectRef}`), { success: true,
projectId,
status: "active" });
        } else {
            await setStatus(client, projectId, "stopped");
            await new Promise((r) => setTimeout(r, 1500));
            await setStatus(client, projectId, "active");
            emit(() => success(`Restarted project ${projectRef}`), { success: true,
projectId,
status: "active" });
        }
    } catch (e) {
        reportError(e, `Failed to ${action} project`);
    }
}
