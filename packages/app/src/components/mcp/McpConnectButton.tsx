import React, { Suspense, useEffect, useState } from "react";
import { hasAdminRole } from "@rebasepro/types";
import { MCP_METADATA_PATH, mcpUrlFromMetadata } from "@rebasepro/common";
import { useApiConfig } from "../../hooks/ApiConfigContext";
import { useAuthController } from "../../hooks/useAuthController";

// The panel is fetched once the button is going to show, so the startup bundle
// carries only this wrapper and the one request that decides it.
const McpConnectPanel = React.lazy(() =>
    import("./McpConnectPanel").then((module) => ({ default: module.McpConnectPanel })));

/**
 * Whether this app's backend serves an MCP endpoint, and where.
 *
 * - `on`: it does, at `url`, the exact URL its tokens are minted for.
 * - `off`: the backend answered, and `/mcp` is not mounted there.
 * - `unknown`: the backend could not be asked (offline, blocked by CORS).
 */
export type McpEndpointStatus =
    | { state: "loading" }
    | { state: "on"; url: string }
    | { state: "off" }
    | { state: "unknown" };

/** One request per backend origin for the life of the page. */
const statusRequests = new Map<string, Promise<McpEndpointStatus>>();

/**
 * The backend's origin: `/mcp` and its discovery document sit at the origin,
 * outside the API path. The page's own origin when no API URL is configured,
 * which is the admin served by the backend itself.
 */
function backendOrigin(apiUrl: string | undefined): string | undefined {
    if (typeof window === "undefined") return undefined;
    try {
        return new URL(apiUrl || window.location.origin, window.location.href).origin;
    } catch {
        return undefined;
    }
}

async function fetchMcpStatus(origin: string): Promise<McpEndpointStatus> {
    try {
        const response = await fetch(`${origin}${MCP_METADATA_PATH}`, { headers: { accept: "application/json" } });
        if (response.status === 404) return { state: "off" };
        if (!response.ok) return { state: "unknown" };
        // A page served in its place (an SPA fallback) is not the document:
        // no `resource`, so no endpoint.
        const body: unknown = await response.json().catch(() => undefined);
        const url = mcpUrlFromMetadata(body);
        return url ? { state: "on", url } : { state: "off" };
    } catch {
        return { state: "unknown" };
    }
}

/**
 * Ask the backend, once, whether it serves `/mcp`.
 *
 * It reads the protected-resource document an MCP client reads before it
 * signs in, so the URL shown is the one the server publishes: right behind a
 * proxy, under `REBASE_PUBLIC_URL`, and on a `rebase dev` port that moved.
 *
 * @group Hooks and utilities
 */
export function useMcpEndpointStatus(): McpEndpointStatus {
    const apiConfig = useApiConfig();
    const origin = backendOrigin(apiConfig?.apiUrl);
    const [status, setStatus] = useState<McpEndpointStatus>({ state: "loading" });
    useEffect(() => {
        if (!origin) {
            setStatus({ state: "unknown" });
            return;
        }
        let current = true;
        let request = statusRequests.get(origin);
        if (!request) {
            request = fetchMcpStatus(origin);
            statusRequests.set(origin, request);
        }
        void request.then((result) => {
            if (current) setStatus(result);
        });
        return () => {
            current = false;
        };
    }, [origin]);
    return status;
}

export interface McpConnectButtonProps {
    className?: string;
    /** An icon button instead of the pill: for a collapsed drawer rail. */
    compact?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
    /** Where the popover mounts: inside a floating drawer, so hovering it keeps the drawer open. */
    portalContainer?: HTMLElement | null;
}

/**
 * "Connect AI": tells the person this app has an MCP server, and connects
 * Claude Code, Cursor, VS Code, Claude or ChatGPT to it in a click or a paste.
 *
 * Shown to everyone signed in while the backend serves `/mcp`, because an agent
 * signs in as the person who connects it and is held to their row-level
 * security. While it is off, only an administrator sees it, with how to turn it
 * on. When the backend cannot be asked, nothing shows.
 *
 * @group Components
 */
export function McpConnectButton(props: McpConnectButtonProps) {
    const status = useMcpConnectStatus();
    if (!status) return null;
    return (
        <Suspense fallback={null}>
            <McpConnectPanel {...props} status={status}/>
        </Suspense>
    );
}

/**
 * The endpoint's status when the "Connect AI" button shows for the signed-in
 * person, else null: `on` for everyone signed in, `off` for an administrator
 * only, and nothing while the backend has not answered or cannot be asked.
 */
function useMcpConnectStatus(): Extract<McpEndpointStatus, { state: "on" | "off" }> | null {
    const status = useMcpEndpointStatus();
    const authController = useAuthController();
    if (!authController.user) return null;
    if (status.state === "on") return status;
    if (status.state === "off" && hasAdminRole(authController.user.roles)) return status;
    return null;
}

/**
 * Whether {@link McpConnectButton} renders anything for the signed-in person,
 * so a container can leave its row out when it does not.
 *
 * @group Hooks and utilities
 */
export function useCanConnectMcp(): boolean {
    return useMcpConnectStatus() !== null;
}
