import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

/**
 * The server's request handlers, driven directly rather than over a transport.
 *
 * The SDK keeps what `setRequestHandler` registered in a private map. Reading it
 * lets a test call `tools/call` as a client would, without connecting the
 * module-level server to anything, and every answer is checked against the
 * shape the tests read before it is handed back.
 */

/** A request as a client sends it. */
export interface McpRequest {
    method: string;
    params?: Record<string, unknown>;
}

/** What a `tools/call` handler answers, as far as these tests read it. */
export interface ToolCallResult {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}

/** What `tools/list` answers. */
export interface ListToolsResult {
    tools: Array<{ name: string }>;
}

/** What `resources/read` answers. */
export interface ReadResourceResult {
    contents: Array<{ uri: string; text: string }>;
}

function requestHandler(server: Server, method: string): (request: McpRequest) => Promise<unknown> {
    const handlers: unknown = Reflect.get(server, "_requestHandlers");
    if (!(handlers instanceof Map)) throw new Error("The server has no request handler map");
    const handler: unknown = handlers.get(method);
    if (typeof handler !== "function") throw new Error(`No handler is registered for ${method}`);
    return async (request) => {
        const answer: unknown = await handler(request);
        return answer;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/** Every entry is an object carrying the string fields named. */
function isListOf(value: unknown, fields: string[]): boolean {
    return Array.isArray(value)
        && value.every((entry) => isRecord(entry) && fields.every((field) => typeof entry[field] === "string"));
}

function isToolCallResult(value: unknown): value is ToolCallResult {
    return isRecord(value)
        && isListOf(value.content, ["type", "text"])
        && (value.isError === undefined || typeof value.isError === "boolean");
}

function isListToolsResult(value: unknown): value is ListToolsResult {
    return isRecord(value) && isListOf(value.tools, ["name"]);
}

function isReadResourceResult(value: unknown): value is ReadResourceResult {
    return isRecord(value) && isListOf(value.contents, ["uri", "text"]);
}

/** The `tools/call` handler. */
export function toolCallHandler(server: Server): (request: McpRequest) => Promise<ToolCallResult> {
    const handle = requestHandler(server, "tools/call");
    return async (request) => {
        const answer = await handle(request);
        if (!isToolCallResult(answer)) throw new Error(`Not a tool result: ${JSON.stringify(answer)}`);
        return answer;
    };
}

/** The `tools/list` handler. */
export function listToolsHandler(server: Server): (request: McpRequest) => Promise<ListToolsResult> {
    const handle = requestHandler(server, "tools/list");
    return async (request) => {
        const answer = await handle(request);
        if (!isListToolsResult(answer)) throw new Error(`Not a tool list: ${JSON.stringify(answer)}`);
        return answer;
    };
}

/** The `resources/read` handler. */
export function readResourceHandler(server: Server): (request: McpRequest) => Promise<ReadResourceResult> {
    const handle = requestHandler(server, "resources/read");
    return async (request) => {
        const answer = await handle(request);
        if (!isReadResourceResult(answer)) throw new Error(`Not a resource: ${JSON.stringify(answer)}`);
        return answer;
    };
}

/** What `resources/list` answers. */
export interface ListResourcesResult {
    resources: Array<{ uri: string; name: string }>;
}

function isListResourcesResult(value: unknown): value is ListResourcesResult {
    return isRecord(value) && isListOf(value.resources, ["uri", "name"]);
}

/** The `resources/list` handler. */
export function listResourcesHandler(server: Server): (request: McpRequest) => Promise<ListResourcesResult> {
    const handle = requestHandler(server, "resources/list");
    return async (request) => {
        const answer = await handle(request);
        if (!isListResourcesResult(answer)) throw new Error(`Not a resource list: ${JSON.stringify(answer)}`);
        return answer;
    };
}
