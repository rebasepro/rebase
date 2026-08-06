import React, { useState, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────
interface RLSPolicy {
    id: string;
    name: string;
    command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
    using: string;
    withCheck?: string;
    roles: string[];
    permissive: boolean;
    syncStatus: "synced" | "unapplied" | "code-only" | "db-only";
}

interface RLSTable {
    name: string;
    schema: string;
    rlsEnabled: boolean;
    policies: RLSPolicy[];
}

// ─── Dynamic Columns Schema Mapping ──────────────────────
const TABLE_COLUMNS: Record<string, string[]> = {
    users: ["id", "email", "role", "created_at"],
    posts: ["id", "title", "author_id", "published"],
    comments: ["id", "post_id", "author_id", "content"],
    orders: ["id", "user_id", "amount", "status"],
    products: ["id", "name", "price", "active"],
    sessions: ["id", "user_id", "token"]
};

// ─── Mock Data ───────────────────────────────────────────
const MOCK_TABLES: RLSTable[] = [
    {
        name: "users",
        schema: "public",
        rlsEnabled: true,
        policies: [
            {
                id: "1",
                name: "users_read_own",
                command: "SELECT",
                using: "rebase.uid() = id",
                roles: ["public"],
                permissive: true,
                syncStatus: "synced"
            },
            {
                id: "2",
                name: "users_update_own",
                command: "UPDATE",
                using: "rebase.uid() = id",
                withCheck: "rebase.uid() = id",
                roles: ["public"],
                permissive: true,
                syncStatus: "synced"
            },
            {
                id: "3",
                name: "admin_manage_users",
                command: "ALL",
                using: "auth.role() = 'admin'",
                roles: ["admin"],
                permissive: true,
                syncStatus: "synced"
            }
        ]
    },
    {
        name: "posts",
        schema: "public",
        rlsEnabled: true,
        policies: [
            {
                id: "4",
                name: "posts_read_public",
                command: "SELECT",
                using: "published = true",
                roles: ["public", "anon"],
                permissive: true,
                syncStatus: "synced"
            },
            {
                id: "5",
                name: "posts_create_auth",
                command: "INSERT",
                using: "true",
                withCheck: "rebase.uid() = author_id",
                roles: ["authenticated"],
                permissive: true,
                syncStatus: "synced"
            },
            {
                id: "6",
                name: "posts_update_own",
                command: "UPDATE",
                using: "rebase.uid() = author_id",
                roles: ["authenticated"],
                permissive: true,
                syncStatus: "synced"
            }
        ]
    },
    {
        name: "comments",
        schema: "public",
        rlsEnabled: true,
        policies: [
            {
                id: "7",
                name: "comments_read_all",
                command: "SELECT",
                using: "true",
                roles: ["public"],
                permissive: true,
                syncStatus: "synced"
            }
        ]
    },
    {
        name: "orders",
        schema: "public",
        rlsEnabled: false,
        policies: []
    },
    {
        name: "products",
        schema: "public",
        rlsEnabled: true,
        policies: [
            {
                id: "8",
                name: "products_read_all",
                command: "SELECT",
                using: "active = true",
                roles: ["public", "anon"],
                permissive: true,
                syncStatus: "synced"
            },
            {
                id: "9",
                name: "products_manage_admin",
                command: "ALL",
                using: "auth.role() = 'admin'",
                roles: ["admin"],
                permissive: true,
                syncStatus: "db-only"
            }
        ]
    },
    {
        name: "sessions",
        schema: "auth",
        rlsEnabled: false,
        policies: []
    }
];

const COMMAND_COLORS: Record<string, { bg: string; text: string }> = {
    SELECT: { bg: "bg-blue-950/60", text: "text-blue-300 border-blue-800/40" },
    INSERT: { bg: "bg-emerald-950/60", text: "text-emerald-300 border-emerald-800/40" },
    UPDATE: { bg: "bg-amber-950/60", text: "text-amber-300 border-amber-800/40" },
    DELETE: { bg: "bg-rose-950/60", text: "text-rose-300 border-rose-800/40" },
    ALL: { bg: "bg-indigo-950/60", text: "text-indigo-300 border-indigo-800/40" }
};

const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
    synced: { bg: "bg-emerald-950/30", text: "text-emerald-400", border: "border-emerald-900/55", label: "Live" },
    unapplied: { bg: "bg-primary/20", text: "text-primary-light", border: "border-primary/30", label: "Unapplied" },
    "code-only": { bg: "bg-amber-950/20", text: "text-amber-400", border: "border-amber-900/40", label: "Code Only" },
    "db-only": { bg: "bg-cyan-950/20", text: "text-cyan-400", border: "border-cyan-900/40", label: "DB Only" }
};

