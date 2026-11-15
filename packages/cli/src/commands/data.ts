/**
 * CLI command: rebase data <action>
 *
 * The rows of a running app's tables, through its REST API — so row-level
 * security, field access, hooks and validation all apply, exactly as they do
 * for the SDK. The same target and credential every project command resolves:
 * the local `rebase dev`, `--url`, `REBASE_BASE_URL`, or `--project <slug>` for
 * a Rebase Cloud project.
 *
 * Filters are the API's own (`?status=eq.published`), passed through
 * unchanged: `--where status=eq.published`, `--where price=gte.10`, and a bare
 * `--where status=draft` for equality. Whatever the API documents, `--where`
 * takes — there is no second dialect to learn or to drift.
 *
 * `rebase console` is the other way into the rows: a local REPL on the
 * database itself. This one goes through the server, and so reaches a deployed
 * project as well.
 */
import fs from "fs";
import type arg from "arg";
import chalk from "chalk";

import { parseCommandArgs, UsageError, wantsHelp } from "../utils/args";
import { unknownCommand } from "../utils/unknown-command";
import { PROJECT_TARGET_FLAGS, readJson, type ProjectTarget } from "../utils/project-target";
import {
    cellText,
    emit,
    fail,
    isRecord,
    parsedLine,
    printProjectHelp,
    projectTarget,
    recordsOf,
    reportTargetError,
    requestJson,
    startProjectCommand,
    stringOf,
    type HelpAction
} from "../utils/project-command";
import { confirmDestructive, isJsonMode, keyValues, note, success } from "./cloud/context";

/** Everything the switch below dispatches, for the did-you-mean. */
export const DATA_SUBCOMMANDS = [
    "query", "get", "count", "aggregate", "insert", "update", "delete", "import", "history", "revert", "watch"
] as const;

/** One page of rows per request when `--all` walks a table. */
const PAGE_SIZE = 200;

/** Rows per `POST /bulk` request on an import — the server's own cap is higher; this keeps a failure cheap. */
const IMPORT_BATCH = 500;

/* ═══════════════════════════════════════════════════════════════
   Entry
   ═══════════════════════════════════════════════════════════════ */

export async function dataCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    startProjectCommand(rawArgs);
    if (!subcommand || subcommand === "--help" || wantsHelp(rawArgs)) {
        printDataHelp();
        return;
    }
    switch (subcommand) {
        case "query":
            await queryRows(rawArgs);
            break;
        case "get":
            await getRow(rawArgs);
            break;
        case "count":
            await countRows(rawArgs);
            break;
        case "aggregate":
            await aggregateRows(rawArgs);
            break;
        case "insert":
            await insertRows(rawArgs);
            break;
        case "update":
            await updateRows(rawArgs);
            break;
        case "delete":
            await deleteRows(rawArgs);
            break;
        case "import":
            await importRows(rawArgs);
            break;
        case "history":
            await rowHistory(rawArgs);
            break;
        case "revert":
            await revertRow(rawArgs);
            break;
        case "watch":
            await watchRows(rawArgs);
            break;
        default:
            unknownCommand(subcommand, DATA_SUBCOMMANDS, "data");
    }
}

/* ═══════════════════════════════════════════════════════════════
   Shared pieces
   ═══════════════════════════════════════════════════════════════ */

/** `/api/data/<table>`, the table as one encoded path segment. */
function tablePath(table: string, ...rest: string[]): string {
    return ["/api/data", encodeURIComponent(table), ...rest.map(encodeURIComponent)].join("/");
}

/** A table name, refused when it is missing or is not one path segment. */
function requireTable(positionals: string[], command: string): string {
    const table = positionals[0];
    if (!table) throw new UsageError(`rebase ${command} needs a table: rebase ${command} <table>. ` + "`rebase schema show --remote` lists them.");
    if (table.includes("/")) throw new UsageError(`"${table}" is not a table name; nested paths go through \`rebase api\`.`);
    return table;
}

/**
 * `--where` conditions as the API's query parameters. `col=op.value` is sent
 * as written; `col=value` is equality, which the API reads the same way.
 * Exported for its tests.
 */
