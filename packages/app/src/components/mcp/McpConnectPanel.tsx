/**
 * The "Connect AI" popover: one tab per AI client, each with the one step that
 * connects it, and the agents this person has already connected.
 *
 * Loaded on demand by `McpConnectButton`, which decides whether it shows.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
    Alert,
    Button,
    CheckCircleIcon,
    cls,
    CopyIcon,
    defaultBorderMixin,
    ExternalLinkIcon,
    IconButton,
    iconSize,
    PlugIcon,
    Popover,
    Tab,
    Tabs,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import {
    CLAUDE_CONNECTORS_URL,
    claudeCodeAddCommand,
    cursorInstallLink,
    defaultMcpServerName,
    genericMcpConfig,
    isLoopbackUrl,
    MCP_CLIENT_KEYS,
    MCP_REMOTE_ONLY_CLIENTS,
    vscodeInstallLink,
    type McpClientKey
} from "@rebasepro/common";
import { useApiBase, useApiConfig } from "../../hooks/ApiConfigContext";
import { useTranslation } from "../../hooks/useTranslation";
import type { McpConnectButtonProps, McpEndpointStatus } from "./McpConnectButton";

/** Product names: the same in every language. */
const CLIENT_NAMES: Record<McpClientKey, string> = {
    "claude-code": "Claude Code",
    cursor: "Cursor",
    vscode: "VS Code",
    claude: "Claude",
    chatgpt: "ChatGPT"
};

type ClientTab = McpClientKey | "other";

/** One application this person has authorized, as `GET /oauth/grants` lists it. */
interface McpGrant {
    clientId: string;
    clientName: string;
    grantedAt: string;
    /** Zero means the grant has lapsed on its own. */
    activeTokens: number;
}

function grantsOf(body: unknown): McpGrant[] {
    if (typeof body !== "object" || body === null) return [];
    const grants: unknown = Reflect.get(body, "grants");
    if (!Array.isArray(grants)) return [];
    return grants.flatMap((grant: unknown): McpGrant[] => {
        if (typeof grant !== "object" || grant === null) return [];
        const clientId: unknown = Reflect.get(grant, "clientId");
        const clientName: unknown = Reflect.get(grant, "clientName");
        const grantedAt: unknown = Reflect.get(grant, "grantedAt");
        const activeTokens: unknown = Reflect.get(grant, "activeTokens");
        if (typeof clientId !== "string") return [];
        return [{
            clientId,
            clientName: typeof clientName === "string" ? clientName : clientId,
            grantedAt: typeof grantedAt === "string" ? grantedAt : "",
            activeTokens: typeof activeTokens === "number" ? activeTokens : 0
        }];
    });
}

/**
 * The person's grants, from the OAuth server's own routes. Read when the panel
 * mounts and each time it opens, never on a timer: a grant is made in another
 * application, and opening the panel is when someone wants to see it.
 */
