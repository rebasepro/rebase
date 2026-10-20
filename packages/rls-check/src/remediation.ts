/**
 * Remediations for `--format agent`: for every finding, the SQL that fixes it
 * and the Rebase `securityRules` that say the same thing.
 *
 * The `fix` a check writes is for a person reading a terminal — prose, options
 * and commented-out examples. A coding agent needs something else: one
 * statement it can run, a list of the blanks it has to fill before running it,
 * and a flag saying when SQL is the wrong place for the change altogether. So
 * this is written per check id, from the snapshot, rather than parsed out of
 * the `fix` text.
 *
 * Three rules hold for every builder here:
 *
 * 1. `sql` is runnable as printed, once every token in `placeholders` has been
 *    replaced. Nothing in it is a comment the agent has to interpret. Where the
 *    tool cannot know a value — the column that holds a row's owner, the role
 *    an application connects as — it says so with a placeholder rather than
 *    guessing, because a guessed column fails on paste and a guessed role can
 *    widen access.
 *
 * 2. Applying `sql` clears the finding it is attached to. A fix that leaves the
 *    finding standing teaches the agent to stop trusting the tool.
 *
 * 3. The Rebase rules mean what the SQL means. `ownerField` compiles to
 *    `<column>::text = rebase.uid()`; a raw rule carries the corrected
 *    expression. Where `securityRules` cannot express the fix at all — grants,
 *    views, functions, FORCE — `rebase.applicable` is false and the note says
 *    what Rebase does instead, rather than inventing a rule.
 *
 * The TypeScript in `rebase.securityRules` is type-checked against
 * `SecurityRule` from `@rebasepro/types` by `remediation.test.ts`. This package
 * cannot import that type — it ships with `pg` and nothing else — so the shapes
 * written here are held to it by the test instead.
 */
import { withMissingOk } from "./checks/current-setting-throws";
import { callerIdOnlyClause, signedInRoleOnlyClause } from "./checks/policy-anonymous-tautology";
import { pinSearchPathSql } from "./checks/security-definer-mutable-search-path";
import { isUnconditionalTrue } from "./checks/sql";
import { policyAmbiguities, type Ambiguity } from "./checks/unqualified-column-in-subquery";
import {
    ANONYMOUS_ROLES,
    callerIdCall,
    DML,
    effectivePrivileges,
    exposedGrantees,
    foreignKeysOf,
    isPublicRole,
    isRebaseManagedPolicy,
    OWNER_COLUMNS,
    policiesFor,
    qi,
    qrel,
    relationAt,
    revokesReaching,
    roleNamed,
    rolesUsableBy,
    sameRole,
    SECURITY_RULES_DOCS,
    WRITE_PRIVILEGES,
    type Privilege
} from "./checks/util";
import { protectedBaseTables } from "./checks/view-bypasses-rls";
import type { DbPolicy, DbRelation, DbSnapshot, Finding, PolicyCommand } from "./types";

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/**
 * Where the decisive change belongs.
 *
 * - `sql`: run {@link Remediation.sql}, as a migration, after filling in its
 *   placeholders.
 * - `rebase-config`: the object is compiled by Rebase from a collection's
 *   `securityRules` and re-made on every boot, so SQL would be undone. Edit
 *   the rule ({@link RebaseEquivalent.snippet}) and run `rebase db push`.
 * - `manual`: no statement can be written without a decision only a person
 *   can make. {@link Remediation.summary} says what to decide.
 */
export type RemediationApply = "sql" | "rebase-config" | "manual";

/** A token in `sql` or in the Rebase rules that must be replaced before use. */
export interface Placeholder {
    /** Exactly as it appears in the text, e.g. `<owner_column>`. */
    token: string;
    /** What to put there, and how to find it out. */
    meaning: string;
}

/** Another valid fix, for when the intent behind the object is ambiguous. */
export interface AlternativeFix {
    summary: string;
    sql: string;
}

/** The same fix, said the Rebase way. */
export interface RebaseEquivalent {
    /** False when `securityRules` cannot express this fix; `note` says why. */
    applicable: boolean;
    /** The `securityRules` array, as TypeScript source. Null when not applicable. */
    securityRules: string | null;
    /** A `defineCollection({ … })` excerpt showing where the rules go. */
    snippet: string | null;
    note: string;
}

export interface Remediation {
    /** One sentence: what the fix does. */
    summary: string;
    apply: RemediationApply;
    /** Statements, each ending in `;`. Null when SQL is the wrong place. */
    sql: string | null;
    placeholders: Placeholder[];
    alternatives: AlternativeFix[];
    /** What applying the fix changes besides clearing the finding. */
    caveats: string[];
    rebase: RebaseEquivalent;
}

// ---------------------------------------------------------------------------
// Rebase rules, as source
// ---------------------------------------------------------------------------

type RuleOperation = "select" | "insert" | "update" | "delete" | "all";

/**
 * The subset of `SecurityRule` this module writes. Each one is a valid
 * `OwnerSecurityRule`, `RawSQLSecurityRule` or `RawSQLCheckOnlySecurityRule` —
 * never two of them at once, which the real type forbids.
 */
interface RuleSpec {
    name?: string;
    operation: RuleOperation;
    mode?: "restrictive";
    ownerField?: string;
    using?: string;
    withCheck?: string;
}

const RULE_KEYS = ["name", "operation", "mode", "ownerField", "using", "withCheck"] as const;

/** `{ operation: "all", ownerField: "user_id" }` — one line, fixed key order. */
function ruleSource(rule: RuleSpec): string {
    const parts = RULE_KEYS.flatMap((key) => {
        const value = rule[key];
        // JSON string syntax is TypeScript string syntax, escapes included.
        return value === undefined ? [] : [`${key}: ${JSON.stringify(value)}`];
    });
    return `{ ${parts.join(", ")} }`;
}

function rulesSource(rules: RuleSpec[], indent = ""): string {
    return `[\n${rules.map((r) => `${indent}    ${ruleSource(r)}`).join(",\n")}\n${indent}]`;
}