export function whereParams(conditions: readonly string[] | undefined): Record<string, string[]> {
    const query: Record<string, string[]> = {};
    for (const raw of conditions ?? []) {
        const at = raw.indexOf("=");
        if (at <= 0) {
            throw new UsageError(`--where takes column=op.value, e.g. status=eq.published or price=gte.10 (got "${raw}").`);
        }
        const column = raw.slice(0, at).trim();
        if (RESERVED_PARAMS.has(column)) {
            throw new UsageError(`--where ${column}=… names a query option, not a column; use its own flag (see \`rebase data --help\`).`);
        }
        (query[column] ??= []).push(raw.slice(at + 1));
    }
    return query;
}

/** Query keys the API reads as options rather than columns. */
const RESERVED_PARAMS = new Set([
    "limit", "offset", "page", "after", "orderBy", "include", "fields", "distinct", "count", "searchString",
    "or", "and", "not", "where", "select", "groupBy", "deleted", "hard"
]);

/** `--order-by name` / `--order-by name:desc`, one or several, as the API's `orderBy`. Exported for tests. */
export function orderByParam(values: readonly string[] | undefined): string | undefined {
    if (!values || values.length === 0) return undefined;
    if (values.length === 1) return values[0];
    return JSON.stringify(values.map(value => {
        const [field, direction] = value.split(":");
        return direction ? { field, direction: direction.toLowerCase() } : { field };
    }));
}

/** A JSON object from `--json-data`, `--file` or stdin (`--file -`). */
function readJsonInput(inline: string | undefined, file: string | undefined, what: string): unknown {
    if (inline !== undefined && file !== undefined) throw new UsageError(`Give the ${what} once: --data or --file, not both.`);
    let text: string | undefined = inline;
    if (file !== undefined) {
        try {
            text = fs.readFileSync(file === "-" ? 0 : file, "utf8");
        } catch (e) {
            throw new UsageError(`Cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    if (text === undefined) throw new UsageError(`The ${what} is missing: pass --data '{…}' or --file <path> (- for stdin).`);
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new UsageError(`The ${what} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/** The formats rows can be printed in. */
type RowFormat = "table" | "json" | "ndjson" | "csv";

function resolveFormat(raw: string | undefined): RowFormat {
    if (raw === undefined) return isJsonMode() ? "json" : "table";
    if (raw === "table" || raw === "json" || raw === "ndjson" || raw === "csv") return raw;
    throw new UsageError(`--format takes table, json, ndjson or csv (got "${raw}").`);
}

/** One CSV field, quoted when it must be. */
function csvField(value: unknown): string {
    const text = cellText(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

/** The columns of a set of rows, in first-seen order. */
function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
    const seen = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
    return [...seen];
}

/** Rows as a terminal table, cells cut at a readable width. */
function printTable(rows: readonly Record<string, unknown>[]): void {
    if (rows.length === 0) {
        console.log(chalk.gray("  No rows."));
        return;
    }
    const columns = columnsOf(rows);
    const MAX = 40;
    const cut = (text: string) => (text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text);
    const widths = columns.map(column => Math.max(column.length, ...rows.map(row => cut(cellText(row[column])).length)));
    console.log(columns.map((column, i) => chalk.bold(column.padEnd(widths[i]))).join("  "));
    console.log(chalk.gray(widths.map(width => "─".repeat(width)).join("  ")));
    for (const row of rows) console.log(columns.map((column, i) => cut(cellText(row[column])).padEnd(widths[i])).join("  "));
}

/** Print rows in a format; `header` says whether CSV starts with a header line. */
function printRows(rows: readonly Record<string, unknown>[], format: RowFormat, meta?: unknown): void {
    switch (format) {
        case "json":
            process.stdout.write(`${JSON.stringify(meta === undefined ? { data: rows } : { data: rows, meta }, null, 2)}\n`);
            break;
        case "ndjson":
            for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
            break;
        case "csv": {
            const columns = columnsOf(rows);
            process.stdout.write(`${columns.map(csvField).join(",")}\n`);
            for (const row of rows) process.stdout.write(`${columns.map(column => csvField(row[column])).join(",")}\n`);
            break;
        }
        default:
            printTable(rows);
    }
}

/* ═══════════════════════════════════════════════════════════════
   query
   ═══════════════════════════════════════════════════════════════ */

export const QUERY_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--where": [String],
    "-w": "--where",
    "--or": String,
    "--order-by": [String],
    "--limit": Number,
    "-n": "--limit",
    "--offset": Number,
    "--fields": String,
    "--include": String,
    "--search": String,
    "--deleted": String,
    "--all": Boolean,
    "--format": String
} satisfies arg.Spec;

async function queryRows(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: QUERY_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data query",
        maxPositionals: 1
    }));
    const { table, query, format } = parsedLine(() => {
        const t = requireTable(positionals, "data query");
        const q: Record<string, string | string[] | undefined> = {
            ...whereParams(flags["--where"]),
            or: flags["--or"],
            orderBy: orderByParam(flags["--order-by"]),
            limit: flags["--limit"] !== undefined ? String(flags["--limit"]) : undefined,
            offset: flags["--offset"] !== undefined ? String(flags["--offset"]) : undefined,
            fields: flags["--fields"],
            include: flags["--include"],
            searchString: flags["--search"],
            deleted: flags["--deleted"]
        };
        if (flags["--all"] && flags["--offset"] !== undefined) throw new UsageError("--all walks every page from the start; drop --offset.");
        return { table: t, query: q, format: resolveFormat(flags["--format"]) };
    });

    const target = await projectTarget(flags, { command: "data query" });

    if (!flags["--all"]) {
        const body = await requestJson(target, tablePath(table), `Failed to query ${table}`, { query });
        const rows = recordsOf(isRecord(body) ? body.data : undefined);
        const meta = isRecord(body) ? body.meta : undefined;
        printRows(rows, format, meta);
        if (format === "table" && isRecord(meta) && meta.hasMore === true) {
            note(chalk.gray(`More rows match; pass --all, or --offset ${(flags["--offset"] ?? 0) + rows.length}.`));
        }
        return;
    }

    // Every page, offset by offset. A table changing underneath can repeat or
    // skip a row at a page edge; an export that must be exact belongs in `db pull`.
    const pageSize = flags["--limit"] ?? PAGE_SIZE;
    const all: Record<string, unknown>[] = [];
    let offset = 0;
    let csvHeader: string[] | undefined;
    for (;;) {
        const body = await requestJson(target, tablePath(table), `Failed to query ${table}`, {
            query: { ...query, limit: String(pageSize), offset: String(offset) }
        });
        const rows = recordsOf(isRecord(body) ? body.data : undefined);
        if (format === "ndjson") {
            for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
        } else if (format === "csv") {
            // Streamed too: the header is the first page's columns, so a later
            // page with a column no earlier row had is written under that header.
            csvHeader ??= columnsOf(rows);
            if (offset === 0) process.stdout.write(`${csvHeader.map(csvField).join(",")}\n`);
            const header = csvHeader;
            for (const row of rows) process.stdout.write(`${header.map(column => csvField(row[column])).join(",")}\n`);
        } else {
            all.push(...rows);
        }
        const meta = isRecord(body) ? body.meta : undefined;
        const more = isRecord(meta) && typeof meta.hasMore === "boolean" ? meta.hasMore : rows.length === pageSize;
        if (!more || rows.length === 0) break;
        offset += rows.length;
    }
    if (format === "json" || format === "table") printRows(all, format);
}

/* ═══════════════════════════════════════════════════════════════
   get / count / aggregate
   ═══════════════════════════════════════════════════════════════ */

export const GET_ROW_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--fields": String,
    "--include": String
} satisfies arg.Spec;

