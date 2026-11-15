/**
 * What every project command shares besides its target: the output mode, the
 * help page, the parse refusal and the way a failed request is reported.
 *
 * The output contract is the cloud family's (`commands/cloud/context.ts`),
 * reused rather than copied: one JSON value on stdout when `--json` is given,
 * `REBASE_JSON=1` is set or stdout is not a terminal; everything else on
 * stderr; a refusal is `{ "error": { message, code, hint } }` and exit 1; a
 * destructive action refuses rather than prompts when nobody can answer.
 *
 * Help is the one difference: a project command's `--help` is the page a
 * person reads even when piped (`rebase data --help | less`), and JSON only
 * when `--json` asks for it.
 */
import {
    emit,
    fail,
    initOutputMode,
    isJsonMode,
    printGroupHelp,
    type GroupHelp,
    type HelpAction
} from "../commands/cloud/context";
import { wantsHelp } from "./args";
import {
    PROJECT_TARGET_HELP,
    TargetError,
    readJson,
    resolveProjectTarget,
    unreachableHint,
    type ProjectTarget,
    type ProjectTargetFlags,
    type ProjectTargetOptions,
    type RequestOptions
} from "./project-target";

export { emit, fail, isJsonMode, type HelpAction };

/** Latch the output mode for this run. Call first, before anything prints. */
export function startProjectCommand(rawArgs: string[]): void {
    initOutputMode(rawArgs, { whenPiped: wantsHelp(rawArgs) ? "human" : "json" });
}

/** A project group's help page, with the target flags as its global options. */
export function printProjectHelp(page: Omit<GroupHelp, "globalFlags">): void {
    printGroupHelp({ ...page, globalFlags: PROJECT_TARGET_HELP });
}

/**
 * Run a parse, and report its refusal through {@link fail} — one JSON value
 * when piped — rather than as a throw, which `bin/rebase.js` prints as text.
 */
export function parsedLine<T>(parse: () => T): T {
    try {
        return parse();
    } catch (e) {
        fail(e instanceof Error ? e.message : String(e), undefined, "usage");
    }
}

/** Report a {@link TargetError} through {@link fail}; rethrow anything else. */
export function reportTargetError(e: unknown, target?: ProjectTarget): never {
    if (e instanceof TargetError) {
        const hint = e.code === "network_error" && target ? (unreachableHint(target) ?? e.hint) : e.hint;
        fail(e.message, hint, e.code);
    }
    throw e;
}

/** Resolve the target, or end the command with why not. */
export async function projectTarget(
    flags: Readonly<Record<string, unknown>>,
    options: ProjectTargetOptions
): Promise<ProjectTarget> {
    try {
        return await resolveProjectTarget(targetFlagsOf(flags), options);
    } catch (e) {
        reportTargetError(e);
    }
}

/** The target flags out of a command's parsed flags, whatever else its spec declares. */
function targetFlagsOf(flags: Record<string, unknown>): ProjectTargetFlags {
    const str = (key: string): string | undefined => (typeof flags[key] === "string" ? String(flags[key]) : undefined);
    const bool = (key: string): boolean | undefined => (flags[key] === true ? true : undefined);
    return {
        "--project": str("--project"),
        "--cloud": bool("--cloud"),
        "--url": str("--url"),
        "--token": str("--token"),
        "--session": bool("--session"),
        "--anon": bool("--anon")
    };
}

/** Send one request and read its JSON answer, or end the command with the app's own refusal. */
export async function requestJson(
    target: ProjectTarget,
    path: string,
    action: string,
    options: RequestOptions = {}
): Promise<unknown> {
    try {
        const res = await target.request(path, { timeoutMs: 60_000, ...options });
        return await readJson(res, target, action);
    } catch (e) {
        reportTargetError(e, target);
    }
}

/** Narrowing helpers for the answers commands read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recordsOf(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function stringOf(value: unknown): string | undefined {
    return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

/** A cell's text for a table: strings as they are, everything else as compact JSON. */
export function cellText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
}
