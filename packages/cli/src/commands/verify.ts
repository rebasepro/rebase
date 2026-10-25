/**
 * CLI command: rebase verify
 *
 * One command that says whether the collections are safe to ship, fast enough
 * to run after every edit. An agent writing `config/collections/*.ts` gets three
 * things wrong more than anything else — an option that does not exist, a UI
 * widget outside `admin: { … }`, and no `securityRules` — and every one of them
 * used to surface late: at boot, in review, or never. The project's Claude Code
 * hook (`.claude/hooks/post-edit-collection.sh`, written by `rebase init` and
 * `rebase skills --hooks`) runs this after each edit to a collection file, and
 * CI runs it on every push.
 *
 * Four steps, each reported on its own:
 *
 * 1. **Collection config** — every file under `config/collections/` loads and
 *    passes `findCollectionConfigProblems` with unknown keys as errors: the same
 *    validator the backend runs at boot, at its strictest.
 * 2. **RLS coverage** — a collection that declares no `securityRules` and
 *    inherits none, or one with a `user_id` / `owner_id` / `organization_id` /
 *    `tenant_id` column that leans on directory defaults instead of its own
 *    rules; and a rule that lets a role read every row of such a table.
 * 3. **Migration freshness** — whether `drizzle/migrations` still builds the
 *    tables and columns the collections declare (offline), and with `--live`
 *    whether the database has applied every migration.
 * 4. **Live RLS audit** — with `--live` and a reachable `DATABASE_URL`, the
 *    `@rebasepro/rls-check` catalogue against the database itself.
 *
 * `--json` prints one object an agent can act on: every finding carries the
 * file, the dotted path into the config and the fix.
 */
import chalk from "chalk";
import fs from "fs";
import path from "path";
import {
    isFirebaseCollectionConfig,
    isRelationalCollectionConfig,
    type CollectionConfig,
    type Property,
    type SecurityRule
} from "@rebasepro/types";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import { failAsJson, findBackendDir, getActiveBackendPlugin, readEnvFile, requireProjectRoot } from "../utils/project";
import { COLLECTIONS_FLAG_HELP, missingCollectionsPath } from "../utils/path-flags";
import { isLoadedCollectionFile } from "../utils/collection-drift";

/** The flags `rebase verify` takes. */
export const VERIFY_FLAGS = {
    "--collections": String,
    "-c": "--collections",
    "--json": Boolean,
    "--quiet": Boolean,
    "-q": "--quiet",
    "--live": Boolean
} as const;

const VERIFY_FLAG_HELP: Record<string, string> = {
    "--collections, -c": COLLECTIONS_FLAG_HELP,
    "--json": "Print one JSON object: every step, and every finding with its file, path and fix",
    "--quiet, -q": "Print nothing when everything passes; only the problems when something fails",
    "--live": "Also connect to DATABASE_URL: check migrations are applied and run the rls-check audit"
};

export type VerifyStepId = "config" | "rls" | "migrations" | "live";

export interface VerifyFinding {
    step: VerifyStepId;
    /** Stable, kebab-case: what kind of problem. An agent can branch on it. */
    check: string;
    severity: "error" | "warning";
    message: string;
    /** What to change, when there is one thing to change. */
    fix?: string;
    /** The collection's slug. */
    collection?: string;
    /** The file to open, relative to the project root. */
    file?: string;
    /** Dotted path into the collection config — `posts.properties.title.widget`. */
    path?: string;
}

export interface VerifyStep {
    id: VerifyStepId;
    title: string;
    status: "passed" | "failed" | "warnings" | "skipped";
    /** Why a step was skipped, or what it covered. */
    detail?: string;
}

export interface VerifyReport {
    ok: boolean;
    /** Relative to the project root. */
    collectionsDir: string;
    steps: VerifyStep[];
    findings: VerifyFinding[];
    summary: { errors: number; warnings: number };
}

export interface VerifyOptions {
    projectRoot: string;
    collectionsDir: string;
    /** The backend package, where `drizzle/migrations` lives. Null for a project without one. */
    backendDir: string | null;
    live: boolean;
    databaseUrl?: string;
    /** Why no `databaseUrl` could be resolved for `--live`, when resolving it failed. */
    databaseUnavailable?: string;
}

