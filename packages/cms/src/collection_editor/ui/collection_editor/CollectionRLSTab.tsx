
import { getPolicyNamesForRule, getPolicyNamesForRules } from "@rebasepro/utils";
import { getGeneratedPolicyNames, getTableName } from "@rebasepro/common";
import React, { useState, useEffect, useMemo } from "react";

/**
 * Validates and double-quotes a SQL identifier to prevent injection.
 * Only allows safe Postgres identifiers (letters, digits, underscores).
 * Throws if the identifier contains unsafe characters.
 */
function sanitizeSqlIdentifier(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
        throw new Error(`Invalid SQL identifier: "${name}". Only letters, digits, and underscores are allowed.`);
    }
    return `"${name}"`;
}
import {
    Button,
    Chip,
    CircularProgress,
    cls,
    Container,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    iconSize,
    KeyIcon,
    MultiSelect,
    MultiSelectItem,
    Paper,
    Select,
    SelectItem,
    TextField,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useFormex } from "@rebasepro/forms";
import { useCollectionsConfigController } from "../../useCollectionsConfigController";
import { useRebaseContext, useTranslation } from "@rebasepro/app";
import type { AdminCollection } from "@rebasepro/cms-types";
import {
    isPostgresCollectionConfig,
    RLS_ROLES_SQL,
    RLS_UID_SQL,
    type PolicyExpression,
    type PostgresPolicy,
    type SecurityOperation,
    type SecurityRule,
    type SecurityRuleBase
} from "@rebasepro/types";

export type { PostgresPolicy } from "@rebasepro/types";

type CollectionWithSecurity = AdminCollection & {
    securityRules?: SecurityRule[];
};

/**
 * The security-rule fields a {@link PostgresPolicy} describes, and the ones an
 * edit carries over from the rule it changes.
 *
 * Wider than any one `SecurityRule` variant on purpose — the same shape as
 * Studio's `PolicyRule`: a policy with only a `WITH CHECK` clause, which is
 * every INSERT-only policy, carries `withCheck` and no `using`. The raw-SQL
 * variant requires `using` and the roles-only one forbids `withCheck`, but the
 * generator compiles the pair exactly as written.
 */
type PolicyRule = SecurityRuleBase & {
    using?: string;
    withCheck?: string;
    ownerField?: string;
    access?: "public";
    condition?: PolicyExpression;
    check?: PolicyExpression;
};

/**
 * `pg_policies` reports the operation and the permissive flag in upper case;
 * `SecurityRule` names them in lower case. These two used to be `.toLowerCase()`
 * assigned straight into a `SecurityRule`, which typechecks only against a
 * `string` field — and this file declared its own local `SecurityRule` with
 * `operation?: string`, so it did. Against the real type it does not: an
 * unrecognised `cmd` would have been written into the collection as a policy
 * operation that compiles to nothing.
 */
function toSecurityOperation(cmd: PostgresPolicy["cmd"] | undefined): SecurityOperation | undefined {
    switch (cmd) {
        case "SELECT": return "select";
        case "INSERT": return "insert";
        case "UPDATE": return "update";
        case "DELETE": return "delete";
        case "ALL": return "all";
        default: return undefined;
    }
}

function toSecurityMode(permissive: PostgresPolicy["permissive"] | undefined): SecurityRule["mode"] {
    // Absent stays absent. `permissive` is the default, so writing it out
    // changes nothing semantically — but this value is serialized into the
    // user's collection file, and defaulting here would grow a `mode:
    // "permissive"` on every rule the editor touches. The `.toLowerCase()`
    // this replaced returned `undefined` for an absent value; that part was
    // right, and only the widened type was wrong.
    if (!permissive) return undefined;
    return permissive === "RESTRICTIVE" ? "restrictive" : "permissive";
}

/**
 * Build a rule from a `pg_policies` row, or from what the inline editor saved.
 *
 * The WITH CHECK is kept whether or not there is a USING. It used to be kept
 * only beside one, because the raw-SQL `SecurityRule` requires `using` — so
 * every INSERT-only policy, which has only a check, came out as a roles-only
 * rule, and a roles-only rule with no roles compiles to `WITH CHECK (false)`:
 * saved or imported here, the policy stopped every insert.
 */
function toSecurityRule(policy: Partial<PostgresPolicy>): PolicyRule {
    return {
        name: policy.policyname ?? "",
        operation: toSecurityOperation(policy.cmd),
        mode: toSecurityMode(policy.permissive),
        roles: policy.roles ? [...policy.roles] : undefined,
        ...(policy.qual ? { using: policy.qual } : {}),
        ...(policy.with_check ? { withCheck: policy.with_check } : {})
    };
}

