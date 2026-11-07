/**
 * CLI command: rebase schema reconcile
 *
 * The reviewed step for what boot will not do. Boot only ever adds, so a
 * property made optional leaves its column NOT NULL, and a property removed
 * leaves its column behind, with its data, and blocking inserts if it was
 * required. This asks the running backend for the plan that fixes both, prints
 * it, and applies it only once confirmed.
 *
 * Through the backend rather than a database URL, because on Rebase Cloud the
 * backend is the one thing that can reach the database — and because it plans
 * against the collections it actually runs, not the ones in this checkout.
 * Columns are dropped only when named with `--drop`; the confirmation sends
 * the plan's digest, so the server runs exactly the statements printed here.
 */
import arg from "arg";
import chalk from "chalk";
import readline from "node:readline/promises";
import { RebaseApiError } from "@rebasepro/client";
import type { SchemaReconcilePlan } from "@rebasepro/types";
import { requireProjectRoot, readEnvFile } from "../utils/project";
import { UsageError } from "../utils/args";
import { cliUserAgent } from "../utils/version";
import { describeFailure, requireBackendUrl } from "./api-keys";

export const RECONCILE_USAGE = "rebase schema reconcile [--drop <collection>.<column>]... [--yes]";

export function parseReconcileArgs(rawArgs: string[]): { drop: string[]; yes: boolean } {
    const flags = arg({ "--drop": [String], "--yes": Boolean, "-y": "--yes" }, { argv: rawArgs.slice(2) });
    if (flags._.length > 0) throw new UsageError(`Unexpected argument "${flags._[0]}". Usage: ${RECONCILE_USAGE}`);
    return { drop: flags["--drop"] ?? [], yes: flags["--yes"] === true };
}

/** The plan, as a person reviews it. Returned as lines so it can be tested. */
export function describeReconcilePlan(plan: SchemaReconcilePlan): string[] {
    const lines: string[] = [];
    for (const r of plan.relaxed) {
        const why = r.undeclared
            ? `no property in "${r.collection}" declares it, and every insert fails on it; its data stays`
            : `optional in "${r.collection}", NOT NULL in the database`;
        lines.push(`  ${chalk.cyan("relax")}  ${r.table}.${r.column}  ${chalk.gray(why)}`);
    }
    for (const d of plan.dropped) {
        const rows = d.rowsWithValue === undefined ? "" : `${d.rowsWithValue.toLocaleString("en-US")} row(s) hold a value`;
        lines.push(`  ${chalk.red("drop")}   ${d.table}.${d.column}  ${chalk.red(rows)}`);
    }
    const kept = plan.undeclared.filter(u =>
        !plan.dropped.some(d => d.table === u.table && d.column === u.column)
        && !plan.relaxed.some(r => r.undeclared && r.table === u.table && r.column === u.column));
    for (const u of kept) {
        const note = u.blocksInserts
            ? chalk.yellow("NOT NULL with no default: every insert fails until it is dropped or relaxed")
            : chalk.gray("no property declares it; kept");
        lines.push(`  ${chalk.gray("keep")}   ${u.table}.${u.column}  ${note}`);
    }
    return lines;
}

interface Backend {
    baseUrl: string;
    post<T>(path: string, body: unknown): Promise<T>;
}

