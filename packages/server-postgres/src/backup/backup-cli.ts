/**
 * CLI handlers for `rebase db backup`, `rebase db restore`, and
 * `rebase db backups list`. Kept out of the main `cli.ts` dispatcher so the
 * backup surface stays self-contained.
 */
import type arg from "arg";
import path from "path";
import fs from "fs";
import os from "os";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import chalk from "chalk";
// Aliased: `out` is already a local in two of the commands below (the `--out`
// backup destination).
import { out as print, outWarn, outError } from "../cli-output";
import { closestWord, parseCommandFlags } from "../cli-flags";
import { redactConnectionPasswords } from "../utils/connection-string";
import { promptConfirm } from "../cli-prompt";
import { checkDatabaseConnectivity } from "../cli-errors";
import type { StorageController } from "@rebasepro/server";
import {
    BackupDestination,
    globalsFileForDump,
    parseBackupDestination,
    parseDbNameFromUrl,
    resolveConnectionString,
    withDatabaseName
} from "./pg-tools";
import {
    applyGlobals,
    BackupToolError,
    createDump,
    discardPartialDump,
    ensureDatabaseExists,
    findRestoreConflicts,
    listBackups,
    preflight,
    readDumpObjects,
    restoreDump,
    uploadBackup,
    validateDump
} from "./backup-service";

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** A web stream's chunks, for piping into a file. */
async function* webChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
    const reader = stream.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * The controller for an object-storage destination, or `null` for a local one.
 *
 * Built by `backupStorageFromEnv` from `@rebasepro/server` — the function the
 * Backups panel's routes use — so the CLI and the panel read a bucket the same
 * way. This file had its own copy, and the two had already drifted once
 * (`S3_FORCE_PATH_STYLE` read as `=== "true"`, so a MinIO backup addressed the
 * bucket as a host).
 *
 * Exported for its test.
 */
export async function resolveStorageForDestination(
    dest: BackupDestination,
    env: Record<string, string | undefined>
): Promise<StorageController | null> {
    if (dest.kind === "local") return null;
    const { backupStorageFromEnv } = await import("@rebasepro/server");
    try {
        return backupStorageFromEnv(dest, env);
    } catch (error) {
        throw new BackupToolError(
            error instanceof Error ? error.message : String(error),
            "Set the same S3_* variables your backend uses for storage."
        );
    }
}

/**
 * The directory `rebase` was run from, which `rebase` puts here for the driver.
 *
 * The driver runs in the project's `backend/`, so a relative path resolved
 * against its own working directory named a different place from the one the
 * user typed it in: `rebase db backup --out ./backups` wrote to `<root>/backups`
 * (the CLI resolves explicit paths itself) while `rebase db backups list`
 * looked in `<root>/backend/backups`. Spelled the same in
 * `packages/cli/src/commands/db.ts`.
 */
export const INVOCATION_CWD_ENV = "REBASE_INVOCATION_CWD";

/** Where a relative path the user typed is relative to: where they ran `rebase`. */
export function invocationDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
    const dir = env[INVOCATION_CWD_ENV]?.trim();
    return dir && path.isAbsolute(dir) ? dir : process.cwd();
}

/**
 * Where `db backup` writes and `db backups list` reads, by one rule.
 *
 * - `--out` is relative to where `rebase` was run, like any path typed on a
 *   command line.
 * - `BACKUP_DESTINATION` is relative to the backend directory, because the
 *   server reads the same variable there: the Backups panel and the scheduled
 *   backup have to find what the CLI wrote.
 * - With neither, `./backups` where `rebase` was run, as the help says.
 *
 * An `s3://` or `gs://` destination is returned as given.
 */
export function resolveBackupLocation(opts: {
    flag?: string;
    configured?: string;
    invocationDir: string;
    backendDir: string;
}): string {
    const flag = opts.flag?.trim();
    if (flag) return isRemoteDestination(flag) ? flag : path.resolve(opts.invocationDir, flag);
    const configured = opts.configured?.trim();
    if (configured) return isRemoteDestination(configured) ? configured : path.resolve(opts.backendDir, configured);
    return path.join(opts.invocationDir, "backups");
}

function isRemoteDestination(value: string): boolean {
    return parseBackupDestination(value).kind !== "local";
}