function useMcpGrants(enabled: boolean) {
    const apiBase = useApiBase();
    const apiConfig = useApiConfig();
    const [grants, setGrants] = useState<McpGrant[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const request = useCallback(async (path: string, method: "GET" | "DELETE"): Promise<unknown> => {
        if (!apiBase) throw new Error("No API URL is configured.");
        const token = await apiConfig?.getAuthToken?.();
        const response = await fetch(`${apiBase}/oauth${path}`, {
            method,
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
            const description = typeof body === "object" && body !== null ? Reflect.get(body, "error_description") : undefined;
            throw new Error(typeof description === "string" ? description : response.statusText);
        }
        return body;
    }, [apiBase, apiConfig]);

    const reload = useCallback(() => {
        if (!enabled) return;
        request("/grants", "GET")
            .then((body) => {
                setGrants(grantsOf(body));
                setError(null);
            })
            .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, [enabled, request]);

    const disconnect = useCallback(async (clientId: string) => {
        await request(`/grants/${encodeURIComponent(clientId)}`, "DELETE");
        setGrants((current) => current?.filter((grant) => grant.clientId !== clientId) ?? null);
    }, [request]);

    useEffect(reload, [reload]);
    return { grants, error, reload, disconnect };
}

/** A value to copy, in a well, with its copy button. */
function CopyField({ value, label }: { value: string; label: string }) {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    const copy = () => {
        void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }, () => undefined);
    };
    return (
        <div className={cls("flex items-center gap-2 pl-3 pr-1 py-1 rounded-lg border bg-surface-sheet", defaultBorderMixin)}>
            <code aria-label={label} className="flex-1 min-w-0 text-[12px] font-mono break-all select-all">
                {value}
            </code>
            <Tooltip title={copied ? t("copied") : t("copy")}>
                <IconButton aria-label={copied ? t("copied") : t("copy")} size="small" onClick={copy}>
                    {copied
                        ? <CheckCircleIcon size={iconSize.smallest} className="text-emerald-500"/>
                        : <CopyIcon size={iconSize.smallest}/>}
                </IconButton>
            </Tooltip>
        </div>
    );
}

function Hint({ children }: { children: React.ReactNode }) {
    return <Typography variant="caption" color="secondary">{children}</Typography>;
}

function ClientStep({ client, name, url }: { client: ClientTab; name: string; url: string }) {
    const { t } = useTranslation();
    switch (client) {
        case "claude-code":
            return <>
                <CopyField value={claudeCodeAddCommand(name, url)} label={CLIENT_NAMES[client]}/>
                <Hint>{t("mcp_connect_claude_code_hint")}</Hint>
            </>;
        case "cursor":
            return <>
                <Button component="a" href={cursorInstallLink(name, url)} variant="outlined" color="neutral" startIcon={<PlugIcon size={iconSize.smallest}/>}>
                    {t("mcp_connect_add_to", { client: CLIENT_NAMES.cursor })}
                </Button>
                <Hint>{t("mcp_connect_cursor_hint")}</Hint>
            </>;
        case "vscode":
            return <>
                <Button component="a" href={vscodeInstallLink(name, url)} variant="outlined" color="neutral" startIcon={<PlugIcon size={iconSize.smallest}/>}>
                    {t("mcp_connect_add_to", { client: CLIENT_NAMES.vscode })}
                </Button>
                <Hint>{t("mcp_connect_vscode_hint")}</Hint>
            </>;
        case "claude":
            return <>
                <CopyField value={url} label="MCP URL"/>
                <Hint>{t("mcp_connect_claude_steps")}</Hint>
                <Button component="a" href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noopener noreferrer"
                        variant="outlined" color="neutral" startIcon={<ExternalLinkIcon size={iconSize.smallest}/>}>
                    {t("mcp_connect_open_claude")}
                </Button>
            </>;
        case "chatgpt":
            return <>
                <CopyField value={url} label="MCP URL"/>
                <Hint>{t("mcp_connect_chatgpt_steps")}</Hint>
            </>;
        case "other":
            return <>
                <CopyField value={JSON.stringify(genericMcpConfig(name, url))} label="mcpServers"/>
                <Hint>{t("mcp_connect_other_hint")}</Hint>
            </>;
    }
}

/** What an administrator sees while `/mcp` is off: why it is worth turning on, and how. */
function EndpointOff({ local }: { local: boolean }) {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
                <Typography variant="label">{t("mcp_off_title")}</Typography>
                <Typography variant="caption" color="secondary">{t("mcp_off_description")}</Typography>
            </div>
            {local
                ? <Hint>{t("mcp_off_local")}</Hint>
                : <>
                    <Hint>{t("mcp_off_deployed")}</Hint>
                    <CopyField value={"REBASE_MCP_ENABLED=true\nREBASE_PUBLIC_URL=" + window.location.origin} label="env"/>
                </>}
        </div>
    );
}

function ConnectedAgents({ grants, error, onDisconnect }: {
    grants: McpGrant[] | null;
    error: string | null;
    onDisconnect: (clientId: string) => Promise<void>;
}) {
    const { t } = useTranslation();
    const [pending, setPending] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const live = grants?.filter((grant) => grant.activeTokens > 0) ?? [];
    return (
        <div className="flex flex-col gap-2">
            <Typography variant="caption" color="secondary" className="font-medium">{t("mcp_connected_agents")}</Typography>
            {error && <Alert color="error" size="small" role={null}>{t("mcp_grants_error", { message: error })}</Alert>}
            {grants && live.length === 0 && <Hint>{t("mcp_no_connected_agents")}</Hint>}
            {live.map((grant) => (
                <div key={grant.clientId} className="flex items-center gap-2 min-w-0">
                    <span aria-hidden className="w-2 h-2 shrink-0 rounded-full bg-emerald-500"/>
                    <Typography variant="body2" noWrap className="truncate flex-1">{grant.clientName}</Typography>
                    <Button variant="text" size="small" color="neutral" disabled={pending === grant.clientId}
                            onClick={() => {
                                setPending(grant.clientId);
                                onDisconnect(grant.clientId)
                                    .then(() => setNote(t("mcp_disconnected_note")))
                                    .catch((e: unknown) => setNote(e instanceof Error ? e.message : String(e)))
                                    .finally(() => setPending(null));
                            }}>
                        {t("mcp_disconnect")}
                    </Button>
                </div>
            ))}
            {note && <Hint>{note}</Hint>}
        </div>
    );
}

