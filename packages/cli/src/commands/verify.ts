/**
 * CLI command: rebase verify
 *
 * One command that says whether the tables are safe to ship, fast enough to
 * run after every edit. An agent editing `backend/schema/*.ts` gets a table
 * definition wrong — a relation to a table the index does not export, an
 * `rls: "inherit"` with no `defaultRls`, a table with no primary key — or
 * writes rules that hand every row of a per-user table to everyone; each of
 * those used to surface late: at boot, in review, or never. The project's
 * Claude Code hook (written by `rebase init` and `rebase skills --hooks`) runs
 * this after each edit to a schema file, and CI runs it on every push.
 *
 * Five steps, each reported on its own:
 *
 * 1. **Table definitions** — `backend/schema` loads and compiles through
 *    `loadBackendSchema`, the loader the backend boots from, so every problem
 *    it would refuse to boot on is a finding here, one per problem.
 * 2. **RLS coverage** — a table with a `user_id` / `owner_id` /
 *    `organization_id` / `tenant_id` column whose rules (its own, or the
 *    `defaultRls` it inherits) let a role read every row regardless of it.
 *    `rls` itself is mandatory, so "no rules at all" is a step-1 error now.
 *    And every compiled policy Postgres would refuse to expand (42P17): a
 *    rule that reads its own table in a sub-select, or tables whose rules
 *    read each other — `checkPolicyRecursion`.
 * 3. **CMS customizations** — every `customizeTable(...)` under
 *    `frontend/src/cms`, read statically (`verify-cms.ts`): a slug no table
 *    declares, a field that is not a column or relation of its table, a
 *    required column kept off the form, one table customized twice. A
 *    project without `frontend/src/cms` (headless) skips it.
 * 4. **Migration freshness** — whether `drizzle/migrations` still builds the
 *    tables and columns the schema declares (offline), and with `--live`
 *    whether the database has applied every migration.
 * 5. **Live RLS audit** — with `--live`, the `@rebasepro/rls-check` catalogue
 *    against the project's database, resolved as `db *` resolves it (the
 *    managed one unless something names another).
 *
 * `--json` prints one object an agent can act on: every finding carries the
 * file, the dotted path into the table and the fix.
 */
import chalk from "chalk";
import fs from "fs";
import path from "path";
import {
    adminRequestRoleFor,
    parseEnvBoolean,
    REBASE_ADMIN_REQUEST_ROLE,
    REBASE_ADMIN_ROLE,
    type SecurityRule,
    type TableDescriptor
} from "@rebasepro/types";
import { isSchemaDefinitionError } from "@rebasepro/common";
import type { PolicyRecursion } from "@rebasepro/rls-check";
import type { PlannedPolicy } from "@rebasepro/server-postgres";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import { failAsJson, findBackendDir, getActiveBackendPlugin, readEnvFile, requireProjectRoot } from "../utils/project";
import { SCHEMA_DIR_FLAG_HELP, missingSchemaDir, refuseRemovedCollectionsFlag } from "../utils/path-flags";
import { resolveSchemaDir } from "../utils/schema-dir";
import { loadProjectSchema, type ModuleAliases, type ProjectSchema } from "../utils/project-schema";
import { checkCmsCustomizations } from "./verify-cms";
import { declaredAdditionalKeys } from "../dev-db/declared-databases";

/** The flags `rebase verify` takes. */
export const VERIFY_FLAGS = {
    "--schema-dir": String,
    "--json": Boolean,
    "--quiet": Boolean,
    "-q": "--quiet",
    "--live": Boolean,
    "--database-url": String,
    "--docker": Boolean
} as const;

const VERIFY_FLAG_HELP: Record<string, string> = {
    "--schema-dir": SCHEMA_DIR_FLAG_HELP,
    "--json": "Print one JSON object: every step, and every finding with its file, path and fix",
    "--quiet, -q": "Print nothing when everything passes; only the problems when something fails",
    "--live": "Also connect to the project's database: check migrations are applied and run the rls-check audit",
    "--database-url": "With --live: audit this database instead of the project's",
    "--docker": "With --live: use the database from docker compose, starting it if needed"
};

export type VerifyStepId = "schema" | "rls" | "cms" | "migrations" | "live";

