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
import { logger } from "@rebasepro/server-core";
import type { StorageController } from "@rebasepro/server-core";
import {
    BackupDestination,
    parseBackupDestination,
    parseDbNameFromUrl,
    resolveConnectionString,
    withDatabaseName
} from "./pg-tools";
import {
    BackupToolError,
    createDump,
    ensureDatabaseExists,
    listBackups,
    preflight,
    restoreDump,
    uploadBackup
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
        const { GCSStorageController } = await import("@rebasepro/server-core");
        return new GCSStorageController({ type: "gcs", bucket: dest.bucket });
    }
    // s3 (also covers R2/MinIO/Hetzner/GCS-interop via S3_ENDPOINT)
    if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
        throw new BackupToolError(
            "S3 destination requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in the environment.",
            "Set the same S3_* variables your backend uses for storage."
        );
    }
    const { S3StorageController } = await import("@rebasepro/server-core");
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
        logger.error(chalk.red("✗ DATABASE_URL is not set. Make sure your .env file is configured."));
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
            "--exclude-schema": [String],
            "--no-owner": Boolean,
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

    logger.info("");
    logger.info(chalk.bold("  💾 Rebase DB Backup"));
    logger.info(chalk.gray(`  Database:    ${dbName}`));
    logger.info(chalk.gray(`  Destination: ${out}`));
    logger.info("");

    // Version pre-flight (doctor-style).
    const pf = await preflight("pg_dump", connectionString);
    if (!pf.compatible) {
        logger.error(chalk.red(`  ✗ ${pf.reason}`));
        process.exit(1);
    }
    logger.info(chalk.gray(`  Using pg_dump ${pf.toolMajor} against server ${pf.serverMajor}.`));

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
                inheritStdio: true
            });
            logger.info("");
            logger.info(chalk.green(`  ✓ Backup written to ${dump.localFile} (${formatBytes(dump.sizeBytes)})`));
        } else {
            const storage = await resolveStorageForDestination(dest, process.env);
            const dump = await createDump({
                connectionString,
                dbName,
                excludeSchemas: args["--exclude-schema"],
                noOwner: args["--no-owner"],
                inheritStdio: true
            });
            try {
                const uploaded = await uploadBackup(storage!, dump.localFile, dest);
                logger.info("");
                logger.info(chalk.green(`  ✓ Backup uploaded to ${uploaded.storageUrl} (${formatBytes(dump.sizeBytes)})`));
                logger.info(chalk.gray("    Ensure this bucket is private — backups may contain secrets and PII."));
            } finally {
                if (fs.existsSync(dump.localFile)) fs.unlinkSync(dump.localFile);
            }
        }
        logger.info("");
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

    logger.info("");
    logger.info(chalk.bold("  ♻️  Rebase DB Restore"));
    logger.info(chalk.gray(`  Source:  ${backupArg}`));
    logger.info(chalk.gray(`  Target:  ${targetDb ?? "(from DATABASE_URL)"}`));
    logger.info("");

    // Resolve the local file to restore from (download object-storage keys).
    let localFile: string;
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
        } else {
            localFile = path.resolve(backupArg);
            if (!fs.existsSync(localFile)) {
                logger.error(chalk.red(`  ✗ Backup file not found: ${localFile}`));
                process.exit(1);
            }
        }

        // Version pre-flight. Check against the base connection — the server
        // version is identical for every database, and the target may not
        // exist yet when --create-db is used.
        const pf = await preflight("pg_restore", baseConnection);
        if (!pf.compatible) {
            logger.error(chalk.red(`  ✗ ${pf.reason}`));
            process.exit(1);
        }

        // Create the target database when requested.
        if (args["--create-db"]) {
            if (!targetDb) {
                logger.error(chalk.red("  ✗ --create-db requires a resolvable target database name (use --target-db)."));
                process.exit(1);
            }
            const created = await ensureDatabaseExists(baseConnection, targetDb);
            logger.info(chalk.gray(created ? `  ✓ Created database "${targetDb}".` : `  • Database "${targetDb}" already exists.`));
        }

        // Destructive-action gate. Restores overwrite data; never run without
        // an explicit yes (interactive confirmation or --yes).
        if (!args["--yes"]) {
            logger.warn(chalk.yellow(
                `  ⚠️  This will restore into "${targetDb ?? "the target database"}" and may overwrite existing data.`
            ));
            const confirmed = await promptConfirm(chalk.yellow("     Type 'yes' to continue: "));
            if (!confirmed) {
                logger.info(chalk.gray("  Aborted. No changes were made."));
                process.exit(1);
            }
        }

        await restoreDump({
            connectionString: targetConnection,
            inputFile: localFile,
            clean: args["--clean"],
            noOwner: args["--no-owner"],
            inheritStdio: true
        });

        logger.info("");
        logger.info(chalk.green(`  ✓ Restore completed into "${targetDb ?? "the target database"}".`));
        logger.info("");
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
        logger.error(chalk.red(`Unknown backups action: "${action}". Valid: list`));
        process.exit(1);
    }

    const args = arg({ "--out": String, "-o": "--out" }, { argv: rawArgs.slice(3), permissive: true });
    const out = args["--out"] || process.env.BACKUP_DESTINATION || path.join(process.cwd(), "backups");
    const dest = parseBackupDestination(out);

    try {
        const storage = await resolveStorageForDestination(dest, process.env);
        const backups = await listBackups(dest, storage ?? undefined);
        logger.info("");
        if (backups.length === 0) {
            logger.info(chalk.gray(`  No backups found at ${out}.`));
        } else {
            logger.info(chalk.bold(`  💾 ${backups.length} backup(s) at ${out}:`));
            logger.info("");
            for (const b of backups) {
                const when = b.createdAt ? b.createdAt.toISOString() : "unknown date";
                const name = dest.kind === "local" ? path.basename(b.key) : b.key;
                logger.info(`  ${chalk.green("●")} ${chalk.bold(name)} ${chalk.gray(`— ${when}`)}`);
            }
        }
        logger.info("");
    } catch (err) {
        reportError(err);
        process.exit(1);
    }
}

