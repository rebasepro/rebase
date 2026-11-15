/**
 * CLI command: rebase api [METHOD] <path>
 *
 * Any route a Rebase app serves, with the target and credential every project
 * command resolves (`utils/project-target.ts`): the local `rebase dev`, a
 * server named by `--url` or `REBASE_BASE_URL`, or a Rebase Cloud project
 * through the console's Studio proxy. Shaped after `gh api`.
 *
 * The answer is printed as it came: JSON pretty-printed, anything else as
 * text. A non-2xx answer is still printed — the app's error envelope is the
 * useful part — and the command exits 1.
 *
 * It exists so the long tail needs no command of its own: a row's history, a
 * materialized view's refresh, the RLS audit, the schema editor's status, a
 * custom function, `/api/meta/contract`. The everyday operations have their
 * own commands (`data`, `users`, `cron`, `storage`, …), which validate their
 * input and confirm what they delete.
 */
import fs from "fs";
import type arg from "arg";
import chalk from "chalk";

import { parseCommandArgs, UsageError, wantsHelp } from "../utils/args";
import { PROJECT_TARGET_FLAGS, type ProjectTarget } from "../utils/project-target";
import {
    parsedLine,
    printProjectHelp,
    projectTarget,
    reportTargetError,
    startProjectCommand
} from "../utils/project-command";

/** The flags `rebase api` takes, on top of the target flags. */
export const API_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--method": String,
    "-X": "--method",
    "--field": [String],
    "-f": "--field",
    "--raw-field": [String],
    "-F": "--raw-field",
    "--input": String,
    "--header": [String],
    "-H": "--header",
    "--include": Boolean,
    "-i": "--include",
    "--silent": Boolean
} satisfies arg.Spec;

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/** What one `rebase api` line asks for. Exported for its tests. */
export interface ApiRequestPlan {
    method: string;
    path: string;
    query: Record<string, string[]>;
    body?: string;
    contentType?: string;
    headers: Record<string, string>;
}

/**
 * The path a request goes to: `/…` as written, anything else under `/api/`
 * — `data/posts` is `/api/data/posts`, as `gh api repos/x` is relative to its
 * API root. A full URL is refused: the target flags say where requests go, so
 * a URL in the path would send the credential somewhere they did not choose.
 */
export function resolveApiPath(raw: string): string {
    const trimmed = raw.trim();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        throw new UsageError(
            `\`rebase api\` takes a path, not a URL (${trimmed}). Name the server with --url and the path after it: `
            + "rebase api --url https://example.com /api/health."
        );
    }
    return trimmed.startsWith("/") ? trimmed : `/api/${trimmed}`;
}

/** `key=value` split at its first `=`. */
function splitField(raw: string, flag: string): [string, string] {
    const at = raw.indexOf("=");
    if (at <= 0) throw new UsageError(`${flag} takes key=value (got "${raw}").`);
    return [raw.slice(0, at), raw.slice(at + 1)];
}

/**
 * A typed field's value, as `gh api -F` reads one: `true`, `false` and `null`
 * as themselves, a number as a number, `@file` as that file's text, a JSON
 * array or object as JSON, anything else as the string.
 */