export interface VerifyFinding {
    step: VerifyStepId;
    /** Stable, kebab-case: what kind of problem. An agent can branch on it. */
    check: string;
    severity: "error" | "warning";
    message: string;
    /** What to change, when there is one thing to change. */
    fix?: string;
    /** The table's slug. */
    table?: string;
    /** The file to open, relative to the project root. */
    file?: string;
    /** The line in {@link file}, when the finding points at one. */
    line?: number;
    /** Dotted path into the table definition — `posts.rls[0]`, `posts.author`. */
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
    /** The schema directory, relative to the project root. */
    schemaDir: string;
    steps: VerifyStep[];
    findings: VerifyFinding[];
    summary: { errors: number; warnings: number };
}

export interface VerifyOptions {
    projectRoot: string;
    /** The schema directory, absolute. */
    schemaDir: string;
    /** The backend package, where `drizzle/migrations` lives. Null for a project without one. */
    backendDir: string | null;
    live: boolean;
    databaseUrl?: string;
    /** Why no `databaseUrl` could be resolved for `--live`, when resolving it failed. */
    databaseUnavailable?: string;
    /**
     * Whether the backend refuses a request with no token (`AUTH_REQUIRE`, on
     * unless set to `false`). Decides how a Rebase-compiled public read reads.
     * Defaults to true, the runtime's default.
     */
    authRequired?: boolean;
    /** Module specifiers mapped to files when importing the schema (in-repo runs and tests). */
    moduleAliases?: ModuleAliases;
}

const STEP_TITLES: Record<VerifyStepId, string> = {
    schema: "Table definitions",
    rls: "RLS coverage",
    cms: "CMS customizations",
    migrations: "Migration freshness",
    live: "Live RLS audit"
};

/**
 * Columns that say "this row belongs to someone". A table carrying one and
 * served without a row filter is the classic multi-tenant leak.
 */
const OWNER_COLUMNS: readonly string[] = ["user_id", "owner_id", "organization_id", "tenant_id"];

const MODULE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"] as const;

// ─── Step 1: table definitions ────────────────────────────────────────────────

/** The schema as far as the later steps need it: the compiled tables, and where each one is written. */
interface VerifiedSchema {
    schema: ProjectSchema;
    descriptors: TableDescriptor[];
    /** The file each table is written in, by slug, relative to the project root. */
    files: Map<string, string>;
}

/**
 * Where a table is written, as far as the files say without running them:
 * the conventional `<schema>/<name>.ts` (or its slug, or its SQL name), else
 * the index that exports it.
 */
function tableFile(projectRoot: string, schemaDir: string, indexFile: string, names: readonly string[]): string | undefined {
    for (const name of names) {
        for (const extension of MODULE_EXTENSIONS) {
            const candidate = path.join(schemaDir, `${name}${extension}`);
            if (fs.existsSync(candidate)) return path.relative(projectRoot, candidate);
        }
    }
    return indexFile ? path.relative(projectRoot, indexFile) : undefined;
}

/**
 * Load the schema the way the backend boots from it. A schema that does not
 * load or does not compile is a set of findings, not a crash — after an
 * agent's edit it is the most likely problem of all.
 */
async function loadSchema(
    options: VerifyOptions
): Promise<{ verified: VerifiedSchema; failures: [] } | { verified: null; failures: VerifyFinding[] }> {
    const relative = (file: string) => path.relative(options.projectRoot, file);
    const indexOf = (): string => MODULE_EXTENSIONS
        .map(extension => path.join(options.schemaDir, `index${extension}`))
        .find(candidate => fs.existsSync(candidate)) ?? "";
    try {
        const schema = await loadProjectSchema(options.projectRoot, options.schemaDir, options.moduleAliases);
        const descriptors = schema.compiled.descriptors;
        const files = new Map<string, string>();
        for (const descriptor of descriptors) {
            const file = tableFile(options.projectRoot, options.schemaDir, schema.loaded.indexFile,
                [descriptor.name, descriptor.slug, descriptor.table]);
            if (file) files.set(descriptor.slug, file);
        }
        return { verified: { schema, descriptors, files }, failures: [] };
    } catch (error) {
        if (isSchemaDefinitionError(error)) {
            const index = indexOf();
            return {
                verified: null,
                failures: error.problems.map((problem): VerifyFinding => {
                    const file = tableFile(options.projectRoot, options.schemaDir, index, [problem.table]);
                    return {
                        step: "schema",
                        check: "schema-definition",
                        severity: "error",
                        table: problem.table,
                        ...(file && { file }),
                        path: problem.key ? `${problem.table}.${problem.key}` : problem.table,
                        message: problem.message,
                        fix: "Change the definition as the message says. The backend refuses to boot on the same schema."
                    };
                })
            };
        }
        const file = typeof error === "object" && error !== null && "file" in error && typeof error.file === "string"
            ? relative(error.file)
            : undefined;
        return {
            verified: null,
            failures: [{
                step: "schema",
                check: "schema-load",
                severity: "error",
                ...(file && { file }),
                message: error instanceof Error ? error.message : String(error),
                fix: "Fix the module as the message says. The backend refuses to boot on the same files."
            }]
        };
    }
}