function reportError(err: unknown): void {
    if (err instanceof BackupToolError) {
        logger.error(chalk.red(`  ✗ ${err.message}`));
        if (err.hint) logger.error(chalk.gray(`    ${err.hint}`));
    } else {
        logger.error(chalk.red(`  ✗ ${err instanceof Error ? err.message : String(err)}`));
    }
}

function printBackupHelp(): void {
    logger.info(`
${chalk.bold("rebase db backup")} — Create a database backup (pg_dump, custom format)

${chalk.green.bold("Usage")}
  rebase db backup [--out <path|s3://bucket/prefix>] [options]

${chalk.green.bold("Options")}
  ${chalk.blue("--out, -o")} <dest>        Local path or s3://…/gs://… URL (default: ./backups)
  ${chalk.blue("--exclude-schema")} <s>    Exclude a schema (repeatable)
  ${chalk.blue("--no-owner")}              Omit ownership commands from the dump

${chalk.green.bold("Notes")}
  Backups may contain secrets and PII. Use private storage destinations and
  enable encryption-at-rest. See docs/backups.md.
`);
}

function printRestoreHelp(): void {
    logger.info(`
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
  ${chalk.blue("--yes, -y")}               Skip the interactive confirmation ${chalk.red("(destructive!)")}

${chalk.red.bold("Warning")}
  Restore is destructive and never runs automatically. Without --yes it
  requires an interactive 'yes'. Prefer --create-db/--target-db to restore
  into a fresh database rather than overwriting a live one.
`);
}

function printBackupsHelp(): void {
    logger.info(`
${chalk.bold("rebase db backups")} — Manage stored backups

${chalk.green.bold("Usage")}
  rebase db backups list [--out <path|s3://bucket/prefix>]
`);
}
