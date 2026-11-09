/**
 * `rebase db request-role migrate` and `rebase db provision --print`: the
 * commands that move a database to another request role, and show the SQL
 * that sets one up, for a database Rebase does not own outright.
 *
 * The line parsers and the renderers are pure and load nothing heavy, because
 * `db-command-line.ts` judges every `rebase db …` line with them before the
 * CLI starts a database. The commands themselves import the security modules
 * and the connection only when they run.
 */
import type arg from "arg";
import chalk from "chalk";
import { REBASE_USER_ROLE } from "@rebasepro/common";

import { closestWord, parseCommandFlags } from "./cli-flags";
import { out, outError, outWarn } from "./cli-output";
import { promptConfirm } from "./cli-prompt";
import { redactConnectionPasswords } from "./utils/connection-string";
import { resolveRlsSettings, type RlsSettings } from "./security/rls-settings";
import type { RequestRoleMigrationPlan } from "./security/request-role-migration";
import type { RawSqlRunner } from "./security/rls-enforcement";

/**
 * The schemas both commands provision in: the ones `db push` and `db migrate`
 * provision the request role in after a schema change.
 */
export const REQUEST_ROLE_SCHEMAS = ["public", "rebase"] as const;

/** The actions `rebase db request-role` answers. */
export const REQUEST_ROLE_ACTIONS = ["migrate"] as const;

/** The flags of `rebase db request-role migrate`. Named `…FLAGS` so the docs verifier reads them. */
export const REQUEST_ROLE_FLAGS = {
    "--to": String,
    "--dry-run": Boolean,
    "--yes": Boolean,
    "-y": "--yes"
} satisfies arg.Spec;

/** The flags of `rebase db provision`. */
export const PROVISION_FLAGS = {
    "--print": Boolean
} satisfies arg.Spec;

export interface RequestRoleLine {
    action: typeof REQUEST_ROLE_ACTIONS[number];
    /** The role(s) to move to, in the order given, without duplicates. */
    to: string[];
    dryRun: boolean;
    yes: boolean;
}

/**
 * `"app_prod_user, app_prod_anon"` → `["app_prod_user", "app_prod_anon"]`.
 * Each name is checked by the same rule the `rls.requestRole` setting uses, so
 * a name the server would refuse at boot is refused here, before anything runs.
 */
export function parseRoleList(value: string, flag: string): string[] {
    const roles = Array.from(new Set(value.split(",").map((r) => r.trim()).filter(Boolean)));
    if (roles.length === 0) throw new Error(`${flag} needs at least one role name, e.g. ${flag} app_prod_user.`);
    for (const role of roles) {
        try {
            resolveRlsSettings({ requestRole: role });
        } catch (err) {
            throw new Error(`${flag} ${role}: ${err instanceof Error ? err.message.replace(/^[^:]*:\s*/, "") : String(err)}`);
        }
    }
    return roles;
}

/**
 * Parse a `rebase db request-role <action> …` line — `["db", "request-role",
 * "migrate", …]`. Throws, with nothing run, on a missing or unknown action, an
 * undeclared flag, a stray word or a missing or unusable `--to`.
 */
export function parseRequestRoleLine(rawArgs: readonly string[]): RequestRoleLine {
    const action = rawArgs[2];
    if (action === undefined || action.startsWith("-")) {
        throw new Error(
            "`rebase db request-role` needs an action: `rebase db request-role migrate --to <role[,role]>`. Nothing was run."
        );
    }
    if (!REQUEST_ROLE_ACTIONS.some((known) => known === action)) {
        const near = closestWord(action, REQUEST_ROLE_ACTIONS);
        throw new Error(
            `\`rebase db request-role\` has no action "${redactConnectionPasswords(action)}"` +
            (near ? ` — did you mean ${near}?` : `. It takes: ${REQUEST_ROLE_ACTIONS.join(", ")}.`) +
            " Nothing was run."
        );
    }
    const args = parseCommandFlags(REQUEST_ROLE_FLAGS, [...rawArgs.slice(3)], "db request-role migrate");
    if (args._.length > 0) {
        throw new Error(
            `\`rebase db request-role migrate\` takes no argument "${redactConnectionPasswords(args._[0])}". ` +
            "Name the new role(s) with --to. Nothing was run."
        );
    }
    const to = args["--to"];
    if (to === undefined) {
        throw new Error(
            "`rebase db request-role migrate` needs --to <role[,role]>: the role(s) requests should run as from now on. Nothing was run."
        );
    }
    return {
        action: "migrate",
        to: parseRoleList(to, "--to"),
        dryRun: args["--dry-run"] === true,
        yes: args["--yes"] === true
    };
}

/**
 * Parse a `rebase db provision …` line. `--print` is required: the command
 * shows the SQL and runs none of it — a server boot, `db push` and
 * `db migrate` are what provision.
 */
