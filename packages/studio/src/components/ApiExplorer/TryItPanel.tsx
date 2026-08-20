import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
    Button,
    cls,
    defaultBorderMixin,
    IconButton,
    iconSize,
    LoaderIcon,
    PlusIcon,
    SendIcon,
    TextField,
    Typography,
    XIcon
} from "@rebasepro/ui";
import { useRebaseContext, UserSelectPopover, SelectableUser } from "@rebasepro/app";
import { AuthSimulationSelector } from "../AuthSimulationSelector";
import type { ParsedEndpoint } from "./types";
import type { User } from "@rebasepro/types";

interface TryItPanelProps {
    endpoint: ParsedEndpoint;
    apiUrl: string;
    getAuthToken: () => Promise<string | null | undefined>;
    user: User | null;
    basePath?: string;
}

/**
 * Interactive "Try It" panel that lets the user execute API requests
 * using their current JWT token directly from the Studio.
 */
export function TryItPanel({ endpoint, apiUrl, getAuthToken, user, basePath = "" }: TryItPanelProps) {
    const storageKey = `rebase_apiexplorer_${endpoint.method}_${endpoint.path}`;

    const [pathParams, setPathParams] = useState<Record<string, string>>(() => {
        try { const v = localStorage.getItem(`${storageKey}_path`); if (v) return JSON.parse(v); } catch { /* ignore */ }
        return {};
    });
    const [queryParams, setQueryParams] = useState<Record<string, string>>(() => {
        try { const v = localStorage.getItem(`${storageKey}_query`); if (v) return JSON.parse(v); } catch { /* ignore */ }
        return {};
    });
    const [customHeaders, setCustomHeaders] = useState<Array<{ key: string; value: string }>>(() => {
        try { const v = localStorage.getItem(`${storageKey}_headers`); if (v) return JSON.parse(v); } catch { /* ignore */ }
        return [{ key: "rebase-branch",
value: "" }];
    });
    const [body, setBody] = useState(() => {
        try { const v = localStorage.getItem(`${storageKey}_body`); if (v) return JSON.parse(v); } catch { /* ignore */ }
        return buildBodyTemplate(endpoint);
    });
    const [response, setResponse] = useState<{ status: number; statusText: string; body: string; time: number } | null>(
        null
    );
    const [loading, setLoading] = useState(false);
    const [authMode, setAuthMode] = useState<"jwt" | "none">("jwt");
    const [validationError, setValidationError] = useState<string | null>(null);

    const rebaseContext = useRebaseContext();
    const currentUser = rebaseContext.authController?.user;

    const users = useMemo((): SelectableUser[] => {
        const managed: SelectableUser[] = [];
        if (currentUser) {
            managed.push({
                uid: currentUser.uid,
                displayName: currentUser.displayName,
                email: currentUser.email,
                photoURL: currentUser.photoURL,
                roles: currentUser.roles
            });
        }
        return managed;
    }, [currentUser]);

    const currentSelectableUser = useMemo((): SelectableUser | null => {
        if (!currentUser) return null;
        return {
            uid: currentUser.uid,
            displayName: currentUser.displayName,
            email: currentUser.email,
            photoURL: currentUser.photoURL,
            roles: currentUser.roles
        };
    }, [currentUser]);

    const [selectedUser, setSelectedUser] = useState<SelectableUser | null>(null);

    useEffect(() => {
        localStorage.setItem(`${storageKey}_path`, JSON.stringify(pathParams));
        localStorage.setItem(`${storageKey}_query`, JSON.stringify(queryParams));
        localStorage.setItem(`${storageKey}_headers`, JSON.stringify(customHeaders));
        localStorage.setItem(`${storageKey}_body`, JSON.stringify(body));
    }, [storageKey, pathParams, queryParams, customHeaders, body]);

    // Build the final URL
    const resolvedUrl = useMemo(() => {
        const base = basePath.startsWith("/") ? basePath : `/${basePath}`;
        const cleanBase = base === "/" ? "" : base;
        let url = `${apiUrl.replace(/\/+$/, "")}${cleanBase}${endpoint.path}`;
        // Replace path params
        for (const [key, val] of Object.entries(pathParams)) {
            url = url.replace(`{${key}}`, encodeURIComponent(val));
        }
        // Append query params
        const qp = Object.entries(queryParams).filter(([, v]) => v.trim() !== "");
        if (qp.length > 0) {
            url += "?" + qp.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
        }
        return url;
    }, [apiUrl, basePath, endpoint.path, pathParams, queryParams]);

    const pathParamDefs = endpoint.parameters.filter((p) => p.in === "path");
    const queryParamDefs = endpoint.parameters.filter((p) => p.in === "query");
    const hasBody = ["post", "put", "patch"].includes(endpoint.method);

    const execute = useCallback(async () => {
        setValidationError(null);
        if (hasBody && body.trim()) {
            try {
                JSON.parse(body);
            } catch (err: unknown) {
                setValidationError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
                return;
            }
        }

        setLoading(true);
        setResponse(null);
        const start = performance.now();

        try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };

            for (const h of customHeaders) {
                if (h.key.trim()) headers[h.key.trim()] = h.value;
            }

            if (authMode === "jwt") {
                const token = await getAuthToken();
                if (token) headers["Authorization"] = `Bearer ${token}`;
                if (selectedUser && selectedUser.uid !== currentUser?.uid) {
                    headers["x-rebase-impersonate"] = selectedUser.uid;
                }
            }

            const res = await fetch(resolvedUrl, {
                method: endpoint.method.toUpperCase(),
                headers,
                body: hasBody && body.trim() ? body : undefined
            });

            const elapsed = Math.round(performance.now() - start);
            let text: string;

            const rawText = await res.text();
            try {
                const json = JSON.parse(rawText);
                text = JSON.stringify(json, null, 2);
            } catch {
                text = rawText;
            }

            setResponse({ status: res.status,
statusText: res.statusText,
body: text,
time: elapsed });
        } catch (err: unknown) {
            setResponse({
                status: 0,
                statusText: "Network Error",
                body: err instanceof Error ? err.message : "Request failed",
                time: Math.round(performance.now() - start)
            });
        } finally {
            setLoading(false);
        }
    }, [resolvedUrl, endpoint.method, hasBody, body, authMode, getAuthToken, customHeaders, selectedUser, currentUser?.uid]);

    return (
        <div className="flex flex-col h-full">
            <div className="p-5 space-y-5 overflow-y-auto flex-1">
                {/* Auth Mode */}
                <AuthSimulationSelector
                    authMode={authMode}
                    setAuthMode={setAuthMode}
                    selectedUser={selectedUser}
                    setSelectedUser={setSelectedUser}
                    users={users}
                    loading={false}
                    currentUser={currentSelectableUser}
                />

                {/* Path Params */}
                {pathParamDefs.length > 0 && (
                    <ParamSection
                        title="Path Parameters"
                        params={pathParamDefs}
                        values={pathParams}
                        onChange={(k, v) => setPathParams((prev) => ({ ...prev,
[k]: v }))}
                    />
                )}

                {/* Query Params */}
                {queryParamDefs.length > 0 && (
                    <ParamSection
                        title="Query Parameters"
                        params={queryParamDefs}
                        values={queryParams}
                        onChange={(k, v) => setQueryParams((prev) => ({ ...prev,
[k]: v }))}
                    />
                )}

                {/* Custom Headers */}
                <CustomKeyValueSection
                    title="Custom Headers"
                    values={customHeaders}
                    onChange={(i, k, v) => {
                        const next = [...customHeaders];
                        next[i] = { key: k,
value: v };
                        setCustomHeaders(next);
                    }}
                    onAdd={() => setCustomHeaders((prev) => [...prev, { key: "",
value: "" }])}
                    onRemove={(i) => {
                        const next = [...customHeaders];
                        next.splice(i, 1);
                        setCustomHeaders(next);
                    }}
                />

                {/* Request Body */}
                {hasBody && (
                    <div>
                        <Typography
                            variant="caption"
                            className="text-text-secondary dark:text-text-secondary-dark text-xs font-semibold uppercase tracking-wider mb-2 block"
                        >
                            Request Body
                        </Typography>
                        <TextField
                            multiline
                            minRows={10}
                            aria-label="Request Body"
                            value={body}
                            onChange={(e) => { setBody(e.target.value); setValidationError(null); }}
                            spellCheck={false}
                            error={!!validationError}
                            className="w-full"
                            inputClassName="font-mono text-xs p-3 resize-y"
                        />
                        {validationError && (
                            <Typography variant="caption" className="text-red-500 mt-1 block text-xs">
                                {validationError}
                            </Typography>
                        )}
                    </div>
                )}

                {/* URL Preview */}
                <div className="rounded-lg bg-surface-100 dark:bg-surface-900 p-3">
                    <Typography
                        variant="caption"
                        className="text-text-secondary dark:text-text-secondary-dark text-[10px] uppercase tracking-wider block mb-1"
                    >
                        Request URL
                    </Typography>
                    <code className="text-xs font-mono text-text-primary dark:text-text-primary-dark break-all">
                        {resolvedUrl}
                    </code>
                </div>

                {/* Execute Button */}
                <Button variant="filled" onClick={execute} disabled={loading} className="w-full">
                    {loading ? (
                        <span className="flex items-center gap-2">
                            <LoaderIcon size={iconSize.small} className="animate-spin" />
                            Sending…
                        </span>
                    ) : (
                        <span className="flex items-center gap-2">
                            <SendIcon size={iconSize.small} />
                            Send Request
                        </span>
                    )}
                </Button>

                {/* Response */}
                {response && (
                    <div className={cls("rounded-lg border overflow-hidden", defaultBorderMixin)}>
                        <div
                            className={cls(
                                "flex items-center justify-between px-4 py-2.5",
                                "bg-surface-50 dark:bg-surface-900/50"
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <ResponseBadge status={response.status}/>
                                <Typography
                                    variant="caption"
                                    className="text-text-secondary dark:text-text-secondary-dark text-xs"
                                >
                                    {response.statusText}
                                </Typography>
                            </div>
                            <Typography
                                variant="caption"
                                className="text-text-secondary dark:text-text-secondary-dark text-xs font-mono"
                            >
                                {response.time}ms
                            </Typography>
                        </div>
                        <pre
                            className={cls(
                                "p-4 text-xs font-mono overflow-auto max-h-96",
                                "bg-surface-950 text-emerald-400",
                                "dark:bg-surface-900 dark:text-emerald-400"
                            )}
                        >
                            {response.body}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── Param Section ────────────────────────────────────────────────── */

function ParamSection({
    title,
    params,
    values,
    onChange
}: {
    title: string;
    params: ParsedEndpoint["parameters"];
    values: Record<string, string>;
    onChange: (_key: string, _value: string) => void;
}) {
    const paramIdBase = React.useId();
    return (
        <div>
            <Typography
                variant="caption"
                className="text-text-secondary dark:text-text-secondary-dark text-xs font-semibold uppercase tracking-wider mb-2 block"
            >
                {title}
            </Typography>
            <div className="space-y-2">
                {params.map((p, index) => (
                    <div key={p.name} className="flex items-center gap-3">
                        <label className="w-32 shrink-0" htmlFor={`${paramIdBase}-${index}-param`}>
                            <code className="text-xs font-mono font-semibold">{p.name}</code>
                            {p.required && <span className="text-red-500 ml-0.5 text-xs">*</span>}
                        </label>
                        <TextField
                            id={`${paramIdBase}-${index}-param`}
                            size="small"
                            placeholder={p.description ?? p.name}
                            value={values[p.name] ?? ""}
                            onChange={(e) => onChange(p.name, e.target.value)}
                            className="flex-1"
                            inputClassName="font-mono text-xs"
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}

function CustomKeyValueSection({
    title,
    values,
    onChange,
    onAdd,
    onRemove
}: {
    title: string;
    values: Array<{ key: string; value: string }>;
    onChange: (index: number, key: string, value: string) => void;
    onAdd: () => void;
    onRemove: (index: number) => void;
}) {
    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <Typography
                    variant="caption"
                    className="text-text-secondary dark:text-text-secondary-dark text-xs font-semibold uppercase tracking-wider block"
                >
                    {title}
                </Typography>
                <Button
                    variant="text"
                    size="small"
                    color="primary"
                    onClick={onAdd}
                    className="text-xs p-0 min-h-0"
                >
                    <PlusIcon size={iconSize.small} className="mr-1" /> Add Header
                </Button>
            </div>
            <div className="space-y-2">
                {values.map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <TextField
                            size="small"
                            aria-label={`Header ${i + 1} name`}
                            placeholder="Header name"
                            value={v.key}
                            onChange={(e) => onChange(i, e.target.value, v.value)}
                            className="w-1/3"
                            inputClassName="font-mono text-xs"
                        />
                        <TextField
                            size="small"
                            aria-label={`Header ${i + 1} value`}
                            placeholder="Value"
                            value={v.value}
                            onChange={(e) => onChange(i, v.key, e.target.value)}
                            className="flex-1"
                            inputClassName="font-mono text-xs"
                        />
                        <IconButton
                            size="small"
                            onClick={() => onRemove(i)}
                            className="text-text-secondary hover:text-red-500 shrink-0"
                            title="Remove"
                        >
                            <XIcon size={iconSize.small} />
                        </IconButton>
                    </div>
                ))}
                {values.length === 0 && (
                    <Typography variant="caption" className="text-text-secondary/50 italic text-xs">
                        No custom headers added.
                    </Typography>
                )}
            </div>
        </div>
    );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function ResponseBadge({ status }: { status: number }) {
    let colorClass = "text-red-500";
    if (status >= 200 && status < 300) colorClass = "text-emerald-500";
    else if (status >= 300 && status < 400) colorClass = "text-blue-500";
    else if (status >= 400 && status < 500) colorClass = "text-amber-500";

    return (
        <span className={cls("text-xs font-semibold font-mono", colorClass)}>
            {status || "ERR"}
        </span>
    );
}

function buildBodyTemplate(endpoint: ParsedEndpoint): string {
    if (!endpoint.requestBody?.content) return "{\n  \n}";
    const json = endpoint.requestBody.content["application/json"];
    if (!json?.schema?.properties) return "{\n  \n}";

    const props = json.schema.properties;
    const lines: string[] = ["{"];
    const keys = Object.keys(props);
    keys.forEach((key, i) => {
        const prop = props[key];
        if (prop.readOnly) return;
        const comma = i < keys.length - 1 ? "," : "";
        const val = defaultValue(prop);
        lines.push(`  "${key}": ${val}${comma}`);
    });
    lines.push("}");
    return lines.join("\n");
}

function defaultValue(schema: { type?: string; format?: string; enum?: (string | number)[] }): string {
    if (schema.enum) return JSON.stringify(schema.enum[0]);
    switch (schema.type) {
        case "string":
            return schema.format === "date-time" ? `"${new Date().toISOString()}"` : '""';
        case "number":
        case "integer":
            return "0";
        case "boolean":
            return "false";
        case "array":
            return "[]";
        default:
            return "null";
    }
}