const STEP_TITLES: Record<VerifyStepId, string> = {
    config: "Collection config",
    rls: "RLS coverage",
    migrations: "Migration freshness",
    live: "Live RLS audit"
};

/**
 * Columns that say "this row belongs to someone". A table carrying one and
 * served without a row filter is the classic multi-tenant leak.
 */
const OWNER_COLUMNS: readonly string[] = ["user_id", "owner_id", "organization_id", "tenant_id"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** What a collection file must default-export to be loaded as one. */
function isCollection(value: unknown): value is CollectionConfig {
    return isRecord(value) && typeof value.slug === "string" && isRecord(value.properties);
}

/** `organizationId` → `organization_id`, as the generator derives a column from a key. */
function snake(key: string): string {
    return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase();
}

// ─── Loading ──────────────────────────────────────────────────────────────────

interface LoadedCollections {
    collections: CollectionConfig[];
    /** Parallel to `collections`: the file each one came from, relative to the project root. */
    sources: string[];
    /** Each collection's `securityRules` as its file declares them, before directory defaults. */
    ownRules: (readonly SecurityRule[] | undefined)[];
    /** `defaultSecurityRules` from the directory's `index.ts`. */
    defaults: readonly SecurityRule[] | undefined;
    defaultsFile?: string;
    failures: VerifyFinding[];
}

/**
 * Load the collections the way the backend finds them: every top-level file
 * the loader reads (`isLoadedCollectionFile`), each default-exporting one
 * collection, plus `defaultSecurityRules` from the directory's `index.ts`.
 *
 * Through jiti, with its caches off: the CLI is plain Node and the files are
 * TypeScript, and a verifier that answered from the previous edit's module
 * would be worse than none. A file that does not load is a finding, not a
 * crash — after an agent's edit it is the most likely problem of all.
 */
async function loadCollectionFiles(projectRoot: string, collectionsDir: string): Promise<LoadedCollections> {
    const { createJiti } = await import("jiti");
    const jiti = createJiti(path.join(collectionsDir, "index.ts"), {
        interopDefault: true,
        moduleCache: false,
        fsCache: false
    });
    const relative = (file: string) => path.relative(projectRoot, file);

    const loaded: LoadedCollections = { collections: [], sources: [], ownRules: [], defaults: undefined, failures: [] };

    for (const name of fs.readdirSync(collectionsDir).filter(isLoadedCollectionFile).sort()) {
        const file = path.join(collectionsDir, name);
        try {
            const exported = await jiti.import<unknown>(file, { default: true });
            if (!isCollection(exported)) {
                loaded.failures.push({
                    step: "config",
                    check: "config-no-collection",
                    severity: "error",
                    file: relative(file),
                    message: `${name} does not default-export a collection (an object with a \`slug\` and \`properties\`).`,
                    fix: "End the file with `export default defineCollection({ slug, name, properties, … })` — the backend refuses to boot on a collection file that exports anything else."
                });
                continue;
            }
            loaded.collections.push(exported);
            loaded.sources.push(relative(file));
            loaded.ownRules.push(exported.securityRules);
        } catch (error) {
            loaded.failures.push({
                step: "config",
                check: "config-load",
                severity: "error",
                file: relative(file),
                message: `${name} does not load: ${error instanceof Error ? error.message : String(error)}`,
                fix: "Fix the syntax or import error. The backend refuses to boot on the same file."
            });
        }
    }

    for (const index of ["index.ts", "index.js"]) {
        const file = path.join(collectionsDir, index);
        if (!fs.existsSync(file)) continue;
        try {
            const mod = await jiti.import<unknown>(file);
            const rules = isRecord(mod) ? mod.defaultSecurityRules : undefined;
            if (Array.isArray(rules)) {
                loaded.defaults = rules;
                loaded.defaultsFile = relative(file);
            }
        } catch (error) {
            loaded.failures.push({
                step: "config",
                check: "config-load",
                severity: "error",
                file: relative(file),
                message: `${index} does not load: ${error instanceof Error ? error.message : String(error)}`,
                fix: "Fix the file, or delete it if the project declares no `defaultSecurityRules`. The backend refuses to boot without reading it."
            });
        }
        break;
    }

    return loaded;
}

// ─── Step 1: collection config ────────────────────────────────────────────────

async function checkConfig(loaded: LoadedCollections): Promise<VerifyFinding[]> {
    const { findCollectionConfigProblems } = await import("@rebasepro/server");
    const fileBySlug = new Map(loaded.collections.map((c, i) => [c.slug, loaded.sources[i]]));
    const problems = findCollectionConfigProblems(loaded.collections, {
        unknownKeys: "error",
        sources: loaded.sources
    });
    return problems.map((problem): VerifyFinding => {
        const slug = problem.path.split(".")[0];
        const file = fileBySlug.get(slug);
        return {
            step: "config",
            check: problem.kind === "key" ? "config-key" : "config-incoherent",
            severity: problem.severity,
            message: problem.message,
            path: problem.path,
            ...(fileBySlug.has(slug) && { collection: slug }),
            ...(file && { file })
        };
    });
}

// ─── Step 2: RLS coverage ─────────────────────────────────────────────────────

/** An owner-ish column a collection's table carries, and the property that declares it. */
interface OwnerColumn {
    column: string;
    key: string;
}

/** The owner-ish columns a collection's table carries: plain columns and `belongsTo` keys. */
function ownerColumnsOf(collection: CollectionConfig): OwnerColumn[] {
    const found: OwnerColumn[] = [];
    const consider = (column: string, key: string) => {
        if (OWNER_COLUMNS.includes(column)) found.push({ column, key });
    };
    for (const [key, property] of Object.entries<Property>(collection.properties ?? {})) {
        if (!isRecord(property)) continue;
        if (property.type === "relation") {
            const relation = property.relation;
            if (isRecord(relation) && relation.kind === "belongsTo") {
                const singular = /[^s]s$/.test(key) ? key.slice(0, -1) : key;
                consider(typeof relation.localKey === "string" ? relation.localKey : `${snake(singular)}_id`, key);
            }
            continue;
        }
        consider(typeof property.columnName === "string" ? property.columnName : snake(key), key);
    }
    return found;
}

/** Whether a rule applies to reads. */
function coversSelect(rule: SecurityRule): boolean {
    const operations = rule.operations ?? [rule.operation ?? "all"];
    return operations.includes("select") || operations.includes("all");
}

/**
 * A permissive read rule with no row filter: every row, to everyone the rule
 * names. `access: "public"` is the same thing said on purpose, so it is not
 * this; `roles: ["admin"]` restates the default admin read and adds nothing.
 */
function isUnfilteredRead(rule: SecurityRule): boolean {
    if (!coversSelect(rule) || rule.mode === "restrictive") return false;
    if (rule.access === "public" || rule.ownerField || rule.condition) return false;
    if (rule.using !== undefined && !/^\s*\(?\s*true\s*\)?\s*$/i.test(rule.using)) return false;
    // A write-only check (`withCheck` with no `using`) filters nothing on read,
    // and it is not a read rule either.
    if (rule.using === undefined && rule.withCheck !== undefined) return false;
    const roles = rule.roles ?? [];
    return !(roles.length > 0 && roles.every(role => role === "admin"));
}

/** A read rule that returns every row to someone: an unfiltered one, or `access: "public"`. */
function opensEveryRow(rule: SecurityRule): boolean {
    return isUnfilteredRead(rule) || (rule.access === "public" && coversSelect(rule) && rule.mode !== "restrictive");
}

function describeRuleTarget(rule: Pick<SecurityRule, "roles">): string {
    return rule.roles?.length ? `role${rule.roles.length > 1 ? "s" : ""} ${rule.roles.map(r => `"${r}"`).join(", ")}` : "every signed-in user";
}

function checkRls(loaded: LoadedCollections): VerifyFinding[] {
    const findings: VerifyFinding[] = [];
    loaded.collections.forEach((collection, i) => {
        // Firestore does not implement `securityRules` at all — its own rules
        // language governs it, and nothing here can say anything about that.
        if (isFirebaseCollectionConfig(collection)) return;

        const slug = collection.slug;
        const file = loaded.sources[i];
        const own = loaded.ownRules[i] ?? [];
        const owners = ownerColumnsOf(collection);
        const tenantScoped = isRelationalCollectionConfig(collection) && isRecord(collection.tenant);
        const ownerField = owners[0]?.column ?? "user_id";

        if (own.length === 0) {
            // An auth collection gets a self-read policy and an admin-only write
            // gate from the framework; it is never served unfiltered.
            if (collection.auth) return;

            if (owners.length > 0 && !tenantScoped) {
                const perUser = ownerField === "user_id" || ownerField === "owner_id";
                const fix = perUser
                    ? `Add \`securityRules: [{ operation: "all", ownerField: "${ownerField}" }]\` so each user reaches only their own rows. ` +
                        "A table meant to be readable by everyone says so: `{ operation: \"select\", access: \"public\" }`."
                    : `Scope it with \`tenant: { field: "${owners[0].key}", from: { claim: "${ownerField}" } }\` (the claim that carries the caller's tenant), ` +
                        "plus the `securityRules` that grant access inside a tenant — e.g. `[{ operation: \"select\", access: \"public\" }]`.";
                const inherited = loaded.defaults ?? [];
                if (inherited.length === 0) {
                    findings.push({
                        step: "rls",
                        check: "rls-missing",
                        severity: "error",
                        collection: slug,
                        file,
                        path: `${slug}.securityRules`,
                        message: `"${slug}" has a \`${ownerField}\` column but declares no \`securityRules\`, and inherits none: nothing says which rows belong to whom (by default only admins can read or write it).`,
                        fix
                    });
                } else if (inherited.some(opensEveryRow)) {
                    // Directory defaults are written for every table. On a
                    // tenant column, inheriting an all-rows read is the
                    // cross-tenant leak; on a per-user column it is often a
                    // public profile or author list, so it is said, not failed.
                    findings.push({
                        step: "rls",
                        check: perUser ? "rls-inherited-read" : "rls-missing",
                        severity: perUser ? "warning" : "error",
                        collection: slug,
                        file,
                        path: `${slug}.securityRules`,
                        message: `"${slug}" has a \`${ownerField}\` column but declares no \`securityRules\` of its own, so it inherits \`defaultSecurityRules\` from ${loaded.defaultsFile}, which let ${describeRuleTarget(inherited.find(opensEveryRow) ?? {})} read every row regardless of \`${ownerField}\`.`,
                        fix
                    });
                }
                return;
            }

            if (!loaded.defaults?.length) {
                findings.push({
                    step: "rls",
                    check: "rls-missing",
                    severity: "error",
                    collection: slug,
                    file,
                    path: `${slug}.securityRules`,
                    message: `"${slug}" declares no \`securityRules\` and inherits none, so nothing says who may read or write it (by default only admins can).`,
                    fix: "Declare its access: `securityRules: [{ operation: \"select\", access: \"public\" }, { operations: [\"insert\", \"update\", \"delete\"], roles: [\"admin\"] }]` " +
                        "for a public table, `{ operation: \"all\", ownerField: \"user_id\" }` for per-user rows, " +
                        "or `{ operation: \"all\", roles: [\"admin\"] }` to keep it admin-only on purpose."
                });
            }
            return;
        }

        if (owners.length === 0 || tenantScoped) return;
        own.forEach((rule, index) => {
            if (!isUnfilteredRead(rule)) return;
            findings.push({
                step: "rls",
                check: "rls-unfiltered-read",
                severity: "warning",
                collection: slug,
                file,
                path: `${slug}.securityRules[${index}]`,
                message: `"${slug}" has a \`${ownerField}\` column, and securityRules[${index}] lets ${describeRuleTarget(rule)} read every row of it with no row filter.`,
                fix: `Filter the rule — \`ownerField: "${ownerField}"\` or a \`condition\` — or, if every row really is meant for ${describeRuleTarget(rule)}, keep it and ignore this warning.`
            });
        });
    });
    return findings;
}

// ─── Step 3: migration freshness ──────────────────────────────────────────────

const POSTGRES_PLUGIN = "@rebasepro/server-postgres";

/** `20260906101530_init.sql` → `20260906101530`, the version Atlas records. */
function migrationVersion(file: string): string {
    return file.split("_")[0];
}

async function checkMigrations(
    options: VerifyOptions,
    loaded: LoadedCollections,
    step: VerifyStep
): Promise<VerifyFinding[]> {
    const skip = (detail: string): VerifyFinding[] => {
        step.status = "skipped";
        step.detail = detail;
        return [];
    };
    if (!options.backendDir) return skip("no backend/ directory");
    const plugin = getActiveBackendPlugin(options.backendDir);
    if (plugin !== POSTGRES_PLUGIN) {
        return skip(`migrations are checked for ${POSTGRES_PLUGIN} projects${plugin ? `; this one uses ${plugin}` : ""}`);
    }
    const migrationsDir = path.join(options.backendDir, "drizzle", "migrations");
    const files = fs.existsSync(migrationsDir)
        ? fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort()
        : [];
    if (files.length === 0) {
        return skip("no migrations yet — the schema is applied with `rebase db push`; `rebase db generate` starts versioned migrations");
    }

    const relativeDir = path.relative(options.projectRoot, migrationsDir);
    const { findUnmigratedSchema } = await import("@rebasepro/server-postgres");
    const findings: VerifyFinding[] = [];
    const fix = "Run `rebase db generate` to write the migration, then `rebase db migrate` to apply it.";
    const fileBySlug = new Map(loaded.collections.map((c, i) => [c.slug, loaded.sources[i]]));

    let changes: ReturnType<typeof findUnmigratedSchema>;
    try {
        changes = findUnmigratedSchema(
            loaded.collections,
            files.map(f => fs.readFileSync(path.join(migrationsDir, f), "utf-8"))
        );
    } catch (error) {
        return [{
            step: "migrations",
            check: "migration-plan",
            severity: "error",
            message: `Could not derive the schema from the collections: ${error instanceof Error ? error.message : String(error)}`,
            fix: "`rebase schema generate` reports the same problem with more context."
        }];
    }

    for (const change of changes) {
        const where = change.column ? `${change.table}.${change.column}` : change.table;
        const message = change.kind === "missing-table"
            ? `Table ${where} is declared by the collections but no migration in ${relativeDir} creates it.`
            : change.kind === "missing-column"
                ? `Column ${where} is declared by the collections but no migration in ${relativeDir} adds it.`
                : `Column ${where} is no longer declared by the collections, but the migrations in ${relativeDir} still create it.`;
        const file = change.slug ? fileBySlug.get(change.slug) : undefined;
        findings.push({
            step: "migrations",
            check: change.kind === "removed-column" ? "migration-stale-column" : "migration-missing",
            severity: "error",
            message,
            fix,
            ...(change.slug && { collection: change.slug }),
            ...(file && { file })
        });
    }

    step.detail = `${files.length} migration${files.length === 1 ? "" : "s"} in ${relativeDir}`;

    if (options.live && options.databaseUrl) {
        findings.push(...await checkAppliedMigrations(options.databaseUrl, files));
    }
    return findings;
}

/** Which migration files the database has not run, from Atlas's revision table. */
async function checkAppliedMigrations(databaseUrl: string, files: string[]): Promise<VerifyFinding[]> {
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
    try {
        await client.connect();
        const present = await client.query<{ present: boolean }>(
            "SELECT to_regclass('rebase.atlas_schema_revisions') IS NOT NULL AS present"
        );
        if (!present.rows[0]?.present) {
            return [{
                step: "migrations",
                check: "migration-unapplied",
                severity: "warning",
                message: "The database has no migration history (rebase.atlas_schema_revisions) — it was provisioned with `rebase db push`, or never migrated.",
                fix: "`rebase db migrate --baseline <version>` adopts an existing database; `rebase db migrate` applies the migrations to a new one."
            }];
        }
        const applied = await client.query<{ version: string }>(
            "SELECT version FROM rebase.atlas_schema_revisions WHERE error IS NULL OR error = ''"
        );
        const done = new Set(applied.rows.map(row => row.version));
        const pending = files.filter(f => !done.has(migrationVersion(f)));
        if (pending.length === 0) return [];
        return [{
            step: "migrations",
            check: "migration-unapplied",
            severity: "error",
            message: `${pending.length} migration${pending.length === 1 ? " has" : "s have"} not been applied to the database: ${pending.join(", ")}.`,
            fix: "Run `rebase db migrate`."
        }];
    } catch (error) {
        return [{
            step: "migrations",
            check: "migration-unapplied",
            severity: "warning",
            message: `Could not read the database's migration history: ${error instanceof Error ? error.message : String(error)}`
        }];
    } finally {
        await client.end().catch(() => undefined);
    }
}

// ─── Step 4: live RLS audit ───────────────────────────────────────────────────

/** rls-check's severities, folded onto this command's two. `info` is not reported. */
function liveSeverity(severity: string): VerifyFinding["severity"] | null {
    if (severity === "critical" || severity === "high") return "error";
    if (severity === "medium" || severity === "low") return "warning";
    return null;
}

/**
 * Why the database `--live` was pointed at cannot be opened, or `null` when it
 * can. Asked once, before the live steps, so an unreachable database is one
 * error rather than a skipped audit and a migration warning: under `--live`
 * the audit was asked for, and a CI run in which it never ran is not green.
 */
async function databaseUnreachable(databaseUrl: string): Promise<string | null> {
    const pg = await import("pg");
    const client = new pg.default.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
    try {
        await client.connect();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    } finally {
        await client.end().catch(() => undefined);
    }
}

async function checkLive(databaseUrl: string, step: VerifyStep): Promise<VerifyFinding[]> {
    const { scan, CHECKS } = await import("@rebasepro/rls-check");
    let result: Awaited<ReturnType<typeof scan>>;
    try {
        result = await scan({ connectionString: databaseUrl, statementTimeoutMs: 10_000 });
    } catch (error) {
        step.detail = "the audit did not run";
        return [{
            step: "live",
            check: "live-scan-failed",
            severity: "error",
            message: `The live RLS audit failed: ${error instanceof Error ? error.message : String(error)}`,
            fix: "`npx @rebasepro/rls-check <database-url>` runs the same audit on its own and reports the failure in full."
        }];
    }
    step.detail = `${CHECKS.length} rls-check checks against ${result.database.host}/${result.database.name}`;

    const findings: VerifyFinding[] = [];
    for (const finding of result.findings) {
        const severity = liveSeverity(finding.severity);
        if (!severity) continue;
        findings.push({
            step: "live",
            check: finding.id,
            severity,
            message: finding.title,
            ...(finding.fix && { fix: finding.fix }),
            path: finding.target.table ? `${finding.target.schema}.${finding.target.table}` : finding.target.schema
        });
    }
    for (const degraded of result.diagnostics.degraded) {
        findings.push({
            step: "live",
            check: "rls-check-degraded",
            severity: "warning",
            message: `The audit could not read ${degraded.what}: ${degraded.error}. A clean result does not cover it.`
        });
    }
    return findings;
}

// ─── The run ──────────────────────────────────────────────────────────────────

function settle(step: VerifyStep, findings: VerifyFinding[]): VerifyStep {
    if (step.status === "skipped") return step;
    const mine = findings.filter(f => f.step === step.id);
    step.status = mine.some(f => f.severity === "error") ? "failed" : mine.length > 0 ? "warnings" : "passed";
    return step;
}

/**
 * Run every step and return the report. Prints nothing and never exits, so a
 * caller — the command, a test — decides what to do with it.
 */
export async function runVerify(options: VerifyOptions): Promise<VerifyReport> {
    const findings: VerifyFinding[] = [];
    const steps: VerifyStep[] = (["config", "rls", "migrations", "live"] as const).map(id => ({
        id,
        title: STEP_TITLES[id],
        status: "passed"
    }));
    const [configStep, rlsStep, migrationsStep, liveStep] = steps;
    const collectionsDir = path.relative(options.projectRoot, options.collectionsDir) || ".";

    if (!fs.existsSync(options.collectionsDir) || !fs.statSync(options.collectionsDir).isDirectory()) {
        for (const step of steps) {
            step.status = "skipped";
            step.detail = `no collections directory at ${collectionsDir}`;
        }
        return { ok: true, collectionsDir, steps, findings, summary: { errors: 0, warnings: 0 } };
    }

    const loaded = await loadCollectionFiles(options.projectRoot, options.collectionsDir);
    findings.push(...loaded.failures);

    if (loaded.collections.length > 0) {
        findings.push(...await checkConfig(loaded));
    }
    const counted = `${loaded.collections.length} collection${loaded.collections.length === 1 ? "" : "s"}`;
    configStep.detail = `${counted}, unknown keys are errors`;
    rlsStep.detail = counted;

    // Directory defaults reach a collection the way the loader applies them, so
    // the migration step plans the same policies the backend would.
    if (loaded.defaults?.length) {
        const { applyCollectionDefaults } = await import("@rebasepro/server");
        applyCollectionDefaults(loaded.collections, { defaultSecurityRules: [...loaded.defaults] });
    }

    findings.push(...checkRls(loaded));

    // The database the live steps read, once it is known to answer. Under
    // `--live` a database that is missing or does not answer is an error: the
    // audit was asked for, and exit 0 without it is a green CI run over nothing.
    let liveUrl: string | undefined;
    if (options.live) {
        if (!options.databaseUrl) {
            liveStep.detail = "no database to audit";
            findings.push({
                step: "live",
                check: "live-no-database",
                severity: "error",
                message: options.databaseUnavailable
                    ? `--live was asked for, and the database could not be prepared: ${options.databaseUnavailable}`
                    : "--live was asked for, and no database is configured to audit.",
                fix: "Pass --database-url <url> (or set DATABASE_URL), or run without --live for the offline checks."
            });
        } else {
            const unreachable = await databaseUnreachable(options.databaseUrl);
            if (unreachable) {
                liveStep.detail = "the database did not answer";
                findings.push({
                    step: "live",
                    check: "live-unreachable",
                    severity: "error",
                    message: `--live was asked for, and the database could not be reached: ${unreachable}. Neither the migration check nor the RLS audit ran.`,
                    fix: "Check the database is running and the URL is right (`rebase db url` prints the one this project resolves), or run without --live for the offline checks."
                });
            } else {
                liveUrl = options.databaseUrl;
            }
        }
    }

    if (findings.some(f => f.step === "config" && f.severity === "error")) {
        migrationsStep.status = "skipped";
        migrationsStep.detail = "fix the collection config errors first";
    } else {
        findings.push(...await checkMigrations({ ...options, databaseUrl: liveUrl }, loaded, migrationsStep));
    }

    if (!options.live) {
        liveStep.status = "skipped";
        liveStep.detail = "pass --live to audit the database";
    } else if (liveUrl) {
        findings.push(...await checkLive(liveUrl, liveStep));
    }

    steps.forEach(step => settle(step, findings));
    const errors = findings.filter(f => f.severity === "error").length;
    return {
        ok: errors === 0,
        collectionsDir,
        steps,
        findings,
        summary: { errors, warnings: findings.length - errors }
    };
}

// ─── Output ───────────────────────────────────────────────────────────────────

function printFinding(finding: VerifyFinding): void {
    const mark = finding.severity === "error" ? chalk.red("✗") : chalk.yellow("!");
    const where = [finding.file, finding.path].filter(Boolean).join(" → ");
    console.log(`  ${mark} ${where ? `${chalk.bold(where)}  ` : ""}${finding.message}`);
    if (finding.fix) console.log(chalk.gray(`      fix: ${finding.fix}`));
}

function summaryLine(report: VerifyReport): string {
    const { errors, warnings } = report.summary;
    return `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`;
}

export function printReport(report: VerifyReport, quiet: boolean): void {
    if (quiet) {
        if (report.findings.length === 0) return;
        if (!report.ok) console.log(chalk.red(`rebase verify: ${summaryLine(report)}`));
        for (const finding of report.findings) printFinding(finding);
        return;
    }

    console.log("");
    console.log(`  ${chalk.bold("rebase verify")} ${chalk.gray(report.collectionsDir)}`);
    console.log("");
    for (const step of report.steps) {
        const mark = step.status === "passed" ? chalk.green("✓")
            : step.status === "failed" ? chalk.red("✗")
                : step.status === "warnings" ? chalk.yellow("!")
                    : chalk.gray("–");
        const detail = step.detail ? chalk.gray(step.status === "skipped" ? `skipped: ${step.detail}` : step.detail) : "";
        console.log(`  ${mark} ${step.title.padEnd(22)} ${detail}`);
    }
    if (report.findings.length > 0) {
        console.log("");
        for (const finding of report.findings) printFinding(finding);
    }
    console.log("");
    console.log(report.ok ? chalk.green(`  ✓ ${summaryLine(report)}`) : chalk.red(`  ✗ ${summaryLine(report)}`));
    console.log("");
}

function printVerifyHelp(): void {
    console.log(`
${chalk.bold("rebase verify")} — Check the collections are safe to ship

${chalk.green.bold("Usage")}
  rebase verify [options]

${chalk.green.bold("Options")}
${Object.entries(VERIFY_FLAG_HELP).map(([flag, help]) => `  ${chalk.blue(flag.padEnd(20))} ${help}`).join("\n")}

${chalk.green.bold("Steps")}
  1. Collection config     every file loads and passes the boot validator, unknown keys as errors
  2. RLS coverage          securityRules are declared, and owner/tenant columns are filtered on
  3. Migration freshness   drizzle/migrations builds every declared table and column
  4. Live RLS audit        with --live: the rls-check catalogue against DATABASE_URL

Exits 1 when any step reports an error; warnings do not fail. Under --live, a
database that is missing or does not answer is an error. Fast and offline
without --live: for CI, and for the Claude Code hook that ${chalk.cyan("rebase skills --hooks")} installs.
`);
}

export async function verifyCommand(rawArgs: string[]): Promise<void> {
    if (wantsHelp(rawArgs)) {
        printVerifyHelp();
        return;
    }
    const { flags } = parseCommandArgs({
        spec: VERIFY_FLAGS,
        rawArgs,
        commandWords: 1,
        command: "verify",
        maxPositionals: 0
    });

    const projectRoot = requireProjectRoot();
    const backendDir = findBackendDir(projectRoot);
    if (flags["--collections"]) {
        // A mistyped `-c` used to skip every step and print "0 errors" with
        // exit 0 — a green CI run over nothing. Refused as `doctor` and
        // `schema` refuse it. Without the flag, a project with no collections
        // directory (a headless one) is still a skip, not a failure.
        const refusal = missingCollectionsPath(rawArgs, process.cwd(), backendDir ?? projectRoot, "verify");
        if (refusal) {
            if (flags["--json"]) {
                failAsJson(
                    `Collections path not found: "${flags["--collections"]}" (resolved to ${path.resolve(process.cwd(), flags["--collections"])}).`,
                    "collections_not_found",
                    "Leave --collections out (config/collections is the default), or pass a directory that exists; relative paths are resolved from where you run the command."
                );
            }
            console.error("");
            for (const line of refusal) console.error(line);
            console.error("");
            process.exit(1);
        }
    }
    const collectionsDir = flags["--collections"]
        ? path.resolve(process.cwd(), flags["--collections"])
        : path.join(projectRoot, "config", "collections");
    const live = flags["--live"] === true;
    const databaseUrl = live
        ? (process.env.DATABASE_URL || readEnvFile(projectRoot).DATABASE_URL || undefined)
        : undefined;

    const report = await runVerify({
        projectRoot,
        collectionsDir,
        backendDir,
        live,
        databaseUrl
    });

    if (flags["--json"]) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printReport(report, flags["--quiet"] === true);
    }
    if (!report.ok) process.exitCode = 1;
}