function collectionSnippet(schema: string, table: string, rules: RuleSpec[]): string {
    return [
        `// The collection whose table is ${schema}.${table} (config/collections/ in a Rebase project)`,
        `defineCollection({`,
        `    // …name, slug, properties and the rest stay as they are…`,
        `    table: ${JSON.stringify(table)},`,
        ...(schema === "public" ? [] : [`    schema: ${JSON.stringify(schema)},`]),
        `    securityRules: ${rulesSource(rules, "    ")}`,
        `});`
    ].join("\n");
}

function rebaseRules(schema: string, table: string, rules: RuleSpec[], note: string): RebaseEquivalent {
    return {
        applicable: true,
        securityRules: rulesSource(rules),
        snippet: collectionSnippet(schema, table, rules),
        note: `${note} ${SECURITY_RULES_DOCS}`
    };
}

function noRebaseRule(note: string): RebaseEquivalent {
    return { applicable: false, securityRules: null, snippet: null, note };
}

const OPERATION: Record<PolicyCommand, RuleOperation> = {
    ALL: "all",
    SELECT: "select",
    INSERT: "insert",
    UPDATE: "update",
    DELETE: "delete"
};

/**
 * The rule that compiles to `policy` with these clauses. A Rebase-managed
 * policy's name is derived from the rule, so it is left for Rebase to derive;
 * a hand-written one keeps its own.
 */
function rawRule(
    snapshot: DbSnapshot,
    policy: DbPolicy,
    using: string | null,
    withCheck: string | null
): RuleSpec {
    return {
        ...(isRebaseManagedPolicy(snapshot, policy) ? {} : { name: policy.name }),
        operation: OPERATION[policy.command],
        ...(policy.permissive ? {} : { mode: "restrictive" as const }),
        ...(using !== null ? { using } : {}),
        ...(withCheck !== null ? { withCheck } : {})
    };
}

function ownerRule(snapshot: DbSnapshot, policy: DbPolicy | undefined, operation: RuleOperation, ownerField: string): RuleSpec {
    return {
        ...(policy && !isRebaseManagedPolicy(snapshot, policy) ? { name: policy.name } : {}),
        operation,
        ...(policy && !policy.permissive ? { mode: "restrictive" as const } : {}),
        ownerField
    };
}

const OWNER_FIELD_NOTE =
    "Rebase enables row-level security on every collection's table and compiles each rule into a policy " +
    "at boot and on `rebase db push`; `ownerField` compiles to `<column>::text = rebase.uid()`, so a row is " +
    "visible and writable only to the user whose id it holds.";

const RAW_RULE_NOTE =
    "A raw rule keeps the expression as SQL; Rebase writes it into the policy as is, with `{column}` " +
    "standing for the row being checked.";

/**
 * Raw expressions copied from a database Rebase did not create may call
 * Supabase's helpers. Rebase rewrites `auth.uid()` to `rebase.uid()` — which
 * returns text, where Supabase's returns uuid.
 */