// ─── Step 2: RLS coverage ─────────────────────────────────────────────────────

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

function checkRls(verified: VerifiedSchema): VerifyFinding[] {
    const findings: VerifyFinding[] = [];
    const defaultsFile = verified.schema.loaded.indexFile
        ? path.basename(verified.schema.loaded.indexFile)
        : "the schema index";
    for (const table of verified.descriptors) {
        // A view takes the policies of the tables it reads; the auth table gets
        // a self-read policy and an admin-only write gate from the framework.
        if (table.kind !== "table" || table.auth) continue;
        // `"admin-only"`, declared or inherited, is a posture said on purpose.
        if (table.rls.posture !== "rules") continue;
        // A tenant-scoped table is filtered by the tenant policy before any rule.
        if (table.tenant) continue;

        const owner = table.columns.find(column => OWNER_COLUMNS.includes(column.column));
        if (!owner) continue;

        const slug = table.slug;
        const file = verified.files.get(slug);
        const ownerField = owner.column;
        const perUser = ownerField === "user_id" || ownerField === "owner_id";
        const fix = perUser
            ? `Give it rules of its own: \`rls: [{ operation: "all", ownerField: "${ownerField}" }]\` so each user reaches only their own rows. ` +
                "A table meant to be readable by everyone says so on the table: `{ operation: \"select\", access: \"public\" }`."
            : `Scope it with \`tenant: { field: "${owner.key}", from: { claim: "${ownerField}" } }\` (the claim that carries the caller's tenant), ` +
                "plus the `rls` rules that grant access inside a tenant — e.g. `[{ operation: \"select\", access: \"public\" }]`.";

        if (table.rls.inherited) {
            const opening = table.rls.rules.find(opensEveryRow);
            if (!opening) continue;
            // `defaultRls` is written for every table. On a tenant column,
            // inheriting an all-rows read is the cross-tenant leak; on a per-user
            // column it is often a public profile or author list, so it is said,
            // not failed.
            findings.push({
                step: "rls",
                check: perUser ? "rls-inherited-read" : "rls-inherited-tenant-read",
                severity: perUser ? "warning" : "error",
                table: slug,
                ...(file && { file }),
                path: `${slug}.rls`,
                message: `"${slug}" has a \`${ownerField}\` column and \`rls: "inherit"\`, so it takes \`defaultRls\` from ${defaultsFile}, ` +
                    `which lets ${describeRuleTarget(opening)} read every row regardless of \`${ownerField}\`.`,
                fix
            });
            continue;
        }

        table.rls.rules.forEach((rule, index) => {
            if (!isUnfilteredRead(rule)) return;
            findings.push({
                step: "rls",
                check: "rls-unfiltered-read",
                severity: "warning",
                table: slug,
                ...(file && { file }),
                path: `${slug}.rls[${index}]`,
                message: `"${slug}" has a \`${ownerField}\` column, and rls[${index}] lets ${describeRuleTarget(rule)} read every row of it with no row filter.`,
                fix: `Filter the rule — \`ownerField: "${ownerField}"\` or a \`condition\` — or, if every row really is meant for ${describeRuleTarget(rule)}, keep it and ignore this warning.`
            });
        });
    }
    return findings;
}

// ─── Step 2, continued: policies Postgres refuses to expand ───────────────────

/** How the statements a policy of this command guards read in a finding. */
function statementsOf(command: PolicyRecursion["command"], table: string): string {
    switch (command) {
        case "INSERT": return `every insert into ${table}`;
        case "UPDATE": return `every update of ${table}`;
        case "DELETE": return `every delete from ${table}`;
        case "SELECT": return `every read of ${table}`;
        default: return `every read and write of ${table}`;
    }
}

