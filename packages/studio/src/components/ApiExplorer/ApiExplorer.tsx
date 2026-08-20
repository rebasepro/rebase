import React, { useState, useEffect, useMemo } from "react";
import { useApiBase, useApiConfig, useAuthController } from "@rebasepro/app";
import {
    CircularProgress,
    Typography,
    Alert,
    cls,
    Button,
    Chip,
    defaultBorderMixin,
    SearchBar,
    iconSize
} from "@rebasepro/ui";
import { BookOpenIcon, PlayIcon } from "@rebasepro/ui";
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
    const apiBase = useApiBase();
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
        const specUrl = `${apiBase}/docs`;

        (async () => {
            try {
                // The spec endpoint itself is public on a stock backend, but
                // `apiUrl` may route through an authenticated proxy (the
                // console's Studio embed) — carry the token like every other
                // request in this view, and like LogsExplorer does.
                const getAuthToken = apiConfig?.getAuthToken ?? authController.getAuthToken;
                const token = getAuthToken ? await getAuthToken() : null;
                const res = await fetch(specUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
                if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                const data = await res.json();
                if (!cancelled) {
                    setSpec(data);
                    setLoading(false);
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Failed to load API spec");
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [apiUrl, apiBase, apiConfig, authController]);

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
        get: "text-blue-600 dark:text-blue-400",
        post: "text-emerald-600 dark:text-emerald-400",
        put: "text-amber-600 dark:text-amber-400",
        patch: "text-orange-600 dark:text-orange-400",
        delete: "text-red-600 dark:text-red-400"
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
                        <BookOpenIcon size={iconSize.medium} className="text-primary dark:text-primary-dark" />
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
                            onTextSearch={(val) => setSidebarFilter(val ?? "")}
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
                                    <Button
                                        key={ep.id}
                                        variant="text"
                                        color="neutral"
                                        fullWidth
                                        onClick={() => {
                                            setSelectedEndpoint(ep);
                                            setTryItOpen(false);
                                        }}
                                        className={cls(
                                            "!justify-between !px-2.5 !py-1.5 !text-left !text-sm",
                                            isSelected
                                                ? "bg-surface-200 dark:bg-surface-800 font-medium"
                                                : "text-text-primary dark:text-text-primary-dark"
                                        )}
                                    >
                                        <span className="truncate text-[13px] opacity-90">{ep.summary || ep.shortPath}</span>
                                        <span
                                            className={cls(
                                                "text-[10px] font-semibold uppercase shrink-0",
                                                METHOD_COLORS[ep.method] ?? "text-text-secondary"
                                            )}
                                        >
                                            {ep.method}
                                        </span>
                                    </Button>
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
                                "flex items-center justify-between px-5 py-3 gap-4 shrink-0 border-b z-10",
                                defaultBorderMixin,
                                "bg-surface-50/80 dark:bg-surface-950/80 backdrop-blur-md sticky top-0"
                            )}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <span
                                    className={cls(
                                        "text-xs font-semibold uppercase",
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
                                <PlayIcon size={iconSize.small} className="mr-1" />
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