function rawRuleNote(snapshot: DbSnapshot, ...exprs: (string | null)[]): string {
    const callsAuth = exprs.some((e) => e !== null && /\bauth\s*\.\s*\w+\s*\(/i.test(e));
    if (snapshot.platform === "rebase" || !callsAuth) return RAW_RULE_NOTE;
    return `${RAW_RULE_NOTE} Rebase rewrites \`auth.uid()\` to \`rebase.uid()\`, which returns text: compare a ` +
        "uuid column with it as `{column}::text = rebase.uid()`.";
}

// ---------------------------------------------------------------------------
// Shared SQL pieces
// ---------------------------------------------------------------------------

type Clause = "USING" | "WITH CHECK";

const clauseExpr = (policy: DbPolicy, clause: Clause): string | null =>
    clause === "USING" ? policy.using : policy.withCheck;

/** The clauses of `policy` whose expression `test` flags. */
function flaggedClauses(policy: DbPolicy, test: (expr: string) => boolean): Clause[] {
    return (["USING", "WITH CHECK"] as const).filter((clause) => {
        const expr = clauseExpr(policy, clause);
        return expr !== null && test(expr);
    });
}

function alterPolicySql(policy: DbPolicy, replace: Partial<Record<Clause, string>>): string {
    const lines = [`ALTER POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)}`];
    for (const clause of ["USING", "WITH CHECK"] as const) {
        const expr = replace[clause];
        if (expr !== undefined) lines.push(`    ${clause} (${expr})`);
    }
    return `${lines.join("\n")};`;
}

/** A policy name the table does not already use. */
function freshPolicyName(snapshot: DbSnapshot, schema: string, table: string, base: string): string {
    const taken = new Set(policiesFor(snapshot, schema, table).map((p) => p.name));
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
    return name;
}

const OWNER_PLACEHOLDER = "<owner_column>";
const APP_ROLE_PLACEHOLDER = "<app_role>";

/** Types `auth.uid()`'s uuid can be compared with once cast to text. */
const TEXT_TYPE = /^(text|citext|character varying|varchar)\b/;

interface OwnerScope {
    /** The predicate, e.g. `"user_id" = auth.uid()`. */
    sql: string;
    /** The column, or the placeholder, for `ownerField`. */
    ownerField: string;
    placeholders: Placeholder[];
}

/**
 * "This row belongs to the caller", spelled for this table and this platform.
 *
 * The column is one that looks like the owner's id *and* compares with the
 * caller id without an error: `auth.uid()` is a uuid, so a uuid column
 * compares directly, a text column through `::text`, and an integer
 * `account_id` not at all — that table gets a placeholder rather than a
 * statement that fails with "operator does not exist". Rebase's `rebase.uid()`
 * is text, and its own compiler casts the column, so this does too.
 */
function ownerScope(snapshot: DbSnapshot, rel: DbRelation | undefined): OwnerScope {
    const uid = callerIdCall(snapshot);
    const rebase = snapshot.platform === "rebase";

    for (const name of OWNER_COLUMNS) {
        const column = rel?.columns.find((c) => c.name === name);
        if (!column) continue;
        if (rebase) return { sql: `${qi(name)}::text = ${uid}`, ownerField: name, placeholders: [] };
        if (column.type === "uuid") return { sql: `${qi(name)} = ${uid}`, ownerField: name, placeholders: [] };
        if (TEXT_TYPE.test(column.type)) return { sql: `${qi(name)} = ${uid}::text`, ownerField: name, placeholders: [] };
    }

    const where = rel ? `${rel.schema}.${rel.name}` : "the table";
    return {
        sql: rebase ? `${OWNER_PLACEHOLDER}::text = ${uid}` : `${OWNER_PLACEHOLDER} = ${uid}`,
        ownerField: OWNER_PLACEHOLDER,
        placeholders: [{
            token: OWNER_PLACEHOLDER,
            meaning:
                `The column of ${where} that holds the id of the user who owns the row, as a quoted identifier ` +
                `(e.g. "user_id"); in the Rebase rule, its property name. ` +
                (rebase
                    ? `The SQL already casts it to text to compare with ${uid}.`
                    : `${uid} returns uuid: for a text column write "<column>" = ${uid}::text instead.`)
        }]
    };
}

/**
 * `auth.uid()` exists on Supabase. Elsewhere it is this tool's best guess at
 * the convention, and the SQL that calls it fails if the function is absent.
 */
function callerCaveats(snapshot: DbSnapshot, scope: OwnerScope): string[] {
    if (snapshot.platform === "supabase" || snapshot.platform === "rebase") return [];
    if (!scope.sql.includes("auth.uid()")) return [];
    return [
        "This database was not recognised as Supabase, so `auth.uid()` may not exist here. Replace it with " +
        "however your API hands Postgres the caller's id — on PostgREST, " +
        "`(current_setting('request.jwt.claims', true)::json ->> 'sub')`, cast to the owner column's type."
    ];
}

const RLS_FILTERS_EVERYONE =
    "With row-level security on, every role that neither owns the table nor holds BYPASSRLS sees only the " +
    "rows a policy admits — a backend job connecting as such a role is filtered too.";

function managedCaveat(policy: DbPolicy): string {
    return (
        `Policy "${policy.name}" is compiled by Rebase from a collection's \`securityRules\` and dropped and ` +
        "re-created on every boot, so an ALTER POLICY would be undone at the next restart. Change the rule, " +
        "then redeploy or run `rebase db push`. A collection that declares no `securityRules` of its own " +
        "inherits `defaultSecurityRules` from config/collections/index.ts — a stock scaffold's unfiltered " +
        "read rule lives there."
    );
}

function policyAt(snapshot: DbSnapshot, finding: Finding): DbPolicy | undefined {
    const { schema, table, policy } = finding.target;
    return snapshot.policies.find((p) => p.schema === schema && p.table === table && p.name === policy);
}

/** For a finding whose object is no longer in the snapshot it came from. */
function unresolved(finding: Finding): Remediation {
    return {
        summary:
            `rls-check could not rebuild the object this ${finding.id} finding names from the scan, so it ` +
            "has no statement to offer; read the finding's detail and docs.",
        apply: "manual",
        sql: null,
        placeholders: [],
        alternatives: [],
        caveats: [],
        rebase: noRebaseRule("No rule could be derived without the object.")
    };
}

// ---------------------------------------------------------------------------
// Policies scoped to their owner — four checks, one shape
// ---------------------------------------------------------------------------

/**
 * Rewrite the flagged clauses of `policy` to "the row belongs to the caller".
 *
 * Only the flagged clauses: a policy whose USING is a membership check and
 * whose WITH CHECK is `true` keeps its membership check. And every flagged
 * clause: rewriting USING while a `WITH CHECK (true)` beside it survives left
 * the policy — and the finding — standing.
 */
function scopePolicyToOwner(
    snapshot: DbSnapshot,
    finding: Finding,
    clauses: Clause[],
    words: { summary: string; managedSummary: string; caveats?: string[]; alternatives?: AlternativeFix[] }
): Remediation {
    const policy = policyAt(snapshot, finding);
    if (!policy || clauses.length === 0) return unresolved(finding);

    const rel = relationAt(snapshot, policy.schema, policy.table);
    const scope = ownerScope(snapshot, rel);
    const rule = ownerRule(snapshot, policy, OPERATION[policy.command], scope.ownerField);
    const rebase = rebaseRules(policy.schema, policy.table, [rule], OWNER_FIELD_NOTE);

    if (isRebaseManagedPolicy(snapshot, policy)) {
        return {
            summary: words.managedSummary,
            apply: "rebase-config",
            sql: null,
            placeholders: scope.placeholders,
            alternatives: [],
            caveats: [managedCaveat(policy)],
            rebase
        };
    }

    return {
        summary: words.summary,
        apply: "sql",
        sql: alterPolicySql(policy, Object.fromEntries(clauses.map((c) => [c, scope.sql]))),
        placeholders: scope.placeholders,
        alternatives: words.alternatives ?? [],
        caveats: [...callerCaveats(snapshot, scope), ...(words.caveats ?? [])],
        rebase
    };
}

function where(finding: Finding): string {
    const { schema, table, policy } = finding.target;
    return `policy "${policy ?? "?"}" on ${schema}.${table ?? "?"}`;
}

function dropAlternative(policy: DbPolicy | undefined): AlternativeFix[] {
    if (!policy) return [];
    return [{
        summary: "If another policy already grants the access this one was meant to, drop this one instead.",
        sql: `DROP POLICY ${qi(policy.name)} ON ${qrel(policy.schema, policy.table)};`
    }];
}

function policyAlwaysTrue(snapshot: DbSnapshot, finding: Finding): Remediation {
    const policy = policyAt(snapshot, finding);
    const clauses = policy ? flaggedClauses(policy, isUnconditionalTrue) : [];
    return scopePolicyToOwner(snapshot, finding, clauses, {
        summary: `Replace the constant true in ${where(finding)} (${clauses.join(" and ")}) with a condition that limits each row to its owner.`,
        managedSummary:
            `Replace the rule that compiles to ${where(finding)} — an \`access: "public"\` rule, or a raw ` +
            "`using: \"true\"` — with one scoped to the row's owner.",
        caveats: [
            "If unconditional access is what this table is for (a public catalogue, say), keep the policy and " +
            "run rls-check with --skip policy-always-true instead: the SQL narrows what every caller sees."
        ],
        alternatives: dropAlternative(policy)
    });
}

function policyAnonymousTautology(snapshot: DbSnapshot, finding: Finding): Remediation {
    const policy = policyAt(snapshot, finding);
    const clauses = policy
        ? flaggedClauses(policy, (e) => {
            const match = callerIdOnlyClause(e);
            return match !== null && !match.guardsSentinel;
        })
        : [];
    return scopePolicyToOwner(snapshot, finding, clauses, {
        summary:
            `Replace the "caller id is not null" test in ${where(finding)} (${clauses.join(" and ")}) with one ` +
            "that compares the row's owner column to the caller id.",
        managedSummary:
            `Replace the rule that compiles to ${where(finding)} with an \`ownerField\` rule — before 1.0, ` +
            "`access: \"authenticated\"` compiled to exactly this shape, so a database pushed then still carries it.",
        alternatives: policy
            ? [{
                summary:
                    "If the intent really is \"any signed-in user, every row\", exclude every id your stack uses " +
                    "for a signed-out caller — rls-check then reports it as policy-authenticated-tautology, which " +
                    "you can --skip.",
                sql: alterPolicySql(policy, Object.fromEntries(clauses.map((c) => {
                    const uid = callerIdCall(snapshot);
                    return [c, `${uid} IS NOT NULL AND ${uid}::text <> ALL (ARRAY['anonymous', 'anon'])`];
                })))
            }]
            : []
    });
}

function policyAuthenticatedTautology(snapshot: DbSnapshot, finding: Finding): Remediation {
    const policy = policyAt(snapshot, finding);
    const clauses = policy
        ? flaggedClauses(policy, (e) => signedInRoleOnlyClause(e) !== null || callerIdOnlyClause(e)?.guardsSentinel === true)
        : [];
    return scopePolicyToOwner(snapshot, finding, clauses, {
        summary:
            `Replace the "caller is signed in" test in ${where(finding)} (${clauses.join(" and ")}) with one that ` +
            "limits each row to its owner, so one account no longer reads another's rows.",
        managedSummary:
            `Replace the rule that compiles to ${where(finding)} with an \`ownerField\` rule, or a \`condition\` ` +
            "naming the group whose members may share rows.",
        caveats: [
            "Where members of a shared group (an organisation, a team) may see each other's rows, scope the " +
            "policy to that membership instead of the owner. If every account genuinely may read every row, " +
            "keep the policy and run rls-check with --skip policy-authenticated-tautology."
        ]
    });
}

function anonymousWriteAllowed(snapshot: DbSnapshot, finding: Finding): Remediation {
    const policy = policyAt(snapshot, finding);
    const clauses = policy ? flaggedClauses(policy, isUnconditionalTrue) : [];

    const alternatives: AlternativeFix[] = [];
    // `rebase_user` is every request on Rebase, signed in or not: taking its
    // write privileges away is not "no anonymous writes", it is "no writes".
    if (policy && snapshot.platform !== "rebase") {
        const anonymous = snapshot.exposedRoles.filter((r) => ANONYMOUS_ROLES.includes(r.toLowerCase()));
        const commands = WRITE_PRIVILEGES.filter((p) => policy.command === "ALL" || p === policy.command);
        const revokes = revokesReaching(snapshot, policy.schema, policy.table, anonymous, commands);
        if (revokes.length > 0) {
            alternatives.push({
                summary: "If no unauthenticated caller should ever write this table, also take the privilege away.",
                sql: revokes.join("\n")
            });
        }
    }

    return scopePolicyToOwner(snapshot, finding, clauses, {
        summary:
            `Scope the writes ${where(finding)} admits to the row's owner, so a request without credentials — ` +
            "whose caller id matches no row — is refused.",
        managedSummary:
            `Scope the write rule that compiles to ${where(finding)} to the caller with an \`ownerField\`, or ` +
            "restrict it with `roles`; revoking the grant instead would be re-made at boot.",
        alternatives
    });
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function rlsDisabled(snapshot: DbSnapshot, finding: Finding): Remediation {
    const { schema, table } = finding.target;
    const rel = table ? relationAt(snapshot, schema, table) : undefined;
    if (!rel) return unresolved(finding);

    const exposed = exposedGrantees(snapshot, rel.schema, rel.name, DML).map((e) => e.role);
    const revokes = revokesReaching(snapshot, rel.schema, rel.name, exposed, DML);

    if (rel.kind === "foreign_table") {
        return {
            summary:
                `Revoke the API roles' privileges on ${rel.schema}.${rel.name}: it is a foreign table, and ` +
                "Postgres cannot put row-level security on one.",
            apply: "sql",
            sql: revokes.join("\n"),
            placeholders: [],
            alternatives: [],
            caveats: [
                "Callers that need this data must then reach it through a function or view that checks the " +
                "caller, kept in a schema your API does not expose."
            ],
            rebase: noRebaseRule(
                "Not expressible: a foreign table cannot have row-level security, and securityRules compile to " +
                "policies. Keep it out of the collections a Rebase backend serves."
            )
        };
    }

    const scope = ownerScope(snapshot, rel);
    const existing = policiesFor(snapshot, rel.schema, rel.name);
    const enable = `ALTER TABLE ${qrel(rel.schema, rel.name)} ENABLE ROW LEVEL SECURITY;`;
    const create =
        `CREATE POLICY ${qi(freshPolicyName(snapshot, rel.schema, rel.name, `${rel.name}_owner`))} ` +
        `ON ${qrel(rel.schema, rel.name)}\n` +
        `    FOR ALL\n` +
        `    USING (${scope.sql})\n` +
        `    WITH CHECK (${scope.sql});`;
    const rebase = rebaseRules(rel.schema, rel.name, [{ operation: "all", ownerField: scope.ownerField }],
        `${OWNER_FIELD_NOTE} Declare the table as a collection, or add the rule to the one that maps it.`);
    const revokeAlternative: AlternativeFix[] = revokes.length > 0
        ? [{ summary: "If API callers should not reach this table at all, revoke their privileges instead.", sql: revokes.join("\n") }]
        : [];

    // Policies already written for this table take effect the moment RLS is
    // on. Adding an owner policy beside them would OR a second grant into
    // whatever they say, so here enabling is the fix and the owner policy an
    // option.
    if (existing.length > 0) {
        const names = existing.map((p) => `"${p.name}"`).join(", ");
        return {
            summary:
                `Enable row-level security on ${rel.schema}.${rel.name}; its ${existing.length} existing ` +
                `${existing.length === 1 ? "policy" : "policies"} (${names}) then ${existing.length === 1 ? "takes" : "take"} effect.`,
            apply: "sql",
            sql: enable,
            placeholders: [],
            alternatives: [
                { summary: "If the existing policies do not admit what callers need, add an owner-scoped policy too.", sql: create },
                ...revokeAlternative
            ],
            caveats: [
                `The existing policies ${names} start filtering rows immediately — re-run rls-check after ` +
                "enabling: any dangerous one is reported under its own check id.",
                RLS_FILTERS_EVERYONE
            ],
            rebase
        };
    }

    return {
        summary: `Enable row-level security on ${rel.schema}.${rel.name} and add a policy that limits every row to its owner.`,
        apply: "sql",
        sql: `${enable}\n${create}`,
        placeholders: scope.placeholders,
        alternatives: revokeAlternative,
        caveats: [...callerCaveats(snapshot, scope), RLS_FILTERS_EVERYONE],
        rebase
    };
}

function rlsEnabledNoPolicies(snapshot: DbSnapshot, finding: Finding): Remediation {
    const { schema, table } = finding.target;
    const rel = table ? relationAt(snapshot, schema, table) : undefined;
    if (!rel) return unresolved(finding);

    const scope = ownerScope(snapshot, rel);
    const exposed = exposedGrantees(snapshot, rel.schema, rel.name, DML).map((e) => e.role);
    const revokes = revokesReaching(snapshot, rel.schema, rel.name, exposed, DML);

    return {
        summary: `Add a policy to ${rel.schema}.${rel.name} that admits each row to its owner; today it admits no row to anyone but the owner role.`,
        apply: "sql",
        sql:
            `CREATE POLICY ${qi(freshPolicyName(snapshot, rel.schema, rel.name, `${rel.name}_owner`))} ` +
            `ON ${qrel(rel.schema, rel.name)}\n` +
            `    FOR ALL\n` +
            `    USING (${scope.sql})\n` +
            `    WITH CHECK (${scope.sql});`,
        placeholders: scope.placeholders,
        alternatives: revokes.length > 0
            ? [{
                summary:
                    "If the table is meant to be unreachable through the API, make that explicit by revoking the " +
                    "API roles' privileges, and run rls-check with --skip rls-enabled-no-policies.",
                sql: revokes.join("\n")
            }]
            : [],
        caveats: callerCaveats(snapshot, scope),
        rebase: rebaseRules(rel.schema, rel.name, [{ operation: "all", ownerField: scope.ownerField }], OWNER_FIELD_NOTE)
    };
}

function rlsEnabledNotForced(snapshot: DbSnapshot, finding: Finding): Remediation {
    const { schema, table } = finding.target;
    const rel = table ? relationAt(snapshot, schema, table) : undefined;
    if (!rel) return unresolved(finding);

    const owner = roleNamed(snapshot, rel.owner);
    const bypasses = Boolean(owner?.superuser || owner?.bypassRls);
    const members = snapshot.exposedRoles.filter((role) =>
        !isPublicRole(role) && !sameRole(role, rel.owner) && rolesUsableBy(snapshot, role).has(rel.owner.toLowerCase()));
    const revokes = members.map((role) => `REVOKE ${qi(rel.owner)} FROM ${qi(role)};`);
    const force = `ALTER TABLE ${qrel(rel.schema, rel.name)} FORCE ROW LEVEL SECURITY;`;
    const membershipCaveat = members.length > 0
        ? [`If ${members.join(", ")} holds ${rel.owner} through another role rather than directly, the REVOKE ` +
            "is a no-op: revoke the intermediate membership instead."]
        : [];
    const rebase = noRebaseRule(
        "Not a securityRules setting. Rebase never sets FORCE: it runs every API request as rebase_user, which " +
        "does not own collection tables, so the owner's exemption never reaches a caller."
    );

    // Rebase's own privileged writes run as the owner and rely on the owner
    // bypassing plain ENABLE; its boot clears FORCE on the auth tables because
    // FORCE made the first sign-up after an upgrade fail with 42501.
    if (snapshot.platform === "rebase") {
        return {
            summary:
                `Do not FORCE row-level security on ${rel.schema}.${rel.name}: Rebase's privileged writes run as ` +
                `the owner ${rel.owner} and depend on its exemption. Make sure nothing untrusted connects as, or ` +
                "is a member of, that role.",
            apply: revokes.length > 0 ? "sql" : "manual",
            sql: revokes.length > 0 ? revokes.join("\n") : null,
            placeholders: [],
            alternatives: [],
            caveats: [
                ...membershipCaveat,
                "The finding stays until FORCE is set; on a Rebase database run rls-check with --skip " +
                "rls-enabled-not-forced once the API is confirmed to connect as rebase_user."
            ],
            rebase
        };
    }

    return {
        summary: bypasses
            ? `Set FORCE ROW LEVEL SECURITY on ${rel.schema}.${rel.name}, and stop the application connecting as ` +
              `${rel.owner}: it is ${owner?.superuser ? "a superuser" : "BYPASSRLS"}, which FORCE does not constrain.`
            : `Set FORCE ROW LEVEL SECURITY on ${rel.schema}.${rel.name} so its policies apply to the owner ` +
              `${rel.owner}${members.length > 0 ? `, and take that role away from ${members.join(", ")}` : ""}.`,
        apply: "sql",
        sql: [force, ...revokes].join("\n"),
        placeholders: [],
        alternatives: [],
        caveats: [
            `With FORCE set, ${rel.owner} is filtered by the policies too: a migration or job that runs as it ` +
            "and touches rows no policy admits sees fewer rows — run those as a superuser or a BYPASSRLS role.",
            ...membershipCaveat
        ],
        rebase
    };
}

function junctionTableUnprotected(snapshot: DbSnapshot, finding: Finding): Remediation {
    const { schema, table } = finding.target;
    const rel = table ? relationAt(snapshot, schema, table) : undefined;
    const fks = rel ? foreignKeysOf(snapshot, rel.schema, rel.name) : [];
    if (!rel || fks.length === 0) return unresolved(finding);

    // A link is visible when both rows it joins are: the endpoints' own
    // policies apply inside the subqueries, as they do to any query.
    const linked = (outer: (column: string) => string): string =>
        fks.map((fk, i) => {
            const alias = `e${i + 1}`;
            const on = fk.columns.map((column, k) => `${alias}.${qi(fk.refColumns[k] ?? "id")} = ${outer(column)}`);
            return `EXISTS (SELECT 1 FROM ${qrel(fk.refSchema, fk.refTable)} AS ${alias} WHERE ${on.join(" AND ")})`;
        }).join(" AND ");

    const name = freshPolicyName(snapshot, rel.schema, rel.name, `${rel.name}_select_via_endpoints`);
    const exposed = exposedGrantees(snapshot, rel.schema, rel.name, DML).map((e) => e.role);
    const revokes = revokesReaching(snapshot, rel.schema, rel.name, exposed, DML);
    const endpoints = fks.map((fk) => `${fk.refSchema}.${fk.refTable}`);

    return {
        summary:
            `Enable row-level security on ${rel.schema}.${rel.name} and let a caller read a link only when it can ` +
            `read both rows it joins (${endpoints.join(" and ")}).`,
        apply: "sql",
        sql:
            `ALTER TABLE ${qrel(rel.schema, rel.name)} ENABLE ROW LEVEL SECURITY;\n` +
            `CREATE POLICY ${qi(name)} ON ${qrel(rel.schema, rel.name)}\n` +
            `    FOR SELECT\n` +
            `    USING (${linked((column) => `${qi(rel.name)}.${qi(column)}`)});`,
        placeholders: [],
        alternatives: revokes.length > 0
            ? [{ summary: "If callers never read the join table directly, revoke their privileges instead.", sql: revokes.join("\n") }]
            : [],
        caveats: [
            `INSERT, UPDATE and DELETE on ${rel.schema}.${rel.name} are refused for every API role until a policy ` +
            "admits them: decide who may create a link — usually the owner of one endpoint — and add that policy.",
            `rls-check inferred that ${rel.schema}.${rel.name} is a join table from its shape; confirm before applying.`
        ],
        rebase: rebaseRules(
            rel.schema,
            rel.name,
            [{ name, operation: "select", using: linked((column) => `{${column}}`) }],
            "If this is the junction of a many-to-many link, declare it as a `relation` property with " +
            "`kind: \"manyToMany\"` instead: Rebase then creates the junction itself, with row-level security on " +
            `and policies derived from both collections. The rule here is for a join table modelled as its own collection. ${RAW_RULE_NOTE}`
        )
    };
}

function grantToPublic(snapshot: DbSnapshot, finding: Finding): Remediation {
    const { schema, table } = finding.target;
    const grant = snapshot.grants.find((g) => g.schema === schema && g.table === table && isPublicRole(g.grantee));
    const privileges = DML.filter((p) => grant?.privileges.includes(p));
    if (!table || privileges.length === 0) return unresolved(finding);

    return {
        summary: `Revoke ${privileges.join(", ")} on ${schema}.${table} from PUBLIC, then grant it to the roles that need it.`,
        apply: "sql",
        sql: `REVOKE ${privileges.join(", ")} ON ${qrel(schema, table)} FROM PUBLIC;`,
        placeholders: [],
        alternatives: [],
        caveats: [
            "Every role that read or wrote this table through PUBLIC loses access. Grant it back explicitly " +
            `where it is needed: GRANT ${privileges.join(", ")} ON ${qrel(schema, table)} TO "<role>";`
        ],
        rebase: noRebaseRule(
            "Not a securityRules setting: Rebase grants table privileges to its own request role, and the rules " +
            "decide which rows each request reaches."
        )
    };
}

// ---------------------------------------------------------------------------
// Views and routines
// ---------------------------------------------------------------------------

const VIEW_NOTE =
    "Not a securityRules setting: rules attach to a collection's table. Serve this data through a collection " +
    "over the base table, whose rules then apply to every read, rather than through a view.";

function viewBypassesRls(snapshot: DbSnapshot, finding: Finding): Remediation {
    const { schema } = finding.target;
    const name = finding.target.view ?? finding.target.table;
    const view = snapshot.views.find((v) => v.schema === schema && v.name === name);
    if (!view) return unresolved(finding);

    const roles = exposedGrantees(snapshot, view.schema, view.name, ["SELECT"]).map((e) => e.role);
    const revokes = revokesReaching(snapshot, view.schema, view.name, roles, ["SELECT"]);

    if (view.securityInvoker === null) {
        return {
            summary:
                `PostgreSQL ${snapshot.serverVersion} has no security_invoker, so revoke the API roles' SELECT on ` +
                `${view.schema}.${view.name} and let callers query the base tables, whose policies apply to them.`,
            apply: "sql",
            sql: revokes.join("\n"),
            placeholders: [],
            alternatives: [],
            caveats: ["On PostgreSQL 15 or newer, ALTER VIEW … SET (security_invoker = true) keeps the view usable instead."],
            rebase: noRebaseRule(VIEW_NOTE)
        };
    }

    // The caller needs its own SELECT on every base table once the view runs
    // as the caller. Name the ones missing, or the fix reads as a break.
    const missing = protectedBaseTables(snapshot, view).flatMap((base) =>
        roles
            .filter((role) => !effectivePrivileges(snapshot, base.schema, base.name, role).has("SELECT"))
            .map((role) => `${role} holds no SELECT on ${base.schema}.${base.name}, so its reads of the view will ` +
                `fail with "permission denied" until you GRANT SELECT ON ${qrel(base.schema, base.name)} TO ` +
                `${isPublicRole(role) ? "PUBLIC" : qi(role)}; the policies there then decide which rows it sees.`));

    return {
        summary:
            `Make ${view.schema}.${view.name} run with the caller's privileges, so row-level security on the tables ` +
            "it reads applies to the caller rather than to the view's owner.",
        apply: "sql",
        sql: `ALTER VIEW ${qrel(view.schema, view.name)} SET (security_invoker = true);`,
        placeholders: [],
        alternatives: revokes.length > 0
            ? [{ summary: "If callers do not need the view, revoke their SELECT on it instead.", sql: revokes.join("\n") }]
            : [],
        caveats: missing,
        rebase: noRebaseRule(VIEW_NOTE)
    };
}

function matviewBypassesRls(snapshot: DbSnapshot, finding: Finding): Remediation {
    const { schema } = finding.target;
    const name = finding.target.view ?? finding.target.table;
    if (!name) return unresolved(finding);

    const roles = exposedGrantees(snapshot, schema, name, ["SELECT"]).map((e) => e.role);
    const revokes = revokesReaching(snapshot, schema, name, roles, ["SELECT"]);
    if (revokes.length === 0) return unresolved(finding);

    return {
        summary:
            `Revoke the API roles' SELECT on materialized view ${schema}.${name}: it stores rows computed by its ` +
            "owner, and no policy can filter them.",
        apply: "sql",
        sql: revokes.join("\n"),
        placeholders: [],
        alternatives: [],
        caveats: [
            "If callers need this data, serve it through a plain view created WITH (security_invoker = true) over " +
            "the base tables, so their policies apply to each caller."
        ],
        rebase: noRebaseRule(VIEW_NOTE)
    };
}

function securityDefinerMutableSearchPath(snapshot: DbSnapshot, finding: Finding): Remediation {
    const { schema, routine } = finding.target;
    if (!routine) return unresolved(finding);

    return {
        summary: `Pin search_path on every overload of the SECURITY DEFINER routine ${schema}.${routine}.`,
        apply: "sql",
        sql: pinSearchPathSql(schema, routine),
        placeholders: [],
        alternatives: [],
        caveats: [
            "Only pg_catalog is on the path afterwards: schema-qualify every table and function the body uses " +
            "(public.orders, not orders), or the routine fails at its next call."
        ],
        rebase: noRebaseRule("Not a securityRules setting: it concerns a function, not a collection's rows.")
    };
}

// ---------------------------------------------------------------------------
// Expressions rewritten in place
// ---------------------------------------------------------------------------

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** An identifier as Postgres may print it: bare, or double-quoted. */
const identifier = (name: string): string => `(?:"${escapeRegExp(name.replace(/"/g, '""'))}"|${escapeRegExp(name)})`;

/**
 * `expr` with the one comparison `hit` names re-pointed at the outer row, or
 * null when that comparison is not there exactly once — a rewrite that could
 * land in the wrong place is not offered.
 */
function rewriteAmbiguity(expr: string, hit: Ambiguity, outer: string): string | null {
    let pattern: RegExp;
    if (hit.kind === "self") {
        const [qualifier, column] = [hit.comparedTo.slice(0, hit.comparedTo.lastIndexOf(".")), hit.column];
        const side = `${identifier(qualifier)}\\s*\\.\\s*${identifier(column)}`;
        pattern = new RegExp(`(${side}\\s*${escapeRegExp(hit.operator ?? "=")})\\s*${side}(?![\\w$"])`, "gi");
        const matches = expr.match(pattern) ?? [];
        if (matches.length !== 1) return null;
        return expr.replace(pattern, (_m, left: string) => `${left} ${outer}`);
    }
    // A bare name: not after a dot, not before one, not part of a longer word.
    pattern = new RegExp(`(?<![\\w$."])(?<!\\.\\s*)${escapeRegExp(hit.column)}(?![\\w$"])(?!\\s*\\.)`, "gi");
    const matches = expr.match(pattern) ?? [];
    if (matches.length !== 1) return null;
    return expr.replace(pattern, outer);
}

function unqualifiedColumnInSubquery(snapshot: DbSnapshot, finding: Finding): Remediation {
    const policy = policyAt(snapshot, finding);
    if (!policy) return unresolved(finding);

    const hits = policyAmbiguities(snapshot, policy).filter((a) => a.hit.column === finding.target.column);
    if (hits.length === 0) return unresolved(finding);

    const rewrite = (outer: (column: string) => string) => {
        const out: Partial<Record<Clause, string>> = {};
        for (const { clause, hit } of hits) {
            const current = out[clause] ?? clauseExpr(policy, clause);
            const next = current === null ? null : rewriteAmbiguity(current, hit, outer(hit.column));
            if (next === null) return null;
            out[clause] = next;
        }
        return out;
    };

    const sqlClauses = rewrite((column) => `${qi(policy.table)}.${qi(column)}`);
    const ruleClauses = rewrite((column) => `{${column}}`);
    const column = finding.target.column ?? hits[0].hit.column;
    const inner = hits[0].hit.inner;
    const confirm =
        `This assumes ${policy.table}.${column} — the row being checked — was meant, not ${inner}.${column}. ` +
        "Confirm before applying: it changes which rows the policy admits.";

    const rebase = ruleClauses
        ? rebaseRules(policy.schema, policy.table, [rawRule(
            snapshot,
            policy,
            ruleClauses.USING ?? policy.using,
            ruleClauses["WITH CHECK"] ?? policy.withCheck
        )], `${rawRuleNote(snapshot, policy.using, policy.withCheck)} The structured form, ` +
            "`policy.existsIn({ collection, where })` with `policy.outerField(\"…\")` for the outer row, makes " +
            "the binding explicit and is checked by the type system.")
        : noRebaseRule("The comparison could not be located in the expression exactly once, so no rule was derived.");

    if (!sqlClauses) {
        return {
            summary:
                `In ${where(finding)}, qualify \`${column}\` inside the subquery over ${inner} as ` +
                `${policy.table}.${column} if it is meant to name the row being checked.`,
            apply: "manual",
            sql: null,
            placeholders: [],
            alternatives: [],
            caveats: [confirm],
            rebase
        };
    }

    if (isRebaseManagedPolicy(snapshot, policy)) {
        return {
            summary: `Qualify \`${column}\` in the rule that compiles to ${where(finding)}, so it names the row being checked.`,
            apply: "rebase-config",
            sql: null,
            placeholders: [],
            alternatives: [],
            caveats: [managedCaveat(policy), confirm],
            rebase
        };
    }

    return {
        summary: `Point \`${column}\` in ${where(finding)} at the row being checked, ${policy.table}.${column}.`,
        apply: "sql",
        sql: alterPolicySql(policy, sqlClauses),
        placeholders: [],
        alternatives: [],
        caveats: [confirm],
        rebase
    };
}

function currentSettingThrows(snapshot: DbSnapshot, finding: Finding): Remediation {
    const policy = policyAt(snapshot, finding);
    if (!policy) return unresolved(finding);

    const fixed: Partial<Record<Clause, string>> = {};
    for (const clause of ["USING", "WITH CHECK"] as const) {
        const expr = clauseExpr(policy, clause);
        if (expr === null) continue;
        const next = withMissingOk(expr);
        if (next !== expr) fixed[clause] = next;
    }
    if (Object.keys(fixed).length === 0) return unresolved(finding);

    const rebase = rebaseRules(policy.schema, policy.table, [rawRule(
        snapshot,
        policy,
        fixed.USING ?? policy.using,
        fixed["WITH CHECK"] ?? policy.withCheck
    )], rawRuleNote(snapshot, policy.using, policy.withCheck));

    if (isRebaseManagedPolicy(snapshot, policy)) {
        return {
            summary: `Pass missing_ok (a second argument, true) to current_setting in the rule that compiles to ${where(finding)}.`,
            apply: "rebase-config",
            sql: null,
            placeholders: [],
            alternatives: [],
            caveats: [managedCaveat(policy)],
            rebase
        };
    }

    return {
        summary:
            `Pass missing_ok to current_setting in ${where(finding)}, so an unset setting denies the row instead ` +
            "of failing the query.",
        apply: "sql",
        sql: alterPolicySql(policy, fixed),
        placeholders: [],
        alternatives: [],
        caveats: [],
        rebase
    };
}

function policyRoleUnreachable(snapshot: DbSnapshot, finding: Finding): Remediation {
    const { schema, table } = finding.target;
    const policies = table ? policiesFor(snapshot, schema, table) : [];
    if (!table || policies.length === 0) return unresolved(finding);

    const named = [...new Set(policies.flatMap((p) => p.roles))];
    const candidates = snapshot.exposedRoles.filter((role) => !isPublicRole(role) &&
        DML.some((p: Privilege) => effectivePrivileges(snapshot, schema, table, role).has(p)));
    const placeholder: Placeholder = {
        token: APP_ROLE_PLACEHOLDER,
        meaning:
            "The role your application's requests run as, as a quoted identifier — run SELECT current_user; on " +
            "the application's own connection." +
            (candidates.length > 0 ? ` Roles that hold privileges on ${schema}.${table}: ${candidates.join(", ")}.` : "")
    };
    const rebase = rebaseRules(schema, table, policies.map((p) => rawRule(snapshot, p, p.using, p.withCheck)),
        "A rule without `pgRoles` applies TO PUBLIC — every connection — and Rebase's API decides who is signed " +
        `in; \`pgRoles\` is what pointed these policies at ${named.join(", ")}. ${RAW_RULE_NOTE}`);

    if (policies.every((p) => isRebaseManagedPolicy(snapshot, p))) {
        return {
            summary:
                `Remove \`pgRoles\` from the rules that compile to the policies on ${schema}.${table}, or set it ` +
                "to the role requests actually arrive as.",
            apply: "rebase-config",
            sql: null,
            placeholders: [],
            alternatives: [],
            caveats: [managedCaveat(policies[0])],
            rebase
        };
    }

    return {
        summary:
            `Point the ${policies.length === 1 ? "policy" : "policies"} on ${schema}.${table} at the role your ` +
            `application connects as; today ${policies.length === 1 ? "it names" : "they name"} only ` +
            `${named.join(", ")}, which no session uses.`,
        apply: "sql",
        sql: policies
            .map((p) => `ALTER POLICY ${qi(p.name)} ON ${qrel(schema, table)} TO ${APP_ROLE_PLACEHOLDER};`)
            .join("\n"),
        placeholders: [placeholder],
        alternatives: [{
            summary: `Or keep the policies as they are and make the application role a member of ${named[0]}.`,
            sql: `GRANT ${isPublicRole(named[0]) ? "PUBLIC" : qi(named[0])} TO ${APP_ROLE_PLACEHOLDER};`
        }],
        caveats: ["Once a reachable role is named, the policies' expressions decide what it sees — review them before applying."],
        rebase
    };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** One builder per check id. A check without one is caught by `remediation.test.ts`. */
export const REMEDIATIONS: Record<string, (snapshot: DbSnapshot, finding: Finding) => Remediation> = {
    "rls-disabled": rlsDisabled,
    "policy-always-true": policyAlwaysTrue,
    "policy-anonymous-tautology": policyAnonymousTautology,
    "policy-authenticated-tautology": policyAuthenticatedTautology,
    "view-bypasses-rls": viewBypassesRls,
    "matview-bypasses-rls": matviewBypassesRls,
    "anonymous-write-allowed": anonymousWriteAllowed,
    "unqualified-column-in-subquery": unqualifiedColumnInSubquery,
    "junction-table-unprotected": junctionTableUnprotected,
    "rls-enabled-not-forced": rlsEnabledNotForced,
    "rls-enabled-no-policies": rlsEnabledNoPolicies,
    "policy-role-unreachable": policyRoleUnreachable,
    "grant-to-public": grantToPublic,
    "security-definer-mutable-search-path": securityDefinerMutableSearchPath,
    "current-setting-throws": currentSettingThrows
};

/** The remediation for one finding, computed against the snapshot it came from. */
export function remediationFor(snapshot: DbSnapshot, finding: Finding): Remediation {
    const build = REMEDIATIONS[finding.id];
    return build ? build(snapshot, finding) : unresolved(finding);
}
