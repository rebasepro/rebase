/**
 * EXPERIMENTAL. The admin panel's side of `POST /api/admin/apps/mcp`
 * (`mcp/admin-apps-mcp.ts` in `@rebasepro/server`): JSON-RPC to the backend's
 * MCP surface with the admin panel's own session.
 */

/** What a tool answers, as MCP shapes it. */
export interface AdminToolResult {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
}

export interface AdminAppsClient {
    /** A JSON-RPC method's result; rejects with the server's message. */
    request(method: string, params: Record<string, unknown>): Promise<unknown>;
    /** A tool's whole answer, a refusal included: the view shows its reason. */
    callTool(name: string, args: Record<string, unknown>): Promise<AdminToolResult>;
}

export function createAdminAppsClient(apiBase: string, getAuthToken?: () => Promise<string | null | undefined>): AdminAppsClient {
    let nextId = 1;
    const request = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
        const token = await getAuthToken?.();
        const response = await fetch(`${apiBase}/admin/apps/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
            body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params })
        });
        const body: unknown = await response.json().catch(() => undefined);
        if (!isRecord(body)) throw new Error(`The server answered ${response.status} without a result.`);
        if (isRecord(body.error)) throw new Error(String(body.error.message ?? "The server refused the request."));
        if (!response.ok) throw new Error(`The server answered ${response.status}.`);
        return body.result;
    };
    return {
        request,
        async callTool(name, args) {
            const result = await request("tools/call", { name, arguments: args });
            return isRecord(result) ? result : {};
        }
    };
}

/** The first text a tool answered: its refusal, when it refused. */
export function toolText(result: AdminToolResult): string | undefined {
    return result.content?.find(block => block.type === "text" && typeof block.text === "string")?.text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
