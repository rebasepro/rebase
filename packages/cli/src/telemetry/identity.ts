import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

/**
 * Who is reporting, and where that is remembered.
 *
 * Two identifiers, because they answer two different questions and conflating
 * them would make the answers wrong:
 *
 *  - `machineId` — one developer's machine. Lives beside the cloud credentials
 *    in `~/.rebase/`, so it survives across every project they scaffold.
 *  - `projectId` — one *checkout*. Lives in the project's gitignored
 *    `.rebase/`, in a file of its own, `telemetry-project.json`, so it lasts
 *    as long as the checkout does.
 *
 * Without the split, a developer trying five templates in an afternoon reads as
 * five installations. With it, that is one machine and five projects, which is
 * the shape the funnel actually needs.
 *
 * ## Why `projectId` is not committed
 *
 * `rebase.json` is checked in, and a stable identifier sitting in a public
 * repository is a correlation handle for anyone who finds it — it ties a named
 * organisation to whatever that id did. `.rebase/` is gitignored, so the id
 * stays on the machine that generated it. It also makes the unit honest: what
 * is being counted is a developer working on a project, not the project.
 *
 * ## Why both are random
 *
 * Neither is derived from a hostname, a database name, an email or a machine
 * fingerprint. Hashing any of those only *looks* anonymous — the space of real
 * hostnames is small enough to brute-force a salted hash back to the original
 * in minutes. A random UUID carries no information at all and does the same job.
 */

/** Bumped when the stored shape changes in a way old CLIs cannot read. */
export const TELEMETRY_CONFIG_VERSION = 1;

export type TelemetryConfig = {
    version: number;
    /**
     * `undefined` means never asked — which is *not* the same as declining, and
     * is the only state in which anything may prompt.
     */
    enabled?: boolean;
    machineId?: string;
    /** When the choice was made, so a later release can tell stale consent from fresh. */
    decidedAt?: string;
};

export function configPath(): string {
    return path.join(os.homedir(), ".rebase", "telemetry.json");
}

export function readConfig(): TelemetryConfig {
    try {
        const raw = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
        if (raw && typeof raw === "object") {
            return {
                version: typeof raw.version === "number" ? raw.version : TELEMETRY_CONFIG_VERSION,
                enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
                machineId: typeof raw.machineId === "string" ? raw.machineId : undefined,
                decidedAt: typeof raw.decidedAt === "string" ? raw.decidedAt : undefined
            };
        }
    } catch {
        // Missing, unreadable or corrupt all mean the same thing: we have no
        // record of a decision, so nothing may be sent.
    }
    return { version: TELEMETRY_CONFIG_VERSION };
}

export function writeConfig(config: TelemetryConfig): void {
    const file = configPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 0600: it sits beside `credentials.json`, and a world-readable identifier
    // on a shared machine is a way to link one developer's activity to another's.
    fs.writeFileSync(file, JSON.stringify({ ...config,
version: TELEMETRY_CONFIG_VERSION }, null, 2), {
        encoding: "utf-8",
        mode: 0o600
    });
}

/**
 * The machine's id, generating and persisting one on first use.
 *
 * Only called once consent exists — an id written before the user agreed would
 * be a record we had no right to create, even unsent.
 */
export function ensureMachineId(): string {
    const config = readConfig();
    if (config.machineId) return config.machineId;
    const machineId = crypto.randomUUID();
    writeConfig({ ...config,
machineId });
    return machineId;
}

/** Where a checkout keeps its id, under the project's gitignored `.rebase/`. */
export const PROJECT_ID_FILE = "telemetry-project.json";

/**
 * The checkout's id, generating one if this project has none.
 *
 * The directory is created when it is missing, but **only** where a
 * `rebase.json` proves this really is a project root. An earlier version
 * required `.rebase/` to already exist, on the assumption that `rebase init`
 * created it — it does not. It is written only when a scaffold is linked to
 * Rebase Cloud, so every self-hosted project reported no `projectId` at all,
 * for ever. That silently broke the funnel this id exists for, on exactly the
 * population the telemetry is meant to learn about.
 *
 * The `rebase.json` check is what keeps the fix from being "scatter `.rebase/`
 * wherever a command happens to run": no manifest, no project, no directory,
 * and the event simply reports no project.
 *
 * A file of its own, written by nothing else. The id used to be a key in
 * `.rebase/state.json`, which is the dev server's runtime file: rewritten
 * from scratch on every start and deleted on every shutdown. So every
 * restart of `rebase dev` minted a new id, and one checkout read as a new
 * project each time — the error this split exists to prevent, by another way.
 */
export function ensureProjectId(projectRoot: string): string | undefined {
    if (!fs.existsSync(path.join(projectRoot, "rebase.json"))) return undefined;

    const dir = path.join(projectRoot, ".rebase");
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch {
        return undefined;
    }

    const file = path.join(dir, PROJECT_ID_FILE);
    if (fs.existsSync(file)) return readProjectId(file);

    const projectId = crypto.randomUUID();
    try {
        // `wx`: of two commands minting the first id at once, one writes and
        // the other reads what it wrote.
        fs.writeFileSync(file, `${JSON.stringify({ projectId }, null, 2)}\n`, { encoding: "utf-8", flag: "wx", mode: 0o600 });
    } catch {
        return fs.existsSync(file) ? readProjectId(file) : undefined;
    }
    return projectId;
}

/**
 * The id a checkout's file holds. A file that does not parse is not ours to
 * repair — overwriting it would quietly start a second id for the same
 * checkout — so the event reports no project instead.
 */
function readProjectId(file: string): string | undefined {
    try {
        const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (raw && typeof raw === "object" && typeof raw.projectId === "string") return raw.projectId;
    } catch {
        // Unreadable or corrupt: see above.
    }
    return undefined;
}
