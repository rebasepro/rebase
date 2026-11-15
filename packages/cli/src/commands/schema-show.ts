/**
 * CLI command: rebase schema show [table]
 *
 * The tables, and one table's columns, relations and row-level security —
 * from `backend/schema` as this checkout declares them, or with `--remote`
 * (or any target flag) as a running server describes them to the caller
 * (`GET /api/schema/tables`). The remote answer is what the API serves *to
 * you*: a credential without `schema:read` sees no policies, and a table you
 * cannot read is not listed.
 *
 * What an agent reads before `rebase data query`, so it uses the real column
 * names rather than guessing them.
 */
import path from "path";
import type arg from "arg";
import chalk from "chalk";

import { parseCommandArgs, UsageError } from "../utils/args";
import { PROJECT_TARGET_FLAGS } from "../utils/project-target";
import {
    emit,
    fail,
    isRecord,
    parsedLine,
    projectTarget,
    recordsOf,
    requestJson,
    startProjectCommand,
    stringOf
} from "../utils/project-command";
import { requireProjectRoot } from "../utils/project";
import { resolveSchemaDir } from "../utils/schema-dir";
import { note } from "./cloud/context";

export const SCHEMA_SHOW_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--remote": Boolean,
    "--schema-dir": String
} satisfies arg.Spec;

/** One table, as much of it as `show` prints — the same reading for a local descriptor and a served one. */
interface TableView {
    slug: string;
    name: string;
    kind: string;
    description?: string;
    primaryKey: string[];
    columns: Array<{ key: string; type: string; nullable: boolean; extra: string[] }>;
    relations: Array<{ key: string; kind: string; target: string }>;
    rls: string;
}

/** Read a descriptor (`TableDescriptor`, local or served) into what `show` prints. */
export function tableView(raw: Record<string, unknown>): TableView {
    const columns = recordsOf(raw.columns).map(column => {
        const extra: string[] = [];
        if (column.primaryKey === true) extra.push("pk");
        if (column.unique === true) extra.push("unique");
        if (column.readOnly === true) extra.push("read-only");
        if (column.generated) extra.push("generated");
        if (column.default !== undefined) extra.push("default");
        if (isRecord(column.stamp)) extra.push(`stamp:${stringOf(column.stamp.kind) ?? "?"}`);
        const type = typeof column.type === "string" ? column.type : isRecord(column.type) ? stringOf(column.type.kind) ?? JSON.stringify(column.type) : "?";
        return { key: stringOf(column.key) ?? "?", type, nullable: column.nullable !== false, extra };
    });
    const relations = recordsOf(raw.relations).map(relation => ({
        key: stringOf(relation.key ?? relation.name) ?? "?",
        kind: stringOf(relation.kind) ?? "?",
        target: stringOf(relation.target ?? relation.table) ?? "?"
    }));
    const rls = isRecord(raw.rls)
        ? [stringOf(raw.rls.posture), Array.isArray(raw.rls.rules) ? `${raw.rls.rules.length} rule(s)` : undefined].filter(Boolean).join(", ")
        : "";
    return {
        slug: stringOf(raw.slug) ?? stringOf(raw.name) ?? "?",
        name: stringOf(raw.name) ?? "?",
        kind: stringOf(raw.kind) ?? "table",
        ...(stringOf(raw.description) ? { description: stringOf(raw.description) } : {}),
        primaryKey: Array.isArray(raw.primaryKey) ? raw.primaryKey.map(String) : [],
        columns,
        relations,
        rls
    };
}

function printTableList(tables: TableView[], from: string): void {
    if (tables.length === 0) return note(`No tables (${from}).`);
    note(chalk.gray(from));
    const width = Math.max(5, ...tables.map(table => table.slug.length));
    for (const table of tables) {
        console.log(`  ${chalk.bold(table.slug.padEnd(width))}  ${chalk.gray(`${table.columns.length} columns${table.kind === "view" ? ", view" : ""}`)}${table.description ? `  ${table.description}` : ""}`);
    }
}

function printTable(table: TableView): void {
    console.log(`  ${chalk.bold(table.slug)}${table.kind === "view" ? chalk.gray(" (view)") : ""}${table.description ? `  ${chalk.gray(table.description)}` : ""}`);
    console.log("");
    const width = Math.max(6, ...table.columns.map(column => column.key.length));
    for (const column of table.columns) {
        console.log(`    ${column.key.padEnd(width)}  ${column.type}${column.nullable ? "" : chalk.yellow(" not null")}${column.extra.length ? chalk.gray(`  ${column.extra.join(", ")}`) : ""}`);
    }
    if (table.relations.length > 0) {
        console.log("");
        for (const relation of table.relations) console.log(`    ${chalk.cyan(relation.key)}  ${relation.kind} → ${relation.target}`);
    }
    if (table.rls) {
        console.log("");
        console.log(chalk.gray(`    row-level security: ${table.rls}`));
    }
}

export async function schemaShowCommand(rawArgs: string[]): Promise<void> {
    startProjectCommand(rawArgs);
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: SCHEMA_SHOW_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "schema show",
        maxPositionals: 1
    }));
    const wanted = positionals[0];
    const remote = flags["--remote"] === true
        || flags["--project"] !== undefined || flags["--cloud"] === true || flags["--url"] !== undefined
        || flags["--token"] !== undefined || flags["--session"] === true || flags["--anon"] === true;

    let raws: Record<string, unknown>[];
    let from: string;
    if (remote) {
        if (flags["--schema-dir"]) fail("--schema-dir reads local files; it does not go with --remote or a target flag.", undefined, "usage");
        const target = await projectTarget(flags, { command: "schema show" });
        const body = await requestJson(target, "/api/schema/tables", "Failed to read the tables");
        raws = recordsOf(Array.isArray(body) ? body : isRecord(body) ? body.tables ?? body.data : undefined);
        from = `as ${target.label} describes them to this credential`;
    } else {
        const projectRoot = requireProjectRoot();
        const schemaDir = flags["--schema-dir"] ? path.resolve(flags["--schema-dir"]) : resolveSchemaDir(projectRoot);
        const { loadProjectSchema } = await import("../utils/project-schema");
        try {
            const { compiled } = await loadProjectSchema(projectRoot, schemaDir);
            raws = compiled.descriptors.map(descriptor => JSON.parse(JSON.stringify(descriptor)) as unknown).filter(isRecord);
        } catch (e) {
            fail(`Could not load ${path.relative(process.cwd(), schemaDir) || schemaDir}: ${e instanceof Error ? e.message : String(e)}`, undefined, "schema_load_failed");
        }
        from = `from ${path.relative(process.cwd(), schemaDir) || schemaDir}`;
    }

    const tables = raws.map(tableView);
    if (wanted) {
        const index = tables.findIndex(table => table.slug === wanted || table.name === wanted);
        if (index === -1) {
            parsedLine(() => {
                throw new UsageError(`No table named ${wanted} (${from}). Known: ${tables.map(table => table.slug).join(", ") || "none"}.`);
            });
        }
        emit(() => printTable(tables[index]), raws[index]);
        return;
    }
    emit(() => printTableList(tables, from), raws);
}
