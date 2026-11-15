/**
 * Who still depends on the change-capture triggers.
 *
 * A process that streams changes from the WAL takes the capture triggers off
 * the tables, so writes pay for no trigger and no NOTIFY. That is only safe
 * when nobody else is still hearing changes through them: a replica that fell
 * back to trigger capture (it found no free replication slot, say) or an older
 * version mid-rollout is LISTENing on `rebase_cdc`, and taking the triggers
 * away leaves it deaf — writes made anywhere else never reach its subscribers.
 *
 * Every realtime LISTEN connection names itself in `application_name`
 * (`rebase-realtime:<instance id>`, then the role of the connection), which
 * `pg_stat_activity` shows to any role, so the question is one query:
 *
 *  - `…:cdc` — a trigger-capture LISTEN. A consumer.
 *  - `…:entity` / `…:wal` — the legacy cross-instance channel, or a WAL stream.
 *    Not a consumer.
 *  - the bare name — a version from before the connections said which they
 *    are. It may be a trigger LISTEN, so it counts as one.
 *
 * Anything uncertain keeps the triggers: an extra trigger costs throughput, a
 * missing one costs correctness.
 */
import type { RawSqlRunner } from "../../security/rls-enforcement";
import { removeTriggerCdc } from "./trigger-cdc";

/** How every realtime LISTEN connection's `application_name` starts. */
export const REALTIME_LISTENER_APPLICATION_PREFIX = "rebase-realtime:";

/** What a realtime connection is for — the suffix after its instance's name. */
export type RealtimeListenerRole = "cdc" | "entity" | "wal";

/** The `application_name` of one of an instance's realtime connections. */
export function realtimeListenerApplicationName(instanceName: string, role: RealtimeListenerRole): string {
    return `${instanceName}:${role}`;
}

export interface ListenerSession {
    applicationName: string | null;
    /** `pg_stat_activity.backend_type`, when the role may see it. */
    backendType: string | null;
}

/**
 * Whether a session may be hearing changes through the capture triggers.
 *
 * @param ownInstanceName This process's `rebase-realtime:<instance id>`; its
 *        own connections never count.
 */
export function isTriggerCaptureConsumer(session: ListenerSession, ownInstanceName: string): boolean {
    const name = session.applicationName;
    if (!name || !name.startsWith(REALTIME_LISTENER_APPLICATION_PREFIX)) return false;
    if (name === ownInstanceName || name.startsWith(`${ownInstanceName}:`)) return false;
    // A replication connection streams the WAL; it LISTENs on nothing.
    if (session.backendType === "walsender") return false;
    const rest = name.slice(REALTIME_LISTENER_APPLICATION_PREFIX.length);
    const role = rest.includes(":") ? rest.slice(rest.lastIndexOf(":") + 1) : undefined;
    if (role === "entity" || role === "wal") return false;
    // `cdc`, the bare name of an older version, or a role this version does
    // not know: any of them may be listening on the triggers.
    return true;
}

/**
 * How many other sessions on this database may depend on the capture
 * triggers. A failed query answers `undefined` — the caller keeps the triggers.
 */
export async function countTriggerCaptureConsumers(run: RawSqlRunner, ownInstanceName: string): Promise<number | undefined> {
    try {
        const rows = await run(
            "SELECT application_name, backend_type FROM pg_stat_activity " +
            "WHERE datname = current_database() " +
            `AND starts_with(application_name, '${REALTIME_LISTENER_APPLICATION_PREFIX}')`
        );
        return rows
            .map((row): ListenerSession => ({
                applicationName: typeof row.application_name === "string" ? row.application_name : null,
                backendType: typeof row.backend_type === "string" ? row.backend_type : null
            }))
            .filter((session) => isTriggerCaptureConsumer(session, ownInstanceName))
            .length;
    } catch {
        return undefined;
    }
}

/** How often a WAL-streaming instance that kept the triggers for another one checks whether it is gone. */
export const TRIGGER_RETIREMENT_INTERVAL_MS = 5 * 60 * 1000;

export type TriggerRetirement =
    | { removed: number }
    /** Kept: `consumers` other sessions may depend on them, or `undefined` when that could not be read. */
    | { kept: true; consumers: number | undefined };

/**
 * Take the capture triggers off the tables — unless another session may still
 * be hearing changes through them ({@link countTriggerCaptureConsumers}).
 *
 * For a process that streams changes from the WAL: it does not need them, and
 * every write pays a trigger and a NOTIFY while they stay.
 */
export async function retireTriggerCaptureIfUnused(run: RawSqlRunner, ownInstanceName: string): Promise<TriggerRetirement> {
    const consumers = await countTriggerCaptureConsumers(run, ownInstanceName);
    if (consumers === undefined || consumers > 0) return { kept: true, consumers };
    return { removed: await removeTriggerCdc(run) };
}