/**
 * Build a {@link SecurityRule} from a live `pg_policies` row, for "Import to
 * codebase".
 *
 * Not {@link toSecurityRule}: that one reads `roles` as the inline editor
 * fills it, with *application* roles. A live policy's `roles` is its `TO`
 * list — *database* roles — which is `pgRoles`. Imported as `roles`, `TO
 * public` became a `rebase.roles()` check no user passes, and on a restrictive
 * policy, which compiles to `NOT (roles) OR condition`, a gate every user
 * passes.
 *
 * `pgRoles` is omitted at the `public` default, so a rule that targets every
 * connection — nearly all of them — carries no advanced field it does not need.
 */
function livePolicyToSecurityRule(policy: PostgresPolicy): PolicyRule {
    const { roles, ...rest } = policy;
    const rule = toSecurityRule(rest);
    const targetsEveryone = roles.length === 0 || (roles.length === 1 && roles[0] === "public");
    return targetsEveryone ? rule : { ...rule, pgRoles: [...roles] };
}

/**
 * The rule with what the editor changed, and nothing else.
 *
 * The editor shows a rule as a policy — name, command, mode, application roles
 * and raw USING / WITH CHECK — and has no field for `ownerField`, `access`, a
 * structured `condition`, `operations` (it shows them as ALL) or `pgRoles`.
 * The rule used to be rebuilt from the form, which dropped all of them:
 * renaming an owner rule saved a roles-only rule with no roles, which compiles
 * to `USING (false)`. So a field is only written when it differs from what the
 * editor was opened with. A condition typed in replaces the rule's condition
 * whole — the forms are exclusive.
 *
 * Studio's RLS editor does the same in `policyRules.ts`; there the editor's
 * roles are the policy's `TO` list, `pgRoles`, and here they are `roles`.
 */
function editedRule(rule: SecurityRule, original: PostgresPolicy, edited: Partial<PostgresPolicy>): PolicyRule {
    const next = toSecurityRule(edited);
    const result: PolicyRule = { ...rule };

    if ((edited.policyname ?? "") !== original.policyname) {
        if (next.name) result.name = next.name;
        else delete result.name;
    }
    if (edited.cmd !== original.cmd) {
        // `operations` wins over `operation`, so it has to go for the new
        // command to mean anything.
        delete result.operations;
        result.operation = next.operation;
    }
    if (edited.permissive !== original.permissive) {
        result.mode = next.mode;
    }
    if (!sameRoles(edited.roles, original.roles)) {
        if (next.roles && next.roles.length > 0) result.roles = next.roles;
        else delete result.roles;
    }
    if ((edited.qual || null) !== (original.qual || null) || (edited.with_check || null) !== (original.with_check || null)) {
        delete result.ownerField;
        delete result.access;
        delete result.condition;
        delete result.check;
        delete result.using;
        delete result.withCheck;
        if (next.using) result.using = next.using;
        if (next.withCheck) result.withCheck = next.withCheck;
    }
    return result;
}

function sameRoles(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    const left = [...(a ?? [])].sort();
    const right = [...(b ?? [])].sort();
    return left.length === right.length && left.every((role, i) => role === right[i]);
}