/** The project's backend, holding the service key. */
function connect(): Backend {
    const projectRoot = requireProjectRoot();
    const env = readEnvFile(projectRoot);
    const serviceKey = env.SERVICE_KEY || env.REBASE_SERVICE_KEY;
    if (!serviceKey) {
        console.error(chalk.red("✗ REBASE_SERVICE_KEY not found in .env — required to change the database's schema."));
        process.exit(1);
    }
    const baseUrl = requireBackendUrl(env, projectRoot).replace(/\/+$/, "");
    return {
        baseUrl,
        async post<T>(path: string, body: unknown): Promise<T> {
            let response: Response;
            try {
                response = await fetch(`${baseUrl}/api/admin/schema/reconcile${path}`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${serviceKey}`,
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "User-Agent": cliUserAgent()
                    },
                    body: JSON.stringify(body)
                });
            } catch (error: unknown) {
                throw new RebaseApiError(error instanceof Error ? error.message : String(error), { status: 0, code: "NETWORK_ERROR" });
            }
            const answer: unknown = await response.json().catch(() => undefined);
            if (!response.ok) {
                const error = answer && typeof answer === "object" && "error" in answer && answer.error && typeof answer.error === "object"
                    ? answer.error as { message?: unknown; code?: unknown; details?: unknown }
                    : undefined;
                throw new RebaseApiError(
                    typeof error?.message === "string" ? error.message : `The server answered ${response.status}.`,
                    { status: response.status, code: typeof error?.code === "string" ? error.code : undefined, details: error?.details }
                );
            }
            return answer as T;
        }
    };
}

function fail(action: string, error: unknown, baseUrl: string): never {
    for (const line of describeFailure(action, error, baseUrl)) {
        console.error(line.startsWith("✗") ? chalk.red(line) : chalk.gray(line));
    }
    if (error instanceof RebaseApiError && error.status === 404) {
        console.error(chalk.gray("  This backend has no reconcile route: it needs a runtime that has `rebase schema reconcile`."));
    }
    process.exit(1);
}

export async function schemaReconcileCommand(rawArgs: string[]): Promise<void> {
    const { drop, yes } = parseReconcileArgs(rawArgs);
    const backend = connect();

    let plan: SchemaReconcilePlan;
    try {
        plan = await backend.post<SchemaReconcilePlan>("/plan", { drop });
    } catch (error) {
        fail("Failed to plan the reconcile", error, backend.baseUrl);
    }

    console.log(chalk.bold(`\nSchema reconcile for ${backend.baseUrl}\n`));
    const described = describeReconcilePlan(plan);
    if (described.length > 0) console.log(described.join("\n"));

    if (plan.problems.length > 0) {
        console.error(chalk.red("\n✗ This plan cannot be applied:"));
        for (const problem of plan.problems) console.error(chalk.red(`  • ${problem}`));
        process.exit(1);
    }
    if (plan.statements.length === 0) {
        console.log(chalk.green("✓ Nothing to do: the database already matches what the collections declare."));
    }
    if (plan.undeclared.length > plan.dropped.length) {
        console.log(chalk.gray("  To drop a column no property declares, name it: --drop <collection>.<column>"));
    }
    if (plan.statements.length === 0) return;

    console.log(chalk.bold("\nStatements"));
    for (const statement of plan.statements) console.log(`  ${statement}`);
    if (plan.dropped.length > 0) {
        console.log(chalk.red("\n  Dropping a column destroys its data. Back the database up first if you may want it back."));
    }

    if (!yes) {
        if (!process.stdin.isTTY) {
            console.error(chalk.red("\n✗ Not applied: confirming needs a terminal. Re-run with --yes once you have read the plan."));
            process.exit(1);
        }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question(`\nApply ${plan.statements.length} statement(s)? Type "yes" to continue: `)).trim();
        rl.close();
        if (answer !== "yes") {
            console.log(chalk.gray("Aborted. Nothing was changed."));
            return;
        }
    }

    try {
        const result = await backend.post<{ applied: string[] }>("/apply", { drop, confirm: plan.digest });
        console.log(chalk.green(`✓ Applied ${result.applied.length} statement(s).`));
    } catch (error) {
        if (error instanceof RebaseApiError && error.code === "SCHEMA_RECONCILE_STALE") {
            console.error(chalk.red("✗ Not applied: the database or the collections changed since this plan was made. Run it again to review the new plan."));
            process.exit(1);
        }
        fail("Failed to apply the reconcile", error, backend.baseUrl);
    }
}