// ─── SQL Expression Parsing & Serialization Utilities ─────
interface VisualCondition {
    type: "always" | "rule";
    left: string;
    operator: string;
    right: string;
}

function parseExpression(expr: string): VisualCondition {
    const clean = (expr || "").trim();
    if (!clean || clean === "true") {
        return { type: "always", left: "rebase.uid()", operator: "=", right: "id" };
    }
    
    // Check if it's "rebase.uid() = something" or "rebase.uid() != something"
    const uidMatch = clean.match(/^auth\.uid\(\)\s*(=|!=)\s*([a-zA-Z_][a-zA-Z0-9_]*)$/i);
    if (uidMatch) {
        return {
            type: "rule",
            left: "rebase.uid()",
            operator: uidMatch[1],
            right: uidMatch[2]
        };
    }
    
    // Check if it's "auth.role() = 'something'" or "auth.role() != 'something'"
    const roleMatch = clean.match(/^auth\.role\(\)\s*(=|!=)\s*'([^']+)'$/i);
    if (roleMatch) {
        return {
            type: "rule",
            left: "auth.role()",
            operator: roleMatch[1],
            right: roleMatch[2]
        };
    }
    
    // Check if it's "column = value" or "column != value"
    const colMatch = clean.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(=|!=)\s*(.*)$/i);
    if (colMatch) {
        const rightVal = colMatch[3].trim().replace(/^'|'$/g, "");
        return {
            type: "rule",
            left: colMatch[1],
            operator: colMatch[2],
            right: rightVal
        };
    }
    
    // Fallback to custom expression
    return {
        type: "rule",
        left: "custom",
        operator: "=",
        right: clean
    };
}

function serializeExpression(cond: VisualCondition): string {
    if (cond.type === "always") {
        return "true";
    }
    if (cond.left === "custom") {
        return cond.right || "true";
    }
    if (cond.left === "rebase.uid()") {
        return `rebase.uid() ${cond.operator} ${cond.right}`;
    }
    if (cond.left === "auth.role()") {
        return `auth.role() ${cond.operator} '${cond.right}'`;
    }
    
    // Check if output needs single quotes (strings need quotes, numbers/booleans don't)
    const isBooleanOrNumeric = cond.right === "true" || cond.right === "false" || (!isNaN(Number(cond.right)) && cond.right !== "");
    const rightVal = isBooleanOrNumeric ? cond.right : `'${cond.right}'`;
    return `${cond.left} ${cond.operator} ${rightVal}`;
}

