import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    AlertTriangleIcon,
    Button,
    cls,
    defaultBorderMixin,
    IconButton,
    iconSize,
    KeyIcon,
    Paper,
    PlusIcon,
    ShieldIcon,
    StatusDot,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import {
    ConfirmationDialog,
    useApiBase,
    useApiConfig,
    useRebaseContext,
    useSnackbarController,
    useStudioCapabilities,
    useStudioSchemaEditing,
    useTableDescriptors,
    useTranslation
} from "@rebasepro/app";
import { policyToSecurityRule, REBASE_INTERNAL_PREFIXES, REBASE_INTERNAL_SCHEMAS } from "@rebasepro/common";
import { adminRequestPolicyName } from "@rebasepro/utils";
import type { JunctionPolicyDescriptor, PostgresPolicy, SecurityRule, TableDescriptor } from "@rebasepro/types";
import { PolicyEditor } from "./PolicyEditor";
import { isCancellation, saveRules } from "./saveRules";
import { applyPolicyEdit, type PolicyEditRefusal, type PolicyRule } from "./policyRules";
import { declaredPoliciesOf, listPolicies, type DeclaredPolicies, type ListedPolicy } from "./policyListing";
import { quoteIdentifier } from "../../utils/sql_utils";
import { schemaSourceProblem, SchemaSourceProblemAlert } from "../schema-source";

export type TableCategory = "collection" | "junction" | "internal" | "other";

/**
 * Whether `descriptor` is the table the server declares for a live table: the
 * same SQL table in the same schema, as the server resolved both.
 *
 * Matched once by name, a table was taken for any collection whose `id`,
 * `path`, `table`, `slug` or `collectionId` equalled its name, in any schema.
 * So an unmapped table named like another table's slug, or a same-named table
 * in another schema, was taken for that table: it listed the declared
 * policies as missing from the table, and offered to import the table's own
 * policies into the declaration. A view is never a `pg_tables` row.
 */
export function mapsTable(descriptor: TableDescriptor, table: { schemaName: string; tableName: string }): boolean {
    return descriptor.kind === "table" && descriptor.table === table.tableName && descriptor.schema === table.schemaName;
}

/**
 * A table the project's own schema maps is the CUSTOMER'S, whatever schema
 * Postgres put it in: Rebase creates a tenant's collection tables in the
 * `rebase` schema, so the schema can never decide this on its own. `users`
 * and `branches` are both platform tables AND, on a project that defines
 * them, collections the customer writes policies for. The mapping is the only
 * thing that knows, so it is asked first.
 */
export function classifyTableClient(
    tableName: string,
    schemaName: string,
    isJunction: boolean,
    isMappedToCollection: boolean
): TableCategory {
    if (isMappedToCollection) return "collection";
    if (
        REBASE_INTERNAL_SCHEMAS.includes(schemaName) ||
        REBASE_INTERNAL_PREFIXES.some((prefix) => tableName.startsWith(prefix))
    ) {
        return "internal";
    }
    if (isJunction) return "junction";
    return "other";
}

/**
 * Every junction the server derives, with its policies, by `schema.table`. A
 * junction has no descriptor of its own: it is listed under each table that
 * declares a relation through it.
 */
export function servedJunctionsOf(declaredTables: readonly TableDescriptor[]): Map<string, JunctionPolicyDescriptor> {
    const junctions = new Map<string, JunctionPolicyDescriptor>();
    for (const table of declaredTables) {
        for (const junction of table.rls.junctions ?? []) {
            junctions.set(`${junction.schema}.${junction.table}`, junction);
        }
        // Without the compiled policies (no `schema:read`) the relation
        // still names its junction: it is still the platform's table.
        for (const relation of table.relations) {
            if (relation.kind !== "manyToMany") continue;
            const key = `${table.schema}.${relation.through.table}`;
            if (!junctions.has(key)) junctions.set(key, { table: relation.through.table, schema: table.schema, policies: [] });
        }
    }
    return junctions;
}