async function getRow(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: GET_ROW_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data get",
        maxPositionals: 2
    }));
    const { table, id } = parsedLine(() => {
        const t = requireTable(positionals, "data get");
        if (!positionals[1]) throw new UsageError("rebase data get needs a row id: rebase data get <table> <id>.");
        return { table: t, id: positionals[1] };
    });
    const target = await projectTarget(flags, { command: "data get" });
    const row = await requestJson(target, tablePath(table, id), `Failed to read ${table}/${id}`, {
        query: { fields: flags["--fields"], include: flags["--include"] }
    });
    emit(() => {
        if (!isRecord(row)) return console.log(cellText(row));
        keyValues(Object.entries(row).map(([key, value]): [string, string] => [key, cellText(value)]));
    }, row);
}

export const COUNT_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--where": [String],
    "-w": "--where",
    "--or": String,
    "--search": String
} satisfies arg.Spec;

async function countRows(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: COUNT_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data count",
        maxPositionals: 1
    }));
    const { table, query } = parsedLine(() => ({
        table: requireTable(positionals, "data count"),
        query: { ...whereParams(flags["--where"]), or: flags["--or"], searchString: flags["--search"] }
    }));
    const target = await projectTarget(flags, { command: "data count" });
    const body = await requestJson(target, tablePath(table, "count"), `Failed to count ${table}`, { query });
    const count = isRecord(body) && typeof body.count === "number" ? body.count : undefined;
    emit(() => console.log(count === undefined ? cellText(body) : String(count)), { table, count });
}