const qualifiedName = (at: { schema: string; table: string }): string => `${at.schema}.${at.table}`;

/**
 * Where the rule a policy compiles from is written: `rls[i]` of its table, the
 * `defaultRls` rule it inherits, or — for a policy Rebase derives (a junction's,
 * the admin baseline) — the table alone.
 */
function ruleLocation(
    descriptor: TableDescriptor | undefined,
    planned: PlannedPolicy | undefined,
    recursion: PolicyRecursion
): { path: string; label: string } {
    if (!descriptor) return { path: recursion.table, label: `policy "${recursion.policy}" of the junction table` };
    const slug = descriptor.slug;
    const fallback = { path: `${slug}.rls`, label: `policy "${recursion.policy}"` };
    if (!planned || planned.injected || descriptor.rls.posture !== "rules") return fallback;
    const rules = descriptor.rls.rules;
    const index = planned.ruleKey.startsWith("#")
        ? Number(planned.ruleKey.slice(1))
        : rules.findIndex(rule => rule.name === planned.ruleKey);
    if (!Number.isInteger(index) || index < 0 || index >= rules.length) return fallback;
    return descriptor.rls.inherited
        ? { path: `${slug}.rls`, label: `the rule it inherits from \`defaultRls\` (defaultRls[${index}])` }
        : { path: `${slug}.rls[${index}]`, label: `rls[${index}]` };
}

/** One loop, in words: what the policy reads, and how that leads back to its table. */
function describeLoop(recursion: PolicyRecursion): string {
    const home = qualifiedName(recursion);
    if (recursion.path.length === 1) return `its own table, ${home}, in a sub-select`;
    const through = recursion.path.slice(1).map((step, i, steps) => {
        const next = i + 1 < steps.length ? qualifiedName(steps[i + 1]) : home;
        return `whose read policy "${step.policy}" reads ${next}`;
    });
    return `${qualifiedName(recursion.reads)} in a sub-select, ${through.join(", ")} back`;
}

/**
 * The tables' policies, compiled as the boot writes them, read for a loop
 * Postgres refuses to expand: a rule that reads its own table in a
 * sub-select, or two tables whose rules read each other. Since 0.25 every
 * `rebase.uid()` is compiled to `(SELECT rebase.uid())` and the admin policies
 * are sub-selects as well, so such a rule fails on every statement it guards,
 * with 42P17 — for users, the service key and `dataAsAdmin` alike — where it
 * worked on 0.21. The analysis is `findPolicyRecursion` from
 * `@rebasepro/rls-check`, over the compiled SQL rather than the rules, so a
 * structured `existsIn` and a junction's derived policy are read as well as
 * raw SQL.
 */