export function typedFieldValue(raw: string): unknown {
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if (raw.startsWith("@")) {
        const file = raw.slice(1);
        try {
            return fs.readFileSync(file === "-" ? 0 : file, "utf8");
        } catch (e) {
            throw new UsageError(`Cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    }
    return raw;
}

/**
 * Resolve a line into the request it describes. Exported for its tests.
 *
 * The method is the first argument when it is one (`rebase api DELETE
 * data/posts/1`), `--method`, or GET — POST when the line carries a body.
 * Fields go into the query string of a GET, HEAD or DELETE and into a JSON
 * body otherwise, as with `gh api`.
 */
export function resolveApiRequest(rawArgs: string[]): { plan: ApiRequestPlan; flags: ReturnType<typeof parseApiLine>["flags"] } {
    const { flags, positionals } = parseApiLine(rawArgs);
    let words = positionals;
    let method = flags["--method"]?.toUpperCase();
    if (words.length === 2) {
        const first = words[0].toUpperCase();
        if (!METHODS.has(first)) {
            throw new UsageError(`\`rebase api\` takes [METHOD] <path>; "${words[0]}" is not an HTTP method.`);
        }
        if (method && method !== first) throw new UsageError(`The method is given twice: ${first} and --method ${method}.`);
        method = first;
        words = words.slice(1);
    }
    if (words.length !== 1) throw new UsageError("`rebase api` needs a path: rebase api data/posts (see `rebase api --help`).");
    const plan = buildApiPlan({
        method,
        path: resolveApiPath(words[0]),
        fields: flags["--field"],
        rawFields: flags["--raw-field"],
        input: flags["--input"],
        headers: flags["--header"]
    });
    return { plan, flags };
}

/** What a line says about a request, before it is resolved into one. */
export interface ApiRequestParts {
    method?: string;
    /** The path, `/api/…` already resolved, optionally with a query string. */
    path: string;
    fields?: readonly string[];
    rawFields?: readonly string[];
    input?: string;
    headers?: readonly string[];
}

/**
 * Resolve the parts of a line into the request they describe. Shared by
 * `rebase api` and `rebase functions invoke`. Exported for tests.
 *
 * The method is the one given, or GET — POST with `--input`. Fields go into
 * the query string of a GET, HEAD or DELETE and into a JSON body otherwise.
 * Unlike `gh api`, a field alone never makes the request a POST.
 */
