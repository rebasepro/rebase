/**
 * The "Simulate access" pill and banner themselves. Loaded on demand by the
 * wrappers in `RlsSimulatorBar.tsx`: only an administrator ever sees them, so
 * nobody else downloads them before the login screen paints.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    Button,
    CircularProgress,
    cls,
    EyeIcon,
    IconButton,
    iconSize,
    KeyRoundIcon,
    Popover,
    ShieldIcon,
    Tab,
    Tabs,
    TextField,
    Typography,
    UserIcon
} from "@rebasepro/ui";
import type { AccessSimulation, RebaseClient } from "@rebasepro/types";
import { useRlsSimulation, type RlsSimulationLabel } from "../../contexts/RlsSimulationContext";
import { useApiBase, useApiConfig } from "../../hooks/ApiConfigContext";
import { useRebaseClient } from "../../hooks/useRebaseClient";
import { useTranslation } from "../../hooks/useTranslation";
import { useCanSimulateAccess, type RlsSimulatorBarProps } from "./RlsSimulatorBar";

/** A role `GET /admin/rls-simulator/options` offers. */
interface SimulatorRole {
    id: string;
    name: string;
}

/** A live service key `GET /admin/rls-simulator/options` offers. */
interface SimulatorApiKey {
    id: string;
    name: string;
    keyPrefix: string;
}

interface SimulatorOptions {
    roles: SimulatorRole[];
    apiKeys: SimulatorApiKey[];
}

/** What `POST /admin/rls-simulator/preview` sums up. */
interface SimulationSummary {
    hiddenCollections: number;
    maskedColumns: number;
}

type SimulatorTab = "role" | "user" | "apiKey";

/** How many users one search of the picker lists. */
const USER_PAGE_SIZE = 20;

/**
 * A request to the simulator's admin surface with the administrator's own
 * token — never through the simulated client, whose headers the admin routes
 * refuse.
 */