async function checkPolicyRecursion(verified: VerifiedSchema): Promise<VerifyFinding[]> {
    const { planPolicyDefinitions, REBASE_USER_ROLE } = await import("@rebasepro/server-postgres");
    const { findPolicyRecursion } = await import("@rebasepro/rls-check");
    let policies: PlannedPolicy[];
    try {
        // A database the boot made both admin roles on: every policy, every companion.
        policies = planPolicyDefinitions(verified.schema.compiled.tables, { adminRequestRoleAvailable: true });
    } catch (error) {
        return [{
            step: "rls",
            check: "rls-policy-plan",
            severity: "error",
            message: `The rules do not compile to policies: ${error instanceof Error ? error.message : String(error)}`,
            fix: "Change the rules as the message says. The boot and `rebase db push` compile the same policies, and refuse them the same way."
        }];
    }

    // The two roles a request runs as: the request role, and the admin request
    // role that inherits it with both admin roles. The server context holds
    // `rebase_admin` alone, a subset of the second.
    const adminRequestRole = adminRequestRoleFor(REBASE_USER_ROLE);
    const recursions = findPolicyRecursion(policies, {
        contexts: [
            { name: REBASE_USER_ROLE, roles: [REBASE_USER_ROLE] },
            { name: adminRequestRole, roles: [adminRequestRole, REBASE_USER_ROLE, REBASE_ADMIN_ROLE, REBASE_ADMIN_REQUEST_ROLE] }
        ],
        // The search path Rebase pins on its connections, which the boot creates the policies under.
        searchPath: ["public"]
    });

    // One finding per policy, in the order the tables and their rules are written.
    const order = (at: { schema: string; table: string; policy: string }): number =>
        policies.findIndex(p => p.schema === at.schema && p.table === at.table && p.name === at.policy);
    const byPolicy = new Map<number, PolicyRecursion[]>();
    for (const recursion of recursions) {
        const at = order(recursion);
        byPolicy.set(at, [...(byPolicy.get(at) ?? []), recursion]);
    }

    return [...byPolicy.entries()].sort(([a], [b]) => a - b).map(([at, loops]): VerifyFinding => {
        const [first] = loops;
        const descriptor = verified.descriptors.find(d => d.kind === "table" && d.schema === first.schema && d.table === first.table);
        const planned: PlannedPolicy | undefined = policies[at];
        const { path: rulePath, label } = ruleLocation(descriptor, planned, first);
        const slug = descriptor?.slug ?? first.table;
        const file = descriptor ? verified.files.get(slug) : undefined;
        const home = qualifiedName(first);
        const certain = loops.some(loop => loop.confidence === "certain");
        // An admin request is subject to every policy a user's request is, and
        // more, so a loop a user's request closes closes for admins too.
        const who = loops.some(loop => loop.contexts.includes(REBASE_USER_ROLE))
            ? ""
            : " for admin requests (the service key, `dataAsAdmin` and admin users)";
        const caveats = certain ? [] : [...new Set(loops.flatMap(loop => loop.caveats))];
        const readTables = [...new Set(loops.map(loop => qualifiedName(loop.reads)))];
        return {
            step: "rls",
            check: "rls-policy-recursion",
            severity: certain ? "error" : "warning",
            table: slug,
            ...(file && { file }),
            path: rulePath,
            message: `"${slug}" ${label} (${first.command.toLowerCase()}) reads ${loops.map(describeLoop).join("; it also reads ")}, ` +
                `so Postgres refuses ${statementsOf(first.command, home)}${who} with 42P17 ` +
                `(infinite recursion detected in policy for relation "${first.table}"). ` +
                "Before 0.25 such a rule could pass: since then the compiler writes `rebase.uid()` as `(SELECT rebase.uid())` and the admin policies as sub-selects, " +
                "so a table's own policies contain a sub-select even where its rules have none." +
                (caveats.length > 0 ? ` Not certain: ${caveats.join(" ")}` : ""),
            fix: `Move the read of ${readTables.join(" and ")} into a \`SECURITY DEFINER\` function, which Postgres does not expand while it applies policies, ` +
                "and call that function from the rule — e.g. `CREATE FUNCTION public.can_access(…) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER " +
                `SET search_path = '' AS $$ SELECT EXISTS (SELECT 1 FROM ${readTables[0]} …) $$\`, then \`using: "public.can_access(…)"\`. ` +
                "Leave the policies Rebase generates as they are."
        };
    });
}

// ─── Step 3: migration freshness ──────────────────────────────────────────────

const POSTGRES_PLUGIN = "@rebasepro/server-postgres";

/** One row of `rebase.atlas_schema_revisions`, as far as "applied" needs it. */
export interface AppliedRevision {
    version: string;
    /** Atlas's revision type, a bit set: 1 baseline, 2 executed, 4 resolved (`migrate set`). */
    type: number;
}

/** Atlas's baseline bit in `atlas_schema_revisions.type`. */
const REVISION_TYPE_BASELINE = 1;

/**
 * The migration files the database has not run, as Atlas's own `migrate status`
 * counts them.
 *
 * A file is applied when its version has a row, or when it is at or behind the
 * newest *baseline* row: `migrate apply --baseline V` records V alone, and
 * means "everything up to V is already here". `rebase db migrate --baseline` is
 * what the CLI prescribes for a booted database, so set membership alone
 * reported the earlier migrations of every baselined database as not applied —
 * and prescribed `rebase db migrate`, which answers "No migration files to
 * execute". That run failed forever.
 */
export function pendingMigrations(
    files: readonly string[],
    revisions: readonly AppliedRevision[],
    compare: (a: string, b: string) => number,
    versionOf: (file: string) => string
): string[] {
    const recorded = new Set(revisions.map(row => row.version));
    const baseline = revisions
        .filter(row => (Number(row.type) & REVISION_TYPE_BASELINE) !== 0)
        .map(row => row.version)
        .reduce<string | null>((newest, version) => (newest === null || compare(version, newest) > 0 ? version : newest), null);
    return files.filter((file) => {
        const version = versionOf(file);
        if (recorded.has(version)) return false;
        return baseline === null || compare(version, baseline) > 0;
    });
}