export function CollectionRLSTab() {
    const { values, setFieldValue } = useFormex<CollectionWithSecurity>();
    // The rule being edited is held by its position: an unnamed rule has no
    // name to find it by, and matching `rule.name` against the editor's empty
    // name found nothing, so the save wrote the rules back unchanged.
    const [editing, setEditing] = useState<{ index: number; policy: PostgresPolicy } | "new" | null>(null);

    // Every other tab in this dialog disables its inputs when the backend will
    // not accept an edit — the general and display forms behind a `fieldset
    // disabled`, the properties editor per control. This one did not, so a
    // read-only panel still invited you to write a policy, delete one, and
    // reorder the lot, and only said no at the submit button on the way out.
    const { readOnly, readOnlyReason } = useCollectionsConfigController();
    const readOnlyTitle = readOnlyReason || "This backend does not accept collection edits.";

    const rules: SecurityRule[] = values.securityRules || [];

    const { databaseAdmin } = useRebaseContext();
    const [dbPolicies, setDbPolicies] = useState<PostgresPolicy[]>([]);
    const [isLoadingDb, setIsLoadingDb] = useState(false);

    // The table `db push` writes this collection's policies on, resolved the
    // way the planner resolves it: `getTableName`, in the collection's schema
    // or `public`. This read `id || table || alias` — none of which a
    // collection that leaves `table` to its slug has, so it loaded no live
    // policies at all — and matched the name in every schema, offering another
    // schema's same-named table's policies for import into this collection.
    const tableName = getTableName(values);
    const schemaName = isPostgresCollectionConfig(values) && values.schema ? values.schema : "public";

    useEffect(() => {
        const fetchLivePolicies = async () => {
            if (!tableName || !databaseAdmin?.executeSql) return;

            setIsLoadingDb(true);
            try {
                // Both validated to be [a-zA-Z_][a-zA-Z0-9_]* — safe inside a
                // string literal once the double quotes are stripped.
                const rawTableName = sanitizeSqlIdentifier(tableName).slice(1, -1);
                const rawSchemaName = sanitizeSqlIdentifier(schemaName).slice(1, -1);
                const sql = `
                    SELECT policyname, permissive, roles, cmd, qual, with_check
                    FROM pg_policies
                    WHERE schemaname = '${rawSchemaName}' AND tablename = '${rawTableName}';
                `;
                const result = await databaseAdmin.executeSql(sql);
                const extractRows = (res: unknown): Record<string, unknown>[] => {
                    if (res && typeof res === "object" && "rows" in res && Array.isArray((res as { rows: Record<string, unknown>[] }).rows)) {
                        return (res as { rows: Record<string, unknown>[] }).rows;
                    }
                    if (Array.isArray(res)) return res as Record<string, unknown>[];
                    return [];
                };
                const pRows = extractRows(result);
                const policies: PostgresPolicy[] = pRows.map((p: Record<string, unknown>) => {
                    let parsedRoles: string[] = [];
                    const r = p.roles || p.ROLES;
                    if (Array.isArray(r)) {
                        parsedRoles = r as string[];
                    } else if (typeof r === "string") {
                        parsedRoles = r.replace(/^{|}$/g, "").split(",").map((s: string) => s.trim());
                    }
                    return {
                        policyname: (p.policyname || p.POLICYNAME || "") as string,
                        tablename: tableName,
                        permissive: (p.permissive || p.PERMISSIVE || "PERMISSIVE") as "PERMISSIVE" | "RESTRICTIVE",
                        roles: parsedRoles,
                        cmd: (p.cmd || p.CMD || "ALL") as "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL",
                        qual: (p.qual || p.QUAL || null) as string | null,
                        with_check: (p.with_check || p.WITH_CHECK || null) as string | null
                    };
                });
                setDbPolicies(policies);
            } catch (e) {
                console.error("Failed to fetch DB policies", e);
            } finally {
                setIsLoadingDb(false);
            }
        };
        fetchLivePolicies();
    }, [databaseAdmin, tableName, schemaName]);

    /**
     * Application roles available to `SecurityRule.roles`.
     *
     * Deliberately NOT `fetchAvailableRoles` — that returns native pg_roles
     * (postgres, rebase_user, …), which can never satisfy an application-role
     * condition.
     */
    const [availableRoles, setAvailableRoles] = useState<string[]>([]);
    const [rolesUnavailable, setRolesUnavailable] = useState(false);

    useEffect(() => {
        let mounted = true;
        const fetchRoles = async () => {
            if (!databaseAdmin?.fetchApplicationRoles) {
                // Older backend, or a driver with no application-role concept.
                if (mounted) setRolesUnavailable(true);
                return;
            }
            try {
                const fetched = await databaseAdmin.fetchApplicationRoles();
                if (mounted) {
                    setAvailableRoles(fetched);
                    setRolesUnavailable(false);
                }
            } catch (e) {
                console.error("Failed to fetch application roles", e);
                if (mounted) setRolesUnavailable(true);
            }
        };
        fetchRoles();
        return () => {
            mounted = false;
        };
    }, [databaseAdmin]);

    // Every policy name `rebase db push` would write for this collection — see
    // `getGeneratedPolicyNames`. This used to be derived here by hand, and the
    // Studio's RLS editor derived a different subset of it by hand, which is
    // exactly how the two came to disagree about which policies were drift.
    const generatedPolicyNames = useMemo(() => {
        if (!tableName) return new Set<string>();
        return getGeneratedPolicyNames(values as AdminCollection);
    }, [tableName, values]);

    const unmappedPolicies = dbPolicies.filter(dp => !generatedPolicyNames.has(dp.policyname));

    const handleSave = (newPolicy: Partial<PostgresPolicy>) => {
        if (!editing) return;
        const newRules: PolicyRule[] = editing === "new"
            ? [...rules, toSecurityRule(newPolicy)]
            : rules.map((r, i) => (i === editing.index ? editedRule(r, editing.policy, newPolicy) : r));
        setFieldValue("securityRules", newRules);
        setEditing(null);
    };

    return (
        <div className={"overflow-auto my-auto"}>
            <Container maxWidth={"4xl"} className={"flex flex-col gap-4 p-8 m-auto"}>
                <div className="w-full flex flex-col">
                <div className="flex items-center justify-between mb-8">
                    <Typography variant="h5">Row Level Security</Typography>
                    <Tooltip title={readOnly ? readOnlyTitle : undefined}>
                        <div>
                            <Button variant="filled" color="neutral" disabled={readOnly} onClick={() => setEditing("new")}>
                                CREATE POLICY
                            </Button>
                        </div>
                    </Tooltip>
                </div>

                {rules.length === 0 ? (
                    <div className="flex-grow flex items-center justify-center text-text-disabled py-12">
                        <Typography variant="body2">No RLS policies defined for this collection.</Typography>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {rules.map((rule: SecurityRule, index: number) => (
                            <Paper key={`${index}:${rule.name ?? ""}`}
                                className={"p-4 border border-transparent hover:border-surface-200 dark:hover:border-surface-700 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors bg-surface-card shadow-sm"}>
                                <div className="flex flex-col gap-1.5 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <KeyIcon size={iconSize.smallest} className="text-text-disabled dark:text-text-disabled-dark shrink-0"/>
                                        <Typography variant="subtitle2" className="truncate">
                                            {/* Unnamed rules are still named in Postgres — show what they compile to
                                                rather than an empty heading. */}
                                            {rule.name || (tableName
                                                ? getPolicyNamesForRule(rule, tableName).join(", ")
                                                : "Unnamed policy")}
                                        </Typography>
                                    </div>
                                    <div className="flex gap-2 text-xs pl-6 overflow-x-auto hide-scrollbar">
                                        <Chip size="small" className="bg-surface-raised text-text-secondary border-none">Action: {rule.operation || "ALL"}</Chip>
                                        <Chip size="small" className="bg-surface-raised text-text-secondary border-none">Roles: {Array.isArray(rule.roles) ? rule.roles.join(", ") : rule.roles}</Chip>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                    <Button size="small" variant="text" disabled={readOnly} onClick={() => setEditing({
                                        index,
                                        policy: {
                                            policyname: rule.name ?? "",
                                            tablename: tableName || "your_table",
                                            permissive: (rule.mode || "permissive").toUpperCase() as PostgresPolicy["permissive"],
                                            cmd: (rule.operation || "ALL").toUpperCase() as PostgresPolicy["cmd"],
                                            roles: [...(rule.roles ?? [])],
                                            qual: rule.using || null,
                                            with_check: rule.withCheck || null
                                        }
                                    })}>
                                        EDIT
                                    </Button>
                                    <IconButton size="small" disabled={readOnly} onClick={() => {
                                        // By position, for the reason editing is: filtered
                                        // by `name`, every unnamed rule went with this one.
                                        setFieldValue("securityRules", rules.filter((_r: SecurityRule, i: number) => i !== index));
                                    }}>
                                        <Trash2Icon size={iconSize.smallest} className="text-text-secondary dark:text-text-secondary-dark hover:text-red-500 dark:hover:text-red-500 transition-colors"/>
                                    </IconButton>
                                </div>
                            </Paper>
                        ))}
                    </div>
                )}

                {isLoadingDb && unmappedPolicies.length === 0 && (
                    <div className="flex justify-center mt-8">
                        <CircularProgress size="small"/>
                    </div>
                )}

                {!isLoadingDb && unmappedPolicies.length > 0 && (
                    <div className="mt-12 flex flex-col gap-4">
                        <Typography variant="h6" className="text-text-secondary">Unmapped Database Policies</Typography>
                        <Typography variant="body2" className="text-text-secondary opacity-80 -mt-2">
                            These policies exist in your Postgres database but are not mapped to this collection&apos;s codebase configuration.
                        </Typography>
                        <div className="flex flex-col gap-3">
                            {unmappedPolicies.map(dp => (
                                <Paper key={dp.policyname}
                                    className={"p-4 border border-orange-200 dark:border-orange-900/50 bg-orange-50/50 dark:bg-orange-900/10 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors"}>
                                    <div className="flex flex-col gap-1.5 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <KeyIcon size={iconSize.smallest} className="text-orange-500 shrink-0"/>
                                            <Typography variant="subtitle2" className="truncate">{dp.policyname}</Typography>
                                            <Tooltip title="This policy is live in the database but missing from your codebase schema.">
                                                <div className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-orange-500/10 text-orange-600 border border-orange-500/20 shrink-0">
                                                    DB Only
                                                </div>
                                            </Tooltip>
                                        </div>
                                        <div className="flex gap-2 text-xs pl-6 overflow-x-auto hide-scrollbar">
                                            <Chip size="small" className="bg-surface-card text-text-secondary border-none">Action: {dp.cmd || "ALL"}</Chip>
                                            <Chip size="small" className="bg-surface-card text-text-secondary border-none">Roles: {Array.isArray(dp.roles) ? dp.roles.join(", ") : dp.roles}</Chip>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                        {/* "Import to codebase" is the one action here that
                                            names its destination, and it is the one the
                                            backend refuses when it has no codebase to write. */}
                                        <Tooltip title={readOnly ? readOnlyTitle : undefined}>
                                            <div>
                                                <Button size="small" variant="outlined" color="primary" disabled={readOnly} onClick={() => {
                                                    const rule: PolicyRule = livePolicyToSecurityRule(dp);
                                                    setFieldValue("securityRules", [...rules, rule]);
                                                }}>
                                                    Import to codebase
                                                </Button>
                                            </div>
                                        </Tooltip>
                                    </div>
                                </Paper>
                            ))}
                        </div>
                    </div>
                )}
                </div>
                <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)} maxWidth="4xl">
                    {editing && (
                        <InlinePolicyEditor
                            policy={editing === "new" ? undefined : editing.policy}
                            table={tableName || "your_table"}
                            schema={schemaName}
                            availableRoles={availableRoles}
                            rolesUnavailable={rolesUnavailable}
                            onSave={handleSave}
                            onCancel={() => setEditing(null)}
                        />
                    )}
                </Dialog>
            </Container>
        </div>
    );
}