export const AGGREGATE_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--select": String,
    "--group-by": String,
    "--where": [String],
    "-w": "--where",
    "--or": String,
    "--format": String
} satisfies arg.Spec;

async function aggregateRows(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: AGGREGATE_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data aggregate",
        maxPositionals: 1
    }));
    const { table, query, format } = parsedLine(() => {
        const t = requireTable(positionals, "data aggregate");
        if (!flags["--select"]) {
            throw new UsageError("rebase data aggregate needs --select, e.g. --select \"count(),sum(total)\" (the API's `select`).");
        }
        return {
            table: t,
            query: { ...whereParams(flags["--where"]), or: flags["--or"], select: flags["--select"], groupBy: flags["--group-by"] },
            format: resolveFormat(flags["--format"])
        };
    });
    const target = await projectTarget(flags, { command: "data aggregate" });
    const body = await requestJson(target, tablePath(table, "aggregate"), `Failed to aggregate ${table}`, { query });
    const rows = recordsOf(isRecord(body) ? body.data : body);
    if (rows.length > 0) printRows(rows, format);
    else emit(() => console.log(cellText(body)), body);
}

/* ═══════════════════════════════════════════════════════════════
   insert / update / delete
   ═══════════════════════════════════════════════════════════════ */

export const INSERT_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--data": String,
    "-d": "--data",
    "--file": String,
    "--upsert": String
} satisfies arg.Spec;

async function insertRows(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: INSERT_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data insert",
        maxPositionals: 1
    }));
    const { table, value } = parsedLine(() => ({
        table: requireTable(positionals, "data insert"),
        value: readJsonInput(flags["--data"], flags["--file"], "row")
    }));
    const target = await projectTarget(flags, { command: "data insert" });
    const action = `Failed to insert into ${table}`;
    if (Array.isArray(value)) {
        // An array is several rows: one bulk request, which is one transaction.
        const body = await requestJson(target, tablePath(table, "bulk"), action, {
            method: "POST",
            json: flags["--upsert"] ? { rows: value, upsert: true, onConflict: flags["--upsert"] } : { rows: value }
        });
        emit(() => success(`Wrote ${recordsOf(isRecord(body) ? body.data : undefined).length || value.length} row(s) to ${table}.`), body);
        return;
    }
    if (!isRecord(value)) fail("A row is a JSON object (or an array of them, for several).", undefined, "usage");
    const row = await requestJson(target, tablePath(table), action, {
        method: "POST",
        json: value,
        query: flags["--upsert"] ? { on_conflict: flags["--upsert"] } : undefined
    });
    emit(() => {
        success(`Inserted into ${table}${isRecord(row) && stringOf(row.id) ? ` (id ${stringOf(row.id)})` : ""}.`);
        if (isRecord(row)) keyValues(Object.entries(row).map(([key, v]): [string, string] => [key, cellText(v)]));
    }, row);
}

export const UPDATE_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--data": String,
    "-d": "--data",
    "--file": String,
    "--where": [String],
    "-w": "--where",
    "--if-match": String
} satisfies arg.Spec;