function useSimulatorRequest() {
    const apiConfig = useApiConfig();
    const apiBase = useApiBase();
    return useCallback(async <T, >(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
        if (!apiBase) throw new Error("No API URL is configured.");
        const token = await apiConfig?.getAuthToken?.();
        const response = await fetch(`${apiBase}/admin/rls-simulator${path}`, {
            method: init?.method ?? "GET",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        const json: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
            const message = typeof json === "object" && json !== null && "error" in json
                && typeof json.error === "object" && json.error !== null && "message" in json.error
                && typeof json.error.message === "string"
                ? json.error.message
                : response.statusText;
            throw new Error(message);
        }
        return json as T;
    }, [apiBase, apiConfig]);
}

/** One choosable row of the popover's lists. */
function ChoiceRow({ selected, onClick, icon, title, detail }: {
    selected: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    title: string;
    detail?: string;
}) {
    return (
        <Button
            variant="text"
            size="small"
            fullWidth
            onClick={onClick}
            className={cls("justify-start", { "bg-surface-active": selected })}>
            {icon}
            <Typography variant="body2" noWrap className="truncate">{title}</Typography>
            {detail && <Typography variant="caption" color="secondary" noWrap className="truncate">{detail}</Typography>}
        </Button>
    );
}

/**
 * "Simulate access": the app bar pill that runs every data view as a role, a
 * user or a service key, so an administrator sees exactly the rows and fields
 * that identity's row-level security lets it read.
 *
 * Shown only to an administrator, and only when the data views ride a client
 * that can derive a simulated one. The server checks the first again on every
 * request: anyone else sending the simulation headers gets a 403.
 *
 * @group Components
 */
export function RlsSimulatorBarPanel({ className, compact, side, align = "end", portalContainer }: RlsSimulatorBarProps) {
    const { t } = useTranslation();
    const controller = useRlsSimulation();
    const canSimulate = useCanSimulateAccess();
    const request = useSimulatorRequest();
    const client = useRebaseClient<RebaseClient>();

    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<SimulatorTab>("role");
    const [options, setOptions] = useState<SimulatorOptions | null>(null);
    const [optionsError, setOptionsError] = useState<string | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [roleUserId, setRoleUserId] = useState("");
    const [userSearch, setUserSearch] = useState("");
    const [users, setUsers] = useState<Array<{ uid: string; label: string; detail?: string }>>([]);
    const [usersLoading, setUsersLoading] = useState(false);

    useEffect(() => {
        if (!open || options) return;
        let cancelled = false;
        request<SimulatorOptions>("/options")
            .then((loaded) => {
                if (!cancelled) setOptions(loaded);
            })
            .catch((error: unknown) => {
                if (!cancelled) setOptionsError(error instanceof Error ? error.message : String(error));
            });
        return () => {
            cancelled = true;
        };
    }, [open, options, request]);

    const adminApi = client?.admin;
    useEffect(() => {
        if (!open || tab !== "user" || !adminApi) return;
        let cancelled = false;
        setUsersLoading(true);
        const timer = setTimeout(() => {
            adminApi.listUsersPaginated({ search: userSearch || undefined, limit: USER_PAGE_SIZE })
                .then(({ users: found }) => {
                    if (cancelled) return;
                    setUsers(found.filter(user => !user.disabled).map(user => ({
                        uid: user.uid,
                        label: user.email ?? user.displayName ?? user.uid,
                        detail: user.roles?.length ? user.roles.join(", ") : undefined
                    })));
                })
                .catch(() => {
                    if (!cancelled) setUsers([]);
                })
                .finally(() => {
                    if (!cancelled) setUsersLoading(false);
                });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [open, tab, userSearch, adminApi]);

    const start = (simulation: AccessSimulation, label: RlsSimulationLabel) => {
        controller.setSimulation(simulation, label);
        setOpen(false);
    };

    if (!canSimulate) return null;

    const active = controller.simulation !== null;

    const trigger = compact ? (
        <IconButton aria-label={t("rls_simulate_access")} className={cls("relative", className)}>
            <EyeIcon size={iconSize.small}/>
            {active && <span aria-hidden className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500"/>}
        </IconButton>
    ) : (
        <Button
            variant="outlined"
            size="small"
            aria-label={t("rls_simulate_access")}
            className={cls("rounded-full whitespace-nowrap", className)}>
            {active
                ? <span aria-hidden className="w-2 h-2 rounded-full bg-amber-500"/>
                : <EyeIcon size={iconSize.smallest}/>}
            {t("rls_simulate_access")}
        </Button>
    );

    return (
        <Popover trigger={trigger} open={open} onOpenChange={setOpen} side={side} align={align} portalContainer={portalContainer}>
            <div className="flex flex-col gap-3 p-3 w-[22rem]">
                <div className="flex flex-col gap-1">
                    <Typography variant="label">{t("rls_simulate_access")}</Typography>
                    <Typography variant="caption" color="secondary">{t("rls_simulate_access_description")}</Typography>
                </div>

                <Tabs value={tab} onValueChange={(value) => setTab(value === "user" || value === "apiKey" ? value : "role")}>
                    <Tab value="role">{t("rls_simulate_tab_role")}</Tab>
                    <Tab value="user">{t("rls_simulate_tab_user")}</Tab>
                    <Tab value="apiKey">{t("rls_simulate_tab_api_key")}</Tab>
                </Tabs>

                {optionsError && (
                    <Alert color="error" size="small" role={null}>
                        {t("rls_simulate_options_error", { message: optionsError })}
                    </Alert>
                )}

                {!options && !optionsError && tab !== "user" && (
                    <div className="flex justify-center p-2"><CircularProgress size="small"/></div>
                )}

                {tab === "role" && options && (
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-col max-h-60 overflow-auto">
                            {options.roles.map(entry => (
                                <ChoiceRow
                                    key={entry.id}
                                    selected={role === entry.id}
                                    onClick={() => setRole(entry.id)}
                                    icon={<ShieldIcon size={iconSize.smallest}/>}
                                    title={entry.id}
                                    detail={entry.name !== entry.id ? entry.name : undefined}/>
                            ))}
                        </div>
                        <TextField
                            size="small"
                            value={roleUserId}
                            placeholder={t("rls_simulate_user_id_optional")}
                            onChange={(event) => setRoleUserId(event.target.value)}/>
                        <Button
                            color="primary"
                            size="small"
                            disabled={!role}
                            onClick={() => {
                                if (!role) return;
                                const userId = roleUserId.trim();
                                start(
                                    { role, ...(userId ? { userId } : {}) },
                                    { kind: "role", role, ...(userId ? { userId } : {}) }
                                );
                            }}>
                            {t("rls_simulate_apply")}
                        </Button>
                    </div>
                )}

                {tab === "user" && (
                    <div className="flex flex-col gap-2">
                        <TextField
                            size="small"
                            value={userSearch}
                            placeholder={t("rls_simulate_search_users")}
                            onChange={(event) => setUserSearch(event.target.value)}/>
                        <div className="flex flex-col max-h-60 overflow-auto">
                            {usersLoading && users.length === 0 && (
                                <div className="flex justify-center p-2"><CircularProgress size="small"/></div>
                            )}
                            {!usersLoading && users.length === 0 && (
                                <Typography variant="caption" color="secondary" className="p-2">{t("rls_simulate_no_users")}</Typography>
                            )}
                            {users.map(user => (
                                <ChoiceRow
                                    key={user.uid}
                                    selected={controller.simulation?.userId === user.uid && !controller.simulation.role}
                                    onClick={() => start({ userId: user.uid }, { kind: "user", user: user.label })}
                                    icon={<UserIcon size={iconSize.smallest}/>}
                                    title={user.label}
                                    detail={user.detail}/>
                            ))}
                        </div>
                    </div>
                )}

                {tab === "apiKey" && options && (
                    <div className="flex flex-col max-h-60 overflow-auto">
                        {options.apiKeys.length === 0 && (
                            <Typography variant="caption" color="secondary" className="p-2">{t("rls_simulate_no_api_keys")}</Typography>
                        )}
                        {options.apiKeys.map(key => (
                            <ChoiceRow
                                key={key.id}
                                selected={controller.simulation?.apiKeyId === key.id}
                                onClick={() => start({ apiKeyId: key.id }, { kind: "apiKey", name: key.name, keyPrefix: key.keyPrefix })}
                                icon={<KeyRoundIcon size={iconSize.smallest}/>}
                                title={key.name}
                                detail={`${key.keyPrefix}…`}/>
                        ))}
                    </div>
                )}

                {active && (
                    <Button
                        variant="text"
                        size="small"
                        onClick={() => {
                            controller.setSimulation(null);
                            setOpen(false);
                        }}>
                        {t("rls_simulate_stop")}
                    </Button>
                )}
            </div>
        </Popover>
    );
}

/**
 * The banner every screen shows while access is simulated: who the data views
 * run as, how many collections show that identity nothing, how many fields its
 * roles cannot read — and the way out.
 *
 * @group Components
 */
export function RlsSimulationBannerPanel({ className }: { className?: string }) {
    const { t } = useTranslation();
    const { simulation, label, setSimulation } = useRlsSimulation();
    const request = useSimulatorRequest();
    const [summary, setSummary] = useState<SimulationSummary | null>(null);

    useEffect(() => {
        setSummary(null);
        if (!simulation) return;
        let cancelled = false;
        request<{ summary: SimulationSummary }>("/preview", { method: "POST", body: simulation })
            .then(({ summary: loaded }) => {
                if (!cancelled) setSummary(loaded);
            })
            .catch((error: unknown) => {
                console.warn("Could not preview the simulated access", error);
            });
        return () => {
            cancelled = true;
        };
    }, [simulation, request]);

    if (!simulation) return null;

    const title = (() => {
        if (label?.kind === "apiKey") return t("rls_simulation_viewing_as_api_key", { name: label.name, prefix: label.keyPrefix });
        if (label?.kind === "user") return t("rls_simulation_viewing_as_user", { user: label.user });
        if (simulation.role && simulation.userId) {
            return t("rls_simulation_viewing_as_role_user", { role: simulation.role, user: simulation.userId });
        }
        if (simulation.role) return t("rls_simulation_viewing_as_role", { role: simulation.role });
        return t("rls_simulation_viewing_as_user", { user: simulation.userId ?? simulation.apiKeyId ?? "" });
    })();

    const counts = summary
        ? [
            summary.hiddenCollections === 1
                ? t("rls_simulation_hidden_collections_one")
                : t("rls_simulation_hidden_collections", { count: String(summary.hiddenCollections) }),
            summary.maskedColumns === 1
                ? t("rls_simulation_masked_columns_one")
                : t("rls_simulation_masked_columns", { count: String(summary.maskedColumns) })
        ].join(", ")
        : t("rls_simulation_counting");

    return (
        <div role="status" aria-live="polite" className={className}>
            <Alert
                color="warning"
                size="small"
                role={null}
                action={<Button variant="text" size="small" onClick={() => setSimulation(null)}>{t("rls_simulate_stop")}</Button>}>
                <div className="flex flex-col gap-0.5">
                    <Typography variant="label">{`${title} — ${counts}`}</Typography>
                    <Typography variant="body2" color="secondary">{t("rls_simulation_note")}</Typography>
                </div>
            </Alert>
        </div>
    );
}
