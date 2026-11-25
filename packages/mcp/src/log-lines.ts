/**
 * Log lines as a model reads them.
 *
 * A Rebase runtime prints one JSON record per line —
 * `{"severity":"INFO","message":"…","timestamp":"…","component":"http",…fields}`
 * — and Rebase Cloud renders each as `<kubelet RFC3339Nano> [<pod>] <record>`.
 * Handed over as that, every line pays for two timestamps, a pod name it
 * shares with every other line, and the quoting of every key. Compact, it is
 *
 *     2026-11-24T14:30:32.126Z WARNING [http] GET /api/x 404 16ms requestId=r-1
 *
 * the record's own time, its severity as written, the pod's short name only
 * when the lines come from several, the component, the message (a request's
 * as method, path, status and latency), then every other field as
 * `key=value`, a value quoted as JSON when it holds a space, a quote or `=`.
 * A line that is not a JSON object is kept as it came, with its pod shortened
 * the same way.
 *
 * The level rules are the CLI's (`packages/cli/src/commands/cloud/runtime-logs.ts`).
 */

/** `<RFC3339> [<pod>] <text>`, each part optional, as `rebase cloud logs` reads it. */
const LINE_PREFIX = /^(?:(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+)?(?:\[([^\]\s]+)\]\s+)?([\s\S]*)$/;

const LEVEL_KEYS = ["severity", "level", "levelname", "loglevel", "lvl"];
const MESSAGE_KEYS = ["message", "msg"];
const TIME_KEYS = ["timestamp", "time"];

interface SplitLine {
    ts: string | null;
    pod: string | null;
    text: string;
}

function splitLine(line: string): SplitLine {
    const m = LINE_PREFIX.exec(line);
    return m ? { ts: m[1] ?? null, pod: m[2] ?? null, text: m[3] ?? "" } : { ts: null, pod: null, text: line };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A numeric (pino/bunyan) level as a word: 50+ ERROR, 40 WARN, 30 INFO, below that DEBUG. */
function severityWord(value: unknown): string | null {
    if (typeof value === "string" && value.trim() !== "") return value.trim().toUpperCase();
    if (typeof value === "number") return value >= 50 ? "ERROR" : value >= 40 ? "WARN" : value >= 30 ? "INFO" : "DEBUG";
    return null;
}

/** One field value as `key=value` writes it. */
export function formatFieldValue(value: unknown): string {
    if (typeof value === "string") return value !== "" && /^[^\s"=]+$/.test(value) ? value : JSON.stringify(value);
    if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/** `x2k4p` of `rebase-backend-7d9f8c6b5-x2k4p`: the part that tells replicas apart. */
export function podShortName(pod: string): string {
    const at = pod.lastIndexOf("-");
    return at === -1 || at === pod.length - 1 ? pod : pod.slice(at + 1);
}

/**
 * A JSON record's text, compact, or null when `text` is not a JSON object.
 * `fallbackTime` is used when the record carries no time of its own.
 */
export function compactRecord(text: string, opts: { fallbackTime?: string | null; pod?: string | null } = {}): string | null {
    const body = text.trim();
    if (!body.startsWith("{") || !body.endsWith("}")) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return null;
    }
    if (!isPlainObject(parsed)) return null;
    const levelKey = LEVEL_KEYS.find((k) => Object.prototype.hasOwnProperty.call(parsed, k));
    const messageKey = MESSAGE_KEYS.find((k) => typeof parsed[k] === "string");
    const timeKey = TIME_KEYS.find((k) => typeof parsed[k] === "string");
    const component = typeof parsed.component === "string" ? parsed.component : null;
    const message = messageKey ? String(parsed[messageKey]) : "";

    const used = new Set<string>([levelKey, messageKey, timeKey].filter((k): k is string => k !== undefined));
    if (component !== null) used.add("component");

    let head = message;
    const method = parsed.method;
    const path = parsed.path;
    if ((message === "request" || message === "") && typeof method === "string" && typeof path === "string") {
        const parts = [method, path];
        used.add("method").add("path");
        if (typeof parsed.status === "number" || typeof parsed.status === "string") {
            parts.push(String(parsed.status));
            used.add("status");
        }
        const latency = typeof parsed.latencyMs === "number" ? { key: "latencyMs", ms: parsed.latencyMs }
            : typeof parsed.duration === "number" ? { key: "duration", ms: parsed.duration }
                : null;
        if (latency) {
            parts.push(`${latency.ms}ms`);
            used.add(latency.key);
        }
        if (parsed.route === path) used.add("route");
        head = parts.join(" ");
    }

    const fields = Object.entries(parsed)
        .filter(([k, v]) => !used.has(k) && v !== undefined)
        .map(([k, v]) => `${k}=${formatFieldValue(v)}`)
        .join(" ");
    const time = timeKey ? String(parsed[timeKey]) : opts.fallbackTime ?? null;
    return [
        time,
        levelKey ? severityWord(parsed[levelKey]) : null,
        opts.pod ? `[${opts.pod}]` : null,
        component !== null ? `[${component}]` : null,
        head || null,
        fields || null
    ].filter((p): p is string => p !== null).join(" ");
}

/**
 * Rendered log lines (`<ts> [<pod>] <text>`, from Rebase Cloud) compact, one
 * per line. The pod is named by its short name, and only when the lines come
 * from more than one.
 */
export function compactLogLines(logs: string): string {
    const lines = logs.split("\n").filter((l) => l !== "").map(splitLine);
    const multiPod = new Set(lines.map((l) => l.pod).filter((p) => p !== null)).size > 1;
    return lines
        .map((l) => {
            const pod = multiPod && l.pod !== null ? podShortName(l.pod) : null;
            const compact = compactRecord(l.text, { fallbackTime: l.ts, pod });
            if (compact !== null) return compact;
            return [l.ts, pod ? `[${pod}]` : null, l.text].filter((p): p is string => p !== null).join(" ");
        })
        .join("\n");
}

/**
 * A process's own output (no kubelet prefix, maybe ANSI-coloured), with every
 * line that is a JSON record made compact and every other line left as it is.
 */
export function compactOutputLines(output: string): string {
    return output
        .split("\n")
        .map((line) => compactRecord(line) ?? line)
        .join("\n");
}

/** The pod fields worth a model's tokens: name, state, lines and restarts, the rest only when they say something. */
function compactPod(pod: unknown): unknown {
    if (!isPlainObject(pod)) return pod;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(pod)) {
        if (v === null || v === undefined) continue;
        if ((k === "truncated" || k === "scanCapped") && v === false) continue;
        if (k === "container") continue;
        out[k] = v;
    }
    return out;
}

/**
 * The body of a log read for a model: one line of JSON holding everything but
 * the log (pods trimmed to what says something), a blank line, then the log —
 * compact when `compact`, as it came otherwise.
 */
export function logReadBody(value: Record<string, unknown>, opts: { compact: boolean }): string {
    const { logs, ...rest } = value;
    const header: Record<string, unknown> = { ...rest };
    if (Array.isArray(rest.pods)) header.pods = rest.pods.map(compactPod);
    const text = typeof logs === "string" ? (opts.compact ? compactLogLines(logs) : logs.replace(/\n$/, "")) : "";
    return `${JSON.stringify(header)}\n\n${text || "(no lines)"}`;
}