async function updateRows(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: UPDATE_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data update",
        maxPositionals: 2
    }));
    const { table, id, value, where } = parsedLine(() => {
        const t = requireTable(positionals, "data update");
        const id = positionals[1];
        const w = flags["--where"];
        if (id && w) throw new UsageError("Name one row by its id, or several with --where; not both.");
        if (!id && !w) throw new UsageError("rebase data update needs a row id, or --where for several: rebase data update <table> <id> --data '{…}'.");
        const v = readJsonInput(flags["--data"], flags["--file"], "change");
        if (!isRecord(v)) throw new UsageError("The change is a JSON object of the columns to set.");
        return { table: t, id, value: v, where: w };
    });
    const target = await projectTarget(flags, { command: "data update" });
    const action = `Failed to update ${table}`;
    if (id) {
        const row = await requestJson(target, tablePath(table, id), action, {
            method: "PATCH",
            json: value,
            headers: flags["--if-match"] ? { "If-Match": flags["--if-match"] } : undefined
        });
        emit(() => {
            success(`Updated ${table}/${id}.`);
            if (isRecord(row)) keyValues(Object.entries(row).map(([key, v]): [string, string] => [key, cellText(v)]));
        }, row);
        return;
    }
    // Several rows by filter: count first, so the confirmation says how many.
    const filter = parsedLine(() => whereParams(where));
    const counted = await requestJson(target, tablePath(table, "count"), action, { query: filter });
    const count = isRecord(counted) && typeof counted.count === "number" ? counted.count : undefined;
    await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Update ${count ?? "the matching"} row(s) of ${table} on ${target.label}?` });
    const body = await requestJson(target, tablePath(table, "bulk"), action, {
        method: "PATCH",
        json: { where: whereObject(filter), data: value }
    });
    emit(() => success(`Updated ${count ?? "the matching"} row(s) of ${table}.`), body);
}

/**
 * The API's JSON `where` from `--where` conditions — the bulk routes take a
 * body, not a query string: `{ "status": ["==", "draft"] }` style tuples, which
 * the shared filter codec decodes from the same `op.value` spelling.
 */
function whereObject(query: Record<string, string[]>): Record<string, string | string[]> {
    const where: Record<string, string | string[]> = {};
    for (const [column, values] of Object.entries(query)) where[column] = values.length === 1 ? values[0] : values;
    return where;
}

export const DELETE_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--where": [String],
    "-w": "--where",
    "--hard": Boolean
} satisfies arg.Spec;

async function deleteRows(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: DELETE_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data delete",
        maxPositionals: 2
    }));
    const { table, id, where } = parsedLine(() => {
        const t = requireTable(positionals, "data delete");
        const i = positionals[1];
        const w = flags["--where"];
        if (i && w) throw new UsageError("Name one row by its id, or several with --where; not both.");
        if (!i && !w) throw new UsageError("rebase data delete needs a row id, or --where for several: rebase data delete <table> <id>.");
        return { table: t, id: i, where: w };
    });
    const target = await projectTarget(flags, { command: "data delete" });
    const action = `Failed to delete from ${table}`;
    const hard = flags["--hard"] === true;
    if (id) {
        await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Delete ${table}/${id}${hard ? " for good" : ""} on ${target.label}?` });
        await requestJson(target, tablePath(table, id), action, { method: "DELETE", query: hard ? { hard: "true" } : undefined });
        emit(() => success(`Deleted ${table}/${id}.`), { table, id, deleted: true });
        return;
    }
    const filter = parsedLine(() => whereParams(where));
    const counted = await requestJson(target, tablePath(table, "count"), action, { query: filter });
    const count = isRecord(counted) && typeof counted.count === "number" ? counted.count : undefined;
    if (count === 0) {
        emit(() => note("No rows match; nothing was deleted."), { table, deleted: 0 });
        return;
    }
    await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Delete ${count ?? "the matching"} row(s) of ${table}${hard ? " for good" : ""} on ${target.label}?` });
    const body = await requestJson(target, tablePath(table, "bulk", "delete"), action, {
        method: "POST",
        json: { where: whereObject(filter) },
        query: hard ? { hard: "true" } : undefined
    });
    emit(() => success(`Deleted ${count ?? "the matching"} row(s) of ${table}.`), body);
}

/* ═══════════════════════════════════════════════════════════════
   import
   ═══════════════════════════════════════════════════════════════ */

export const IMPORT_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--file": String,
    "--format": String,
    "--upsert": String,
    "--ignore-duplicates": Boolean,
    "--batch": Number
} satisfies arg.Spec;

/** Parse one CSV document into rows of strings. Quotes, doubled quotes and newlines in quotes. Exported for tests. */
export function parseCsv(text: string): Record<string, string>[] {
    const records: string[][] = [];
    let field = "";
    let record: string[] = [];
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === "\"" && text[i + 1] === "\"") {
                field += "\"";
                i++;
            } else if (ch === "\"") {
                quoted = false;
            } else {
                field += ch;
            }
            continue;
        }
        if (ch === "\"") quoted = true;
        else if (ch === ",") {
            record.push(field);
            field = "";
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            record.push(field);
            records.push(record);
            record = [];
            field = "";
        } else field += ch;
    }
    if (field !== "" || record.length > 0) {
        record.push(field);
        records.push(record);
    }
    const nonEmpty = records.filter(r => !(r.length === 1 && r[0] === ""));
    const [header, ...rows] = nonEmpty;
    if (!header) return [];
    return rows.map(r => Object.fromEntries(header.map((column, i) => [column, r[i] ?? ""])));
}

/** Rows out of a file, by its `--format` or its extension. Exported for tests. */
export function readImportRows(text: string, format: string): Record<string, unknown>[] {
    if (format === "csv") return parseCsv(text);
    if (format === "ndjson") {
        return text.split(/\r?\n/).filter(line => line.trim()).map((line, i) => {
            try {
                const row: unknown = JSON.parse(line);
                if (!isRecord(row)) throw new Error("not an object");
                return row;
            } catch (e) {
                throw new UsageError(`Line ${i + 1} is not a JSON object: ${e instanceof Error ? e.message : String(e)}`);
            }
        });
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new UsageError(`The file is not JSON: ${e instanceof Error ? e.message : String(e)} (CSV and NDJSON take --format).`);
    }
    const rows = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : undefined;
    if (!rows || !rows.every(isRecord)) throw new UsageError("A JSON import is an array of row objects (or `{ \"data\": [...] }`, what `data query --format json` writes).");
    return rows;
}

