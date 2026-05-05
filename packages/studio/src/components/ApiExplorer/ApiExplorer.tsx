import React, { useState, useEffect, useMemo } from "react";
import { useApiConfig, useAuthController } from "@rebasepro/core";
import {
    CircularProgress,
    Typography,
    Alert,
    cls,
    Button,
    Chip,
    defaultBorderMixin,
    SearchBar
} from "@rebasepro/ui";
import { EndpointDetail } from "./EndpointDetail";
import { TryItPanel } from "./TryItPanel";
import type { OpenApiSpec, ParsedEndpoint } from "./types";
import { parseOpenApiSpec } from "./parseSpec";

/**
 * Custom-built API Explorer for Rebase Studio.
 * No external dependencies — renders the OpenAPI spec natively
 * with deep integration into the Rebase auth system.
 */
export function ApiExplorer() {
    const apiConfig = useApiConfig();
    const authController = useAuthController();
    const apiUrl = apiConfig?.apiUrl;

    const [spec, setSpec] = useState<OpenApiSpec | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedEndpoint, setSelectedEndpoint] = useState<ParsedEndpoint | null>(null);
    const [sidebarFilter, setSidebarFilter] = useState("");
    const [tryItOpen, setTryItOpen] = useState(false);

    // Fetch OpenAPI spec
    useEffect(() => {
        if (!apiUrl) return;
        let cancelled = false;
        const specUrl = `${apiUrl.replace(/\/+$/, "")}/api/docs`;

        (async () => {
            try {
                const res = await fetch(specUrl);
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const data = await res.json();
                if (!cancelled) {
                    setSpec(data);
                    setLoading(false);
                }
            } catch (err: any) {
                if (!cancelled) {
                    setError(err.message ?? "Failed to load API spec");
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [apiUrl]);

    // Parse spec into grouped endpoints
    const { groups, allEndpoints } = useMemo(() => {
        if (!spec) return { groups: [],
allEndpoints: [] };
        return parseOpenApiSpec(spec);
    }, [spec]);

    // Filter
    const filteredGroups = useMemo(() => {
        if (!sidebarFilter.trim()) return groups;
        const q = sidebarFilter.toLowerCase();
        return groups
            .map((g) => ({
                ...g,
                endpoints: g.endpoints.filter(
                    (e) =>
                        e.path.toLowerCase().includes(q) ||
                        e.summary.toLowerCase().includes(q) ||
                        e.method.toLowerCase().includes(q)
                )
            }))
            .filter((g) => g.endpoints.length > 0);
    }, [groups, sidebarFilter]);

    // Auto-select first endpoint
    useEffect(() => {
        if (!selectedEndpoint && allEndpoints.length > 0) {
            setSelectedEndpoint(allEndpoints[0]);
        }
    }, [allEndpoints, selectedEndpoint]);

    // ── States ───────────────────────────────────────────────────────
    if (!apiUrl) {
        return (
            <div className="flex items-center justify-center h-full w-full p-8">
                <Alert color="warning">
                    <Typography variant="body2">
                        No API URL configured. Ensure your app provides an{" "}
                        <code className="font-mono text-xs">apiUrl</code>.
                    </Typography>
                </Alert>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full w-full gap-4">
                <CircularProgress size="medium"/>
                <Typography variant="body2" className="text-text-secondary dark:text-text-secondary-dark animate-pulse">
                    Loading API specification…
                </Typography>
            </div>
        );
    }

    if (error || !spec) {
        return (
            <div className="flex items-center justify-center h-full w-full p-8">
                <Alert color="error">
                    <Typography variant="body2">{error ?? "Unknown error"}</Typography>
                </Alert>
            </div>
        );
    }

    const METHOD_COLORS: Record<string, string> = {
        get: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
        post: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
        put: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
        patch: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
        delete: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20"
    };

    return (
        <div className="flex h-full w-full overflow-hidden">
            {/* ── Sidebar ──────────────────────────────────────── */}
            <div
                className={cls(
                    "w-72 min-w-[272px] flex flex-col h-full overflow-hidden border-r",
                    defaultBorderMixin,
                    "bg-surface-50 dark:bg-surface-900"
                )}
            >
                {/* Header */}
                <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="material-icons text-lg text-primary dark:text-primary-dark">auto_stories</span>
                        <Typography variant="subtitle2" className="font-semibold">
                            {spec.info?.title ?? "API Reference"}
                        </Typography>
                    </div>
                    {spec.info?.version && (
                        <Chip size="smallest" colorScheme="cyanDarker">
                            v{spec.info.version}
                        </Chip>
                    )}
                    {/* Search */}
                    <div className="mb-2">
                        <SearchBar
                            placeholder="Filter endpoints…"
                            size="small"
                            onTextSearch={(val) => setSidebarFilter(val || "")}
                        />
                    </div>

                    {/* Auth status removed to avoid redundancy with the AuthSimulationSelector */}
                </div>

                {/* Endpoint list */}
                <div className="flex-1 overflow-y-auto px-2 pb-4">
                    {filteredGroups.map((group) => (
                        <div key={group.tag} className="mb-3">
                            <Typography
                                variant="caption"
                                className="px-2 py-1.5 text-text-secondary dark:text-text-secondary-dark uppercase tracking-wider font-semibold text-[10px]"
                            >
                                {group.tag}
                            </Typography>
                            {group.endpoints.map((ep) => {
                                const isSelected = selectedEndpoint?.id === ep.id;
                                return (
                                    <button
                                        key={ep.id}
                                        onClick={() => {
                                            setSelectedEndpoint(ep);
                                            setTryItOpen(false);
                                        }}
                                        className={cls(
                                            "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-sm transition-all",
                                            "hover:bg-surface-200 dark:hover:bg-surface-700",
                                            isSelected
                                                ? "bg-surface-200 dark:bg-surface-700 font-medium"
                                                : "text-text-primary dark:text-text-primary-dark"
                                        )}
                                    >
                                        <span
                                            className={cls(
                                                "text-[10px] font-bold uppercase w-12 text-center py-0.5 rounded border shrink-0",
                                                defaultBorderMixin,
                                                METHOD_COLORS[ep.method] ?? "bg-surface-200 text-text-secondary"
                                            )}
                                        >
                                            {ep.method}
                                        </span>
                                        <span className="truncate text-xs font-mono opacity-80">{ep.shortPath}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                    {filteredGroups.length === 0 && (
                        <Typography
                            variant="body2"
                            className="text-center text-text-secondary dark:text-text-secondary-dark py-8"
                        >
                            No endpoints match
                        </Typography>
                    )}
                </div>
            </div>

            {/* ── Main content ─────────────────────────────────── */}
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                {selectedEndpoint ? (
                    <>
                        {/* Top bar */}
                        <div
                            className={cls(
                                "flex items-center justify-between px-5 py-3 gap-4 shrink-0 border-b",
                                defaultBorderMixin,
                                "bg-surface-50/50 dark:bg-surface-900/50"
                            )}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <span
                                    className={cls(
                                        "text-xs font-bold uppercase px-2.5 py-1 rounded border",
                                        defaultBorderMixin,
                                        METHOD_COLORS[selectedEndpoint.method] ?? ""
                                    )}
                                >
                                    {selectedEndpoint.method}
                                </span>
                                <code className="text-sm font-mono text-text-primary dark:text-text-primary-dark truncate">
                                    {selectedEndpoint.path}
                                </code>
                            </div>
                            <Button
                                variant={tryItOpen ? "filled" : "outlined"}
                                size="small"
                                onClick={() => setTryItOpen((v) => !v)}
                            >
                                <span className="material-icons text-base mr-1">play_arrow</span>
                                Try It
                            </Button>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto">
                            {tryItOpen ? (
                                <TryItPanel
                                    key={selectedEndpoint.operationId || selectedEndpoint.path}
                                    endpoint={selectedEndpoint}
                                    apiUrl={apiUrl}
                                    getAuthToken={apiConfig?.getAuthToken ?? authController.getAuthToken}
                                    user={authController.user}
                                    basePath={spec?.servers?.[0]?.url || ""}
                                />
                            ) : (
                                <EndpointDetail endpoint={selectedEndpoint} spec={spec}/>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <Typography variant="body2" className="text-text-secondary dark:text-text-secondary-dark">
                            Select an endpoint from the sidebar
                        </Typography>
                    </div>
                )}
            </div>
        </div>
    );
}

ApiExplorer.displayName = "ApiExplorer";

