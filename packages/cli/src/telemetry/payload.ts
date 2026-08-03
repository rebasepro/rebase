import os from "os";
import { createRequire } from "module";

/**
 * Every field that may ever leave the machine, and nothing else.
 *
 * ## The rule this file exists to enforce
 *
 * **No value here may be free text.** Every property is either a number, a
 * boolean, or a string drawn from a set enumerated in this file. That is not
 * fussiness — free text is the mechanism by which telemetry leaks. An error
 * message carries `/Users/francesco/rebase/...`, which is a real person's name.
 * A collection name carries a customer's product vocabulary. A database URL
 * carries a password. None of those are things anyone intends to send; they
 * arrive by being interpolated into a string that a well-meaning field was
 * happy to accept.
 *
 * So the payload is closed by construction. Adding a field means adding it
 * here, where the review question — "can this ever contain something the user
 * typed?" — is unavoidable.
 *
 * ## What is deliberately absent
 *
 * Project names, directory paths, collection or table names, hostnames,
 * database URLs, error messages, stack traces, email addresses, exact row or
 * user counts. Anything that would let a payload be traced to an organisation
 * rather than to an anonymous id.
 */

/**
 * Bumped whenever a field is added, removed or changes meaning.
 *
 * Sent with every event so the receiving end can reject or migrate old shapes,
 * and so `rebase telemetry show` can state which contract the user agreed to.
 */
export const TELEMETRY_SCHEMA_VERSION = 1;

/** The events the CLI reports. Closed set — a name not listed cannot be sent. */
export type TelemetryEventName =
    | "cli.init"
    | "cli.dev"
    | "cli.deploy"
    | "cli.schema_generate"
    | "cli.db_push"
    | "cli.error";

/** A single non-free-text value. */
export type TelemetryValue = string | number | boolean;

export type TelemetryEvent = {
    schema: number;
    event: TelemetryEventName;
    /** Random per machine — see identity.ts on why it is not derived. */
    machineId: string;
    /** Random per checkout. Absent when the command ran outside a project. */
    projectId?: string;
    /** The CLI's own version, so old releases can be told apart. */
    cliVersion: string;
    /** Coarse platform facts, for the support matrix. */
    nodeMajor: number;
    platform: NodeJS.Platform;
    arch: string;
    /** UTC, second precision. Not a device clock reading anyone can fingerprint. */
    at: string;
    properties: Record<string, TelemetryValue>;
};

/**
 * Buckets rather than exact counts.
 *
 * An exact figure is a surprisingly good fingerprint — "this install has 37
 * collections" narrows the field a great deal when combined with a version and
 * a driver. A bucket answers "roughly how big" without doing that.
 */
export function bucket(value: number): string {
    if (!Number.isFinite(value) || value < 0) return "unknown";
    if (value === 0) return "0";
    if (value <= 5) return "1-5";
    if (value <= 20) return "6-20";
    if (value <= 50) return "21-50";
    if (value <= 200) return "51-200";
    return "200+";
}

/** Duration in coarse bands — enough to see "slow", not enough to fingerprint. */
export function durationBucket(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "unknown";
    if (ms < 5_000) return "<5s";
    if (ms < 30_000) return "5-30s";
    if (ms < 120_000) return "30-120s";
    return "120s+";
}

/**
 * An error reduced to something safe to transmit.
 *
 * The message and the stack are discarded, always. What survives is the
 * constructor name and, for the errors that carry one, a `code` — both of which
 * come from the program rather than from anything the user typed or named.
 * `EACCES` is useful and safe; "cannot write /Users/francesco/clients/acme" is
 * neither.
 */
export function errorClass(error: unknown): string {
    if (error && typeof error === "object") {
        const code = (error as { code?: unknown }).code;
        if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(code)) return code;
        const name = (error as { name?: unknown }).name;
        if (typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(name)) return name;
    }
    return "Unknown";
}

/**
 * Drop anything that is not a permitted value type, and clamp strings.
 *
 * The last line of defence rather than the first. Every call site is supposed
 * to pass enumerated values; this is what stops a future one that forgets from
 * turning into an incident. Strings are capped at 64 characters because no
 * legitimate enumerated value is longer, and a path or a message always is.
 */
export function sanitize(properties: Record<string, unknown>): Record<string, TelemetryValue> {
    const out: Record<string, TelemetryValue> = {};
    for (const [key, value] of Object.entries(properties)) {
        if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) continue;
        if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
            out[key] = value;
        } else if (typeof value === "string" && value.length > 0 && value.length <= 64) {
            // Anything with a separator in it is a path, a URL or a sentence —
            // never one of our enumerated tokens.
            if (!/[/\\@:\s]/.test(value)) out[key] = value;
        }
    }
    return out;
}

function cliVersion(): string {
    try {
        const require = createRequire(import.meta.url);
        const pkg = require("../../package.json");
        return typeof pkg?.version === "string" ? pkg.version : "unknown";
    } catch {
        return "unknown";
    }
}

export function buildEvent(
    event: TelemetryEventName,
    properties: Record<string, unknown>,
    identity: { machineId: string; projectId?: string }
): TelemetryEvent {
    return {
        schema: TELEMETRY_SCHEMA_VERSION,
        event,
        machineId: identity.machineId,
        projectId: identity.projectId,
        cliVersion: cliVersion(),
        nodeMajor: Number(process.versions.node.split(".")[0]) || 0,
        platform: os.platform(),
        arch: os.arch(),
        at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        properties: sanitize(properties)
    };
}