async function importRows(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: IMPORT_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data import",
        maxPositionals: 1
    }));
    const { table, rows, batch } = parsedLine(() => {
        const t = requireTable(positionals, "data import");
        const file = flags["--file"];
        if (!file) throw new UsageError("rebase data import needs --file <path> (- for stdin): JSON, NDJSON or CSV.");
        let text: string;
        try {
            text = fs.readFileSync(file === "-" ? 0 : file, "utf8");
        } catch (e) {
            throw new UsageError(`Cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
        const format = flags["--format"] ?? (file.endsWith(".csv") ? "csv" : file.endsWith(".ndjson") || file.endsWith(".jsonl") ? "ndjson" : "json");
        if (!["json", "ndjson", "csv"].includes(format)) throw new UsageError(`--format takes json, ndjson or csv (got "${format}").`);
        const size = flags["--batch"] ?? IMPORT_BATCH;
        if (!Number.isInteger(size) || size <= 0) throw new UsageError("--batch takes a positive number of rows.");
        if (flags["--ignore-duplicates"] && !flags["--upsert"]) throw new UsageError("--ignore-duplicates goes with --upsert <column>, the conflict to ignore.");
        return { table: t, rows: readImportRows(text, format), batch: size };
    });
    if (rows.length === 0) {
        emit(() => note("The file holds no rows; nothing was written."), { table, written: 0 });
        return;
    }
    const target = await projectTarget(flags, { command: "data import" });
    let written = 0;
    for (let start = 0; start < rows.length; start += batch) {
        const slice = rows.slice(start, start + batch);
        try {
            const res = await target.request(tablePath(table, "bulk"), {
                method: "POST",
                timeoutMs: 120_000,
                json: {
                    rows: slice,
                    ...(flags["--upsert"] ? { upsert: true, onConflict: flags["--upsert"] } : {}),
                    ...(flags["--ignore-duplicates"] ? { ignoreDuplicates: true } : {})
                }
            });
            await readJson(res, target, `Rows ${start + 1}–${start + slice.length} of ${table} were refused (${written} written before them)`);
        } catch (e) {
            reportTargetError(e, target);
        }
        written += slice.length;
        if (!isJsonMode() && rows.length > batch) note(chalk.gray(`${written}/${rows.length}`));
    }
    emit(() => success(`Imported ${written} row(s) into ${table} on ${target.label}.`), { table, written });
}

/* ═══════════════════════════════════════════════════════════════
   history / revert
   ═══════════════════════════════════════════════════════════════ */

export const HISTORY_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--limit": Number,
    "-n": "--limit",
    "--offset": Number
} satisfies arg.Spec;

async function rowHistory(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: HISTORY_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data history",
        maxPositionals: 2
    }));
    const { table, id } = parsedLine(() => {
        const t = requireTable(positionals, "data history");
        if (!positionals[1]) throw new UsageError("rebase data history needs a row id: rebase data history <table> <id>.");
        return { table: t, id: positionals[1] };
    });
    const target = await projectTarget(flags, { command: "data history" });
    const body = await requestJson(target, tablePath(table, id, "history"), `Failed to read the history of ${table}/${id}`, {
        query: { limit: flags["--limit"]?.toString(), offset: flags["--offset"]?.toString() }
    });
    const entries = recordsOf(isRecord(body) ? body.data : body);
    emit(() => {
        if (entries.length === 0) return note("No history is recorded for this row (is history on for the table?).");
        for (const entry of entries) {
            console.log(`  ${chalk.bold(stringOf(entry.id) ?? "?")}  ${chalk.gray(stringOf(entry.created_at ?? entry.createdAt) ?? "")}  ${stringOf(entry.action ?? entry.operation) ?? ""}`);
        }
        note(chalk.gray(`Put one back with: rebase data revert ${table} ${id} <historyId>`));
    }, body);
}

export const REVERT_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

async function revertRow(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: REVERT_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data revert",
        maxPositionals: 3
    }));
    const { table, id, historyId } = parsedLine(() => {
        const t = requireTable(positionals, "data revert");
        if (!positionals[1] || !positionals[2]) {
            throw new UsageError("rebase data revert needs a row id and a history id: rebase data revert <table> <id> <historyId> (`rebase data history` lists them).");
        }
        return { table: t, id: positionals[1], historyId: positionals[2] };
    });
    const target = await projectTarget(flags, { command: "data revert" });
    await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Put ${table}/${id} back to version ${historyId} on ${target.label}?` });
    const body = await requestJson(target, tablePath(table, id, "history", historyId, "revert"), `Failed to revert ${table}/${id}`, { method: "POST" });
    emit(() => success(`Reverted ${table}/${id} to ${historyId}; the revert is a new history entry.`), body);
}

/* ═══════════════════════════════════════════════════════════════
   watch
   ═══════════════════════════════════════════════════════════════ */

export const WATCH_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--where": [String],
    "-w": "--where",
    "--limit": Number,
    "-n": "--limit"
} satisfies arg.Spec;