export function buildApiPlan(parts: ApiRequestParts): ApiRequestPlan {
    const method = parts.method?.toUpperCase();
    if (method && !METHODS.has(method)) throw new UsageError(`--method ${method} is not an HTTP method.`);

    const fields: Array<[string, unknown]> = [
        ...(parts.fields ?? []).map((raw): [string, unknown] => splitField(raw, "--field")),
        ...(parts.rawFields ?? []).map((raw): [string, unknown] => {
            const [key, value] = splitField(raw, "--raw-field");
            return [key, typedFieldValue(value)];
        })
    ];

    let input: string | undefined;
    if (parts.input !== undefined) {
        const file = parts.input;
        try {
            input = fs.readFileSync(file === "-" ? 0 : file, "utf8");
        } catch (e) {
            throw new UsageError(`Cannot read --input ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // GET unless the line says otherwise. `gh api` switches to POST as soon as
    // a field is added; here that would turn `rebase api data/posts -f limit=5`
    // into creating a row. A write is named (`POST`, `-X PATCH`) or carries a
    // whole body (`--input`).
    const resolvedMethod = method ?? (input !== undefined ? "POST" : "GET");
    const inQuery = resolvedMethod === "GET" || resolvedMethod === "HEAD" || resolvedMethod === "DELETE";
    if (input !== undefined && fields.length > 0 && !inQuery) {
        throw new UsageError("--input is the whole body; fields cannot be added to it. Give one or the other.");
    }

    const headers: Record<string, string> = {};
    for (const raw of parts.headers ?? []) {
        const at = raw.indexOf(":");
        if (at <= 0) throw new UsageError(`--header takes "Name: value" (got "${raw}").`);
        const name = raw.slice(0, at).trim();
        if (/^authorization$/i.test(name)) {
            throw new UsageError("Pass a bearer with --token, not an Authorization header: the target decides where credentials go.");
        }
        headers[name] = raw.slice(at + 1).trim();
    }

    const query: Record<string, string[]> = {};
    const [bare, search] = parts.path.split(/\?(.*)/s, 2);
    if (search) {
        for (const [key, value] of new URLSearchParams(search)) (query[key] ??= []).push(value);
    }

    const plan: ApiRequestPlan = { method: resolvedMethod, path: bare, query, headers };
    if (inQuery) {
        for (const [key, value] of fields) (query[key] ??= []).push(typeof value === "string" ? value : JSON.stringify(value));
    }
    if (input !== undefined) {
        plan.body = input;
        plan.contentType = looksLikeJson(input) ? "application/json" : "application/octet-stream";
    } else if (fields.length > 0 && !inQuery) {
        plan.body = JSON.stringify(Object.fromEntries(fields));
        plan.contentType = "application/json";
    }
    return plan;
}

function looksLikeJson(text: string): boolean {
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

function parseApiLine(rawArgs: string[]) {
    return parseCommandArgs({
        spec: API_FLAGS,
        rawArgs,
        commandWords: 1,
        command: "api",
        maxPositionals: 2
    });
}

export async function apiCommand(rawArgs: string[]): Promise<void> {
    startProjectCommand(rawArgs);
    if (wantsHelp(rawArgs)) {
        printApiHelp();
        return;
    }
    const { plan, flags } = parsedLine(() => resolveApiRequest(rawArgs));
    const target = await projectTarget(flags, { command: "api" });
    await sendApiPlan(target, plan, { include: flags["--include"] === true, silent: flags["--silent"] === true });
}

/**
 * Send a resolved request and print the answer as it came: JSON
 * pretty-printed, anything else as text, the status line and headers first
 * with `include`. A non-2xx answer is printed too, and exits 1.
 */
export async function sendApiPlan(
    target: ProjectTarget,
    plan: ApiRequestPlan,
    options: { include?: boolean; silent?: boolean } = {}
): Promise<void> {
    let res: Response;
    try {
        res = await target.request(plan.path, {
            method: plan.method,
            query: plan.query,
            body: plan.body,
            headers: { ...plan.headers, ...(plan.contentType ? { "Content-Type": plan.contentType } : {}) }
        });
    } catch (e) {
        reportTargetError(e, target);
    }

    if (options.include) {
        process.stdout.write(`HTTP ${res.status} ${res.statusText}\n`);
        res.headers.forEach((value, name) => process.stdout.write(`${name}: ${value}\n`));
        process.stdout.write("\n");
    }

    const text = plan.method === "HEAD" ? "" : await res.text();
    if (!options.silent && text) {
        let printed = text;
        try {
            printed = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
            // Not JSON: printed as it came.
        }
        process.stdout.write(printed.endsWith("\n") ? printed : `${printed}\n`);
    }

    if (res.status >= 300) {
        // The body above says why; this is the exit code a script branches on,
        // and one line for whoever reads the terminal.
        process.stderr.write(chalk.red(`✗ HTTP ${res.status} from ${target.label}\n`));
        process.exit(1);
    }
}

function printApiHelp(): void {
    printProjectHelp({
        command: "api",
        usage: "[METHOD] <path>",
        title: "Send any request to the app's API, with the project's credential",
        actions: [
            {
                action: "[METHOD] <path>",
                description: "data/posts is /api/data/posts; a path starting with / is sent as written",
                flags: [
                    ["--method, -X <method>", "The HTTP method (else GET; POST with --input — a field alone never writes)"],
                    ["--field, -f <key=value>", "A string field: query string on GET/HEAD/DELETE, JSON body otherwise"],
                    ["--raw-field, -F <key=value>", "A typed field: true/false/null, numbers, JSON, @file"],
                    ["--input <file|->", "The whole request body, from a file or stdin"],
                    ["--header, -H <\"Name: value\">", "An extra request header (never Authorization: use --token)"],
                    ["--include, -i", "Print the status line and response headers first"],
                    ["--silent", "Print nothing; only the exit code says how it went"]
                ]
            }
        ],
        notes: [
            "Examples:",
            "  rebase api data/posts -f status=eq.published -f limit=5",
            "  rebase api POST data/posts -F title=Hello -F published=true",
            "  rebase api /api/admin/rls-audit --project acme",
            "  rebase api functions/hello --anon",
            "A non-2xx answer is printed and exits 1. The everyday operations have their own commands: rebase data, users, cron, storage, functions, logs."
        ]
    });
}
