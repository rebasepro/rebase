/**
 * What `rebase db migrate --baseline <version>` does, given the history the
 * database already has.
 *
 * The flag promises to record `<version>` as applied and migrate from the next
 * one. Atlas's own `migrate apply --baseline` keeps that promise only on a
 * database with no revision history: once one row exists it ignores the flag
 * without a word, applies the migration anyway, and the CLI had already printed
 * "Recording … as already applied". That is the normal second time: a project
 * baselines once, then `rebase dev` adds a column at boot, `db generate` writes
 * the migration for it, and `db migrate` fails on `column … already exists
 * (42701)` however the baseline is spelled.
 *
 * So the history is read first. With none, Atlas's baseline does the work.
 * Behind `<version>`, `atlas migrate set` marks every migration up to it as
 * applied, which is what a baseline means. At or past it, there is nothing to
 * record, and the command says so instead of claiming it recorded something.
 */
import { withAppClient } from "../cli-helpers";

export type BaselinePlan =
    /** No history: `migrate apply --baseline <version>`, Atlas's own mechanism. */
    | { kind: "atlas-baseline" }
    /** History behind `<version>`: `migrate set <version>`, then a plain apply. */
    | { kind: "set"; latest: string }
    /** History at or past `<version>`: nothing to record, a plain apply. */
    | { kind: "already-recorded"; latest: string };

/**
 * Atlas's version order for the versions Rebase writes: numeric timestamps,
 * compared as numbers so a shorter one is not read as later; anything else as
 * text.
 */
export function compareMigrationVersions(a: string, b: string): number {
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
        const x = BigInt(a);
        const y = BigInt(b);
        return x === y ? 0 : x < y ? -1 : 1;
    }
    return a.localeCompare(b);
}

/**
 * The version Atlas records for a migration file: its numeric prefix
 * (`20260906101530_init.sql` → `20260906101530`), or the name without `.sql`.
 */
export function migrationVersionOf(file: string): string {
    return /^(\d+)/.exec(file)?.[1] ?? file.replace(/\.sql$/, "");
}

/** How many versions a refused baseline names, newest last. */
const VERSIONS_NAMED = 5;

/**
 * Why `--baseline <version>` cannot run, or `null` when it names a migration
 * file in `drizzle/migrations`.
 *
 * Asked before anything else, the database included. A version no file has
 * was refused only by Atlas, after the command had said "Marking every
 * migration up to abc as applied…"; and one older than every file read
 * "Nothing to record" and migrated on, though it named nothing to baseline.
 *
 * @param files the migration files, sorted oldest first.
 * @returns the refusal, its first line the error and the rest the detail.
 */
export function baselineVersionProblem(version: string, files: readonly string[]): string | null {
    const versions = files.map(migrationVersionOf);
    if (versions.length === 0) {
        return `--baseline ${version}: There are no migrations in drizzle/migrations to baseline. Nothing was run.\n` +
            "Run `rebase db generate` to write the first one.";
    }
    if (versions.includes(version)) return null;
    const named = versions.slice(-VERSIONS_NAMED).join(", ");
    const which = versions.length > VERSIONS_NAMED
        ? `The newest ${VERSIONS_NAMED} of the ${versions.length} versions there`
        : "The versions there";
    return `--baseline ${version} names no migration in drizzle/migrations. Nothing was run.\n` +
        `${which}: ${named}. A baseline is one of them: the newest migration the database already holds.`;
}

/** How to keep `--baseline <version>`'s promise, given the newest recorded version. */
export function planBaseline(version: string, latestRecorded: string | null): BaselinePlan {
    if (latestRecorded === null) return { kind: "atlas-baseline" };
    if (compareMigrationVersions(version, latestRecorded) > 0) return { kind: "set", latest: latestRecorded };
    return { kind: "already-recorded", latest: latestRecorded };
}

/** What the command says before it migrates, for each plan. */
export function describeBaselinePlan(version: string, plan: BaselinePlan): string {
    switch (plan.kind) {
        case "atlas-baseline":
            return `Recording ${version} as already applied, then migrating from the next one.`;
        case "set":
            return `This database already records migrations up to ${plan.latest}, and Atlas applies --baseline only ` +
                `to a database with none.\n  Marking every migration up to ${version} as applied with \`atlas migrate set\`, ` +
                "then migrating from the next one.";
        case "already-recorded":
            return `Nothing to record: this database already records migrations up to ${plan.latest}, which ` +
                `includes ${version}.\n  Migrating from the next one.`;
    }
}

/**
 * The newest version Atlas has recorded on this database, or `null` when it
 * has recorded none (no revisions table yet included).
 *
 * The table is `rebase.atlas_schema_revisions`: the CLI passes
 * `--revisions-schema rebase` to every `migrate apply`.
 */
export async function latestRecordedMigration(databaseUrl: string): Promise<string | null> {
    return withAppClient(databaseUrl, async (client) => {
        const exists = await client.query<{ present: boolean }>(
            "SELECT to_regclass('rebase.atlas_schema_revisions') IS NOT NULL AS present"
        );
        if (!exists.rows[0]?.present) return null;
        const rows = await client.query<{ version: string }>(
            "SELECT version FROM rebase.atlas_schema_revisions WHERE version NOT LIKE '.%'"
        );
        const versions = rows.rows.map(row => row.version);
        if (versions.length === 0) return null;
        return versions.reduce((latest, version) => (compareMigrationVersions(version, latest) > 0 ? version : latest));
    });
}