/**
 * Print a table's matching rows each time they change, over the app's realtime
 * socket — the same subscription the SDK's `listen` opens, under the same RLS.
 * One JSON line per change when piped. Runs until interrupted.
 *
 * Not through the Studio proxy, which carries HTTP only: on a cloud project it
 * needs --token or --session, which go to the app's own address.
 */
async function watchRows(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: WATCH_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "data watch",
        maxPositionals: 1
    }));
    const { table, filter } = parsedLine(() => ({ table: requireTable(positionals, "data watch"), filter: whereParams(flags["--where"]) }));
    const target = await projectTarget(flags, { command: "data watch" });
    if (target.credential === "studio-proxy") {
        fail(
            "The console's Studio proxy carries HTTP only, and `data watch` needs the app's realtime socket.",
            "Pass --token <bearer> (an rk_ key with data:read) or --session to reach the app's own address.",
            "realtime_unavailable"
        );
    }
    await watchOverSocket(target, table, filter, flags["--limit"]);
}

async function watchOverSocket(target: ProjectTarget, table: string, filter: Record<string, string[]>, limit: number | undefined): Promise<void> {
    const { createRebaseClient } = await import("@rebasepro/client");
    const { cliUserAgent } = await import("../utils/version");
    // The SDK opens and authenticates the socket itself, with the bearer the
    // target sends.
    const token = await target.bearer();
    const client = createRebaseClient({
        baseUrl: target.baseUrl,
        ...(token ? { token } : {}),
        headers: { "User-Agent": cliUserAgent() },
        auth: { persistSession: false, autoRefresh: false }
    });
    const { deserializeFilter } = await import("@rebasepro/common");
    const where = deserializeFilter(whereObject(filter));
    if (!isJsonMode()) note(`Watching ${table} on ${target.label}. Ctrl-C to stop.`);
    const handle = client.data.table(table).listen(
        { where, ...(limit ? { limit } : {}) },
        (event: unknown) => {
            const rows = isRecord(event) && Array.isArray(event.data) ? recordsOf(event.data) : recordsOf(event);
            if (isJsonMode()) process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), data: rows })}\n`);
            else {
                console.log(chalk.gray(`── ${new Date().toLocaleTimeString()} · ${rows.length} row(s)`));
                printTable(rows);
            }
        },
        (error: unknown) => fail(`The subscription to ${table} failed: ${error instanceof Error ? error.message : String(error)}`, undefined, "realtime_error")
    );
    await new Promise<void>(resolve => {
        const stop = () => {
            if (typeof handle === "function") handle();
            resolve();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
    });
    process.exit(0);
}

/* ═══════════════════════════════════════════════════════════════
   Help
   ═══════════════════════════════════════════════════════════════ */

const DATA_ACTIONS: HelpAction[] = [
    {
        action: "query",
        args: "<table>",
        description: "Read rows: filtered, sorted, paged",
        flags: [
            ["--where, -w <col=op.value>", "A condition in the API's own syntax: status=eq.published, price=gte.10 (repeatable)"],
            ["--or <(a.eq.1,b.gt.2)>", "Conditions any of which may match"],
            ["--order-by <col[:desc]>", "Sort (repeatable, in order)"],
            ["--limit, -n <n>", "Rows per page (default: the server's)"],
            ["--offset <n>", "Skip this many rows"],
            ["--fields <a,b>", "Only these columns"],
            ["--include <relation>", "Embed a relation"],
            ["--search <text>", "Full-text search, on tables that declare it"],
            ["--deleted <include|only>", "Soft-deleted rows too, or only them"],
            ["--all", "Every page, not just the first"],
            ["--format <table|json|ndjson|csv>", "How to print the rows (csv and ndjson stream with --all)"]
        ]
    },
    { action: "get", args: "<table> <id>", description: "Read one row", flags: [["--fields <a,b>", "Only these columns"], ["--include <relation>", "Embed a relation"]] },
    { action: "count", args: "<table>", description: "Count the rows that match", flags: [["--where, -w <col=op.value>", "As for query"], ["--search <text>", "As for query"]] },
    {
        action: "aggregate",
        args: "<table>",
        description: "count, sum, avg, min, max, grouped",
        flags: [["--select <exprs>", "The API's select: \"count(),sum(total)\""], ["--group-by <cols>", "Group by these columns"]]
    },
    {
        action: "insert",
        args: "<table>",
        description: "Add a row, or several from a JSON array",
        flags: [["--data, -d <json>", "The row as JSON"], ["--file <path|->", "The row (or an array of rows) from a file or stdin"], ["--upsert <column>", "Update the row that conflicts on this column instead"]]
    },
    {
        action: "update",
        args: "<table> [<id>]",
        description: "Change columns on a row, or on every row --where matches",
        flags: [["--data, -d <json>", "The columns to set"], ["--file <path|->", "The same, from a file"], ["--where, -w <col=op.value>", "Update every matching row (confirms first)"], ["--if-match <etag>", "Refuse if the row changed since this version"]]
    },
    {
        action: "delete",
        args: "<table> [<id>]",
        description: "Delete a row, or every row --where matches (confirms first)",
        flags: [["--where, -w <col=op.value>", "Delete every matching row"], ["--hard", "Remove a soft-deleted table's rows for good"]]
    },
    {
        action: "import",
        args: "<table>",
        description: "Write rows from a JSON, NDJSON or CSV file, in batches",
        flags: [["--file <path|->", "The rows (format from the extension, else --format)"], ["--format <json|ndjson|csv>", "The file's format"], ["--upsert <column>", "Update rows that conflict on this column"], ["--ignore-duplicates", "With --upsert: skip conflicting rows instead"], ["--batch <n>", `Rows per request (default ${IMPORT_BATCH})`]]
    },
    { action: "history", args: "<table> <id>", description: "A row's recorded versions (tables with history on)", flags: [["--limit, -n <n>", "At most this many"], ["--offset <n>", "Skip this many"]] },
    { action: "revert", args: "<table> <id> <historyId>", description: "Put a row back to a recorded version" },
    { action: "watch", args: "<table>", description: "Print the matching rows each time they change (realtime)", flags: [["--where, -w <col=op.value>", "As for query"], ["--limit, -n <n>", "At most this many rows"]] }
];

function printDataHelp(): void {
    printProjectHelp({
        command: "data",
        title: "Read and write a running app's rows, through its API and its row-level security",
        actions: DATA_ACTIONS,
        notes: [
            "Examples:",
            "  rebase data query posts --where status=eq.published --order-by created_at:desc -n 10",
            "  rebase data insert posts --data '{\"title\":\"Hello\"}'",
            "  rebase data import posts --file seed.csv --upsert slug",
            "  rebase data query orders --all --format csv --project acme > orders.csv",
            "The service key is admin: row-level security still runs, as the admin role. Pass --token or --session to act as somebody else.",
            "`rebase schema show --remote` lists the tables and their columns."
        ]
    });
}