async function checkMigrations(
    options: VerifyOptions,
    verified: VerifiedSchema,
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

    let changes: ReturnType<typeof findUnmigratedSchema>;
    try {
        changes = findUnmigratedSchema(
            verified.schema.compiled.tables,
            files.map(f => fs.readFileSync(path.join(migrationsDir, f), "utf-8"))
        );
    } catch (error) {
        return [{
            step: "migrations",
            check: "migration-plan",
            severity: "error",
            message: `Could not derive the SQL schema from the tables: ${error instanceof Error ? error.message : String(error)}`,
            fix: "`rebase schema generate` reports the same problem with more context."
        }];
    }

    for (const change of changes) {
        const where = change.column ? `${change.table}.${change.column}` : change.table;
        const message = change.kind === "missing-table"
            ? `Table ${where} is declared in the schema but no migration in ${relativeDir} creates it.`
            : change.kind === "missing-column"
                ? `Column ${where} is declared in the schema but no migration in ${relativeDir} adds it.`
                : `Column ${where} is no longer declared in the schema, but the migrations in ${relativeDir} still create it.`;
        const file = change.slug ? verified.files.get(change.slug) : undefined;
        findings.push({
            step: "migrations",
            check: change.kind === "removed-column" ? "migration-stale-column" : "migration-missing",
            severity: "error",
            message,
            fix,
            ...(change.slug && { table: change.slug }),
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
        const applied = await client.query<{ version: string; type: string | number }>(
            "SELECT version, type FROM rebase.atlas_schema_revisions WHERE error IS NULL OR error = ''"
        );
        const { compareMigrationVersions, migrationVersionOf } = await import("@rebasepro/server-postgres");
        const pending = pendingMigrations(
            files,
            applied.rows.map(row => ({ version: row.version, type: Number(row.type) })),
            compareMigrationVersions,
            migrationVersionOf
        );
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

/**
 * A `USING (true)` read policy Rebase compiled from an `access: "public"`
 * select rule, on a backend that refuses a request with no token.
 *
 * rls-check reads the policy alone, and for the role every signed-in request
 * runs as it is "every row to everyone": critical. But the API answers 401
 * before RLS is consulted unless `AUTH_REQUIRE=false`, so what it grants is
 * every row to every *signed-in* user — exactly what step 2 accepts as a rule
 * said on purpose, and what boot reports as an info line. A fresh blog
 * scaffold failed its own `verify --live` with three such errors. It is a
 * warning here, as an unfiltered read is in step 2; with `AUTH_REQUIRE=false`
 * the rows really are public and it stays an error.
 */
function isTokenGatedPublicRead(
    finding: { id: string; target: { table?: string; policy?: string } },
    authRequired: boolean,
    isGeneratedPolicyName: (name: string, table: string) => boolean
): boolean {
    if (!authRequired || finding.id !== "policy-always-true") return false;
    const { table, policy } = finding.target;
    if (!table || !policy) return false;
    return isGeneratedPolicyName(policy, table) && policy.startsWith(`${table}_select_`);
}

async function checkLive(databaseUrl: string, step: VerifyStep, authRequired: boolean): Promise<VerifyFinding[]> {
    const { scan, CHECKS } = await import("@rebasepro/rls-check");
    const { isGeneratedPolicyName } = await import("@rebasepro/server-postgres");
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
        const tokenGated = severity === "error" && isTokenGatedPublicRead(finding, authRequired, isGeneratedPolicyName);
        findings.push({
            step: "live",
            check: finding.id,
            severity: tokenGated ? "warning" : severity,
            message: tokenGated
                ? `${finding.title} — compiled from an \`access: "public"\` read rule: every signed-in user reads every row. ` +
                    "A request with no token is refused by the API (AUTH_REQUIRE is on), so it is not an anonymous read."
                : finding.title,
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
    const steps: VerifyStep[] = (["schema", "rls", "cms", "migrations", "live"] as const).map(id => ({
        id,
        title: STEP_TITLES[id],
        status: "passed"
    }));
    const [schemaStep, rlsStep, cmsStep, migrationsStep, liveStep] = steps;
    const schemaDir = path.relative(options.projectRoot, options.schemaDir) || ".";
    const skipAll = (detail: string): VerifyReport => {
        for (const step of steps) {
            step.status = "skipped";
            step.detail = detail;
        }
        return { ok: true, schemaDir, steps, findings, summary: { errors: 0, warnings: 0 } };
    };

    // No schema is a project that declares no tables — its API is introspected
    // from the database (a headless one). A skip, not a failure.
    if (!fs.existsSync(options.schemaDir) || !fs.statSync(options.schemaDir).isDirectory()) {
        return skipAll(`no schema directory at ${schemaDir}`);
    }

    const { verified, failures } = await loadSchema(options);
    findings.push(...failures);
    if (verified && !verified.schema.loaded.indexFile) {
        return skipAll(`${schemaDir} has no index.ts, so it declares no tables`);
    }

    if (verified) {
        const tables = verified.descriptors.length;
        schemaStep.detail = `${tables} table${tables === 1 ? "" : "s"}, compiled as the backend boots them`;
        rlsStep.detail = `${tables} table${tables === 1 ? "" : "s"}`;
        findings.push(...checkRls(verified));
        findings.push(...await checkPolicyRecursion(verified));
        const cms = await checkCmsCustomizations(options.projectRoot, verified.descriptors);
        if (cms.directories.length === 0) {
            cmsStep.status = "skipped";
            cmsStep.detail = "no frontend/src/cms";
            // A frontend without src/cms still builds without the backend guard.
            for (const finding of cms.findings) findings.push({ step: "cms", ...finding });
        } else {
            cmsStep.detail = `${cms.customizations} customization${cms.customizations === 1 ? "" : "s"} in ${cms.directories.join(", ")}, read without running them`;
            for (const finding of cms.findings) findings.push({ step: "cms", ...finding });
        }
    } else {
        for (const step of [rlsStep, cmsStep]) {
            step.status = "skipped";
            step.detail = "fix the table definitions first";
        }
    }

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

    if (!verified) {
        migrationsStep.status = "skipped";
        migrationsStep.detail = "fix the table definitions first";
    } else {
        findings.push(...await checkMigrations({ ...options, databaseUrl: liveUrl }, verified, migrationsStep));
    }

    if (!options.live) {
        liveStep.status = "skipped";
        liveStep.detail = "pass --live to audit the database";
    } else if (liveUrl) {
        findings.push(...await checkLive(liveUrl, liveStep, options.authRequired ?? true));
    }

    steps.forEach(step => settle(step, findings));
    const errors = findings.filter(f => f.severity === "error").length;
    return {
        ok: errors === 0,
        schemaDir,
        steps,
        findings,
        summary: { errors, warnings: findings.length - errors }
    };
}

// ─── Output ───────────────────────────────────────────────────────────────────

function printFinding(finding: VerifyFinding): void {
    const mark = finding.severity === "error" ? chalk.red("✗") : chalk.yellow("!");
    const file = finding.file && finding.line !== undefined ? `${finding.file}:${finding.line}` : finding.file;
    const where = [file, finding.path].filter(Boolean).join(" → ");
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
    console.log(`  ${chalk.bold("rebase verify")} ${chalk.gray(report.schemaDir)}`);
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
${chalk.bold("rebase verify")} — Check the tables are safe to ship

${chalk.green.bold("Usage")}
  rebase verify [options]

${chalk.green.bold("Options")}
${Object.entries(VERIFY_FLAG_HELP).map(([flag, help]) => `  ${chalk.blue(flag.padEnd(20))} ${help}`).join("\n")}

${chalk.green.bold("Steps")}
  1. Table definitions     backend/schema loads and compiles as the backend boots it
  2. RLS coverage          owner and tenant columns are filtered on by the rules that read them,
                           and no rule reads its own table back through a sub-select (42P17)
  3. CMS customizations    frontend/src/cms: each customizeTable names a table, its fields, and a form that can create
  4. Migration freshness   drizzle/migrations builds every declared table and column
  5. Live RLS audit        with --live: the rls-check catalogue against the project's database

Exits 1 when any step reports an error; warnings do not fail. Under --live, a
database that is missing or does not answer is an error. Fast and offline
without --live: for CI, and for the Claude Code hook that ${chalk.cyan("rebase skills --hooks")} installs.
`);
}

/**
 * Whether the backend refuses a request with no token: `AUTH_REQUIRE` from the
 * environment, else `.env`, read as every boolean env var is read
 * (`parseEnvBoolean`: `false`/`0`/`no`/`off` turn it off). On unless one of
 * those says otherwise — the runtime's default. Compared raw, `AUTH_REQUIRE=0`
 * read as "on", and a compiled public read was reported as token-gated on a
 * backend that serves it to anyone.
 */
export function authRequiredFrom(
    environment: Record<string, string | undefined>,
    envFile: Record<string, string | undefined>
): boolean {
    return parseEnvBoolean(environment.AUTH_REQUIRE ?? envFile.AUTH_REQUIRE) !== false;
}

/**
 * The database `--live` audits, resolved as every other database door resolves
 * it (`db *`, `console`, `doctor`): `--database-url`, `DATABASE_URL`, `.env`,
 * `--docker` or the last `rebase dev --docker`, and otherwise the managed
 * development database — started if it is not running. Reading only
 * `DATABASE_URL` meant the audit never ran on a fresh scaffold, whose database
 * is the managed one.
 *
 * Progress goes to stderr, so `--json` keeps stdout to the report.
 */
async function resolveLiveDatabase(
    projectRoot: string,
    rawArgs: readonly string[],
    options: { flagUrl: string | null; flagDocker: boolean; quiet: boolean }
): Promise<Pick<VerifyOptions, "databaseUrl" | "databaseUnavailable">> {
    try {
        const { ensureDockerDatabase, databaseUrlOf } = await import("./db");
        await ensureDockerDatabase(projectRoot, rawArgs);
        const { prepareDatabaseEnv } = await import("../dev-db/prepare");
        const prepared = await prepareDatabaseEnv(projectRoot, {
            flagUrl: options.flagUrl,
            flagDocker: options.flagDocker,
            quiet: options.quiet,
            onProgress: options.quiet ? undefined : (line) => console.error(chalk.gray(`  ${line}`)),
            additionalKeys: declaredAdditionalKeys(projectRoot)
        });
        return { databaseUrl: databaseUrlOf(prepared, readEnvFile(projectRoot)) };
    } catch (error) {
        return { databaseUnavailable: error instanceof Error ? error.message : String(error) };
    }
}

export async function verifyCommand(rawArgs: string[]): Promise<void> {
    if (wantsHelp(rawArgs)) {
        printVerifyHelp();
        return;
    }
    refuseRemovedCollectionsFlag(rawArgs.slice(2), "verify");
    const { flags } = parseCommandArgs({
        spec: VERIFY_FLAGS,
        rawArgs,
        commandWords: 1,
        command: "verify",
        maxPositionals: 0
    });

    const projectRoot = requireProjectRoot();
    const backendDir = findBackendDir(projectRoot);
    const typedDir = flags["--schema-dir"];
    if (typedDir) {
        // A mistyped path used to skip every step and print "0 errors" with
        // exit 0 — a green CI run over nothing. Refused as `doctor` and
        // `schema` refuse it. Without the flag, a project with no schema
        // directory (a headless one) is still a skip, not a failure.
        const refusal = missingSchemaDir(rawArgs, process.cwd(), backendDir ?? projectRoot, "verify");
        if (refusal) {
            if (flags["--json"]) {
                failAsJson(
                    `Schema directory not found: "${typedDir}" (resolved to ${path.resolve(process.cwd(), typedDir)}).`,
                    "schema_dir_not_found",
                    "Leave --schema-dir out (backend/schema is the default), or pass a directory that exists; relative paths are resolved from where you run the command."
                );
            }
            console.error("");
            for (const line of refusal) console.error(line);
            console.error("");
            process.exit(1);
        }
    }
    const schemaDir = typedDir ? path.resolve(process.cwd(), typedDir) : resolveSchemaDir(projectRoot);
    const live = flags["--live"] === true;
    const database = live
        ? await resolveLiveDatabase(projectRoot, rawArgs, {
            flagUrl: flags["--database-url"] ?? null,
            flagDocker: flags["--docker"] === true,
            quiet: flags["--quiet"] === true
        })
        : {};

    const report = await runVerify({
        projectRoot,
        schemaDir,
        backendDir,
        live,
        ...database,
        authRequired: authRequiredFrom(process.env, readEnvFile(projectRoot))
    });

    if (flags["--json"]) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printReport(report, flags["--quiet"] === true);
    }
    if (!report.ok) process.exitCode = 1;
}

