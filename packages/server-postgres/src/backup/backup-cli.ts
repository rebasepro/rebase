/**
 * CLI handlers for `rebase db backup`, `rebase db restore`, and
 * `rebase db backups list`. Kept out of the main `cli.ts` dispatcher so the
 * backup surface stays self-contained.
 */
import arg from "arg";
import path from "path";
import fs from "fs";
import os from "os";
import readline from "readline";
import chalk from "chalk";
// Aliased: `out` is already a local in two of the commands below (the `--out`
// backup destination).
import { out as print, outWarn, outError } from "../cli-output";
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
    listBackups,
    preflight,
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

/**
 * Build a StorageController for an object-storage destination from the same
 * `S3_*` env vars the backend uses. Returns `null` for local destinations.
 */
async function resolveStorageForDestination(
    dest: BackupDestination,
    env: Record<string, string | undefined>
): Promise<StorageController | null> {
    if (dest.kind === "local") return null;
    if (dest.kind === "gcs") {
        const { GCSStorageController } = await import("@rebasepro/server");
        return new GCSStorageController({ type: "gcs", bucket: dest.bucket });
    }
    // s3 (also covers R2/MinIO/Hetzner/GCS-interop via S3_ENDPOINT)
    if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
        throw new BackupToolError(
            "S3 destination requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in the environment.",
            "Set the same S3_* variables your backend uses for storage."
        );
    }
    const { S3StorageController } = await import("@rebasepro/server");
    return new S3StorageController({
        type: "s3",
        bucket: dest.bucket,
        region: env.S3_REGION || "auto",
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
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

async function promptConfirm(question: string): Promise<boolean> {
    // Non-interactive shells (CI, pipes) can't answer — treat as "no".
    if (!process.stdin.isTTY) return false;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer: string = await new Promise((resolve) => rl.question(question, resolve));
        return /^y(es)?$/i.test(answer.trim());
    } finally {
        rl.close();
    }
}

// ─────────────────────────────────────────────────────────────────────────
// rebase db backup
// ─────────────────────────────────────────────────────────────────────────
export async function backupCommand(rawArgs: string[]): Promise<void> {
    const args = arg(
        {
            "--out": String,
            // The same alias `build` and `cloud env pull` carry. `--output` is
            // the canonical spelling in this CLI and this command took only
            // `--out`, so `rebase db backup --output ./backups` wrote to
            // ./backups *and* to the default directory — the flag was ignored
            // and its value became a positional.
            "--output": "--out",
            "--exclude-schema": [String],
            "--no-owner": Boolean,
            "--enable-row-security": Boolean,
            "--row-security-role": String,
            "-o": "--out"
        },
        { argv: rawArgs.slice(2), permissive: true }
    );

    if (args._.includes("--help") || rawArgs.includes("--help")) {
        printBackupHelp();
        return;
    }

    const connectionString = requireConnection();
    const dbName = parseDbNameFromUrl(connectionString) ?? "database";
    const out = args["--out"] || process.env.BACKUP_DESTINATION || path.join(process.cwd(), "backups");
    const dest = parseBackupDestination(out);

    print("");
    print(chalk.bold("  💾 Rebase DB Backup"));
    print(chalk.gray(`  Database:    ${dbName}`));
    print(chalk.gray(`  Destination: ${out}`));
    print("");

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
export async function restoreCommand(rawArgs: string[]): Promise<void> {
    const args = arg(
        {
            "--target-db": String,
            "--create-db": Boolean,
            "--clean": Boolean,
            "--no-owner": Boolean,
            "--continue-on-error": Boolean,
            "--yes": Boolean,
            "-y": "--yes"
        },
        { argv: rawArgs.slice(2), permissive: true }
    );

    const backupArg = args._[0];
    if (!backupArg || rawArgs.includes("--help")) {
        printRestoreHelp();
        if (!backupArg && !rawArgs.includes("--help")) process.exit(1);
        return;
    }

    const baseConnection = requireConnection();

    // Choose the target connection: an explicit --target-db (or --create-db's
    // implied fresh db) swaps the database name so the live one isn't clobbered.
    const targetDb = args["--target-db"] ?? parseDbNameFromUrl(baseConnection) ?? undefined;
    const targetConnection = args["--target-db"]
        ? withDatabaseName(baseConnection, args["--target-db"])
        : baseConnection;

    print("");
    print(chalk.bold("  ♻️  Rebase DB Restore"));
    print(chalk.gray(`  Source:  ${backupArg}`));
    print(chalk.gray(`  Target:  ${targetDb ?? "(from DATABASE_URL)"}`));
    print("");

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
            const file = await storage.getObject(key, bucket);
            if (!file) throw new BackupToolError(`Backup not found in storage: ${backupArg}`);
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-restore-"));
            localFile = path.join(tmpDir, path.basename(key));
            fs.writeFileSync(localFile, Buffer.from(await file.arrayBuffer()));
            cleanupTemp = true;
            const globalsObj = await storage.getObject(globalsFileForDump(key), bucket);
            if (globalsObj) globalsSql = Buffer.from(await globalsObj.arrayBuffer()).toString("utf-8");
        } else {
            localFile = path.resolve(backupArg);
            if (!fs.existsSync(localFile)) {
                outError(chalk.red(`  ✗ Backup file not found: ${localFile}`));
                process.exit(1);
            }
            const globalsPath = globalsFileForDump(localFile);
            if (fs.existsSync(globalsPath)) globalsSql = fs.readFileSync(globalsPath, "utf-8");
        }

        // Version pre-flight. Check against the base connection — the server
        // version is identical for every database, and the target may not
        // exist yet when --create-db is used.
        const pf = await preflight("pg_restore", baseConnection);
        if (!pf.compatible) {
            outError(chalk.red(`  ✗ ${pf.reason}`));
            process.exit(1);
        }

        // `--create-db` needs a name before anything else can be decided.
        if (args["--create-db"] && !targetDb) {
            outError(chalk.red("  ✗ --create-db requires a resolvable target database name (use --target-db)."));
            process.exit(1);
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
        if (!args["--yes"]) {
            outWarn(chalk.yellow(
                `  ⚠️  This will restore into "${targetDb ?? "the target database"}" and may overwrite existing data.`
            ));
            const confirmed = await promptConfirm(chalk.yellow("     Type 'yes' to continue: "));
            if (!confirmed) {
                print(chalk.gray("  Aborted. No changes were made."));
                process.exit(1);
            }
        }

        // Create the target database when requested.
        if (args["--create-db"]) {
            const created = await ensureDatabaseExists(baseConnection, targetDb!);
            print(chalk.gray(created ? `  ✓ Created database "${targetDb}".` : `  • Database "${targetDb}" already exists.`));
        }

        // Recreate cluster roles before restoring so GRANT/RLS statements in
        // the dump apply. Best-effort and idempotent (see applyGlobals).
        if (globalsSql) {
            print(chalk.gray("  Recreating cluster roles from the backup's roles sidecar…"));
            const { applied, skipped } = await applyGlobals(
                targetConnection,
                globalsSql,
                (m) => print(chalk.gray(m))
            );
            print(chalk.gray(`  ✓ Roles: ${applied} applied, ${skipped} skipped (already present or not permitted).`));
        } else {
            outWarn(chalk.yellow("  ⚠️  No roles sidecar (.globals.sql) accompanies this backup."));
            outWarn(chalk.yellow("     If the dump grants to roles that don't exist (e.g. rebase_user), the restore"));
            outWarn(chalk.yellow("     will fail — recreate those roles first, or use a backup that includes its globals."));
        }

        await restoreDump({
            connectionString: targetConnection,
            inputFile: localFile,
            clean: args["--clean"],
            noOwner: args["--no-owner"],
            // Fail loudly by default so a skipped GRANT never leaves RLS off.
            exitOnError: !args["--continue-on-error"],
            inheritStdio: true
        });

        print("");
        print(chalk.green(`  ✓ Restore completed into "${targetDb ?? "the target database"}".`));
        print("");
    } catch (err) {
        reportError(err);
        process.exit(1);
    } finally {
        if (cleanupTemp && typeof localFile! === "string" && fs.existsSync(localFile!)) {
            fs.rmSync(path.dirname(localFile!), { recursive: true, force: true });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// rebase db backups list
// ─────────────────────────────────────────────────────────────────────────
export async function backupsCommand(rawArgs: string[]): Promise<void> {
    const action = rawArgs[2];
    if (!action || action === "--help") {
        printBackupsHelp();
        return;
    }
    if (action !== "list") {
        outError(chalk.red(`Unknown backups action: "${action}". Valid: list`));
        process.exit(1);
    }

    const args = arg({ "--out": String, "--output": "--out", "-o": "--out" }, { argv: rawArgs.slice(3), permissive: true });
    const out = args["--out"] || process.env.BACKUP_DESTINATION || path.join(process.cwd(), "backups");
    const dest = parseBackupDestination(out);

    try {
        const storage = await resolveStorageForDestination(dest, process.env);
        const backups = await listBackups(dest, storage ?? undefined);
        print("");
        if (backups.length === 0) {
            print(chalk.gray(`  No backups found at ${out}.`));
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

function reportError(err: unknown): void {
    if (err instanceof BackupToolError) {
        outError(chalk.red(`  ✗ ${err.message}`));
        if (err.hint) outError(chalk.gray(`    ${err.hint}`));
    } else {
        outError(chalk.red(`  ✗ ${err instanceof Error ? err.message : String(err)}`));
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
  requires an interactive 'yes'. Prefer --create-db/--target-db to restore
  into a fresh database rather than overwriting a live one.

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
