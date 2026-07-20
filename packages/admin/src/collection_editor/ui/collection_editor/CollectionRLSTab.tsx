
import { CollectionConfig, SecurityRule as GeneratedSecurityRule } from "@rebasepro/types";
import { getPolicyNamesForRule, getPolicyNamesForRules } from "@rebasepro/utils";
import { getEffectiveSecurityRules } from "@rebasepro/common";
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
import { useRebaseContext } from "@rebasepro/app";

/** Postgres RLS policy shape — defined inline to avoid depending on @rebasepro/studio */
export interface PostgresPolicy {
    policyname: string;
    tablename: string;
    permissive: "PERMISSIVE" | "RESTRICTIVE";
    roles: string[];
    cmd: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
    qual: string | null;
    with_check: string | null;
    status?: "live" | "code_only" | "both";
}

interface SecurityRule {
    name: string;
    operation?: string;
    mode?: string;
    using?: string;
    withCheck?: string;
    /** Application roles (`rebase.user_roles`), AND'd into USING/WITH CHECK. */
    roles?: string[];
    /** Native PostgreSQL roles for the policy's `TO` clause. Defaults to `public`. */
    pgRoles?: string[];
}

/**
 * `roles` on a security rule is the application-role shortcut: it AND's a
 * `auth.roles() && ARRAY[...]` condition onto the policy. Leaving it off does
 * NOT mean "nobody" — it means the rule simply isn't filtered by role, so its
 * other conditions decide access on their own. Rendering the bare list left an
 * empty "Roles:" chip that read like the policy granted no one anything.
 *
 * (The Postgres `TO` clause is a separate field, `pgRoles`, defaulting to
 * `public` — see the unmapped-policy chips below.)
 */
function RuleRolesChip({ roles, className }: { roles?: readonly string[] | string, className: string }) {
    const list = Array.isArray(roles) ? roles : (roles ? [roles] : []);
    if (list.length === 0) {
        return (
            <Tooltip title="Not restricted by application role — this policy's other conditions apply to every user.">
                <Chip size="small" className={className}>Roles: Any</Chip>
            </Tooltip>
        );
    }
    return <Chip size="small" className={className}>Roles: {list.join(", ")}</Chip>;
}

type CollectionWithSecurity = CollectionConfig & {
    securityRules?: SecurityRule[];
    id?: string;
    table?: string;
    alias?: string;
};

