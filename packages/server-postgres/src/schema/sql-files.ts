/**
 * `backend/sql/*.sql`: the SQL a project keeps beside its tables — functions,
 * triggers, CHECK constraints, grants — that a table definition cannot say.
 *
 * `schema introspect` writes what it cannot carry to
 * `backend/sql/introspected-left-behind.sql`, and nothing applied it: a project
 * kept a note to run it by hand after every `rebase db push`, and a push that
 * recreated a table took its triggers with it until someone remembered.
 *
 * `rebase db push` now applies every file in this directory, in file-name
 * order, after the tables and views and before the policies (so a policy may
 * call a function a file defines). Each file is recorded by name and SHA-256
 * in `rebase.sql_files` and runs again only when its content changes, each in
 * its own transaction: a file that fails rolls back alone and stops the push,
 * naming it. Files must therefore be safe to run again (`CREATE OR REPLACE
 * FUNCTION`, `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`, `ADD CONSTRAINT`
 * guarded by a `DO` block). Removing a file undoes nothing it did; the push
 * says so.
 *
 * A file whose name starts with `_` is a draft and is not applied: that is
 * where `schema introspect` writes what it left behind
 * (`_introspected-left-behind.sql`), which still needs review — Supabase's
 * `auth.uid()`, a `CREATE TRIGGER` that cannot run twice — before it is renamed
 * and applied. The name it used before this, `introspected-left-behind.sql`,
 * is treated as a draft too, so a project that has one is not broken by it.
 *
 * Side-effect free; the database half is `applySqlFiles` in `cli-helpers.ts`.
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

export interface SqlFile {
    name: string;
    sql: string;
    hash: string;
}

/** Where a project's SQL files live: `backend/sql`, beside `backend/schema`. */
export function sqlFilesDir(schemaDir: string): string {
    return path.join(path.dirname(path.resolve(schemaDir)), "sql");
}

/** Where `schema introspect` writes the objects it did not carry, for review. A draft. */
export const INTROSPECTED_LEFT_BEHIND_FILE = "_introspected-left-behind.sql";

/** A file the push does not apply: `_`-prefixed, or introspect's name before the prefix. */
export function isDraftSqlFile(name: string): boolean {
    return name.startsWith("_") || name === "introspected-left-behind.sql";
}

/** The `.sql` files in `dir` that are drafts, sorted by name. */
export function draftSqlFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((name) => name.endsWith(".sql") && isDraftSqlFile(name)).sort();
}

/** The `.sql` files in `dir` the push applies, sorted by name; none when it does not exist. */
export function readSqlFiles(dir: string): SqlFile[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter((name) => name.endsWith(".sql") && !isDraftSqlFile(name) && fs.statSync(path.join(dir, name)).isFile())
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((name) => {
            const sql = fs.readFileSync(path.join(dir, name), "utf8");
            return { name, sql, hash: createHash("sha256").update(sql).digest("hex") };
        });
}

/** What a push does with the files, given what `rebase.sql_files` records. */
export interface SqlFilesPlan {
    /** New, or changed since they were applied: run, in this order. */
    apply: (SqlFile & { changed: boolean })[];
    unchanged: string[];
    /** Recorded as applied, no longer on disk. Nothing they did is undone. */
    removed: string[];
}

export function planSqlFiles(files: SqlFile[], applied: ReadonlyMap<string, string>): SqlFilesPlan {
    const apply: SqlFilesPlan["apply"] = [];
    const unchanged: string[] = [];
    for (const file of files) {
        const recorded = applied.get(file.name);
        if (recorded === file.hash) unchanged.push(file.name);
        else apply.push({ ...file, changed: recorded !== undefined });
    }
    const onDisk = new Set(files.map((f) => f.name));
    const removed = [...applied.keys()].filter((name) => !onDisk.has(name)).sort();
    return { apply, unchanged, removed };
}

/** The ledger. In `rebase`, which every Atlas plan excludes. */
export const SQL_FILES_LEDGER_SQL = [
    "CREATE SCHEMA IF NOT EXISTS rebase",
    `CREATE TABLE IF NOT EXISTS rebase.sql_files (
        name text PRIMARY KEY,
        hash text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
    )`
];

export const RECORD_SQL_FILE_SQL =
    "INSERT INTO rebase.sql_files (name, hash, applied_at) VALUES ($1, $2, now()) " +
    "ON CONFLICT (name) DO UPDATE SET hash = EXCLUDED.hash, applied_at = EXCLUDED.applied_at";
