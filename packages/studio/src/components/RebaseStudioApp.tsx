import React, { useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { createRebaseClient, type CreateRebaseClientResult } from "@rebasepro/client";
import {
    IconForView,
    Rebase,
    useModeController,
    useNavigationGroupLabel,
    useRebaseAuthController,
    useRebaseRegistry,
    useTranslation,
    type RebaseAuthController,
    type RebaseStudioConfig
} from "@rebasepro/app";
import {
    Alert,
    Button,
    Card,
    CircularProgressCenter,
    cls,
    defaultBorderMixin,
    HomeIcon,
    IconButton,
    iconSize,
    LogOutIcon,
    MoonIcon,
    SunIcon,
    TextField,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { RebaseStudio } from "./RebaseStudio";
import { STUDIO_GROUP_ORDER, StudioHomePage } from "./StudioHomePage";

export interface RebaseStudioAppProps {
    /** Base URL of the Rebase API (e.g. `""` for same-origin, or `"http://localhost:3000"`). */
    apiUrl?: string;
    /** Optional pre-created RebaseClient instance. */
    client?: CreateRebaseClientResult<Record<string, unknown>>;
    /** Router basename when mounted under a sub-path (e.g. `"/_studio"`). */
    basename?: string;
    /** Display name shown in the Studio header. */
    name?: string;
    /** Restrict the built-in Studio tools shown in the sidebar. */
    tools?: RebaseStudioConfig["tools"];
    /** Custom views added alongside the built-in Studio tools. */
    devViews?: RebaseStudioConfig["devViews"];
    /** When true, do not wrap in a `<BrowserRouter>` (caller already provides one). */
    withoutRouter?: boolean;
}

const GROUP_ORDER = STUDIO_GROUP_ORDER;

function StudioSignInScreen({
    name,
    auth
}: {
    name: string;
    auth: RebaseAuthController;
}) {
    const { t } = useTranslation();
    const [mode, setMode] = useState<"signin" | "register">(auth.needsSetup ? "register" : "signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    const isRegister = auth.needsSetup || mode === "register";

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);
        setSubmitting(true);
        try {
            if (isRegister) {
                await auth.register(email.trim(), password, displayName.trim() || undefined);
            } else {
                await auth.emailPasswordLogin(email.trim(), password);
            }
        } catch (err: unknown) {
            setLocalError(err instanceof Error ? err.message : t("studio_app_auth_failed"));
        } finally {
            setSubmitting(false);
        }
    };

    const errorMessage = localError ?? auth.authProviderError?.message ?? null;

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-surface-frame p-6">
            <Card className="w-full max-w-md p-6 flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                    <Typography variant="h5" className="font-semibold">
                        {name}
                    </Typography>
                    <Typography variant="body2" color="secondary">
                        {auth.needsSetup
                            ? t("studio_app_setup_subtitle")
                            : (isRegister ? t("studio_app_register_subtitle") : t("studio_app_signin_subtitle"))}
                    </Typography>
                </div>

                {errorMessage && <Alert color="error">{errorMessage}</Alert>}

                <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
                    {isRegister && (
                        <TextField
                            label={t("studio_app_display_name_optional")}
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="Admin"
                        />
                    )}
                    <TextField
                        label={t("email")}
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="admin@example.com"
                        required
                    />
                    <TextField
                        label={t("auth_password")}
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                    <Button
                        type="submit"
                        variant="filled"
                        disabled={submitting || !email.trim() || !password}
                        className="mt-1"
                    >
                        {submitting
                            ? t("studio_app_please_wait")
                            : (auth.needsSetup ? t("studio_app_create_admin") : (isRegister ? t("studio_app_create_account") : t("auth_sign_in")))}
                    </Button>
                </form>

                {!auth.needsSetup && auth.registrationEnabled && (
                    <div className="flex justify-center">
                        <Button
                            size="small"
                            variant="text"
                            onClick={() => setMode((m) => m === "signin" ? "register" : "signin")}
                        >
                            {isRegister ? t("studio_app_have_account") : t("studio_app_need_account")}
                        </Button>
                    </div>
                )}
            </Card>
        </div>
    );
}