// ─── VisualRuleBuilder Sub-Component ─────────────────────
function VisualRuleBuilder({
    label,
    expression,
    onChange,
    tableName
}: {
    label: string;
    expression: string;
    onChange: (expr: string) => void;
    tableName: string;
}) {
    const cond = parseExpression(expression);
    const columns = TABLE_COLUMNS[tableName] || [];
    
    const handleTypeChange = (type: "always" | "rule") => {
        if (type === "always") {
            onChange("true");
        } else {
            // Pick a logical default based on available columns
            const defaultIdCol = columns.includes("user_id") ? "user_id" : (columns.includes("author_id") ? "author_id" : "id");
            onChange(`rebase.uid() = ${defaultIdCol}`);
        }
    };

    const handleUpdate = (updated: Partial<VisualCondition>) => {
        const newCond = { ...cond, ...updated };
        onChange(serializeExpression(newCond));
    };

    return (
        <div className="space-y-2 p-3 rounded-lg bg-surface-900/60 border border-surface-800/40">
            <div className="flex items-center justify-between">
                <span className="text-[10px] text-surface-400 uppercase font-semibold tracking-wider">{label}</span>
                <div className="flex gap-1 bg-surface-950 p-0.5 rounded border border-surface-800/30 text-[10px]">
                    <button
                        type="button"
                        onClick={() => handleTypeChange("always")}
                        className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                            cond.type === "always" 
                                ? "bg-primary/20 text-primary-light font-semibold" 
                                : "text-surface-500 hover:text-surface-300"
                        }`}
                    >
                        Always (true)
                    </button>
                    <button
                        type="button"
                        onClick={() => handleTypeChange("rule")}
                        className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                            cond.type === "rule" 
                                ? "bg-primary/20 text-primary-light font-semibold" 
                                : "text-surface-500 hover:text-surface-300"
                        }`}
                    >
                        Custom Rule
                    </button>
                </div>
            </div>

            {cond.type === "rule" ? (
                <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {/* Left side selector */}
                        <select
                            value={cond.left}
                            onChange={(e) => {
                                const left = e.target.value;
                                if (left === "rebase.uid()") {
                                    const defaultIdCol = columns.includes("user_id") ? "user_id" : (columns.includes("author_id") ? "author_id" : "id");
                                    handleUpdate({ left, operator: "=", right: defaultIdCol });
                                } else if (left === "auth.role()") {
                                    handleUpdate({ left, operator: "=", right: "authenticated" });
                                } else if (left === "custom") {
                                    handleUpdate({ left, operator: "=", right: "" });
                                } else {
                                    handleUpdate({ left, operator: "=", right: "true" });
                                }
                            }}
                            className="bg-surface-850 border border-surface-700/40 rounded px-2 py-1 text-surface-200 font-mono outline-none focus:border-primary transition-all cursor-pointer"
                        >
                            <option value="rebase.uid()">rebase.uid() [User ID]</option>
                            <option value="auth.role()">auth.role() [User Role]</option>
                            {columns.map(col => (
                                <option key={col} value={col}>column: {col}</option>
                            ))}
                            <option value="custom">Custom SQL Expression</option>
                        </select>

                        {cond.left !== "custom" && (
                            <>
                                {/* Operator selector */}
                                <select
                                    value={cond.operator}
                                    onChange={(e) => handleUpdate({ operator: e.target.value })}
                                    className="bg-surface-850 border border-surface-700/40 rounded px-1.5 py-1 text-surface-200 font-mono outline-none focus:border-primary transition-all cursor-pointer"
                                >
                                    <option value="=">=</option>
                                    <option value="!=">!=</option>
                                </select>

                                {/* Right side selector/input */}
                                {cond.left === "rebase.uid()" ? (
                                    <select
                                        value={cond.right}
                                        onChange={(e) => handleUpdate({ right: e.target.value })}
                                        className="bg-surface-850 border border-surface-700/40 rounded px-2 py-1 text-surface-200 font-mono outline-none focus:border-primary transition-all cursor-pointer"
                                    >
                                        {columns.map(col => (
                                            <option key={col} value={col}>{col}</option>
                                        ))}
                                    </select>
                                ) : cond.left === "auth.role()" ? (
                                    <select
                                        value={cond.right}
                                        onChange={(e) => handleUpdate({ right: e.target.value })}
                                        className="bg-surface-850 border border-surface-700/40 rounded px-2 py-1 text-surface-200 font-mono outline-none focus:border-primary transition-all cursor-pointer"
                                    >
                                        <option value="public">public</option>
                                        <option value="authenticated">authenticated</option>
                                        <option value="anon">anon</option>
                                        <option value="admin">admin</option>
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        value={cond.right}
                                        onChange={(e) => handleUpdate({ right: e.target.value })}
                                        placeholder="value (e.g. true, 'admin')"
                                        className="bg-surface-850 border border-surface-700/40 rounded px-2 py-1 text-surface-200 font-mono outline-none focus:border-primary transition-all flex-1 min-w-[80px]"
                                    />
                                )}
                            </>
                        )}
                    </div>

                    {cond.left === "custom" && (
                        <textarea
                            rows={2}
                            value={cond.right}
                            onChange={(e) => handleUpdate({ right: e.target.value })}
                            placeholder="raw SQL condition expression (e.g. rebase.uid() = id OR is_admin = true)"
                            className="w-full bg-surface-850 border border-surface-700/40 rounded px-2 py-1 text-[11px] font-mono text-amber-300 outline-none focus:border-primary transition-all resize-none"
                        />
                    )}

                    <div className="text-[10px] text-surface-500 font-mono bg-surface-950/60 px-2 py-1.5 rounded flex items-center justify-between">
                        <span className="opacity-70">Compiled SQL:</span>
                        <code className="text-amber-400 font-semibold">{expression}</code>
                    </div>
                </div>
            ) : (
                <div className="text-[11px] text-surface-500 font-mono bg-surface-950/60 px-3 py-2 rounded-md">
                    Always allows access (evaluates to <code className="text-emerald-400 font-semibold">true</code>).
                </div>
            )}
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────
export function RLSEditorDemo() {
    const [tables, setTables] = useState<RLSTable[]>(MOCK_TABLES);
    const [selectedTable, setSelectedTable] = useState<string>("users");
    const [editingPolicy, setEditingPolicy] = useState<string | null>(null);
    const [showNewPolicyForm, setShowNewPolicyForm] = useState(false);
    
    // Simulated DB Syncing Loader state
    const [isSyncing, setIsSyncing] = useState(false);

    // New Policy form state variables
    const [newPolicyName, setNewPolicyName] = useState("");
    const [newPolicyCommand, setNewPolicyCommand] = useState<RLSPolicy["command"]>("SELECT");
    const [newPolicyUsing, setNewPolicyUsing] = useState("true");
    const [newPolicyWithCheck, setNewPolicyWithCheck] = useState("true");
    const [newPolicyRoles, setNewPolicyRoles] = useState<string[]>(["public"]);

    // Editing Policy form state variables
    const [editName, setEditName] = useState("");
    const [editCommand, setEditCommand] = useState<RLSPolicy["command"]>("SELECT");
    const [editUsing, setEditUsing] = useState("true");
    const [editWithCheck, setEditWithCheck] = useState("true");
    const [editRoles, setEditRoles] = useState<string[]>([]);

    const activeTable = tables.find(t => t.name === selectedTable) ?? tables[0];
    const hasUnapplied = activeTable.policies.some(p => p.syncStatus === "unapplied");

    const toggleRLS = useCallback((tableName: string) => {
        setTables(prev => prev.map(t =>
            t.name === tableName ? { ...t, rlsEnabled: !t.rlsEnabled } : t
        ));
    }, []);

    const deletePolicy = useCallback((tableId: string, policyId: string) => {
        setTables(prev => prev.map(t =>
            t.name === tableId ? { ...t, policies: t.policies.filter(p => p.id !== policyId) } : t
        ));
    }, []);

    const syncToDB = useCallback((tableName: string) => {
        setIsSyncing(true);
        setTimeout(() => {
            setTables(prev => prev.map(t =>
                t.name === tableName
                    ? {
                        ...t,
                        policies: t.policies.map(p => ({ ...p, syncStatus: "synced" }))
                    }
                    : t
            ));
            setIsSyncing(false);
        }, 1000);
    }, []);

    const startEditing = useCallback((policy: RLSPolicy) => {
        setEditingPolicy(policy.id);
        setEditName(policy.name);
        setEditCommand(policy.command);
        setEditUsing(policy.using);
        setEditWithCheck(policy.withCheck ?? "true");
        setEditRoles(policy.roles);
    }, []);

    const savePolicy = useCallback((policyId: string) => {
        if (!editName.trim()) return;

        const showCheck = editCommand === "ALL" || editCommand === "INSERT" || editCommand === "UPDATE";
        const showUsing = editCommand !== "INSERT";

        setTables(prev => prev.map(t =>
            t.name === selectedTable
                ? {
                    ...t,
                    policies: t.policies.map(p =>
                        p.id === policyId
                            ? {
                                ...p,
                                name: editName.trim(),
                                command: editCommand,
                                using: showUsing ? editUsing : "true",
                                withCheck: showCheck ? editWithCheck : undefined,
                                roles: editRoles.length > 0 ? editRoles : ["public"],
                                syncStatus: "unapplied"
                            }
                            : p
                    )
                }
                : t
        ));
        setEditingPolicy(null);
    }, [selectedTable, editName, editCommand, editUsing, editWithCheck, editRoles]);

    const openNewPolicyForm = () => {
        setNewPolicyName("");
        setNewPolicyCommand("SELECT");
        setNewPolicyUsing("true");
        setNewPolicyWithCheck("true");
        setNewPolicyRoles(["public"]);
        setShowNewPolicyForm(true);
    };

    const addPolicy = useCallback(() => {
        if (!newPolicyName.trim()) return;
        
        const showCheck = newPolicyCommand === "ALL" || newPolicyCommand === "INSERT" || newPolicyCommand === "UPDATE";
        const showUsing = newPolicyCommand !== "INSERT";

        const newPolicy: RLSPolicy = {
            id: String(Date.now()),
            name: newPolicyName.trim(),
            command: newPolicyCommand,
            using: showUsing ? newPolicyUsing : "true",
            withCheck: showCheck ? newPolicyWithCheck : undefined,
            roles: newPolicyRoles.length > 0 ? newPolicyRoles : ["public"],
            permissive: true,
            syncStatus: "unapplied"
        };

        setTables(prev => prev.map(t =>
            t.name === selectedTable ? { ...t, policies: [...t.policies, newPolicy] } : t
        ));
        
        setShowNewPolicyForm(false);
    }, [newPolicyName, newPolicyCommand, newPolicyUsing, newPolicyWithCheck, newPolicyRoles, selectedTable]);

    // Helpers to identify which builder inputs are needed
    const newShowCheck = newPolicyCommand === "ALL" || newPolicyCommand === "INSERT" || newPolicyCommand === "UPDATE";
    const newShowUsing = newPolicyCommand !== "INSERT";

    const editShowCheck = editCommand === "ALL" || editCommand === "INSERT" || editCommand === "UPDATE";
    const editShowUsing = editCommand !== "INSERT";

    return (
        <div className="flex h-[580px] w-full rounded-xl overflow-hidden ring-1 ring-surface-700 bg-surface-950 shadow-2xl text-surface-300 text-sm">
            {/* ── Sidebar ── */}
            <div className="w-[180px] border-r border-surface-800/40 flex flex-col shrink-0">
                <div className="px-3 py-2.5 border-b border-surface-800/40 bg-surface-900/40 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-surface-500">Tables</span>
                    <svg className="h-3 w-3 text-surface-600 cursor-pointer hover:text-surface-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                    {/* Group by schema */}
                    {["public", "auth"].map(schema => (
                        <div key={schema}>
                            <div className="text-[10px] font-semibold text-surface-500 px-1.5 py-1 tracking-wider">▾ {schema}</div>
                            {tables.filter(t => t.schema === schema).map(table => (
                                <button
                                    key={table.name}
                                    onClick={() => {
                                        setSelectedTable(table.name);
                                        setEditingPolicy(null);
                                        setShowNewPolicyForm(false);
                                    }}
                                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs w-full text-left transition-colors cursor-pointer ${
                                        selectedTable === table.name
                                            ? "bg-primary/10 text-primary"
                                            : "text-surface-400 hover:bg-surface-800/40"
                                    }`}
                                >
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        table.rlsEnabled ? "bg-emerald-500" : "bg-orange-400 opacity-50"
                                    }`}/>
                                    <span className="truncate flex-1 font-mono text-[11px]">{table.name}</span>
                                    <span className="text-[10px] opacity-40">{table.policies.length}</span>
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Main Panel ── */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Table header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-800/40 bg-surface-900/30 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-surface-300">{activeTable.schema}.{activeTable.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${
                            activeTable.rlsEnabled
                                ? "bg-emerald-950/30 text-emerald-400 border-emerald-900/40"
                                : "bg-orange-950/30 text-orange-400 border-orange-900/40"
                        }`}>
                            RLS {activeTable.rlsEnabled ? "ENABLED" : "DISABLED"}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => toggleRLS(activeTable.name)}
                            className="text-[10px] px-2 py-1 rounded-md bg-surface-800/60 text-surface-400 hover:text-surface-300 cursor-pointer transition-colors"
                        >
                            {activeTable.rlsEnabled ? "Disable RLS" : "Enable RLS"}
                        </button>
                        
                        {/* Apply / Sync to DB Button */}
                        {activeTable.rlsEnabled && hasUnapplied && (
                            <button
                                onClick={() => syncToDB(activeTable.name)}
                                disabled={isSyncing}
                                className="text-[10px] px-2.5 py-1 rounded-md bg-emerald-500 text-surface-950 font-semibold cursor-pointer hover:bg-emerald-400 disabled:opacity-50 transition-all flex items-center gap-1 shadow-md shadow-emerald-500/10 animate-pulse"
                            >
                                {isSyncing ? (
                                    <>
                                        <svg className="animate-spin h-3 w-3 text-surface-950" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Syncing...
                                    </>
                                ) : (
                                    <>
                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        Sync DB
                                    </>
                                )}
                            </button>
                        )}

                        {activeTable.rlsEnabled && (
                            <button
                                onClick={openNewPolicyForm}
                                className="text-[10px] px-2 py-1 rounded-md bg-primary/20 text-primary-light font-semibold cursor-pointer hover:bg-primary/30 transition-colors"
                            >
                                + Create Policy
                            </button>
                        )}
                    </div>
                </div>

                {/* Policies list */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-surface-900/20">
                    {!activeTable.rlsEnabled ? (
                        <div className="flex items-center justify-center h-full text-surface-600">
                            <div className="text-center">
                                <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                                <p className="text-xs mb-3">RLS is disabled for this table</p>
                                <button
                                    onClick={() => toggleRLS(activeTable.name)}
                                    className="px-3 py-1.5 rounded-md bg-primary/20 text-primary-light text-[11px] font-semibold hover:bg-primary/30 cursor-pointer transition-colors"
                                >
                                    Enable RLS
                                </button>
                            </div>
                        </div>
                    ) : activeTable.policies.length === 0 && !showNewPolicyForm ? (
                        <div className="flex items-center justify-center h-full text-surface-600">
                            <div className="text-center">
                                <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                                <p className="text-xs mb-1">No policies defined</p>
                                <p className="text-[10px] text-surface-600 mb-3">All access is denied by default</p>
                                <button
                                    onClick={openNewPolicyForm}
                                    className="px-3 py-1.5 rounded-md bg-primary/20 text-primary-light text-[11px] font-semibold hover:bg-primary/30 cursor-pointer transition-colors"
                                >
                                    Create First Policy
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {activeTable.policies.map((policy) => {
                                const cmdStyle = COMMAND_COLORS[policy.command] ?? COMMAND_COLORS.SELECT;
                                const statusStyle = STATUS_STYLES[policy.syncStatus] ?? STATUS_STYLES.synced;

                                return (
                                    <div
                                        key={policy.id}
                                        className={`p-3 rounded-lg border transition-colors ${
                                            editingPolicy === policy.id
                                                ? "border-primary bg-primary/5 shadow-inner"
                                                : policy.syncStatus === "unapplied"
                                                    ? "border-primary/20 bg-primary/5 hover:border-primary/35"
                                                    : "border-surface-800/50 bg-surface-950/80 hover:border-surface-700/60"
                                        }`}
                                    >
                                        {/* Card Header when NOT editing this policy */}
                                        {editingPolicy !== policy.id ? (
                                            <>
                                                <div className="flex items-center justify-between mb-2.5">
                                                    <div className="flex items-center gap-2">
                                                        <svg className="h-3.5 w-3.5 text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
                                                        <span className="text-sm text-white font-semibold">{policy.name}</span>
                                                        <span className={`text-[8px] px-1.5 py-0.5 rounded font-semibold uppercase ${cmdStyle.bg} ${cmdStyle.text} border ${cmdStyle.text.replace("text-", "border-").replace("300", "800/40")}`}>
                                                            {policy.command}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}>
                                                            {statusStyle.label}
                                                        </span>
                                                        <button
                                                            onClick={() => startEditing(policy)}
                                                            className="text-surface-500 hover:text-surface-300 cursor-pointer transition-colors"
                                                            title="Edit Policy"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                                        </button>
                                                        <button
                                                            onClick={() => deletePolicy(activeTable.name, policy.id)}
                                                            className="text-surface-500 hover:text-red-400 cursor-pointer transition-colors"
                                                            title="Delete Policy"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap gap-1.5">
                                                    <div className="flex items-center gap-1 px-2 py-1 rounded bg-surface-800/60 text-[10px]">
                                                        <span className="text-surface-500 uppercase font-semibold">USING:</span>
                                                        <code className="text-amber-300 font-mono font-semibold">{policy.using}</code>
                                                    </div>
                                                    {policy.withCheck && (
                                                        <div className="flex items-center gap-1 px-2 py-1 rounded bg-surface-800/60 text-[10px]">
                                                            <span className="text-surface-500 uppercase font-semibold">CHECK:</span>
                                                            <code className="text-amber-300 font-mono font-semibold">{policy.withCheck}</code>
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-1 px-2 py-1 rounded bg-surface-800/60 text-[10px]">
                                                        <span className="text-surface-500 uppercase font-semibold">Roles:</span>
                                                        <span className="text-surface-300 font-mono font-medium">{policy.roles.join(", ")}</span>
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            /* Expanded EDIT form */
                                            <div className="space-y-3.5">
                                                <div className="flex items-center gap-2 border-b border-surface-800/30 pb-2 mb-1">
                                                    <svg className="h-3.5 w-3.5 text-primary-light animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                                    <span className="text-xs text-white font-semibold">Editing Policy "{policy.name}"</span>
                                                </div>
                                                
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-[10px] text-surface-500 uppercase font-semibold block mb-1">Policy Name</label>
                                                        <input
                                                            type="text"
                                                            className="w-full px-2.5 py-1.5 rounded bg-surface-800/60 border border-surface-700/40 text-[11px] font-mono text-surface-200 outline-none focus:border-primary transition-all"
                                                            value={editName}
                                                            onChange={(e) => setEditName(e.target.value)}
                                                            placeholder="policy_name"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] text-surface-500 uppercase font-semibold block mb-1">Command / Action</label>
                                                        <select
                                                            className="w-full px-2.5 py-1.5 rounded bg-surface-800/60 border border-surface-700/40 text-[11px] font-mono text-surface-200 outline-none focus:border-primary transition-all cursor-pointer"
                                                            value={editCommand}
                                                            onChange={(e) => setEditCommand(e.target.value as RLSPolicy["command"])}
                                                        >
                                                            <option value="SELECT">SELECT</option>
                                                            <option value="INSERT">INSERT</option>
                                                            <option value="UPDATE">UPDATE</option>
                                                            <option value="DELETE">DELETE</option>
                                                            <option value="ALL">ALL (ALL ops)</option>
                                                        </select>
                                                    </div>
                                                </div>

                                                {/* Roles multi-select */}
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[10px] text-surface-500 uppercase font-semibold block mb-0.5">Target Roles</label>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {["public", "authenticated", "anon", "admin"].map(role => {
                                                            const isSelected = editRoles.includes(role);
                                                            return (
                                                                <button
                                                                    key={role}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        if (isSelected) {
                                                                            setEditRoles(editRoles.filter(r => r !== role));
                                                                        } else {
                                                                            setEditRoles([...editRoles, role]);
                                                                        }
                                                                    }}
                                                                    className={`px-2 py-0.5 rounded text-[10px] border transition-all cursor-pointer ${
                                                                        isSelected
                                                                            ? "bg-primary/25 text-primary-light border-primary/35 font-semibold"
                                                                            : "bg-surface-800/40 text-surface-500 border-surface-700/10 hover:text-surface-300"
                                                                    }`}
                                                                >
                                                                    {role}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {/* Visual Condition Builders for EDIT */}
                                                {editShowUsing && (
                                                    <VisualRuleBuilder
                                                        label="USING Expression (Row Reads)"
                                                        expression={editUsing}
                                                        onChange={setEditUsing}
                                                        tableName={activeTable.name}
                                                    />
                                                )}

                                                {editShowCheck && (
                                                    <VisualRuleBuilder
                                                        label="WITH CHECK Expression (Writes / Updates)"
                                                        expression={editWithCheck}
                                                        onChange={setEditWithCheck}
                                                        tableName={activeTable.name}
                                                    />
                                                )}

                                                <div className="flex gap-2 pt-1 border-t border-surface-800/30">
                                                    <button
                                                        onClick={() => savePolicy(policy.id)}
                                                        className="px-3 py-1 rounded bg-primary text-white text-[10px] font-semibold hover:bg-primary/80 transition-colors cursor-pointer"
                                                    >
                                                        Save Changes
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingPolicy(null)}
                                                        className="px-3 py-1 rounded bg-surface-800/60 text-surface-400 text-[10px] font-semibold hover:text-surface-300 transition-colors cursor-pointer"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* New policy form */}
                            {showNewPolicyForm && (
                                <div className="p-3.5 rounded-lg border border-primary/35 bg-primary/5 space-y-3.5 shadow-md">
                                    <div className="flex items-center gap-2 border-b border-primary/10 pb-2 mb-1">
                                        <svg className="h-3.5 w-3.5 text-primary-light" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/></svg>
                                        <span className="text-xs text-white font-semibold">New Policy</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-[10px] text-surface-500 uppercase font-semibold block mb-1">Name</label>
                                            <input
                                                type="text"
                                                className="w-full px-2.5 py-1.5 rounded bg-surface-800/60 border border-surface-700/40 text-[11px] font-mono text-surface-200 outline-none focus:border-primary transition-all"
                                                value={newPolicyName}
                                                onChange={(e) => setNewPolicyName(e.target.value)}
                                                placeholder="policy_name"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-surface-500 uppercase font-semibold block mb-1">Command / Action</label>
                                            <select
                                                className="w-full px-2.5 py-1.5 rounded bg-surface-800/60 border border-surface-700/40 text-[11px] font-mono text-surface-200 outline-none focus:border-primary transition-all cursor-pointer"
                                                value={newPolicyCommand}
                                                onChange={(e) => setNewPolicyCommand(e.target.value as RLSPolicy["command"])}
                                            >
                                                <option value="SELECT">SELECT</option>
                                                <option value="INSERT">INSERT</option>
                                                <option value="UPDATE">UPDATE</option>
                                                <option value="DELETE">DELETE</option>
                                                <option value="ALL">ALL (ALL ops)</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Roles Selector */}
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-surface-500 uppercase font-semibold block mb-0.5">Target Roles</label>
                                        <div className="flex flex-wrap gap-1.5">
                                            {["public", "authenticated", "anon", "admin"].map(role => {
                                                const isSelected = newPolicyRoles.includes(role);
                                                return (
                                                    <button
                                                        key={role}
                                                        type="button"
                                                        onClick={() => {
                                                            if (isSelected) {
                                                                setNewPolicyRoles(newPolicyRoles.filter(r => r !== role));
                                                            } else {
                                                                setNewPolicyRoles([...newPolicyRoles, role]);
                                                            }
                                                        }}
                                                        className={`px-2 py-0.5 rounded text-[10px] border transition-all cursor-pointer ${
                                                            isSelected
                                                                ? "bg-primary/25 text-primary-light border-primary/35 font-semibold"
                                                                : "bg-surface-800/40 text-surface-500 border-surface-700/10 hover:text-surface-300"
                                                        }`}
                                                    >
                                                        {role}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Visual Rule Builders for NEW */}
                                    {newShowUsing && (
                                        <VisualRuleBuilder
                                            label="USING Expression (Row Reads)"
                                            expression={newPolicyUsing}
                                            onChange={setNewPolicyUsing}
                                            tableName={activeTable.name}
                                        />
                                    )}

                                    {newShowCheck && (
                                        <VisualRuleBuilder
                                            label="WITH CHECK Expression (Writes / Updates)"
                                            expression={newPolicyWithCheck}
                                            onChange={setNewPolicyWithCheck}
                                            tableName={activeTable.name}
                                        />
                                    )}

                                    <div className="flex gap-2 pt-1.5 border-t border-surface-800/30">
                                        <button
                                            onClick={addPolicy}
                                            disabled={!newPolicyName.trim()}
                                            className="px-3 py-1.5 rounded bg-primary text-white text-[10px] font-semibold hover:bg-primary/80 disabled:opacity-50 transition-colors cursor-pointer"
                                        >
                                            Create Policy
                                        </button>
                                        <button
                                            onClick={() => setShowNewPolicyForm(false)}
                                            className="px-3 py-1.5 rounded bg-surface-800/60 text-surface-400 text-[10px] font-semibold hover:text-surface-300 transition-colors cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