export function CollectionRLSTab() {
    const { values, setFieldValue } = useFormex<CollectionWithSecurity>();
    const [editingPolicy, setEditingPolicy] = useState<PostgresPolicy | "new" | null>(null);

    const rules: SecurityRule[] = values.securityRules || [];

    const { databaseAdmin } = useRebaseContext();
    const [dbPolicies, setDbPolicies] = useState<PostgresPolicy[]>([]);
    const [isLoadingDb, setIsLoadingDb] = useState(false);

    useEffect(() => {
        const fetchLivePolicies = async () => {
            const tableName = values.id || values.table || values.alias;
            if (!tableName || !databaseAdmin?.executeSql) return;

            setIsLoadingDb(true);
            try {
                const safeTableName = sanitizeSqlIdentifier(tableName);
                // safeTableName is validated to be [a-zA-Z_][a-zA-Z0-9_]* — safe for string literal
                const quotedName = safeTableName.slice(1, -1); // strip double quotes to get raw name
                const sql = `
                    SELECT policyname, permissive, roles, cmd, qual, with_check
                    FROM pg_policies
                    WHERE tablename = '${quotedName}' AND schemaname NOT IN ('information_schema', 'pg_catalog');
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
    }, [databaseAdmin, values.id, values.table, values.alias]);

    const tableName = values.id || values.table || values.alias;

    /**
     * Every policy name `rebase db push` would write for this collection.
     *
     * Two things make this more than `rules.map(r => r.name)`:
     *  - a rule without an explicit `name` becomes `<table>_<op>_<hash>`, so
     *    comparing `rule.name` to `policyname` never matches for it;
     *  - the generator also injects the safe-by-default baseline
     *    (`<table>_default_admin_*`), which is in no collection's `securityRules`.
     *
     * Missing either made Rebase's own policies look hand-written, and offered to
     * import them back into the codebase that produced them.
     */
    const generatedPolicyNames = useMemo(() => {
        if (!tableName) return new Set<string>();
        const effectiveRules = getEffectiveSecurityRules(values as CollectionConfig);
        return getPolicyNamesForRules(
            [...(rules as unknown as GeneratedSecurityRule[]), ...effectiveRules],
            tableName
        );
    }, [rules, tableName, values]);

    const unmappedPolicies = dbPolicies.filter(dp => !generatedPolicyNames.has(dp.policyname));

    const handleSave = async (newPolicy: Partial<PostgresPolicy>) => {
        const rule: SecurityRule = {
            name: newPolicy.policyname ?? "",
            operation: newPolicy.cmd?.toLowerCase(),
            mode: newPolicy.permissive?.toLowerCase(),
            using: newPolicy.qual || undefined,
            withCheck: newPolicy.with_check || undefined,
            roles: newPolicy.roles
        };

        let newRules;
        if (editingPolicy === "new") {
            newRules = [...rules, rule];
        } else {
            newRules = rules.map((r: SecurityRule) => r.name === (editingPolicy as PostgresPolicy).policyname ? rule : r);
        }
        setFieldValue("securityRules", newRules);
        setEditingPolicy(null);
    };

    return (
        <div className={"overflow-auto my-auto"}>
            <Container maxWidth={"4xl"} className={"flex flex-col gap-4 p-8 m-auto"}>
                <div className="w-full flex flex-col">
                <div className="flex items-center justify-between mb-8">
                    <Typography variant="h5">Row Level Security</Typography>
                    <Button variant="filled" color="neutral" onClick={() => setEditingPolicy("new")}>
                        CREATE POLICY
                    </Button>
                </div>

                {rules.length === 0 ? (
                    <div className="flex-grow flex items-center justify-center text-text-disabled py-12">
                        <Typography variant="body2">No RLS policies defined for this collection.</Typography>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {rules.map((rule: SecurityRule) => (
                            <Paper key={rule.name}
                                className={"p-4 border border-transparent hover:border-surface-200 dark:hover:border-surface-700 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors bg-white dark:bg-surface-800 shadow-sm"}>
                                <div className="flex flex-col gap-1.5 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <KeyIcon size={iconSize.smallest} className="text-text-disabled dark:text-text-disabled-dark shrink-0"/>
                                        <Typography variant="subtitle2" className="truncate">
                                            {/* Unnamed rules are still named in Postgres — show what they compile to
                                                rather than an empty heading. */}
                                            {rule.name || (tableName
                                                ? getPolicyNamesForRule(rule as unknown as GeneratedSecurityRule, tableName).join(", ")
                                                : "Unnamed policy")}
                                        </Typography>
                                    </div>
                                    <div className="flex gap-2 text-xs pl-6 overflow-x-auto hide-scrollbar">
                                        <Chip size="small" className="bg-surface-100 dark:bg-surface-900 text-text-secondary border-none">Action: {rule.operation || "ALL"}</Chip>
                                        <RuleRolesChip roles={rule.roles} className="bg-surface-100 dark:bg-surface-900 text-text-secondary border-none"/>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                    <Button size="small" variant="text" onClick={() => setEditingPolicy({
                                        policyname: rule.name,
                                        tablename: values.id || values.table || values.alias || "your_table",
                                        permissive: (rule.mode || "permissive").toUpperCase() as PostgresPolicy["permissive"],
                                        cmd: (rule.operation || "ALL").toUpperCase() as PostgresPolicy["cmd"],
                                        // Seeding with ["public"] put a Postgres role into the
                                        // app-role field: saving compiled it to
                                        // `auth.roles() && ARRAY['public']`, which no user holds.
                                        roles: rule.roles ? [...rule.roles] : [],
                                        qual: rule.using || null,
                                        with_check: rule.withCheck || null
                                    })}>
                                        EDIT
                                    </Button>
                                    <IconButton size="small" onClick={() => {
                                        setFieldValue("securityRules", rules.filter((r: SecurityRule) => r.name !== rule.name));
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
                                            <Chip size="small" className="bg-white dark:bg-surface-900 text-text-secondary border-none">Action: {dp.cmd || "ALL"}</Chip>
                                            {/* Live policies report the Postgres `TO` grantees, not app roles. */}
                                            <Tooltip title="The PostgreSQL roles this policy is granted to (its TO clause).">
                                                <Chip size="small" className="bg-white dark:bg-surface-900 text-text-secondary border-none">
                                                    DB roles: {(Array.isArray(dp.roles) ? dp.roles : [dp.roles]).filter(Boolean).join(", ") || "public"}
                                                </Chip>
                                            </Tooltip>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                                        <Button size="small" variant="outlined" color="primary" onClick={() => {
                                             // `dp.roles` is the policy's Postgres TO clause, so it
                                             // belongs in `pgRoles` — putting it in `roles` turned
                                             // grantees into an app-role condition nobody satisfies.
                                             const pgRoles = (Array.isArray(dp.roles) ? dp.roles : [dp.roles]).filter(Boolean);
                                             const isDefaultGrantee = pgRoles.length === 0 || (pgRoles.length === 1 && pgRoles[0] === "public");
                                             const rule: SecurityRule = {
                                                name: dp.policyname,
                                                operation: dp.cmd?.toLowerCase(),
                                                mode: dp.permissive?.toLowerCase(),
                                                using: dp.qual || undefined,
                                                withCheck: dp.with_check || undefined,
                                                pgRoles: isDefaultGrantee ? undefined : pgRoles
                                            };
                                            setFieldValue("securityRules", [...rules, rule]);
                                        }}>
                                            Import to codebase
                                        </Button>
                                    </div>
                                </Paper>
                            ))}
                        </div>
                    </div>
                )}
                </div>
                <Dialog open={!!editingPolicy} onOpenChange={(open) => !open && setEditingPolicy(null)} maxWidth="4xl">
                    {editingPolicy && (
                        <InlinePolicyEditor
                            policy={editingPolicy === "new" ? undefined : editingPolicy}
                            table={values.id || values.table || values.alias || "your_table"}
                            onSave={handleSave}
                            onCancel={() => setEditingPolicy(null)}
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
const ROLE_OPTIONS = ["public", "authenticated", "anon", "admin"];

function InlinePolicyEditor({
    policy,
    table,
    onSave,
    onCancel
}: {
    policy?: PostgresPolicy;
    table: string;
    onSave: (policyData: Partial<PostgresPolicy>) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState(policy?.policyname || "");
    const [behavior, setBehavior] = useState<"PERMISSIVE" | "RESTRICTIVE">(policy?.permissive || "PERMISSIVE");
    const [command, setCommand] = useState<PolicyCommand>((policy?.cmd as PolicyCommand) || "ALL");
    const [roles, setRoles] = useState<string[]>(
        policy?.roles ? (Array.isArray(policy.roles) ? [...policy.roles] : [policy.roles]) : []
    );
    const [usingExpr, setUsingExpr] = useState(policy?.qual || "");
    const [checkExpr, setCheckExpr] = useState(policy?.with_check || "");

    const showCheck = command === "ALL" || command === "INSERT" || command === "UPDATE";

    return (
        <>
            <DialogTitle variant="h6">
                {policy ? "Edit Policy" : "Create Policy"}
                <div className="text-sm font-normal text-text-secondary dark:text-text-secondary-dark tracking-wide mt-1">
                    Define RLS rules for <span className="font-mono text-primary bg-primary-bg dark:bg-primary-bg-dark px-1 py-0.5 rounded">public.{table}</span>
                </div>
            </DialogTitle>
            <DialogContent className="p-4 md:p-6 border-t dark:border-surface-700 bg-surface-50 dark:bg-surface-800" includeMargin={false}>
                <Paper className={cls("p-4 md:p-6 flex flex-col gap-6 bg-white dark:bg-surface-800 border-none sm:border-solid rounded-none sm:rounded-xl", defaultBorderMixin)}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                            <Typography variant="caption" className="uppercase tracking-wider text-text-secondary">Policy Name</Typography>
                            <TextField value={name} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setName(e.target.value)} placeholder="e.g. allow_read_all"/>
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
                        <MultiSelect size="small" value={roles} onValueChange={setRoles} placeholder="Any role (no restriction)">
                            {ROLE_OPTIONS.map(r => <MultiSelectItem key={r} value={r}>{r}</MultiSelectItem>)}
                        </MultiSelect>
                        <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark">
                            Rebase roles from <span className="font-mono">rebase.user_roles</span>, not PostgreSQL roles.
                            Leave empty to apply this policy to every user.
                        </Typography>
                    </div>
                    {command !== "INSERT" && (
                        <div className="flex flex-col gap-1.5">
                            <Typography variant="caption" className="uppercase tracking-wider text-text-secondary">USING expression</Typography>
                            <TextField value={usingExpr} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setUsingExpr(e.target.value)} placeholder="e.g. auth.uid() = user_id"/>
                        </div>
                    )}
                    {showCheck && (
                        <div className="flex flex-col gap-1.5">
                            <Typography variant="caption" className="uppercase tracking-wider text-text-secondary">WITH CHECK expression</Typography>
                            <TextField value={checkExpr} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCheckExpr(e.target.value)} placeholder="e.g. auth.uid() = user_id"/>
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