export function parseProvisionLine(rawArgs: readonly string[]): { print: true } {
    const args = parseCommandFlags(PROVISION_FLAGS, [...rawArgs.slice(2)], "db provision");
    if (args._.length > 0) {
        throw new Error(
            `\`rebase db provision\` takes no argument "${redactConnectionPasswords(args._[0])}". Nothing was run.`
        );
    }
    if (args["--print"] !== true) {
        throw new Error(
            "`rebase db provision` prints the SQL and runs none of it: pass --print. A server boot, " +
            "`rebase db push` and `rebase db migrate` provision the request role themselves. Nothing was run."
        );
    }
    return { print: true };
}

/**
 * Which roles a migration moves from and to. From is what this database
 * recorded, or `rebase_user` — every database provisioned before the setting
 * existed ran as it. `null` when the two are the same set, in any order:
 * there is nothing to move.
 */
export function resolveMigrationRoles(
    recorded: readonly string[] | undefined,
    to: readonly string[]
): { from: string[]; to: string[] } | null {
    const from = recorded && recorded.length > 0 ? [...recorded] : [REBASE_USER_ROLE];
    const same = from.length === to.length && from.every((role) => to.includes(role));
    return same ? null : { from, to: [...to] };
}

const quoted = (roles: readonly string[]): string => roles.map((r) => `"${r}"`).join(", ");

/** What `db request-role migrate` says before it runs, or instead of running with `--dry-run`. */
export function renderMigrationPlan(
    plan: RequestRoleMigrationPlan,
    roles: { from: readonly string[]; to: readonly string[] },
    dryRun: boolean
): string[] {
    const lines: string[] = [];
    lines.push(`  Requests in this database run as ${quoted(roles.from)}. This moves them to ${quoted(roles.to)}.`);
    lines.push(chalk.gray("  Grants are re-issued in this database only; the old role is left as it is, because another database may use it."));
    lines.push("");
    lines.push(dryRun ? "  Would run, in one transaction:" : "  Will run, in one transaction:");
    lines.push(chalk.gray(`    -- create ${quoted(roles.to)} if missing (NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT), and let this connection switch to it`));
    if (plan.statements.length === 0) {
        lines.push(chalk.gray(`    -- ${quoted(roles.from)} holds no grants here: nothing to copy`));
    }
    for (const statement of plan.statements) lines.push(`    ${statement};`);
    lines.push(chalk.gray(`    -- record ${quoted(roles.to)} in rebase.schema_meta (request_roles)`));
    if (dryRun) {
        lines.push("");
        lines.push(...renderRevokeOld(plan, roles.from));
    }
    return lines;
}

/** The statements that take the old role's grants back here, for the operator to run once satisfied. */
export function renderRevokeOld(plan: RequestRoleMigrationPlan, from: readonly string[]): string[] {
    if (plan.revokeOld.length === 0) {
        return [chalk.gray(`  ${quoted(from)} holds no grants in this database, so there is nothing to take back.`)];
    }
    return [
        `  Run these once you no longer need ${quoted(from)} in this database:`,
        ...plan.revokeOld.map((statement) => `    ${statement};`)
    ];
}

/**
 * The prose `appRoleSetupInstructions` opens with, as SQL comments, and the SQL
 * after it as it is — so the output of `db provision --print` can be piped
 * into `psql` whole.
 */
export function asSqlScript(instructions: string): string {
    const split = instructions.indexOf("\n\n");
    if (split === -1) return instructions;
    const prose = instructions.slice(0, split).split("\n").map((line) => `-- ${line}`.trimEnd());
    return [...prose, instructions.slice(split + 2)].join("\n");
}

/**
 * The whole `db provision --print` script: for each request role, the SQL that
 * creates it and lets the connection switch to it, plus the grants the
 * `grants` mode makes schema-wide. Runs nothing.
 */
export function renderProvisionScript(
    connectionRole: string,
    settings: Pick<RlsSettings, "roles" | "grants" | "provisionRole">,
    sqlFor: (role: string) => string
): string {
    const parts: string[] = [
        "-- Request role setup for this database, as a database administrator would run it.",
        `-- Connection role: "${connectionRole}". Request role(s): ${quoted(settings.roles)}. grants: ${settings.grants}. provisionRole: ${settings.provisionRole}.`,
        "-- Printed by `rebase db provision --print`; nothing was run. Every statement is safe to re-run."
    ];
    if (settings.grants === "managed") {
        parts.push("-- grants: managed — no schema-wide grants here; once the connection can switch, a boot grants each table Rebase serves.");
    } else if (settings.grants === "none") {
        parts.push("-- grants: none — Rebase grants nothing; grant the request role the tables it should reach yourself.");
    }
    for (const role of settings.roles) {
        parts.push("", `-- ── "${role}" ──`, asSqlScript(sqlFor(role)));
    }
    return parts.join("\n");
}

