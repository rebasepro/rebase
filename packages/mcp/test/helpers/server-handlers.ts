import {
    InMemoryTransport,
    isJSONRPCErrorResponse,
    isJSONRPCResultResponse,
    type JSONRPCMessage,
    type Server
} from "@modelcontextprotocol/server";

/**
 * The server's request handlers, driven as a client drives them.
 *
 * Each server is connected once, over an in-memory transport, and opened with
 * a 2025-era `initialize`. Every request then goes over the wire as JSON-RPC:
 * a result is checked against the shape the tests read before it is handed
 * back, and an error response is thrown with its message.
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

/** A connected client end: sends one request and resolves with its result. */
type Send = (request: McpRequest) => Promise<unknown>;

const connections = new WeakMap<Server, Promise<Send>>();

/** The protocol revision the helper's client opens with. */
export const LEGACY_PROTOCOL_VERSION = "2025-11-25";

async function connect(server: Server): Promise<Send> {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let nextId = 1;
    clientSide.onmessage = (message: JSONRPCMessage) => {
        if (isJSONRPCResultResponse(message) && typeof message.id === "number") {
            pending.get(message.id)?.resolve(message.result);
            pending.delete(message.id);
        } else if (isJSONRPCErrorResponse(message) && typeof message.id === "number") {
            pending.get(message.id)?.reject(new Error(message.error.message));
            pending.delete(message.id);
        }
    };
    await server.connect(serverSide);
    await clientSide.start();
    const send: Send = (request) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve,
reject });
        clientSide.send({ jsonrpc: "2.0",
id,
method: request.method,
params: request.params ?? {} }).catch(reject);
    });
    await send({
        method: "initialize",
        params: { protocolVersion: LEGACY_PROTOCOL_VERSION,
capabilities: {},
clientInfo: { name: "rebase-mcp-test",
version: "0" } }
    });
    await clientSide.send({ jsonrpc: "2.0",
method: "notifications/initialized" });
    return send;
}

function requestHandler(server: Server): Send {
    return async (request) => {
        let connection = connections.get(server);
        if (!connection) {
            connection = connect(server);
            connections.set(server, connection);
        }
        const send = await connection;
        return send(request);
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
    const handle = requestHandler(server);
    return async (request) => {
        const answer = await handle(request);
        if (!isToolCallResult(answer)) throw new Error(`Not a tool result: ${JSON.stringify(answer)}`);
        return answer;
    };
}

/** The `tools/list` handler. */
export function listToolsHandler(server: Server): (request: McpRequest) => Promise<ListToolsResult> {
    const handle = requestHandler(server);
    return async (request) => {
        const answer = await handle(request);
        if (!isListToolsResult(answer)) throw new Error(`Not a tool list: ${JSON.stringify(answer)}`);
        return answer;
    };
}

/** The `resources/read` handler. */
export function readResourceHandler(server: Server): (request: McpRequest) => Promise<ReadResourceResult> {
    const handle = requestHandler(server);
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
    const handle = requestHandler(server);
    return async (request) => {
        const answer = await handle(request);
        if (!isListResourcesResult(answer)) throw new Error(`Not a resource list: ${JSON.stringify(answer)}`);
        return answer;
    };
}

/** Any request, answered with its raw result. */
export function rawHandler(server: Server): Send {
    return requestHandler(server);
}