export function McpConnectPanel({
    className,
    compact,
    side,
    align = "end",
    portalContainer,
    status
}: McpConnectButtonProps & { status: Extract<McpEndpointStatus, { state: "on" | "off" }> }) {
    const { t } = useTranslation();
    const on = status.state === "on";
    const url = on ? status.url : "";
    const local = isLoopbackUrl(on ? url : window.location.href);
    const [open, setOpen] = useState(false);
    // Claude and ChatGPT add a connector from their own servers, which cannot
    // reach a server on this machine: on localhost they get a line saying so,
    // not a tab whose steps would fail.
    const clients = MCP_CLIENT_KEYS.filter((key) => !(local && MCP_REMOTE_ONLY_CLIENTS.has(key)));
    const [tab, setTab] = useState<ClientTab>(clients[0] ?? "other");
    const { grants, error, reload, disconnect } = useMcpGrants(on);

    // The page title is the project's name in a scaffold (its index.html), and
    // that is what `rebase mcp connect` names the server after: so a client
    // connected from either place gets the same entry, not two.
    const name = defaultMcpServerName(typeof document !== "undefined" ? document.title : undefined, url);
    const connected = (grants ?? []).some((grant) => grant.activeTokens > 0);
    const dot = !on
        ? <span aria-hidden className="w-2 h-2 rounded-full border border-hairline-strong"/>
        : connected
            ? <span aria-hidden className="w-2 h-2 rounded-full bg-emerald-500"/>
            : null;

    const trigger = compact ? (
        <IconButton aria-label={t("mcp_connect")} className={cls("relative", className)}>
            <PlugIcon size={iconSize.small}/>
            {dot && <span className="absolute top-1 right-1 flex">{dot}</span>}
        </IconButton>
    ) : (
        <Button variant="outlined" size="small" aria-label={t("mcp_connect")}
                className={cls("rounded-full whitespace-nowrap", className)}>
            <PlugIcon size={iconSize.smallest}/>
            {t("mcp_connect")}
            {dot}
        </Button>
    );

    return (
        <Popover trigger={trigger} open={open} side={side} align={align} portalContainer={portalContainer}
                 onOpenChange={(next) => {
                     setOpen(next);
                     if (next) reload();
                 }}>
            <div className="flex flex-col gap-3 p-3 w-[26rem] max-w-[calc(100vw-2rem)]">
                {!on && <EndpointOff local={local}/>}
                {on && <>
                    <div className="flex flex-col gap-1">
                        <Typography variant="label">{t("mcp_connect_title")}</Typography>
                        <Typography variant="caption" color="secondary">{t("mcp_connect_description")}</Typography>
                    </div>

                    <Tabs value={tab} onValueChange={(value) => setTab(clients.find((key) => key === value) ?? "other")}>
                        {clients.map((key) => <Tab key={key} value={key}>{CLIENT_NAMES[key]}</Tab>)}
                        <Tab value="other">{t("mcp_connect_tab_other")}</Tab>
                    </Tabs>

                    {/* Every tab's step sits in the same grid cell, the hidden
                        ones invisible and inert, so the panel is as tall as the
                        tallest step and does not jump when the tab changes. */}
                    <div className="grid">
                        {[...clients, "other" as const].map((key) => (
                            <div key={key} inert={key !== tab}
                                 className={cls("[grid-area:1/1] flex flex-col gap-2", key !== tab && "invisible")}>
                                <ClientStep client={key} name={name} url={url}/>
                            </div>
                        ))}
                    </div>

                    {local && <Hint>{t("mcp_connect_remote_only_local")}</Hint>}

                    <div className="pt-2">
                        <ConnectedAgents grants={grants} error={error} onDisconnect={disconnect}/>
                    </div>
                </>}
            </div>
        </Popover>
    );
}