/** {@link resolveBackupLocation} for this process. */
function backupLocation(flag: string | undefined): string {
    return resolveBackupLocation({
        flag,
        configured: process.env.BACKUP_DESTINATION,
        invocationDir: invocationDir(),
        backendDir: process.cwd()
    });
}

function requireConnection(): string {
    const conn = resolveConnectionString(process.env);
    if (!conn) {
        outError(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
        process.exit(1);
    }
    return conn;
}

// ─────────────────────────────────────────────────────────────────────────
// rebase db backup
// ─────────────────────────────────────────────────────────────────────────
const BACKUP_FLAGS = {
    "--out": String,
    // The same alias `build` and `cloud env pull` carry. `--output` is the
    // canonical spelling in this CLI, and `rebase db backup --output ./backups`
    // has to write there.
    "--output": "--out",
    "--exclude-schema": [String],
    "--no-owner": Boolean,
    "--enable-row-security": Boolean,
    "--row-security-role": String,
    "-o": "--out"
} satisfies arg.Spec;

/**
 * Parse a `rebase db backup …` line. An undeclared flag is refused (see
 * `parseCommandFlags`), and so is a positional: `rebase db backup ./backups`
 * means `--out ./backups`, and taken as nothing it wrote to the default
 * directory.
 */
export function parseBackupLine(rawArgs: string[]) {
    const args = parseCommandFlags(BACKUP_FLAGS, rawArgs.slice(2), "db backup");
    const [stray] = args._;
    if (stray !== undefined) {
        throw new Error(
            `\`rebase db backup\` takes no argument "${stray}". Nothing was run. ` +
            `To choose where the backup goes, pass --out ${stray}.`
        );
    }
    return args;
}

export async function backupCommand(rawArgs: string[]): Promise<void> {
    if (rawArgs.includes("--help")) {
        printBackupHelp();
        return;
    }
    const args = parseBackupLine(rawArgs);

    const connectionString = requireConnection();
    const dbName = parseDbNameFromUrl(connectionString) ?? "database";
    const out = backupLocation(args["--out"]);
    const dest = parseBackupDestination(out);

    print("");
    print(chalk.bold("  💾 Rebase DB Backup"));
    print(chalk.gray(`  Database:    ${dbName}`));
    print(chalk.gray(`  Destination: ${out}`));
    print("");

    // A database that is not running is said the way `db push` says it — the
    // host, the port and what to start — before pg_dump's version probe meets
    // it as a bare `connect ECONNREFUSED`.
    await checkDatabaseConnectivity(connectionString);

    // Version pre-flight (doctor-style).
    const pf = await preflight("pg_dump", connectionString);
    if (!pf.compatible) {
        outError(chalk.red(`  ✗ ${pf.reason}`));
        process.exit(1);
    }
    print(chalk.gray(`  Using pg_dump ${pf.toolMajor} against server ${pf.serverMajor}.`));

    // Opt-in, and loud. With row security on, pg_dump stops refusing to read
    // rows it cannot see and starts leaving them out — an exit-0 backup that
    // is quietly short. Anyone choosing that should know they chose it.
    const rowSecurity = args["--enable-row-security"]
        ? { uid: "rebase-db-backup", roles: [args["--row-security-role"] || "admin"] }
        : undefined;

    if (rowSecurity) {
        outWarn("");
        outWarn(chalk.yellow("  ⚠  Dumping with row-level security ON."));
        outWarn(chalk.gray(`     Reading as roles [${rowSecurity.roles.join(", ")}], which satisfies the generated`));
        outWarn(chalk.gray("     `admin_full_access` policy. This backup contains exactly the rows those"));
        outWarn(chalk.gray("     policies admit — a table whose policies have no admin rule comes out short,"));
        outWarn(chalk.gray("     and pg_dump will not say so. Prefer granting the dumping role BYPASSRLS."));
        outWarn("");
    }

    try {
        if (dest.kind === "local") {
            // Honour an explicit `…/name.dump` path; otherwise treat it as a
            // directory and auto-name the file.
            const explicitFile = dest.path.endsWith(".dump");
            const dump = await createDump({
                connectionString,
                dbName,
                outDir: explicitFile ? path.dirname(dest.path) : dest.path,
                fileName: explicitFile ? path.basename(dest.path) : undefined,
                excludeSchemas: args["--exclude-schema"],
                noOwner: args["--no-owner"],
                inheritStdio: true,
                rowSecurity
            });
            await assertDumpValid(dump.localFile);
            print("");
            print(chalk.green(`  ✓ Backup written to ${dump.localFile} (${formatBytes(dump.sizeBytes)})`));
            if (dump.globalsFile) {
                print(chalk.gray(`    ✓ Roles captured to ${dump.globalsFile} (needed so RLS survives a restore).`));
            }
        } else {
            const storage = await resolveStorageForDestination(dest, process.env);
            const dump = await createDump({
                connectionString,
                dbName,
                excludeSchemas: args["--exclude-schema"],
                noOwner: args["--no-owner"],
                inheritStdio: true,
                rowSecurity
            });
            try {
                await assertDumpValid(dump.localFile);
                const uploaded = await uploadBackup(storage!, dump.localFile, dest);
                print("");
                print(chalk.green(`  ✓ Backup uploaded to ${uploaded.storageUrl} (${formatBytes(dump.sizeBytes)})`));
                // Upload the roles sidecar next to the dump so a restore can
                // recreate roles the dump's GRANT/RLS statements depend on.
                if (dump.globalsFile && fs.existsSync(dump.globalsFile)) {
                    const globalsUpload = await uploadBackup(storage!, dump.globalsFile, dest);
                    print(chalk.gray(`    ✓ Roles uploaded to ${globalsUpload.storageUrl} (needed so RLS survives a restore).`));
                }
                print(chalk.gray("    Ensure this bucket is private — backups may contain secrets and PII."));
            } finally {
                if (fs.existsSync(dump.localFile)) fs.unlinkSync(dump.localFile);
                if (dump.globalsFile && fs.existsSync(dump.globalsFile)) fs.unlinkSync(dump.globalsFile);
            }
        }
        print("");
    } catch (err) {
        reportError(err);
        process.exit(1);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// rebase db restore <backup>
// ─────────────────────────────────────────────────────────────────────────
const RESTORE_FLAGS = {
    "--target-db": String,
    "--create-db": Boolean,
    "--clean": Boolean,
    "--no-owner": Boolean,
    "--continue-on-error": Boolean,
    "--yes": Boolean,
    "-y": "--yes"
} satisfies arg.Spec;

/**
 * Parse a `rebase db restore …` line; the one positional is the backup.
 *
 * Strict, because this is the command where a typo costs most: parsed
 * permissively, `--targt-db x` became a second positional, the target fell
 * back to DATABASE_URL's own database, and the restore ran against the live
 * one.
 */
export function parseRestoreLine(rawArgs: string[]) {
    const args = parseCommandFlags(RESTORE_FLAGS, rawArgs.slice(2), "db restore");
    if (args._.length > 1) {
        throw new Error(
            `\`rebase db restore\` restores one backup, and was given ${args._.length}: ` +
            `${args._.map(word => `"${word}"`).join(", ")}. Nothing was run.`
        );
    }
    return args;
}

/**
 * The restore's one question, asked before anything can change.
 *
 * `--yes` skips it. On a terminal it asks for a typed 'yes'. With no terminal
 * nobody can answer, and the refusal says to pass `--yes`, as `db reset`,
 * `db pull` and `db branch prune` do: "Aborted. No changes were made." alone
 * read as though someone had answered no.
 *
 * @returns whether to go on. When not, it has said why.
 */
export async function confirmRestore(opts: {
    target: string;
    yes: boolean;
    interactive: boolean;
    ask: (question: string) => Promise<boolean>;
}): Promise<boolean> {
    if (opts.yes) return true;
    outWarn(chalk.yellow(`  ⚠️  This will restore into "${opts.target}" and may overwrite existing data.`));
    if (!opts.interactive) {
        outError(chalk.red("  ✗ Nothing was restored: there is no terminal to confirm on."));
        outError(chalk.gray(`    Re-run with --yes to restore into "${opts.target}".`));
        return false;
    }
    const confirmed = await opts.ask(chalk.yellow("     Type 'yes' to continue: "));
    if (!confirmed) print(chalk.gray("  Aborted. No changes were made."));
    return confirmed;
}

/** How many of the conflicting objects a refusal names before counting the rest. */
const CONFLICTS_NAMED = 5;

/**
 * What `db restore` says when the target already holds what the backup
 * creates, and the two ways round it: `--clean` replaces them with the
 * backup's copy, a new database restores beside them.
 */
export function describeRestoreConflict(
    target: string,
    backupArg: string,
    conflicts: readonly string[]
): { message: string; hint: string } {
    const named = conflicts.slice(0, CONFLICTS_NAMED).join(", ");
    const more = conflicts.length > CONFLICTS_NAMED ? `, and ${conflicts.length - CONFLICTS_NAMED} more` : "";
    return {
        message: `"${target}" already holds ${named}${more}, which this backup creates. ` +
            "Without --clean, pg_restore stops at the first of them. Nothing was restored or changed.",
        hint: [
            `To replace them with the backup's copy:  rebase db restore ${backupArg} --clean`,
            `To restore beside them, in a new database:  rebase db restore ${backupArg} --create-db --target-db <new name>`
        ].join("\n    ")
    };
}

export async function restoreCommand(rawArgs: string[]): Promise<void> {
    if (rawArgs.includes("--help")) {
        printRestoreHelp();
        return;
    }
    const args = parseRestoreLine(rawArgs);

    const backupArg = args._[0];
    if (!backupArg) {
        printRestoreHelp();
        process.exit(1);
    }

    const baseConnection = requireConnection();

    // Choose the target connection: an explicit --target-db swaps the database
    // name so the live one isn't clobbered. Without it the target is
    // DATABASE_URL's own database, and `--create-db` only creates it when it is
    // missing.
    const targetDb = args["--target-db"] ?? parseDbNameFromUrl(baseConnection) ?? undefined;
    const targetConnection = args["--target-db"]
        ? withDatabaseName(baseConnection, args["--target-db"])
        : baseConnection;

    print("");
    print(chalk.bold("  ♻️  Rebase DB Restore"));
    print(chalk.gray(`  Source:  ${backupArg}`));
    print(chalk.gray(`  Target:  ${targetDb ?? "(from DATABASE_URL)"}`));
    print("");

    // Before anything is downloaded, and in `db push`'s words: see backupCommand.
    await checkDatabaseConnectivity(baseConnection);

    // Resolve the local file to restore from (download object-storage keys).
    // Also resolve the `.globals.sql` roles sidecar so cluster roles can be
    // recreated before the restore — without them the dump's GRANT/RLS
    // statements fail and RLS is silently lost.
    let localFile: string;
    let globalsSql: string | null = null;
    let cleanupTemp = false;
    try {
        if (/^(s3|gs):\/\//.test(backupArg)) {
            const dest = parseBackupDestination(backupArg.replace(/\/[^/]+$/, ""));
            const storage = await resolveStorageForDestination(dest, process.env);
            if (!storage) throw new BackupToolError("Could not resolve storage for the given URL.");
            const key = backupArg.replace(/^(s3|gs):\/\/[^/]+\//, "");
            const bucket = backupArg.replace(/^(s3|gs):\/\/([^/]+)\/.*$/, "$2");
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-restore-"));
            localFile = path.join(tmpDir, path.basename(key));
            cleanupTemp = true;
            // Streamed to disk: buffered, a dump was held twice in memory and
            // one over 2 GiB could not be written in one call at all.
            const object = storage.getObjectStream
                ? await storage.getObjectStream(key, { bucket })
                : await storage.getObject(key, bucket).then((file) => file && { stream: file.stream() });
            if (!object) throw new BackupToolError(`Backup not found in storage: ${backupArg}`);
            await pipeline(Readable.from(webChunks(object.stream)), fs.createWriteStream(localFile));
            const globalsObj = await storage.getObject(globalsFileForDump(key), bucket);
            if (globalsObj) globalsSql = Buffer.from(await globalsObj.arrayBuffer()).toString("utf-8");
        } else {
            localFile = path.resolve(invocationDir(), backupArg);
            if (!fs.existsSync(localFile)) throw new BackupToolError(`Backup file not found: ${localFile}`);
            const globalsPath = globalsFileForDump(localFile);
            if (fs.existsSync(globalsPath)) globalsSql = fs.readFileSync(globalsPath, "utf-8");
        }

        // Version pre-flight. Check against the base connection — the server
        // version is identical for every database, and the target may not
        // exist yet when --create-db is used.
        // Thrown, not exited, from here down: an exit skipped the `finally`
        // that removes a dump downloaded from object storage.
        const pf = await preflight("pg_restore", baseConnection);
        if (!pf.compatible) throw new BackupToolError(pf.reason ?? "pg_restore cannot restore into this server.");

        // `--create-db` needs a name before anything else can be decided.
        if (args["--create-db"] && !targetDb) {
            throw new BackupToolError("--create-db requires a resolvable target database name (use --target-db).");
        }

        // Destructive-action gate. Restores overwrite data; never run without
        // an explicit yes (interactive confirmation or --yes).
        //
        // Ahead of `--create-db`, not after it. Creating the database first
        // meant an aborted run had already changed the cluster, while printing
        // "No changes were made" — and it left an empty database behind that a
        // second, confirmed run then reported as "already exists". The gate is
        // now the first thing that can stop the command, so its own message is
        // true whichever way the answer goes.
        // Before the question and before anything is applied, roles included:
        // without --clean, pg_restore stops at the first object the target
        // already has, and said so in its own words and execa's, after the
        // roles had run. A target that does not exist yet holds nothing.
        if (!args["--clean"]) {
            const conflicts = await findRestoreConflicts(targetConnection, await readDumpObjects(localFile));
            if (conflicts.length > 0) {
                const { message, hint } = describeRestoreConflict(targetDb ?? "the target database", backupArg, conflicts);
                throw new BackupToolError(message, hint);
            }
        }

        const confirmed = await confirmRestore({
            target: targetDb ?? "the target database",
            yes: args["--yes"] === true,
            interactive: process.stdin.isTTY === true,
            ask: promptConfirm
        });
        if (!confirmed) {
            // An exit code, so the `finally` still removes a downloaded dump.
            process.exitCode = 1;
            return;
        }

        // Create the target database when requested.
        if (args["--create-db"]) {
            const created = await ensureDatabaseExists(baseConnection, targetDb!);
            print(chalk.gray(created ? `  ✓ Created database "${targetDb}".` : `  • Database "${targetDb}" already exists.`));
        }

        // Recreate cluster roles before restoring so GRANT/RLS statements in
        // the dump apply. Best-effort and idempotent (see applyGlobals).
        let rolesApplied = 0;
        if (globalsSql) {
            print(chalk.gray("  Recreating cluster roles from the backup's roles sidecar…"));
            const { applied, skipped } = await applyGlobals(
                targetConnection,
                globalsSql,
                (m) => print(chalk.gray(m))
            );
            rolesApplied = applied;
            print(chalk.gray(`  ✓ Roles: ${applied} applied, ${skipped} skipped (already present or not permitted).`));
        } else {
            outWarn(chalk.yellow("  ⚠️  No roles sidecar (.globals.sql) accompanies this backup."));
            outWarn(chalk.yellow("     If the dump grants to roles that don't exist (e.g. rebase_user), the restore"));
            outWarn(chalk.yellow("     will fail — recreate those roles first, or use a backup that includes its globals."));
        }

        try {
            await restoreDump({
                connectionString: targetConnection,
                inputFile: localFile,
                clean: args["--clean"],
                noOwner: args["--no-owner"],
                // Fail loudly by default so a skipped GRANT never leaves RLS off.
                exitOnError: !args["--continue-on-error"],
                inheritStdio: true
            });
        } catch (err) {
            if (err instanceof BackupToolError) throw err;
            // pg_restore has printed its own error above; execa's repeats the
            // command line, which says nothing the reader can act on.
            throw new BackupToolError(
                `pg_restore stopped on the error above. What it restored before that stays in "${targetDb ?? "the target database"}".`,
                rolesApplied > 0
                    ? `The ${rolesApplied} cluster role(s) recreated from the backup's sidecar before it stay too.`
                    : undefined
            );
        }

        print("");
        print(chalk.green(`  ✓ Restore completed into "${targetDb ?? "the target database"}".`));
        print("");
    } catch (err) {
        reportError(err);
        // An exit code, not `process.exit`: exiting here skipped the `finally`
        // below, and a failed restore from object storage left its downloaded
        // dump, every row of the database, in the temp directory.
        process.exitCode = 1;
    } finally {
        if (cleanupTemp && typeof localFile! === "string" && fs.existsSync(localFile!)) {
            fs.rmSync(path.dirname(localFile!), { recursive: true, force: true });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// rebase db backups list
// ─────────────────────────────────────────────────────────────────────────
const BACKUPS_ACTIONS = ["list"] as const;

/** What `db backups <action>` says of an action it does not have: the sentence every `db` command says. */
export function unknownBackupsAction(action: string): string {
    const near = closestWord(action, BACKUPS_ACTIONS);
    return near
        ? `Unknown db backups command "${action}" — did you mean \`${near}\`? Run \`rebase db backups --help\` for the rest.`
        : `Unknown db backups command "${action}". Run \`rebase db backups --help\` for the ones there are.`;
}

export async function backupsCommand(rawArgs: string[]): Promise<void> {
    const action = rawArgs[2];
    if (!action || action === "--help") {
        printBackupsHelp();
        return;
    }
    if (action !== "list") {
        outError(chalk.red(`✗ ${unknownBackupsAction(action)}`));
        process.exit(1);
    }

    const args = parseCommandFlags(
        { "--out": String, "--output": "--out", "-o": "--out" },
        rawArgs.slice(3),
        "db backups list"
    );
    const out = backupLocation(args["--out"]);
    const dest = parseBackupDestination(out);

    try {
        const storage = await resolveStorageForDestination(dest, process.env);
        const backups = await listBackups(dest, storage ?? undefined);
        print("");
        if (backups.length === 0) {
            print(chalk.gray(`  No backups found at ${out}.`));
            await mentionBackendBackups(out, args["--out"]);
        } else {
            print(chalk.bold(`  💾 ${backups.length} backup(s) at ${out}:`));
            print("");
            for (const b of backups) {
                const when = b.createdAt ? b.createdAt.toISOString() : "unknown date";
                const name = dest.kind === "local" ? path.basename(b.key) : b.key;
                // An empty file is called out rather than listed as a peer of
                // the real ones. Older failures could leave a 0-byte dump here
                // (fixed at the source now), and retention protects the newest
                // by date whatever they contain — so a corpse left in place can
                // hold a `keepMinimum` slot against a backup that matters.
                const empty = b.sizeBytes === 0;
                const size = b.sizeBytes === undefined ? "" : ` — ${formatBytes(b.sizeBytes)}`;
                if (empty) {
                    print(`  ${chalk.red("○")} ${chalk.bold(name)} ${chalk.gray(`— ${when}`)}${chalk.red(" — EMPTY, not restorable")}`);
                } else {
                    print(`  ${chalk.green("●")} ${chalk.bold(name)} ${chalk.gray(`— ${when}${size}`)}`);
                }
            }
            if (backups.some(b => b.sizeBytes === 0)) {
                print("");
                print(chalk.yellow("  ⚠  Empty files above are leftovers from a failed backup. Delete them:"));
                print(chalk.gray("     they count as recent backups for retention but restore nothing."));
            }
        }
        print("");
    } catch (err) {
        reportError(err);
        process.exit(1);
    }
}

/**
 * Point at `<backend>/backups` when the default listing is empty and that
 * directory holds dumps.
 *
 * Earlier releases resolved the default there, so after an upgrade the
 * backups a project already has are one directory away from the listing.
 */
async function mentionBackendBackups(listed: string, flag: string | undefined): Promise<void> {
    if (flag || process.env.BACKUP_DESTINATION?.trim()) return;
    const backendBackups = path.join(process.cwd(), "backups");
    if (path.resolve(listed) === backendBackups) return;
    const found = await listBackups({ kind: "local", path: backendBackups }).catch(() => []);
    if (found.length === 0) return;
    print(chalk.gray(`  ${found.length} backup(s) are in ${backendBackups}, where earlier releases of`));
    print(chalk.gray(`  \`rebase db backup\` wrote by default. List them with:`));
    print(chalk.gray(`    rebase db backups list --out ${path.relative(invocationDir(), backendBackups) || "."}`));
}

/**
 * Verify a freshly written dump; abort the command if it looks corrupt.
 *
 * Discards the artifact on the way out. Refusing to *report* success was never
 * enough on its own: the file stayed on disk, `rebase db backups list` showed
 * it as an ordinary entry, and retention — which ranks by timestamp and never
 * looks at size — would protect it as one of the `keepMinimum` newest while
 * pruning a real backup underneath it. The roles sidecar goes too; the two are
 * uploaded and pruned as a pair, so half a pair is not a backup either.
 */
async function assertDumpValid(localFile: string): Promise<void> {
    const check = await validateDump(localFile);
    if (!check.ok) {
        discardPartialDump(globalsFileForDump(localFile));
        discardPartialDump(localFile);
        throw new BackupToolError(
            `The backup failed validation and was discarded: ${check.reason}`,
            "The dump was corrupt or truncated, so nothing was kept. Investigate before relying on this destination."
        );
    }
}

/**
 * Say why a backup command failed, with no password in it.
 *
 * What reaches here is often a client tool's failure, and execa's message
 * repeats the tool's command line. The tools get the password through
 * `PGPASSWORD` now, so it is not on that line, but a connection string can
 * still arrive inside a message from elsewhere; this is the last place to
 * stop it reaching a terminal or a CI log.
 */
function reportError(err: unknown): void {
    if (err instanceof BackupToolError) {
        outError(chalk.red(`  ✗ ${redactConnectionPasswords(err.message)}`));
        if (err.hint) outError(chalk.gray(`    ${redactConnectionPasswords(err.hint)}`));
    } else {
        outError(chalk.red(`  ✗ ${redactConnectionPasswords(err instanceof Error ? err.message : String(err))}`));
    }
}

function printBackupHelp(): void {
    print(`
${chalk.bold("rebase db backup")} — Create a database backup (pg_dump, custom format)

${chalk.green.bold("Usage")}
  rebase db backup [--out <path|s3://bucket/prefix>] [options]

${chalk.green.bold("Options")}
  ${chalk.blue("--out, -o")} <dest>        Local path or s3://…/gs://… URL (default: ./backups)
  ${chalk.blue("--exclude-schema")} <s>    Exclude a schema (repeatable)
  ${chalk.blue("--no-owner")}              Omit ownership commands from the dump
  ${chalk.blue("--enable-row-security")}   Dump as an admin subject instead of failing on RLS
                             ${chalk.red("(may produce a partial dump — see below)")}
  ${chalk.blue("--row-security-role")} <r> Role to read as with the flag above (default: admin)

${chalk.green.bold("Row-level security")}
  On a managed Postgres the dumping role usually owns nothing and has no
  BYPASSRLS, so pg_dump refuses:

    ERROR: query would be affected by row-level security policy for table "..."

  That refusal is the safe behaviour. --enable-row-security replaces it by
  reading as an admin subject: Rebase sets app.uid/app.user_roles so the
  generated admin_full_access policy admits the dump. The dump then contains
  exactly what those policies admit ${chalk.red("and no error is raised for what they do not")} —
  a table whose policies lack an admin rule comes out short, silently.

  Granting the dumping role BYPASSRLS is the option that keeps a backup
  meaning "every row".

${chalk.green.bold("Notes")}
  Backups may contain secrets and PII. Use private storage destinations and
  enable encryption-at-rest. See docs/backups.md.
`);
}

function printRestoreHelp(): void {
    print(`
${chalk.bold("rebase db restore")} — Restore a database from a backup (pg_restore)

${chalk.green.bold("Usage")}
  rebase db restore <backup> [options]

${chalk.green.bold("Arguments")}
  <backup>                   Local .dump file, or s3://…/gs://… object key

${chalk.green.bold("Options")}
  ${chalk.blue("--target-db")} <name>      Restore into this database instead of DATABASE_URL's
  ${chalk.blue("--create-db")}             Create the target database first if it doesn't exist
  ${chalk.blue("--clean")}                 Drop existing objects before recreating them
  ${chalk.blue("--no-owner")}              Ignore ownership from the dump
  ${chalk.blue("--continue-on-error")}     Log and continue past errors ${chalk.red("(may leave RLS un-enforced!)")}
  ${chalk.blue("--yes, -y")}               Skip the interactive confirmation ${chalk.red("(destructive!)")}

${chalk.red.bold("Warning")}
  Restore is destructive and never runs automatically. Without --yes it
  asks for a typed 'yes' on a terminal, and with no terminal to ask on it
  refuses. Prefer --create-db/--target-db to restore into a fresh database
  rather than overwriting a live one. Into a database that already holds
  what the backup creates, it needs --clean, and refuses before changing
  anything without it.

  By default the restore aborts on the first error (--exit-on-error) so a
  skipped GRANT never silently leaves RLS un-enforced. Roles are recreated
  from the backup's .globals.sql sidecar first; keep that file next to the
  dump. Use --continue-on-error only when you understand the consequences.
`);
}

function printBackupsHelp(): void {
    print(`
${chalk.bold("rebase db backups")} — Manage stored backups

${chalk.green.bold("Usage")}
  rebase db backups list [--out <path|s3://bucket/prefix>]
  rebase db backup list  [--out <path|s3://bucket/prefix>]   ${chalk.gray("(the same thing)")}
`);
}