// ─── Inline Policy Editor (no Monaco dependency) ────────────────────

type PolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";
const COMMAND_OPTIONS: PolicyCommand[] = ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"];

function InlinePolicyEditor({
    policy,
    table,
    schema,
    availableRoles,
    rolesUnavailable,
    onSave,
    onCancel
}: {
    policy?: PostgresPolicy;
    table: string;
    schema: string;
    availableRoles: string[];
    rolesUnavailable: boolean;
    onSave: (policyData: Partial<PostgresPolicy>) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [name, setName] = useState(policy?.policyname || "");
    const [behavior, setBehavior] = useState<"PERMISSIVE" | "RESTRICTIVE">(policy?.permissive || "PERMISSIVE");
    const [command, setCommand] = useState<PolicyCommand>((policy?.cmd as PolicyCommand) || "ALL");
    // No roles means "not restricted by role". Seeding a value here would
    // silently narrow every new policy to it.
    const [roles, setRoles] = useState<string[]>(
        policy?.roles ? (Array.isArray(policy.roles) ? policy.roles : [policy.roles]) : []
    );
    const [customRole, setCustomRole] = useState("");
    const [usingExpr, setUsingExpr] = useState(policy?.qual || "");
    const [checkExpr, setCheckExpr] = useState(policy?.with_check || "");

    const showCheck = command === "ALL" || command === "INSERT" || command === "UPDATE";

    /**
     * Roles offered in the dropdown: those in use in the project, plus any the
     * rule already carries. The union matters — application roles are derived
     * from what users hold, so a role that is referenced here but assigned to
     * nobody would otherwise vanish from its own policy on the next save.
     */
    const roleOptions = useMemo(
        () => Array.from(new Set([...availableRoles, ...roles])).sort(),
        [availableRoles, roles]
    );

    const addCustomRole = () => {
        const trimmed = customRole.trim();
        if (!trimmed || roles.includes(trimmed)) {
            setCustomRole("");
            return;
        }
        setRoles([...roles, trimmed]);
        setCustomRole("");
    };

    return (
        <>
            <DialogTitle variant="h6">
                {policy ? "Edit Policy" : "Create Policy"}
                <div className="text-sm font-normal text-text-secondary dark:text-text-secondary-dark tracking-wide mt-1">
                    Define RLS rules for <span className="font-mono text-primary bg-primary-bg px-1 py-0.5 rounded">{schema}.{table}</span>
                </div>
            </DialogTitle>
            <DialogContent className="p-4 md:p-6 border-t dark:border-surface-700 bg-surface-sheet" includeMargin={false}>
                <Paper className={cls("p-4 md:p-6 flex flex-col gap-6 bg-surface-card border-none sm:border-solid rounded-none sm:rounded-xl", defaultBorderMixin)}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                            <Typography variant="caption" className="uppercase tracking-wider text-text-secondary">{t("studio_policy_name")}</Typography>
                            <TextField aria-label={t("studio_policy_name")} value={name} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setName(e.target.value)} placeholder="e.g. allow_read_all"/>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Typography variant="caption" className="uppercase tracking-wider text-text-secondary">Behavior</Typography>
                            <Select value={behavior} onValueChange={(val: string) => setBehavior(val as "PERMISSIVE" | "RESTRICTIVE")} position="item-aligned">
                                <SelectItem value="PERMISSIVE">Permissive</SelectItem>
                                <SelectItem value="RESTRICTIVE">Restrictive</SelectItem>
                            </Select>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Typography variant="caption" className="uppercase tracking-wider text-text-secondary">Command</Typography>
                        <div className="flex flex-wrap gap-1.5">
                            {COMMAND_OPTIONS.map(cmd => (
                                <Button key={cmd} size="small" variant={command === cmd ? "filled" : "text"} color="neutral" onClick={() => setCommand(cmd)}>
                                    {cmd}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Typography variant="caption" className="uppercase tracking-wider text-text-secondary">Application Roles</Typography>
                        <Typography variant="caption" className="text-text-secondary opacity-80 -mt-1">
                            Roles held by users of this project, matched via <span className="font-mono">{RLS_ROLES_SQL}</span>.
                            These are not PostgreSQL roles — leave empty to apply the policy to everyone.
                        </Typography>
                        {roleOptions.length > 0 && (
                            <MultiSelect size="small" value={roles} onValueChange={setRoles} placeholder="Select roles">
                                {roleOptions.map(r => <MultiSelectItem key={r} value={r}>{r}</MultiSelectItem>)}
                            </MultiSelect>
                        )}
                        {rolesUnavailable && roleOptions.length === 0 && (
                            <Typography variant="caption" className="text-text-secondary opacity-80">
                                Could not load the project&apos;s roles — enter them manually below.
                            </Typography>
                        )}
                        {!rolesUnavailable && roleOptions.length === 0 && (
                            <Typography variant="caption" className="text-text-secondary opacity-80">
                                No roles are assigned to any user yet — enter one manually below.
                            </Typography>
                        )}
                        <div className="flex gap-2 items-center">
                            <TextField size="small" aria-label="Add a custom role" value={customRole}
                                onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCustomRole(e.target.value)}
                                onKeyDown={(e: React.KeyboardEvent) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        addCustomRole();
                                    }
                                }}
                                placeholder="Add a role not listed, e.g. editor"/>
                            <Button size="small" variant="outlined" color="neutral"
                                disabled={!customRole.trim()} onClick={addCustomRole}>
                                Add
                            </Button>
                        </div>
                    </div>
                    {command !== "INSERT" && (
                        <div className="flex flex-col gap-1.5">
                            <Typography variant="caption" className="uppercase tracking-wider text-text-secondary">{t("studio_policy_using_expr")}</Typography>
                            <TextField aria-label={t("studio_policy_using_expr")} value={usingExpr} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setUsingExpr(e.target.value)} placeholder={`e.g. ${RLS_UID_SQL} = uid`}/>
                        </div>
                    )}
                    {showCheck && (
                        <div className="flex flex-col gap-1.5">
                            <Typography variant="caption" className="uppercase tracking-wider text-text-secondary">{t("studio_policy_check_expr")}</Typography>
                            <TextField aria-label={t("studio_policy_check_expr")} value={checkExpr} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCheckExpr(e.target.value)} placeholder={`e.g. ${RLS_UID_SQL} = uid`}/>
                        </div>
                    )}
                </Paper>
            </DialogContent>
            <DialogActions>
                <Button size="small" variant="text" color="neutral" onClick={onCancel}>Cancel</Button>
                <Button size="small" variant="filled" color="primary" disabled={!name}
                    onClick={() => onSave({ policyname: name,
permissive: behavior,
cmd: command,
roles,
qual: usingExpr,
with_check: showCheck ? checkExpr : null })}
                >Save</Button>
            </DialogActions>
        </>
    );
}
