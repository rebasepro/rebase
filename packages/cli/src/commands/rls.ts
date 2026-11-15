/**
 * CLI command: rebase rls <action>
 *
 * What another identity would see: the app's RLS simulator
 * (`/api/admin/rls-simulator`), the one Studio's "view as" uses. For a role,
 * a user or a service key it answers, table by table, how many rows that
 * identity reads against how many you read, which tables its scopes shut it
 * out of, and which columns it cannot read. Read-only: nothing is written.
 *
 * The simulator answers an administrator's own session, never a key — a
 * machine credential could otherwise borrow anyone's view. So this command
 * sends the session `rebase auth login` stored for the server, and says so
 * when there is none.
 *
 * `rebase verify --live` is the static half: policies checked against the
 * schema with no identity in mind.
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

/** Everything the switch below dispatches, for the did-you-mean. */
export const RLS_SUBCOMMANDS = ["simulate", "options"] as const;

const SIMULATOR = "/api/admin/rls-simulator";

export async function rlsCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    startProjectCommand(rawArgs);
    if (!subcommand || subcommand === "--help" || wantsHelp(rawArgs)) {
        printRlsHelp();
        return;
    }
    switch (subcommand) {
        case "simulate":
            await simulate(rawArgs);
            break;
        case "options":
            await options(rawArgs);
            break;
        default:
            unknownCommand(subcommand, RLS_SUBCOMMANDS, "rls");
    }
}

export const RLS_OPTIONS_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

async function options(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: RLS_OPTIONS_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "rls options",
        maxPositionals: 0
    }));
    const target = await projectTarget(flags, { command: "rls options", defaultCredential: "person" });
    const body = await requestJson(target, `${SIMULATOR}/options`, "Failed to read what can be simulated");
    emit(() => {
        const roles = recordsOf(isRecord(body) ? body.roles : undefined);
        const keys = recordsOf(isRecord(body) ? body.apiKeys : undefined);
        console.log(chalk.bold("  Roles"));
        for (const role of roles) console.log(`    ${stringOf(role.id) ?? "?"}`);
        console.log(chalk.bold("  Service keys"));
        if (keys.length === 0) console.log(chalk.gray("    none"));
        for (const key of keys) console.log(`    ${stringOf(key.id) ?? "?"}  ${stringOf(key.name) ?? ""} ${chalk.gray(`[${stringOf(key.keyPrefix) ?? ""}•••]`)}`);
    }, body);
}

export const RLS_SIMULATE_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--role": String,
    "--user": String,
    "--key": String,
    "--table": String
} satisfies arg.Spec;

async function simulate(rawArgs: string[]): Promise<void> {
    const { flags, simulation } = parsedLine(() => {
        const parsed = parseCommandArgs({
            spec: RLS_SIMULATE_FLAGS,
            rawArgs,
            commandWords: 2,
            command: "rls simulate",
            maxPositionals: 0
        });
        const given = [parsed.flags["--role"], parsed.flags["--user"], parsed.flags["--key"]].filter(v => v !== undefined);
        if (given.length !== 1) throw new UsageError("Name one identity: --role <role>, --user <uid> or --key <api-key-id> (`rebase rls options` lists them).");
        return {
            flags: parsed.flags,
            simulation: {
                ...(parsed.flags["--role"] ? { role: parsed.flags["--role"] } : {}),
                ...(parsed.flags["--user"] ? { userId: parsed.flags["--user"] } : {}),
                ...(parsed.flags["--key"] ? { apiKeyId: parsed.flags["--key"] } : {})
            }
        };
    });
    const target = await projectTarget(flags, { command: "rls simulate", defaultCredential: "person" });
    const body = await requestJson(target, `${SIMULATOR}/preview`, "Failed to simulate", { method: "POST", json: simulation });
    const tables = recordsOf(isRecord(body) ? body.collections : undefined)
        .filter(view => !flags["--table"] || view.slug === flags["--table"]);
    emit(() => {
        const identity = isRecord(body) && isRecord(body.identity) ? body.identity : undefined;
        const who = stringOf(simulation.role) ?? stringOf(simulation.userId) ?? stringOf(simulation.apiKeyId) ?? "?";
        const roles = identity && Array.isArray(identity.roles) ? identity.roles.map(String).join(", ") : "";
        console.log(chalk.bold(`  As ${who}`) + (roles ? chalk.gray(`  roles: ${roles}`) : ""));
        if (tables.length === 0) return note(flags["--table"] ? `No table named ${flags["--table"]}.` : "No tables.");
        const width = Math.max(5, ...tables.map(view => (stringOf(view.slug) ?? "").length));
        for (const view of tables) {
            const slug = stringOf(view.slug) ?? "?";
            const hidden = stringOf(view.hiddenBy);
            const visible = typeof view.visibleRows === "number" ? view.visibleRows : undefined;
            const total = typeof view.totalRows === "number" ? view.totalRows : undefined;
            const rows = hidden === "scope"
                ? chalk.gray("shut out by the key's scopes")
                : hidden === "error"
                    ? chalk.red(`read fails: ${stringOf(view.error) ?? "unknown error"}`)
                    : `${visible ?? "?"} of ${total ?? "?"} rows${hidden === "rls" ? chalk.yellow("  (policies hide every row)") : ""}`;
            const masked = Array.isArray(view.maskedColumns) && view.maskedColumns.length > 0
                ? chalk.gray(`  cannot read: ${view.maskedColumns.map(String).join(", ")}`)
                : "";
            console.log(`  ${slug.padEnd(width)}  ${rows}${masked}`);
        }
    }, body);
}

const RLS_ACTIONS: HelpAction[] = [
    {
        action: "simulate",
        description: "Per table: the rows an identity reads against yours, scope shut-outs, unreadable columns",
        flags: [
            ["--role <role>", "Simulate a role (anon for a visitor)"],
            ["--user <uid>", "Simulate one user, with their live roles"],
            ["--key <api-key-id>", "Simulate a service key, with its scopes"],
            ["--table <slug>", "Only this table"]
        ]
    },
    { action: "options", description: "The roles and service keys there are to simulate" }
];

function printRlsHelp(): void {
    printProjectHelp({
        command: "rls",
        title: "What another identity would see, under the app's row-level security",
        actions: RLS_ACTIONS,
        notes: [
            "The simulator answers an administrator's own session, never a key: sign in first with `rebase auth login`.",
            "Example: rebase rls simulate --role anon",
            "`rebase verify --live` checks the policies themselves, with no identity in mind."
        ]
    });
}