/** What the editor says when an edit has no declared rule to go back to. */
const POLICY_EDIT_REFUSALS: Record<PolicyEditRefusal, string> = {
    generated: "studio_rls_edit_generated",
    not_declared: "studio_rls_edit_not_declared",
    several_operations: "studio_rls_edit_several_operations",
    redacted: "studio_rls_edit_redacted"
};

export interface TablePoliciesProps {
    schemaName: string;
    tableName: string;
    rlsEnabled: boolean;
    /** What Postgres holds for the table now (`pg_policies`). */
    policies: readonly PostgresPolicy[];
    /** The table looks like a junction (every column a foreign key), whether or not the server derives it. */
    isJunction?: boolean;
    /** Read the live state again after a change this component made. */
    onChanged: () => void;
}

/**
 * One table's row level security: the RLS switch, the policies Postgres
 * enforces merged with what the code declares (drift, unapplied), and the
 * editor that writes a policy where it belongs — the declaration when there
 * is a codebase, the database otherwise.
 *
 * The RLS view and the table inspector's Policies tab both render this, so
 * there is one place a policy is listed, edited and dropped.
 */
export function TablePolicies({ schemaName, tableName, rlsEnabled, policies, isJunction = false, onChanged }: TablePoliciesProps) {
    const { databaseAdmin } = useRebaseContext();
    const snackbarController = useSnackbarController();
    const { t } = useTranslation();
    // The tables the server declares, with the policies it compiles for each:
    // the server is the one compiler, this editor only compares its answer
    // with what Postgres holds.
    const descriptors = useTableDescriptors();
    const schemaProblem = schemaSourceProblem(descriptors);
    const declaredTables = descriptors.tables;
    const { codebase: hasCodebase } = useStudioCapabilities();
    const apiConfig = useApiConfig();
    const apiBase = useApiBase() ?? "/api";
    const schemaEditing = useStudioSchemaEditing();
    const reloadDeclared = descriptors.reload;

    const activeTableData = useMemo(() => ({ schemaName, tableName }), [schemaName, tableName]);

    /**
     * Saving rules on a table that inherits them from `defaultRls` detaches it
     * into rules of its own: asked here, never done silently. Settled by the
     * dialog below — "OK" detaches, "Cancel" keeps `"inherit"`.
     */
    const [detaching, setDetaching] = useState<string | null>(null);
    const settleDetach = useRef<((detach: boolean) => void) | null>(null);
    const confirmDetach = useCallback((slug: string) => new Promise<boolean>(resolve => {
        settleDetach.current?.(false);
        settleDetach.current = resolve;
        setDetaching(slug);
    }), []);
    const answerDetach = useCallback((detach: boolean) => {
        settleDetach.current?.(detach);
        settleDetach.current = null;
        setDetaching(null);
    }, []);

    /** Through the plan/apply dialog when there is one — see `saveRules`. */
    const saveSecurityRules = useCallback(
        async (table: TableDescriptor, securityRules: readonly PolicyRule[]) => {
            await saveRules(
                schemaEditing,
                { apiBase, getAuthToken: apiConfig?.getAuthToken },
                table,
                securityRules,
                { confirmDetach }
            );
            reloadDeclared();
        },
        [apiBase, apiConfig, schemaEditing, reloadDeclared, confirmDetach]);

    /** Closing the plan dialog is an answer, not a failure — see `saveRules`. */
    const reportSaveFailure = useCallback((e: unknown) => {
        if (isCancellation(e)) return;
        snackbarController.open({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }, [snackbarController]);

    // Hosts key this component by table, so another table starts with nothing open.
    const [editingPolicy, setEditingPolicy] = useState<ListedPolicy | "new" | null>(null);

    const [confirmToggleRls, setConfirmToggleRls] = useState<{ enabled: boolean; managed: boolean } | null>(null);
    const [confirmDropPolicy, setConfirmDropPolicy] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);

    /**
     * Native PostgreSQL roles, for the policy editor's `TO` list.
     *
     * `fetchAvailableRoles` and not `fetchApplicationRoles`: a policy's `TO`
     * clause names database roles, and an application role put there produces
     * a policy that either fails to create or matches nothing.
     */
    const [pgRoleOptions, setPgRoleOptions] = useState<string[]>([]);
    useEffect(() => {
        let mounted = true;
        if (!databaseAdmin?.fetchAvailableRoles) return;
        databaseAdmin.fetchAvailableRoles()
            .then((roles) => { if (mounted) setPgRoleOptions(roles); })
            .catch((e) => console.error("Failed to fetch database roles", e));
        return () => { mounted = false; };
    }, [databaseAdmin]);

    const qualifiedTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;

    const applyToggleRls = useCallback(async () => {
        if (!confirmToggleRls || !databaseAdmin?.executeSql) return;
        const action = confirmToggleRls.enabled ? "DISABLE" : "ENABLE";
        setConfirming(true);
        try {
            await databaseAdmin.executeSql(`ALTER TABLE ${qualifiedTable} ${action} ROW LEVEL SECURITY`);
            snackbarController.open({
                type: "success",
                message: t(confirmToggleRls.enabled ? "studio_tables_rls_disabled_on" : "studio_tables_rls_enabled_on", { name: tableName })
            });
            setConfirmToggleRls(null);
            onChanged();
        } catch (e: unknown) {
            snackbarController.open({ type: "error", message: e instanceof Error ? e.message : String(e) });
        } finally {
            setConfirming(false);
        }
    }, [confirmToggleRls, databaseAdmin, qualifiedTable, snackbarController, t, tableName, onChanged]);

    const applyDropPolicy = useCallback(async () => {
        if (!confirmDropPolicy || !databaseAdmin?.executeSql) return;
        setConfirming(true);
        try {
            // Its admin-request companion (`USING (true)` for every admin) goes
            // with it, in the same implicit transaction: left behind, it would
            // keep admitting every admin to every row the dropped policy did.
            await databaseAdmin.executeSql(
                `DROP POLICY ${quoteIdentifier(confirmDropPolicy)} ON ${qualifiedTable}; ` +
                `DROP POLICY IF EXISTS ${quoteIdentifier(adminRequestPolicyName(confirmDropPolicy))} ON ${qualifiedTable}`
            );
            snackbarController.open({ type: "success", message: t("studio_tables_policy_dropped", { name: confirmDropPolicy }) });
            setConfirmDropPolicy(null);
            onChanged();
        } catch (e: unknown) {
            snackbarController.open({ type: "error", message: e instanceof Error ? e.message : String(e) });
        } finally {
            setConfirming(false);
        }
    }, [confirmDropPolicy, databaseAdmin, qualifiedTable, snackbarController, t, onChanged]);

    const servedJunctions = useMemo(() => servedJunctionsOf(declaredTables), [declaredTables]);

    /** The table the server declares for this one, if any. */
    const activeDescriptor = useMemo(
        () => declaredTables.find(descriptor => mapsTable(descriptor, activeTableData)) ?? null,
        [activeTableData, declaredTables]
    );

    /**
     * The junction a relation derives this table as, when it is one. Its
     * policies are Rebase's — derived from the endpoints' relations — and the
     * server re-creates them on every start, like a declared table's.
     */
    const activeJunction = useMemo(() => {
        if (activeDescriptor) return null;
        return servedJunctions.get(`${schemaName}.${tableName}`) ?? null;
    }, [activeDescriptor, servedJunctions, schemaName, tableName]);

    const activeTableCategory = classifyTableClient(tableName, schemaName, Boolean(activeJunction) || isJunction, Boolean(activeDescriptor));

    const activeRlsPosture = activeDescriptor?.rls.posture;
    const activeTableNonManaged = activeRlsPosture === "external" || activeRlsPosture === "unmanaged";

    /** Whether the server re-asserts this table's RLS on every start. */
    const activeTableManaged = Boolean((activeDescriptor && !activeTableNonManaged) || activeJunction);

    /**
     * What the server says the table's policies are — `undefined` when it
     * declares none, or withheld them from this caller.
     */
    const activeDeclared = useMemo((): DeclaredPolicies | undefined => {
        if (activeDescriptor) return activeTableNonManaged ? undefined : declaredPoliciesOf(activeDescriptor.rls);
        if (activeJunction && activeJunction.policies.length > 0) return { rules: [], policies: activeJunction.policies };
        return undefined;
    }, [activeDescriptor, activeJunction, activeTableNonManaged]);

    /**
     * The table is declared, but this caller is not shown what it compiles to
     * (no `schema:read`): the list is what the database holds, and nothing is
     * written to the declaration — its raw rules may be redacted.
     */
    const declaredWithheld = activeDescriptor !== null && !activeTableNonManaged && activeDeclared === undefined;

    /** A save to the declaration needs the declaration, and a codebase to write it into. */
    const savesToCodebase = activeDescriptor !== null && hasCodebase;

    /**
     * What Postgres enforces on the table, and what the code declares that it
     * does not have yet. A policy in both is listed with the *database's*
     * fields, and the declaration rides beside it with where the two differ.
     */
    const mergedPolicies = useMemo((): ListedPolicy[] =>
        listPolicies([...policies], activeDeclared, tableName).sort((a, b) => a.policyname.localeCompare(b.policyname)),
    [policies, activeDeclared, tableName]);

    const handleSave = async (newPolicy: Partial<PostgresPolicy>) => {
        if (!editingPolicy) return;
        /*
         * Where a policy for a *mapped* table belongs depends on the host, not
         * on the table. Beside its own source, the collection file is the
         * right home: the rule is checked in, and the next migration applies
         * it. The hosted console has no source, and the schema-editor routes
         * are not mounted under NODE_ENV=production, so there the database is
         * the only place a policy can live — the same path unmapped tables use.
         */
        if (savesToCodebase && activeDescriptor) {
            if (declaredWithheld) {
                snackbarController.open({ type: "error", message: t("studio_rls_save_needs_schema_read", { table: tableName }) });
                return;
            }
            const existingRules: readonly SecurityRule[] = activeDescriptor.rls.rules;
            let newRules: PolicyRule[];
            if (editingPolicy === "new") {
                newRules = [...existingRules, policyToSecurityRule(newPolicy)];
            } else {
                // Back to the rule the policy compiles from, or a refusal that
                // says why there is none — never the unchanged rules reported
                // as saved.
                const edit = applyPolicyEdit(existingRules, editingPolicy, newPolicy);
                if (!edit.ok) {
                    snackbarController.open({ type: "error", message: t(POLICY_EDIT_REFUSALS[edit.reason], { policy: editingPolicy.policyname }) });
                    return;
                }
                newRules = edit.rules;
                if (JSON.stringify(newRules) === JSON.stringify(existingRules)) {
                    snackbarController.open({ type: "info", message: t("studio_rls_nothing_changed") });
                    return;
                }
            }
            try {
                // Addressed by its slug: the schema editor finds tables by it, never by the SQL name.
                await saveSecurityRules(activeDescriptor, newRules);
                snackbarController.open({ type: "success", message: t("studio_tables_policy_saved") });
                setEditingPolicy(null);
                onChanged();
            } catch (e: unknown) {
                reportSaveFailure(e);
            }
            return;
        }

        // A policy Rebase generates is re-created on the next start, and what
        // the database holds for it is a compiled condition the form only
        // shows as text: rewriting it here cannot last, and one slip in that
        // text drops the condition. The source path refuses the same edit.
        if (editingPolicy !== "new" && editingPolicy.generated) {
            snackbarController.open({ type: "error", message: t(POLICY_EDIT_REFUSALS.generated, { policy: editingPolicy.policyname }) });
            return;
        }
        if (!databaseAdmin?.executeSql) return;
        try {
            const policyName = quoteIdentifier(newPolicy.policyname || "unnamed_policy");
            const cmd = newPolicy.cmd || "ALL";
            const permissive = (newPolicy.permissive || "PERMISSIVE") === "PERMISSIVE" ? "PERMISSIVE" : "RESTRICTIVE";
            const roles = newPolicy.roles && newPolicy.roles.length > 0
                ? newPolicy.roles.map(r => quoteIdentifier(r)).join(", ")
                : "public";

            let sql = `CREATE POLICY ${policyName} ON ${qualifiedTable} AS ${permissive} FOR ${cmd} TO ${roles}`;
            if (newPolicy.qual) sql += ` USING (${newPolicy.qual})`;
            if (newPolicy.with_check) sql += ` WITH CHECK (${newPolicy.with_check})`;

            // An edit replaces the policy under the name it *had*, and its
            // admin-request companion, in the same statement as the CREATE:
            // Postgres runs a multi-statement simple query as one implicit
            // transaction, so a CREATE that fails takes the DROP back with it.
            if (editingPolicy !== "new") {
                const previousName = quoteIdentifier(editingPolicy.policyname);
                const companion = quoteIdentifier(adminRequestPolicyName(editingPolicy.policyname));
                sql = `DROP POLICY IF EXISTS ${previousName} ON ${qualifiedTable}; DROP POLICY IF EXISTS ${companion} ON ${qualifiedTable}; ${sql}`;
            }
            await databaseAdmin.executeSql(sql);
            snackbarController.open({ type: "success", message: t("studio_tables_policy_applied", { name: newPolicy.policyname ?? "" }) });
            setEditingPolicy(null);
            onChanged();
        } catch (e: unknown) {
            snackbarController.open({ type: "error", message: e instanceof Error ? e.message : String(e) });
        }
    };

    const importToCodebase = async (policy: ListedPolicy) => {
        if (!activeDescriptor) return;
        // A live policy's `roles` is its `TO` list: database roles, so
        // `pgRoles`. Copied into `roles`, `TO public` became an
        // application-role check nobody passes.
        const rule = policyToSecurityRule(policy);
        try {
            await saveSecurityRules(activeDescriptor, [...activeDescriptor.rls.rules, rule]);
            snackbarController.open({ type: "success", message: t("studio_tables_policy_imported") });
            onChanged();
        } catch (e: unknown) {
            reportSaveFailure(e);
        }
    };

    const renderPolicyTag = (label: string, value: string) => (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-field">
            <Typography variant="caption" color="secondary" className="font-medium">{label}</Typography>
            <Typography variant="mono" className="text-xs break-all">{value}</Typography>
        </div>
    );

    if (editingPolicy) {
        return (
            <PolicyEditor
                policy={editingPolicy === "new" ? undefined : editingPolicy}
                schema={schemaName}
                table={tableName}
                roleOptions={pgRoleOptions}
                onSave={(policy) => void handleSave(policy)}
                onCancel={() => setEditingPolicy(null)}
            />
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <StatusDot tone={rlsEnabled ? "ok" : "busy"}>
                    {rlsEnabled ? t("studio_rls_enabled") : t("studio_rls_disabled")}
                </StatusDot>
                <div className="flex items-center gap-2">
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setConfirmToggleRls({ enabled: rlsEnabled, managed: activeTableManaged })}
                    >
                        {rlsEnabled ? t("studio_rls_disable_rls") : t("studio_rls_enable_rls")}
                    </Button>
                    <Button size="small" color="primary" variant="filled" onClick={() => setEditingPolicy("new")}>
                        <PlusIcon size={iconSize.smallest} />
                        {t("studio_rls_create_policy")}
                    </Button>
                </div>
            </div>

            {/* Without the served tables the list is only what the database holds: say why. */}
            {schemaProblem && <SchemaSourceProblemAlert problem={schemaProblem}/>}
            {declaredWithheld && (
                <Alert color="info">
                    <Typography variant="caption">{t("studio_rls_declared_withheld", { table: tableName })}</Typography>
                </Alert>
            )}
            {/* A table the server re-asserts on every start, where this editor
                writes straight to the database: what is changed here does not
                outlive the next start. */}
            {activeTableManaged && !savesToCodebase && (
                <Alert color="info">
                    <Typography variant="caption">{t("studio_rls_reapplied_on_start", { table: tableName })}</Typography>
                </Alert>
            )}
            {activeRlsPosture === "external" && (
                <Alert color="info">
                    <Typography variant="body2" className="mb-1 font-semibold">External Row-Level Security</Typography>
                    <Typography variant="caption" className="opacity-80">
                        This table declares <code>rls: &quot;external&quot;</code>. Postgres enforces row-level security using
                        policies managed outside Rebase (SQL migrations, Supabase, or a DBA); Rebase does not generate or
                        overwrite policies for it.
                    </Typography>
                </Alert>
            )}
            {activeRlsPosture === "unmanaged" && (
                <Alert color="info">
                    <Typography variant="body2" className="mb-1 font-semibold">Unmanaged Row-Level Security</Typography>
                    <Typography variant="caption" className="opacity-80">
                        This table declares <code>rls: &quot;unmanaged&quot;</code>. Rebase does not enable row-level security
                        or generate policies for it; access is enforced in application code (hooks, scopes, or routes).
                    </Typography>
                </Alert>
            )}
            {activeTableCategory === "internal" && (
                <Alert color="info">
                    <Typography variant="body2" className="mb-1 font-semibold">Rebase System Table</Typography>
                    <Typography variant="caption" className="opacity-80">
                        This table is managed internally by Rebase. Its security policies are configured automatically.
                        Editing policies on system tables is an advanced operation.
                    </Typography>
                </Alert>
            )}
            {activeTableCategory === "junction" && (
                <Alert color="info">
                    <Typography variant="body2" className="mb-1 font-semibold">Junction Table</Typography>
                    <Typography variant="caption" className="opacity-80">
                        This is an auto-generated junction table for a many-to-many relation.
                        Rebase derives its policies: rows are readable when both related rows
                        are, and writable following the declaring table&apos;s update rules
                        (plus the server/admin baseline). You can still add RLS policies
                        directly to broaden access.
                    </Typography>
                </Alert>
            )}

            {!rlsEnabled && (
                <Alert color="warning">
                    <Typography variant="subtitle2">Row Level Security (RLS) is disabled</Typography>
                    <Typography variant="body2" className="mt-1">
                        Your table is completely readable and writable by anyone with access privileges. Enable RLS to create policies that restrict access to specific rows.
                    </Typography>
                </Alert>
            )}

            {mergedPolicies.length > 0 && (
                <div className="flex flex-col gap-3">
                    <Typography variant="subtitle2">{t("studio_rls_policies")}</Typography>
                    {mergedPolicies.map(policy => (
                        <Paper key={policy.policyname} className={cls("p-3 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border rounded-lg", defaultBorderMixin)}>
                            <div className="flex flex-col gap-2 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <KeyIcon size={iconSize.smallest} className="text-text-secondary dark:text-text-secondary-dark shrink-0"/>
                                    <Typography variant="body2" className="truncate">{policy.policyname}</Typography>
                                    {policy.status === "code_only" && (
                                        <Tooltip title={t("studio_rls_unapplied_tooltip")}>
                                            <span><StatusDot tone="idle" size="small">{t("studio_rls_unapplied")}</StatusDot></span>
                                        </Tooltip>
                                    )}
                                    {/* The database holds this policy differently from its
                                        declaration: TO list, command, mode, and whether each
                                        clause is there — never the clause text. */}
                                    {policy.drift && policy.drift.length > 0 && (
                                        <Tooltip title={t("studio_rls_drift_tooltip", { fields: policy.drift.join(", ") })}>
                                            <span><StatusDot tone="busy" size="small">{`${t("studio_rls_drift")}: ${policy.drift.join(", ")}`}</StatusDot></span>
                                        </Tooltip>
                                    )}
                                    {/* A *drift* signal: the codebase does not declare this policy.
                                        Without a codebase, or on external/unmanaged tables, live policies
                                        are not codebase drift. */}
                                    {policy.status === "live" && hasCodebase && !activeTableNonManaged && (
                                        <Tooltip title={t("studio_tables_policy_db_only_tooltip")}>
                                            <span><StatusDot tone="busy" size="small">{t("studio_tables_policy_db_only")}</StatusDot></span>
                                        </Tooltip>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {renderPolicyTag(t("studio_tables_policy_action"), policy.cmd)}
                                    {renderPolicyTag(t("studio_tables_policy_roles"), Array.isArray(policy.roles) ? policy.roles.join(", ") : String(policy.roles))}
                                    {policy.qual && renderPolicyTag("USING", policy.qual)}
                                    {policy.with_check && renderPolicyTag("WITH CHECK", policy.with_check)}
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0 items-center">
                                {/* Writes a collection source file, so it needs a codebase on the other end. */}
                                {policy.status === "live" && savesToCodebase && activeDescriptor && !declaredWithheld && (
                                    <Button size="small" variant="outlined" onClick={() => void importToCodebase(policy)}>
                                        {t("studio_tables_policy_import")}
                                    </Button>
                                )}
                                <Button size="small" variant="text" onClick={() => setEditingPolicy(policy)}>
                                    {t("studio_rls_edit")}
                                </Button>
                                {policy.status !== "code_only" && (
                                    <Tooltip title={t("studio_rls_delete")} asChild={true}>
                                        <IconButton aria-label={t("studio_rls_delete")} size="small" onClick={() => setConfirmDropPolicy(policy.policyname)}>
                                            <Trash2Icon size={iconSize.smallest}/>
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </div>
                        </Paper>
                    ))}
                </div>
            )}

            {mergedPolicies.length === 0 && rlsEnabled && (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                    <ShieldIcon size={36} className="text-text-disabled dark:text-text-disabled-dark"/>
                    <Typography variant="subtitle2" color="secondary">{t("studio_tables_policies_none_title")}</Typography>
                    <Typography variant="caption" color="secondary" className="max-w-sm">{t("studio_tables_policies_none_body")}</Typography>
                </div>
            )}

            {mergedPolicies.length === 0 && !rlsEnabled && activeDescriptor && (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                    <AlertTriangleIcon size={36} className="text-text-disabled dark:text-text-disabled-dark"/>
                    <Typography variant="subtitle2" color="secondary">{t("studio_tables_policies_no_access_control")}</Typography>
                </div>
            )}

            <ConfirmationDialog
                open={confirmToggleRls !== null}
                loading={confirming}
                onAccept={applyToggleRls}
                onCancel={() => setConfirmToggleRls(null)}
                title={confirmToggleRls?.enabled ? t("studio_rls_disable_confirm_title") : t("studio_rls_enable_confirm_title")}
                body={confirmToggleRls?.enabled
                    ? [
                        t("studio_rls_disable_confirm_body", { table: tableName }),
                        // The server switches a managed table's RLS back on at its next start.
                        confirmToggleRls.managed ? t("studio_rls_disable_reapplied", { table: tableName }) : ""
                    ].filter(Boolean).join(" ")
                    : t("studio_rls_enable_confirm_body", { table: tableName })}
            />
            <ConfirmationDialog
                open={detaching !== null}
                onAccept={() => answerDetach(true)}
                onCancel={() => answerDetach(false)}
                title={t("schema_rules_detach_title")}
                body={t("schema_rules_detach_body", { table: detaching ?? "" })}
            />
            <ConfirmationDialog
                open={confirmDropPolicy !== null}
                loading={confirming}
                onAccept={applyDropPolicy}
                onCancel={() => setConfirmDropPolicy(null)}
                title={t("studio_rls_drop_policy_title")}
                body={t("studio_rls_drop_policy_body", { policy: confirmDropPolicy ?? "", table: tableName })}
            />
        </div>
    );
}