function StudioStandaloneShell({
    name,
    auth
}: {
    name: string;
    auth: RebaseAuthController;
}) {
    const registry = useRebaseRegistry();
    const navigate = useNavigate();
    const location = useLocation();
    const modeController = useModeController();
    const labelGroup = useNavigationGroupLabel();
    const { t } = useTranslation();

    /** Every view gets a route; only the ones not hidden from navigation are listed in the rail. */
    const routedViews = useMemo(() => registry.studioConfig?.devViews ?? [], [registry.studioConfig?.devViews]);
    const views = useMemo(
        () => routedViews.filter((v) => !v.hideFromNavigation),
        [routedViews]
    );

    const groupedViews = useMemo(() => {
        const map = new Map<string, typeof views>();
        for (const v of views) {
            const g = v.group || "Tools";
            const arr = map.get(g) ?? [];
            arr.push(v);
            map.set(g, arr);
        }
        const ordered: Array<{ group: string; items: typeof views }> = [];
        for (const g of GROUP_ORDER) {
            const items = map.get(g);
            if (items && items.length > 0) {
                ordered.push({ group: g, items });
                map.delete(g);
            }
        }
        for (const [g, items] of map.entries()) {
            ordered.push({ group: g, items });
        }
        return ordered;
    }, [views]);

    if (auth.initialLoading) {
        return <CircularProgressCenter />;
    }

    if (!auth.user && !auth.loginSkipped) {
        return <StudioSignInScreen name={name} auth={auth} />;
    }

    const currentSlug = location.pathname.replace(/^\/+/, "").split("/")[0] || "";
    const isDark = modeController.mode === "dark";

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-surface-frame text-text-primary dark:text-text-primary-dark">
            {/* Standalone Studio Sidebar */}
            <aside className={cls("w-60 shrink-0 flex flex-col border-r bg-surface-frame", defaultBorderMixin)}>
                <div className={cls("h-12 px-4 border-b flex items-center justify-between gap-2 shrink-0", defaultBorderMixin)}>
                    <button
                        type="button"
                        onClick={() => navigate("/")}
                        className="flex items-center gap-2 min-w-0 text-left"
                    >
                        <Typography variant="subtitle1" className="font-semibold truncate">
                            {name}
                        </Typography>
                    </button>
                    <Tooltip title={isDark ? t("studio_app_light_mode") : t("studio_app_dark_mode")}>
                        <IconButton
                            size="small"
                            aria-label={t("toggle_theme")}
                            onClick={() => modeController.setMode(isDark ? "light" : "dark")}
                        >
                            {isDark ? <SunIcon size={iconSize.small} /> : <MoonIcon size={iconSize.small} />}
                        </IconButton>
                    </Tooltip>
                </div>

                <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-3">
                    <button
                        type="button"
                        onClick={() => navigate("/")}
                        className={cls(
                            "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors",
                            currentSlug === ""
                                ? "bg-surface-active text-text-primary dark:text-text-primary-dark font-medium"
                                : "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-hover hover:text-text-primary dark:hover:text-text-primary-dark"
                        )}
                    >
                        <HomeIcon size={iconSize.small} />
                        <span>{t("home")}</span>
                    </button>

                    {groupedViews.map(({ group, items }) => (
                        <div key={group} className="flex flex-col gap-0.5">
                            <Typography
                                variant="caption"
                                color="secondary"
                                className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
                            >
                                {labelGroup(group)}
                            </Typography>
                            {items.map((view) => {
                                const active = currentSlug === view.slug;
                                return (
                                    <button
                                        key={view.slug}
                                        type="button"
                                        onClick={() => navigate(`/${view.slug}`)}
                                        className={cls(
                                            "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors text-left",
                                            active
                                                ? "bg-surface-active text-text-primary dark:text-text-primary-dark font-medium"
                                                : "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-hover hover:text-text-primary dark:hover:text-text-primary-dark"
                                        )}
                                    >
                                        <IconForView collectionOrView={view} className="w-4 h-4 shrink-0" />
                                        <span className="truncate">{view.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </nav>

                {auth.user && (
                    <div className={cls("p-3 border-t flex items-center justify-between gap-2 shrink-0", defaultBorderMixin)}>
                        <div className="min-w-0">
                            <Typography variant="caption" className="block truncate font-medium">
                                {auth.user.displayName || auth.user.email || auth.user.uid}
                            </Typography>
                            {auth.user.email && (
                                <Typography variant="caption" color="secondary" className="block truncate text-[11px]">
                                    {auth.user.email}
                                </Typography>
                            )}
                        </div>
                        <Tooltip title={t("studio_app_sign_out")}>
                            <IconButton size="small" aria-label={t("studio_app_sign_out")} onClick={() => void auth.signOut()}>
                                <LogOutIcon size={iconSize.small} />
                            </IconButton>
                        </Tooltip>
                    </div>
                )}
            </aside>

            {/* Active Studio Tool Content */}
            <div className="flex-1 min-w-0 h-full overflow-hidden bg-surface-sheet">
                <Routes>
                    <Route path="/" element={registry.studioConfig?.homePage ?? <StudioHomePage />} />
                    {routedViews.map((view) => {
                        const ViewEl = view.view;
                        const element = typeof ViewEl === "function" ? <ViewEl /> : ViewEl;
                        return <Route key={view.slug} path={`/${view.slug}/*`} element={element} />;
                    })}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </div>
        </div>
    );
}

/**
 * Standalone Rebase Studio application shell.
 *
 * Mounts the full developer & zero-code BaaS console (Tables, SQL, RLS,
 * Schema Visualizer, Storage & Policies, Users & Roles, Webhooks, Cron,
 * API Explorer, Logs, Branches, Backups, API Keys) with ZERO dependency on
 * `@rebasepro/cms`.
 */
export function RebaseStudioApp({
    apiUrl,
    client: providedClient,
    basename,
    name = "Rebase Studio",
    tools,
    devViews,
    withoutRouter = false
}: RebaseStudioAppProps) {
    const resolvedBaseUrl = useMemo(() => {
        if (apiUrl !== undefined) return apiUrl;
        if (typeof window !== "undefined") return window.location.origin;
        return "";
    }, [apiUrl]);

    const client = useMemo(
        () => providedClient ?? createRebaseClient({ baseUrl: resolvedBaseUrl }),
        [providedClient, resolvedBaseUrl]
    );

    const authController = useRebaseAuthController({ client });

    const content = (
        <Rebase
            client={client}
            authController={authController}
            apiUrl={resolvedBaseUrl}
        >
            <RebaseStudio tools={tools} devViews={devViews} />
            <StudioStandaloneShell name={name} auth={authController} />
        </Rebase>
    );

    if (withoutRouter) return content;

    return (
        <BrowserRouter basename={basename}>
            {content}
        </BrowserRouter>
    );
}
