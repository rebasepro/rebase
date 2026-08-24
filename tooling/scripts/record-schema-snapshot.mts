/**
 * Record the current auth schema as an upgrade snapshot.
 *
 * `packages/server-postgres/test/e2e/upgrade-e2e.test.ts` restores every file in
 * `schema-snapshots/` and runs the current migrations over it. That suite is only
 * as good as the eras it has to upgrade *from*, and the two hand-written ones
 * cover history, not the future: the next one-way migration will be tested
 * against era 1 and against nothing since.
 *
 * So: on a release commit, before starting the next migration, record what this
 * release leaves behind.
 *
 *     node --import tsx tooling/scripts/record-schema-snapshot.mts --database-url <url>
 *
 * Point it at a database this release provisioned. CI makes two of them — the
 * `rebase_acceptance` database from the self-host step, and any of the e2e
 * containers — and a local `pnpm dev` database is just as valid. What matters is
 * that the schema came from a real boot, not from this script's idea of one.
 *
 * Timing is the easy thing to get wrong: a snapshot recorded *after* you write
 * the next migration records the shape you were trying to test against, and the
 * upgrade test then proves that a schema can be migrated to itself.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SNAPSHOT_DIR = path.join(ROOT, "packages/server-postgres/test/e2e/schema-snapshots");

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? undefined : args[index + 1];
};

const databaseUrl = flag("database-url") ?? process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error(
        "No database to record.\n\n" +
        "  node --import tsx tooling/scripts/record-schema-snapshot.mts --database-url postgres://…\n\n" +
        "Point it at a database provisioned by THIS release — the acceptance database, a\n" +
        "dev database, any real boot. See the header of this file for why that matters."
    );
    process.exit(1);
}

// ── Versions, so the file records what it came from ──────────────────────────
const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "packages/server-postgres/package.json"), "utf8")
) as { version: string };

const { AUTH_SCHEMA_VERSION } = await import(
    `${ROOT}/packages/server-postgres/src/auth/schema-version.ts`
) as { AUTH_SCHEMA_VERSION: number };

const outName = flag("out") ?? `recorded-v${pkg.version}-auth${AUTH_SCHEMA_VERSION}.sql`;
const outPath = path.join(SNAPSHOT_DIR, outName);

if (existsSync(outPath) && !args.includes("--force")) {
    console.error(
        `${path.relative(ROOT, outPath)} already exists.\n\n` +
        "Refusing to overwrite. A snapshot is a record of a schema that shipped — rewriting\n" +
        "it un-tests every upgrade path that ran through it. If this release really did\n" +
        "change shape after the first recording, bump the version or pass --out.\n" +
        "--force overrides, and is almost never what you want."
    );
    process.exit(1);
}

// ── Dump ─────────────────────────────────────────────────────────────────────
//
// Schema-only, `rebase` only: collection tables belong to `rebase db push` and
// vary per project, while the auth schema is the framework's own and the only
// part every deployment shares. Ownership and privilege lines are dropped
// because the snapshot is restored into a throwaway container whose roles are
// not the ones the source database had.
function pgDump(): string {
    const dumpArgs = [
        "--schema-only",
        "--schema=rebase",
        "--no-owner",
        "--no-privileges",
        "--no-tablespaces",
        "--no-comments",
        databaseUrl!
    ];

    // Prefer a dumper pinned to the server major the tests run against. A local
    // pg_dump older than the server refuses outright, and one that is newer can
    // emit syntax the test container cannot restore.
    const viaDocker = spawnSync(
        "docker",
        ["run", "--rm", "--network", "host", "postgres:18-alpine", "pg_dump", ...dumpArgs],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    if (viaDocker.status === 0) return viaDocker.stdout;

    console.warn(
        "⚠️  Dockerised pg_dump failed, falling back to the local one. " +
        "(On macOS, --network host does not reach the host; a local pg_dump is expected here.)"
    );
    const local = spawnSync("pg_dump", dumpArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (local.status !== 0) {
        console.error("pg_dump failed:\n" + (local.stderr || viaDocker.stderr || "(no output)"));
        process.exit(1);
    }
    return local.stdout;
}

// `SET` preambles and `SELECT pg_catalog.set_config` pin session state that the
// restoring client sets for itself; keeping them makes the diff between two
// snapshots mostly noise.
//
// `\restrict` / `\unrestrict` have to go for a different and less obvious
// reason. They are **psql meta-commands, not SQL** — pg_dump began wrapping its
// output in them so that a hostile search_path cannot hijack a restore — and
// `upgrade-e2e.test.ts` replays these files through `client.query()`, which
// speaks only SQL. A snapshot carrying them fails to restore with
// `syntax error at or near "\"`, and that is what has been silently stopping
// this script from producing a usable snapshot. The pair brackets the whole
// dump, outside any statement, so dropping the two lines leaves the recorded
// schema exactly as it was.
const KNOWN_META_COMMANDS = /^\\(restrict|unrestrict)\b/;

const dump = pgDump()
    .split("\n")
    .filter(line => !/^(SET |SELECT pg_catalog\.set_config|--)/.test(line))
    .filter(line => !KNOWN_META_COMMANDS.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Any other meta-command would fail the same way — but later, from a test whose
// message says "syntax error" and does not mention this file. Refuse now, with
// the offending line in hand, rather than committing a snapshot that cannot be
// restored. The check is deliberately narrow so a dollar-quoted function body
// containing a backslash is not mistaken for one.
const unknownMeta = dump.split("\n").filter(line => /^\\[a-z]+\b/i.test(line));
if (unknownMeta.length > 0) {
    console.error(
        "The dump contains psql meta-commands this script does not know how to strip:\n\n" +
        unknownMeta.map(line => `    ${line}`).join("\n") +
        "\n\nSnapshots are replayed through a plain SQL client, which cannot execute these.\n" +
        "Add them to KNOWN_META_COMMANDS once you have checked they are safe to drop."
    );
    process.exit(1);
}

if (!/CREATE TABLE/i.test(dump)) {
    console.error(
        "The dump contains no CREATE TABLE — the `rebase` schema is empty or absent.\n" +
        "This database was never booted against, so there is nothing to record."
    );
    process.exit(1);
}

// ── Seed ─────────────────────────────────────────────────────────────────────
//
// Appended rather than dumped. A snapshot with no rows exercises the DDL half of
// a migration and none of the back-fill, and the back-fill is the half that
// quietly signs every user out. Synthetic on purpose: a real dump would carry
// real emails and password hashes into the repository.
const stamp = outName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
const seed = `
-- ── Seed ─────────────────────────────────────────────────────────────────────
-- Synthetic, and required: see schema-snapshots/README.md. One user and two live
-- sessions on one device tuple, which is the shape every rotation migration has
-- to preserve.

INSERT INTO rebase.users (id, email, display_name, roles, email_verified)
VALUES ('user-${stamp}', 'recorded@${stamp}.test', 'Recorded User', ARRAY['admin'], TRUE);

-- session_started_at is set explicitly, and to the same instant as created_at,
-- because the column already exists in every era this script can record from —
-- it is added by the very migration that the older snapshots exist to test.
-- Leaving it to its DEFAULT now() would seed a row whose session apparently
-- began two days after its token was created, and upgrade-e2e.test.ts would
-- read that as the migration having back-filled from NOW(). Setting it turns
-- that assertion into the one worth making about a modern era: an existing
-- session start survives the upgrade untouched.
INSERT INTO rebase.refresh_tokens (uid, token_hash, expires_at, user_agent, ip_address, created_at, session_started_at)
VALUES
    ('user-${stamp}', '${stamp}-token-a', NOW() + INTERVAL '30 days',
     'Mozilla/5.0 (recorded)', '203.0.113.20', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
    ('user-${stamp}', '${stamp}-token-b', NOW() + INTERVAL '30 days',
     'Mozilla/5.0 (recorded)', '203.0.113.21', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '6 hours');
`;

const header = `-- ─────────────────────────────────────────────────────────────────────────────
-- Recorded snapshot — @rebasepro/server-postgres v${pkg.version}, auth schema version ${AUTH_SCHEMA_VERSION}.
--
-- Generated by tooling/scripts/record-schema-snapshot.mts from a database this release
-- provisioned. Do not hand-edit: it is a record of a schema that shipped, and
-- editing it to make a test pass un-tests every upgrade path through it.
-- ─────────────────────────────────────────────────────────────────────────────
`;

writeFileSync(outPath, `${header}\n${dump}\n${seed}`);

const total = readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith(".sql")).length;
console.log(
    `\n\x1b[32m✓\x1b[0m Recorded ${path.relative(ROOT, outPath)}\n` +
    `  ${total} snapshot(s) now in the upgrade matrix.\n\n` +
    `  Verify it restores and migrates before committing:\n` +
    `    pnpm --filter @rebasepro/server-postgres test:e2e upgrade\n`
);