function databaseUrlOrExit(): string {
    const databaseUrl = process.env.DATABASE_URL || process.env.ADMIN_CONNECTION_STRING;
    if (!databaseUrl) {
        outError(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
        process.exit(1);
    }
    return databaseUrl;
}

/** `rebase db provision --print`. */
export async function provisionCommand(rawArgs: string[]): Promise<void> {
    parseProvisionLine(rawArgs);
    const databaseUrl = databaseUrlOrExit();
    const { withAppClient } = await import("./cli-helpers");
    const { appRoleSetupInstructions, readRecordedRequestRoles } = await import("./security/rls-enforcement");
    const { cliRlsSettings } = await import("./security/rls-settings");

    const script = await withAppClient(databaseUrl, async (client) => {
        const run: RawSqlRunner = async (text) => (await client.query(text)).rows as Record<string, unknown>[];
        const [who] = await run("SELECT current_user AS role");
        const connectionRole = String(who?.role ?? "");
        const settings = cliRlsSettings(await readRecordedRequestRoles(run));
        // Only the schemas that exist: a GRANT on a missing schema fails the
        // script, and a boot grants on `rebase` itself when it creates it.
        const present = await run(
            `SELECT nspname FROM pg_namespace WHERE nspname IN (${REQUEST_ROLE_SCHEMAS.map((s) => `'${s}'`).join(", ")})`
        );
        const schemas = REQUEST_ROLE_SCHEMAS.filter((schema) => present.some((row) => row.nspname === schema));
        return renderProvisionScript(
            connectionRole,
            settings,
            (role) => appRoleSetupInstructions(connectionRole, schemas, role, settings.grants)
        );
    });
    out(script);
}

/**
 * The confirmation `db request-role migrate` asks for. `--yes` skips it; with
 * no terminal nobody can answer, so it refuses and names `--yes`.
 */
async function confirmMigration(yes: boolean): Promise<boolean> {
    if (yes) return true;
    if (!process.stdin.isTTY) {
        outError(chalk.red("  ✗ Nothing was changed: there is no terminal to confirm on."));
        outError(chalk.gray("    Re-run with --yes, or with --dry-run to see the plan."));
        return false;
    }
    const confirmed = await promptConfirm(chalk.yellow("  Type 'yes' to move this database to the new request role(s): "));
    if (!confirmed) out(chalk.gray("  Aborted. No changes were made."));
    return confirmed;
}

/** `rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]`. */
export async function requestRoleCommand(rawArgs: string[]): Promise<void> {
    const line = parseRequestRoleLine(rawArgs);
    const databaseUrl = databaseUrlOrExit();
    const { withAppClient } = await import("./cli-helpers");
    const { AppRoleSetupError, readRecordedRequestRoles } = await import("./security/rls-enforcement");
    const { migrateRequestRoles, planRequestRoleMigration } = await import("./security/request-role-migration");

    out("");
    out(chalk.bold("  rebase db request-role migrate"));
    out("");

    await withAppClient(databaseUrl, async (client) => {
        const run: RawSqlRunner = async (text) => (await client.query(text)).rows as Record<string, unknown>[];
        const roles = resolveMigrationRoles(await readRecordedRequestRoles(run), line.to);
        if (!roles) {
            out(chalk.green(`  ✓ Requests in this database already run as ${quoted(line.to)}. Nothing to do.`));
            return;
        }

        const plan = await planRequestRoleMigration(run, roles.from, roles.to);
        for (const text of renderMigrationPlan(plan, roles, line.dryRun)) out(text);
        out("");
        if (line.dryRun) {
            out(chalk.gray("  Dry run: nothing was changed."));
            return;
        }
        if (!(await confirmMigration(line.yes))) {
            process.exitCode = 1;
            return;
        }

        let applied: RequestRoleMigrationPlan;
        await client.query("BEGIN");
        try {
            applied = await migrateRequestRoles(run, { from: roles.from, to: roles.to, schemas: REQUEST_ROLE_SCHEMAS });
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK").catch(() => undefined);
            if (err instanceof AppRoleSetupError) {
                outError(chalk.red(`  ✗ Nothing was changed: ${err.message.slice(0, -err.instructions.length).trimEnd()}`));
                outError(chalk.gray(err.instructions));
                process.exitCode = 1;
                return;
            }
            throw err;
        }

        out(chalk.green(`  ✓ Requests in this database now run as ${quoted(roles.to)} (${applied.statements.length} grant(s) re-issued).`));
        out("");
        for (const text of renderRevokeOld(applied, roles.from)) out(text);
        out("");
        outWarn(chalk.yellow(`  ${requestRoleReminder(roles.to)}`));
        out("");
    });
}

/**
 * What to change on the servers once the database has moved: a boot configured
 * for other roles than the recorded ones refuses to start. One role fits the
 * environment variable; several need the setting in code.
 */
export function requestRoleReminder(to: readonly string[]): string {
    const setting = to.length === 1
        ? `REBASE_RLS_REQUEST_ROLE=${to[0]} (or rls.requestRole: "${to[0]}" in the driver config)`
        : `rls.requestRole in the driver config (a { anonymous, signedIn } map, or a function with rls.requestRoles: [${to.map((r) => `"${r}"`).join(", ")}])`;
    return `Set ${setting} on every server that uses this database: a boot configured for other roles refuses to start.`;
}
