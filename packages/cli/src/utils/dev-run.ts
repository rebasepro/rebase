/**
 * What a running `rebase dev` says about itself, for the commands run beside it.
 *
 * `.rebase/dev.json`, written by the `rebase dev` process when it starts the
 * backend and removed when it stops:
 *
 *     { "pid": 4242, "database": "localhost:54329/postgres",
 *       "backendUrl": "http://localhost:3082", "startedAt": "…" }
 *
 * The backend's own `.rebase/state.json` cannot answer either question this
 * one is for:
 *
 * - **Where the backend is.** `state.json` belongs to whichever backend in the
 *   project bound last. A `rebase dev` killed without its Ctrl+C leaves its
 *   backend running under `tsx watch`, and that orphan restarts on the next
 *   file save and writes `state.json` again with its own port — so
 *   `rebase auth emails` asked a stale server on 3083 while `rebase dev`
 *   served on 3082, and printed its empty mailbox. Only one `rebase dev`
 *   process is alive per run, and it records the port its own backend
 *   announced.
 * - **Which database.** A running `rebase dev` applies schema edits as files
 *   are saved (boot creates missing tables and columns), so `rebase db push
 *   --dry-run` beside it answers "No changes" for a column added a minute
 *   earlier. Saying so needs to know the two are on the same database.
 *
 * `database` is the address alone — host, port, database name — never the
 * connection string: no credentials are written here. Every read checks that
 * the pid is still alive, because a `rebase dev` that was killed leaves the
 * file behind.
 */
import fs from "fs";
import path from "path";

import type { PreparedDatabase } from "../dev-db/prepare";

/** One `rebase dev` run, as {@link readRunningDev} returns it. */
export interface DevRun {
    /** The `rebase dev` process. */
    pid: number;
    /** `host:port/name` of the database its backend runs on, or null when it was not resolved. */
    database: string | null;
    /** Where its backend answers, once it has announced the port it bound. */
    backendUrl: string | null;
    startedAt: string;
}

export function devRunPath(projectRoot: string): string {
    return path.join(projectRoot, ".rebase", "dev.json");
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * A database's address without its credentials — `host:port/name` — or null
 * when `url` is not a connection string.
 *
 * Normalized so two spellings of one database compare equal: every loopback
 * name is `localhost`, the port defaults to 5432, and a socket directory given
 * as `?host=` stands in for an empty host.
 */
export function databaseAddress(url: string | null | undefined): string | null {
    if (!url) return null;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
    const rawHost = (parsed.hostname || parsed.searchParams.get("host") || "").toLowerCase();
    if (!rawHost) return null;
    const host = LOOPBACK.has(rawHost) ? "localhost" : rawHost;
    const port = parsed.port || "5432";
    let name = parsed.pathname.replace(/^\//, "");
    try {
        name = decodeURIComponent(name);
    } catch {
        // An undecodable name is compared as written.
    }
    return `${host}:${port}/${name}`;
}

/**
 * The connection string a prepared database hands the backend: the managed
 * daemon's, which only `env` carries, or the one the resolver chose.
 */
export function preparedDatabaseUrl(prepared: Pick<PreparedDatabase, "database" | "env"> | null): string | null {
    if (!prepared) return null;
    if (prepared.database.kind === "managed") return prepared.env.DATABASE_URL ?? null;
    return prepared.database.url ?? prepared.env.DATABASE_URL ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecord(projectRoot: string): DevRun | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(devRunPath(projectRoot), "utf-8"));
    } catch {
        return null;
    }
    if (!isRecord(parsed)) return null;
    const pid = parsed.pid;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
    return {
        pid,
        database: text(parsed.database),
        backendUrl: text(parsed.backendUrl),
        startedAt: text(parsed.startedAt) ?? ""
    };
}

function writeRecord(projectRoot: string, run: DevRun): void {
    try {
        fs.mkdirSync(path.dirname(devRunPath(projectRoot)), { recursive: true });
        fs.writeFileSync(devRunPath(projectRoot), `${JSON.stringify(run, null, 2)}\n`, "utf-8");
    } catch {
        // Best effort: a `.rebase/` that cannot be written costs the commands
        // beside this run their answer, never the run itself.
    }
}

/**
 * Whether a process with this pid is alive and this user's. `EPERM` is a
 * process of another user's, which is not a `rebase dev` this user started.
 */
export function isOwnProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** Record this `rebase dev` run, on the database its backend is about to use. */
export function recordDevRun(projectRoot: string, databaseUrl: string | null): void {
    writeRecord(projectRoot, {
        pid: process.pid,
        database: databaseAddress(databaseUrl),
        backendUrl: null,
        startedAt: new Date().toISOString()
    });
}

/** Record where this run's backend answers, once it has said which port it bound. */
export function recordDevBackendUrl(projectRoot: string, backendUrl: string): void {
    const run = readRecord(projectRoot);
    if (!run || run.pid !== process.pid) return;
    writeRecord(projectRoot, { ...run, backendUrl });
}

/** Remove this run's record, and only this run's: another `rebase dev` may have taken it over. */
export function forgetDevRun(projectRoot: string): void {
    if (readRecord(projectRoot)?.pid !== process.pid) return;
    try {
        fs.unlinkSync(devRunPath(projectRoot));
    } catch {
        // Already gone is the desired end state.
    }
}

/** The `rebase dev` running for this project, or null when none is. */
export function readRunningDev(projectRoot: string): DevRun | null {
    const run = readRecord(projectRoot);
    return run && isOwnProcessAlive(run.pid) ? run : null;
}

/** The `rebase dev` running for this project on the database `databaseUrl` names, or null. */
export function runningDevOnDatabase(projectRoot: string, databaseUrl: string | null): DevRun | null {
    const address = databaseAddress(databaseUrl);
    if (!address) return null;
    const run = readRunningDev(projectRoot);
    return run && run.database === address ? run : null;
}

/**
 * What `rebase db push` adds when a `rebase dev` runs on the database it just
 * planned against: that server applies new tables and columns as files are
 * saved, so a change it already applied is not in the plan.
 */
export function devServerAppliesSchemaNote(run: DevRun): string {
    const where = run.backendUrl ? ` at ${run.backendUrl}` : "";
    return `ℹ \`rebase dev\` is running on this database${where} (pid ${run.pid}). It applies new tables and columns ` +
        "as you save, so a change it has already applied is not listed here.";
}
