/**
 * CLI command: rebase functions <action>
 *
 * A running app's own routes — one per file in `backend/functions/`, served at
 * `/api/functions/<name>/*` — listed, or called with the project's credential.
 * `invoke` is `rebase api` aimed at one function: the same fields, body and
 * headers, and the answer printed as it came.
 *
 * Functions are public by default and decide their own access
 * (`requireAuth`, `requireRole`, `requireScope`), so the credential matters:
 * the service key is admin, `--token` tests a narrower one, `--session` a
 * person, and `--anon` what a visitor gets.
 */
import type arg from "arg";
import chalk from "chalk";

import { parseCommandArgs, UsageError, wantsHelp } from "../utils/args";
import { unknownCommand } from "../utils/unknown-command";
import { PROJECT_TARGET_FLAGS } from "../utils/project-target";
import {
    emit,
    isRecord,
    parsedLine,
    printProjectHelp,
    projectTarget,
    recordsOf,
    requestJson,
    startProjectCommand,
    stringOf,
    type HelpAction
} from "../utils/project-command";
import { note } from "./cloud/context";
import { buildApiPlan, sendApiPlan } from "./api";

/** Everything the switch below dispatches, for the did-you-mean. */
export const FUNCTIONS_SUBCOMMANDS = ["list", "invoke"] as const;

export async function functionsCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    startProjectCommand(rawArgs);
    if (subcommand === "--help" || wantsHelp(rawArgs)) {
        printFunctionsHelp();
        return;
    }
    switch (subcommand ?? "list") {
        case "list":
            await listFunctions(rawArgs);
            break;
        case "invoke":
            await invokeFunction(rawArgs);
            break;
        default:
            unknownCommand(subcommand, FUNCTIONS_SUBCOMMANDS, "functions");
    }
}

export const FUNCTIONS_LIST_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

async function listFunctions(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: FUNCTIONS_LIST_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "functions list",
        maxPositionals: 0
    }));
    const target = await projectTarget(flags, { command: "functions list" });
    const body = await requestJson(target, "/api/functions", "Failed to list functions");
    const list = recordsOf(isRecord(body) ? body.functions ?? body.data : body);
    emit(() => {
        if (list.length === 0) return note(`${target.label} serves no functions (backend/functions/ is empty, or no file loaded).`);
        for (const fn of list) {
            const name = stringOf(fn.name) ?? "?";
            console.log(`  ${chalk.bold(name)}  ${chalk.gray(stringOf(fn.path) ?? `/api/functions/${name}`)}`);
        }
        if (isRecord(body) && typeof body.skipped === "number" && body.skipped > 0) {
            note(chalk.yellow(`${body.skipped} file(s) did not load; the server log says why.`));
        }
    }, body);
}

export const FUNCTIONS_INVOKE_FLAGS = {
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
    "-i": "--include"
} satisfies arg.Spec;

async function invokeFunction(rawArgs: string[]): Promise<void> {
    const { flags, plan } = parsedLine(() => {
        const parsed = parseCommandArgs({
            spec: FUNCTIONS_INVOKE_FLAGS,
            rawArgs,
            commandWords: 2,
            command: "functions invoke",
            maxPositionals: 2
        });
        const [name, rest] = parsed.positionals;
        if (!name) throw new UsageError("rebase functions invoke needs a function name: rebase functions invoke <name> [path].");
        if (name.includes("/")) throw new UsageError(`"${name}" is not a function name: the path after it is the second argument.`);
        const sub = rest ? `/${rest.replace(/^\/+/, "")}` : "";
        return {
            flags: parsed.flags,
            plan: buildApiPlan({
                method: parsed.flags["--method"],
                path: `/api/functions/${encodeURIComponent(name)}${sub}`,
                fields: parsed.flags["--field"],
                rawFields: parsed.flags["--raw-field"],
                input: parsed.flags["--input"],
                headers: parsed.flags["--header"]
            })
        };
    });
    const target = await projectTarget(flags, { command: "functions invoke" });
    await sendApiPlan(target, plan, { include: flags["--include"] === true });
}

const FUNCTIONS_ACTIONS: HelpAction[] = [
    { action: "list", description: "The functions the server loaded (the default)" },
    {
        action: "invoke",
        args: "<name> [path]",
        description: "Call one: /api/functions/<name>/<path>, the answer printed as it came",
        flags: [
            ["--method, -X <method>", "The HTTP method (else GET; POST with --input — a field alone never writes)"],
            ["--field, -f <key=value>", "A string field: query string on GET/HEAD/DELETE, JSON body otherwise"],
            ["--raw-field, -F <key=value>", "A typed field: true/false/null, numbers, JSON, @file"],
            ["--input <file|->", "The whole request body"],
            ["--header, -H <\"Name: value\">", "An extra request header"],
            ["--include, -i", "Print the status line and response headers first"]
        ]
    }
];

function printFunctionsHelp(): void {
    printProjectHelp({
        command: "functions",
        title: "A running app's own routes (backend/functions): list them, call one",
        actions: FUNCTIONS_ACTIONS,
        notes: [
            "Examples:",
            "  rebase functions invoke hello --anon",
            "  rebase functions invoke billing webhook -X POST --input event.json",
            "A non-2xx answer is printed and exits 1. Functions decide their own access, so the credential matters: --anon shows what a visitor gets."
        ]
    });
}
