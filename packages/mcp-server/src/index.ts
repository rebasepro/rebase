import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, type ChildProcess } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";

// ── Package Manager Detection ───────────────────────────────────────────────

export type PackageManager = "pnpm" | "yarn" | "npm";

/**
 * Detect the project's package manager by checking for lock files.
 * Falls back to pnpm (Rebase's default) if no lock file is found.
 */
export function detectPackageManager(projectDir: string): PackageManager {
    const candidates: [string, PackageManager][] = [
        ["pnpm-lock.yaml", "pnpm"],
        ["pnpm-workspace.yaml", "pnpm"],
        ["yarn.lock", "yarn"],
        ["package-lock.json", "npm"]
    ];
    for (const [lockFile, pm] of candidates) {
        if (existsSync(resolve(projectDir, lockFile))) return pm;
    }
    // Also check in app/ subdirectory for scaffolded projects
    for (const [lockFile, pm] of candidates) {
        if (existsSync(resolve(projectDir, "app", lockFile))) return pm;
    }
    return "pnpm"; // Rebase default
}

/** Return the exec command and its arguments prefix for running a package binary. */
export function getExecCommand(pm: PackageManager): { command: string; args: string[] } {
    switch (pm) {
        case "pnpm":
            return { command: "pnpm", args: ["exec"] };
        case "yarn":
            return { command: "yarn", args: ["exec"] };
        case "npm":
            return { command: "npx", args: [] };
    }
}

/** Return the run command for executing package.json scripts. */
export function getRunCommand(pm: PackageManager): { command: string; args: string[] } {
    switch (pm) {
        case "pnpm":
            return { command: "pnpm", args: ["run"] };
        case "yarn":
            return { command: "yarn", args: ["run"] };
        case "npm":
            return { command: "npm", args: ["run"] };
    }
}

// We dynamically load @rebasepro/client to avoid transitive type issues.
// The client SDK ships compiled .d.ts that reference @rebasepro/types (which
// drags in React peer-deps).  By importing at runtime only we keep the MCP
// server build clean.
const CLIENT_PKG = "@rebasepro/client";
async function loadClientSdk(): Promise<(opts: Record<string, unknown>) => unknown> {
    const mod = await import(/* webpackIgnore: true */ CLIENT_PKG);
    return mod.createRebaseClient;
}

// ── Environment ─────────────────────────────────────────────────────────────

const PROJECT_DIR = process.env.REBASE_PROJECT_DIR || process.cwd();

// Try to load .env from the project directory
for (const envPath of [
    resolve(PROJECT_DIR, ".env"),
    resolve(PROJECT_DIR, "app", ".env")
]) {
    if (existsSync(envPath)) {
        loadDotenv({ path: envPath });
        break;
    }
}

const BASE_URL = process.env.REBASE_BASE_URL || "http://localhost:3001";
const API_TOKEN = process.env.REBASE_API_TOKEN || process.env.REBASE_TOKEN || "";

// ── Rebase Client (lazy) ────────────────────────────────────────────────────

type RebaseClient = {
    auth: {
        getUser: () => Promise<{ uid: string; email: string | null; roles?: string[] }>;
    };
    data: {
        collection: (slug: string) => {
            find: (opts: Record<string, unknown>) => Promise<unknown>;
            findById: (id: string) => Promise<unknown>;
            create: (data: unknown) => Promise<unknown>;
            update: (id: string, data: unknown) => Promise<unknown>;
            delete: (id: string) => Promise<void>;
        };
    };
    admin: {
        listUsers: () => Promise<unknown>;
        createUser: (opts: Record<string, unknown>) => Promise<unknown>;
        updateUser: (id: string, opts: Record<string, unknown>) => Promise<unknown>;
        deleteUser: (id: string) => Promise<unknown>;
        listRoles: () => Promise<unknown>;
    };
    cron: {
        listJobs: () => Promise<{ jobs: unknown[] }>;
        getJob: (jobId: string) => Promise<{ job: unknown }>;
        triggerJob: (jobId: string) => Promise<{ log: unknown; job: unknown }>;
        getJobLogs: (jobId: string, options?: { limit?: number }) => Promise<{ logs: unknown[] }>;
        toggleJob: (jobId: string, enabled: boolean) => Promise<{ job: unknown }>;
    };
    storage: {
        listObjects: (prefix: string, options?: { bucket?: string; maxResults?: number; pageToken?: string }) => Promise<unknown>;
        deleteObject: (key: string, bucket?: string) => Promise<void>;
        getSignedUrl: (keyOrUrl: string, bucket?: string) => Promise<unknown>;
    };
    functions: {
        invoke: (name: string, payload?: unknown, options?: { method?: string; path?: string }) => Promise<unknown>;
    };
};

let _client: RebaseClient | null = null;

async function getClient(): Promise<RebaseClient> {
    if (!_client) {
        const createRebaseClient = await loadClientSdk();
        _client = createRebaseClient({
            baseUrl: BASE_URL,
            token: API_TOKEN || undefined
        }) as RebaseClient;
    }
    return _client;
}

async function ensureAdmin(): Promise<void> {
    const client = await getClient();
    try {
        const user = await client.auth.getUser();
        if (!user.roles?.includes("admin")) {
            throw new Error("Access denied: User does not have the 'admin' role.");
        }
    } catch (err: any) {
        throw new Error(`Admin authorization failed: ${err.message}`);
    }
}

// ── MCP Server ──────────────────────────────────────────────────────────────

export const server = new Server(
    { name: "rebase-mcp-server",
      version: "0.0.1" },
    { capabilities: { tools: {},
      resources: {} } }
);

// ── Tool Definitions ────────────────────────────────────────────────────────

interface ToolDef {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
}

const CLI_TOOLS: (ToolDef & { cmd: string[] })[] = [
    {
        name: "rebase_schema_generate",
        description: "Generate Drizzle schema from Rebase TypeScript collection definitions. Run this after adding or modifying collection files.",
        inputSchema: { type: "object",
properties: {} },
        cmd: ["schema", "generate"]
    },
    {
        name: "rebase_db_push",
        description: "Apply the current Drizzle schema directly to the database (development shortcut, skips migration files).",
        inputSchema: { type: "object",
properties: {} },
        cmd: ["db", "push"]
    },
    {
        name: "rebase_schema_introspect",
        description: "Introspect the live database and generate Rebase collection definitions from existing tables.",
        inputSchema: { type: "object",
properties: {} },
        cmd: ["schema", "introspect"]
    },
    {
        name: "rebase_db_generate",
        description: "Generate SQL migration files from schema changes (compares current Drizzle schema against the last snapshot).",
        inputSchema: { type: "object",
properties: {} },
        cmd: ["db", "generate"]
    },
    {
        name: "rebase_db_migrate",
        description: "Run all pending SQL migrations against the database.",
        inputSchema: { type: "object",
properties: {} },
        cmd: ["db", "migrate"]
    },
    {
        name: "rebase_generate_sdk",
        description: "Generate a fully-typed JavaScript/TypeScript SDK from collection definitions.",
        inputSchema: { type: "object",
properties: {} },
        cmd: ["generate-sdk"]
    },
    {
        name: "rebase_doctor",
        description: "Detect schema drift between collection definitions, generated Drizzle schema, and the live PostgreSQL database.",
        inputSchema: { type: "object", properties: {} },
        cmd: ["doctor"]
    },
    {
        name: "rebase_auth_reset_password",
        description: "Reset a user's password in the Rebase project.",
        inputSchema: {
            type: "object",
            properties: {
                email: { type: "string", description: "Email of the user to reset" },
                password: { type: "string", description: "New password to set (defaults to 'NewPassword123!')" }
            },
            required: ["email"]
        },
        cmd: ["auth", "reset-password"]
    },
    {
        name: "rebase_db_branch_create",
        description: "Create a new database branch (Admins only).",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Name of the new database branch" },
                from: { type: "string", description: "Parent branch to clone from (optional)" }
            },
            required: ["name"]
        },
        cmd: ["db", "branch", "create"]
    },
    {
        name: "rebase_db_branch_list",
        description: "List all database branches (Admins only).",
        inputSchema: { type: "object", properties: {} },
        cmd: ["db", "branch", "list"]
    },
    {
        name: "rebase_db_branch_delete",
        description: "Delete an existing database branch (Admins only).",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Name of the branch to delete" }
            },
            required: ["name"]
        },
        cmd: ["db", "branch", "delete"]
    },
    {
        name: "rebase_db_branch_info",
        description: "Show information and status for a database branch (Admins only).",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Name of the branch to inspect" }
            },
            required: ["name"]
        },
        cmd: ["db", "branch", "info"]
    }
];

const DATA_TOOLS: ToolDef[] = [
    {
        name: "list_documents",
        description: "List documents from a Rebase collection with optional filtering, sorting, and pagination.",
        inputSchema: {
            type: "object",
            properties: {
                collection: { type: "string",
description: "Collection slug" },
                limit: { type: "number",
description: "Max results (default 25)" },
                offset: { type: "number",
description: "Skip N results" },
                orderBy: { type: "string",
description: "Sort field, optionally with :asc or :desc suffix" },
                where: {
                    type: "object",
                    description: "Filter object, e.g. { \"status\": \"eq.active\", \"price\": \"gte.100\" }",
                    additionalProperties: { type: "string" }
                }
            },
            required: ["collection"]
        }
    },
    {
        name: "get_document",
        description: "Get a single document by ID from a Rebase collection.",
        inputSchema: {
            type: "object",
            properties: {
                collection: { type: "string",
description: "Collection slug" },
                id: { type: "string",
description: "Document ID" }
            },
            required: ["collection", "id"]
        }
    },
    {
        name: "create_document",
        description: "Create a new document in a Rebase collection.",
        inputSchema: {
            type: "object",
            properties: {
                collection: { type: "string",
description: "Collection slug" },
                data: { type: "object",
description: "Document fields",
additionalProperties: true }
            },
            required: ["collection", "data"]
        }
    },
    {
        name: "update_document",
        description: "Update an existing document in a Rebase collection.",
        inputSchema: {
            type: "object",
            properties: {
                collection: { type: "string",
description: "Collection slug" },
                id: { type: "string",
description: "Document ID" },
                data: { type: "object",
description: "Fields to update",
additionalProperties: true }
            },
            required: ["collection", "id", "data"]
        }
    },
    {
        name: "delete_document",
        description: "Delete a document from a Rebase collection.",
        inputSchema: {
            type: "object",
            properties: {
                collection: { type: "string",
description: "Collection slug" },
                id: { type: "string",
description: "Document ID" }
            },
            required: ["collection", "id"]
        }
    }
];

const ADMIN_TOOLS: ToolDef[] = [
    {
        name: "list_users",
        description: "List all users registered in the Rebase backend, including their roles.",
        inputSchema: { type: "object",
properties: {} }
    },
    {
        name: "create_user",
        description: "Create a new user in the Rebase backend.",
        inputSchema: {
            type: "object",
            properties: {
                email: { type: "string",
description: "User email" },
                displayName: { type: "string",
description: "Display name" },
                password: { type: "string",
description: "Initial password" },
                roles: { type: "array",
items: { type: "string" },
description: "Role IDs to assign" }
            },
            required: ["email"]
        }
    },
    {
        name: "update_user",
        description: "Update an existing user (email, display name, roles).",
        inputSchema: {
            type: "object",
            properties: {
                userId: { type: "string",
description: "User UID" },
                email: { type: "string" },
                displayName: { type: "string" },
                roles: { type: "array",
items: { type: "string" } }
            },
            required: ["userId"]
        }
    },
    {
        name: "delete_user",
        description: "Delete a user from the Rebase backend.",
        inputSchema: {
            type: "object",
            properties: {
                userId: { type: "string",
description: "User UID" }
            },
            required: ["userId"]
        }
    },
    {
        name: "list_roles",
        description: "List all roles defined in the Rebase backend.",
        inputSchema: { type: "object",
properties: {} }
    }
];

const DEV_TOOLS: ToolDef[] = [
    {
        name: "rebase_dev_start",
        description: "Start the Rebase development server (frontend + backend). Returns immediately — use rebase_dev_logs to check output.",
        inputSchema: { type: "object",
properties: {} }
    },
    {
        name: "rebase_dev_logs",
        description: "Read recent output from the running Rebase dev server.",
        inputSchema: {
            type: "object",
            properties: {
                lines: { type: "number",
description: "Number of recent lines to return (default 50)" }
            }
        }
    },
    {
        name: "rebase_dev_stop",
        description: "Stop the running Rebase development server.",
        inputSchema: { type: "object",
properties: {} }
    }
];

const STORAGE_TOOLS: ToolDef[] = [
    {
        name: "storage_list_objects",
        description: "List files/objects stored in Rebase storage.",
        inputSchema: {
            type: "object",
            properties: {
                prefix: { type: "string", description: "Filter objects by prefix (e.g. 'images/')" },
                bucket: { type: "string", description: "Filter by storage bucket name" },
                maxResults: { type: "number", description: "Maximum number of results to return (default 50)" },
                pageToken: { type: "string", description: "Pagination token" }
            }
        }
    },
    {
        name: "storage_delete_object",
        description: "Delete an object/file from Rebase storage.",
        inputSchema: {
            type: "object",
            properties: {
                key: { type: "string", description: "Key/path of the file to delete (e.g., 'images/profile.png')" },
                bucket: { type: "string", description: "Storage bucket name" }
            },
            required: ["key"]
        }
    },
    {
        name: "storage_get_metadata",
        description: "Get metadata and a temporary signed download URL for a file in Rebase storage.",
        inputSchema: {
            type: "object",
            properties: {
                key: { type: "string", description: "Key/path/url of the file to download" },
                bucket: { type: "string", description: "Storage bucket name" }
            },
            required: ["key"]
        }
    }
];

const CRON_TOOLS: ToolDef[] = [
    {
        name: "cron_list_jobs",
        description: "List all scheduled cron jobs and their configuration status.",
        inputSchema: { type: "object", properties: {} }
    },
    {
        name: "cron_get_job",
        description: "Get status and details of a specific scheduled cron job.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Unique identifier of the cron job" }
            },
            required: ["jobId"]
        }
    },
    {
        name: "cron_trigger_job",
        description: "Manually trigger a cron job run immediately.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Unique identifier of the cron job to run" }
            },
            required: ["jobId"]
        }
    },
    {
        name: "cron_get_job_logs",
        description: "Read execution logs for a specific cron job.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Unique identifier of the cron job" },
                limit: { type: "number", description: "Number of log lines to return (default 50)" }
            },
            required: ["jobId"]
        }
    },
    {
        name: "cron_toggle_job",
        description: "Enable or disable a scheduled cron job.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Unique identifier of the cron job" },
                enabled: { type: "boolean", description: "Set to true to enable, false to disable" }
            },
            required: ["jobId", "enabled"]
        }
    }
];

const FUNCTION_TOOLS: ToolDef[] = [
    {
        name: "invoke_function",
        description: "Invoke a custom backend Hono function (located in api/functions/:name).",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Function name (filename without extension, e.g. 'send-welcome-email')" },
                payload: { type: "object", description: "Optional JSON payload body for POST/PUT/PATCH requests", additionalProperties: true },
                method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP Method (defaults to POST)" },
                path: { type: "string", description: "Optional sub-path to append after the function name (e.g. 'status/123')" }
            },
            required: ["name"]
        }
    }
];

export const ALL_TOOLS: ToolDef[] = [
    ...CLI_TOOLS.map(({ cmd: _c, ...rest }) => rest),
    ...DATA_TOOLS,
    ...ADMIN_TOOLS,
    ...DEV_TOOLS,
    ...STORAGE_TOOLS,
    ...CRON_TOOLS,
    ...FUNCTION_TOOLS
];

// ── Tool Handlers ───────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS
}));

/** Spawn the rebase CLI using the project's detected package manager. */
function runRebaseCmd(commandArgs: string[]): Promise<string> {
    const pm = detectPackageManager(PROJECT_DIR);
    const { command, args: execArgs } = getExecCommand(pm);
    return new Promise((resolve) => {
        const child = spawn(command, [...execArgs, "rebase", ...commandArgs], {
            cwd: PROJECT_DIR,
            shell: true,
            env: { ...process.env }
        });
        const chunks: string[] = [];
        child.stdout?.on("data", (d: Buffer) => chunks.push(d.toString()));
        child.stderr?.on("data", (d: Buffer) => chunks.push(d.toString()));
        child.on("error", (err) => resolve(`Error spawning command: ${err.message}`));
        child.on("close", (code) => {
            const output = chunks.join("").trim();
            resolve(code !== 0 ? `Command exited with code ${code}\n\n${output}` : output || "(no output)");
        });
    });
}

// Dev server management
let devProcess: ChildProcess | null = null;
const devLogs: string[] = [];
const MAX_DEV_LOG_LINES = 500;

function appendDevLog(line: string) {
    devLogs.push(line);
    if (devLogs.length > MAX_DEV_LOG_LINES) {
        devLogs.splice(0, devLogs.length - MAX_DEV_LOG_LINES);
    }
}

function textResult(text: string) {
    return { content: [{ type: "text" as const,
text }] };
}

function jsonResult(data: unknown) {
    return textResult(JSON.stringify(data, null, 2));
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── CLI tools ───────────────────────────────────────────────────────
    const cliTool = CLI_TOOLS.find((t) => t.name === name);
    if (cliTool) {
        if (name.startsWith("rebase_db_branch_")) {
            await ensureAdmin();
        }

        const cmdArgs = [...cliTool.cmd];
        if (name === "rebase_auth_reset_password") {
            const argsObj = args as { email: string; password?: string };
            cmdArgs.push("--email", argsObj.email);
            if (argsObj.password) {
                cmdArgs.push("--password", argsObj.password);
            }
        } else if (name === "rebase_db_branch_create") {
            const argsObj = args as { name: string; from?: string };
            cmdArgs.push(argsObj.name);
            if (argsObj.from) {
                cmdArgs.push("--from", argsObj.from);
            }
        } else if (name === "rebase_db_branch_delete" || name === "rebase_db_branch_info") {
            const argsObj = args as { name: string };
            cmdArgs.push(argsObj.name);
        }

        const result = await runRebaseCmd(cmdArgs);
        return textResult(result);
    }

    // ── Data tools (via @rebasepro/client) ──────────────────────────────
    const client = await getClient();

    switch (name) {
        case "list_documents": {
            const argsObj = args as { collection: string; limit?: number; offset?: number; orderBy?: string; where?: Record<string, unknown> };
            const { collection: slug, limit, offset, orderBy, where } = argsObj;
            const result = await client.data.collection(slug).find({
                limit,
                offset,
                orderBy,
                where
            });
            return jsonResult(result);
        }

        case "get_document": {
            const argsObj = args as { collection: string; id: string };
            const { collection: slug, id } = argsObj;
            const entity = await client.data.collection(slug).findById(id);
            if (!entity) return textResult(`Document ${id} not found in ${slug}`);
            return jsonResult(entity);
        }

        case "create_document": {
            const argsObj = args as { collection: string; data: Record<string, unknown> };
            const { collection: slug, data } = argsObj;
            const entity = await client.data.collection(slug).create(data);
            return jsonResult(entity);
        }

        case "update_document": {
            const argsObj = args as { collection: string; id: string; data: Record<string, unknown> };
            const { collection: slug, id, data } = argsObj;
            const entity = await client.data.collection(slug).update(id, data);
            return jsonResult(entity);
        }

        case "delete_document": {
            const argsObj = args as { collection: string; id: string };
            const { collection: slug, id } = argsObj;
            await client.data.collection(slug).delete(id);
            return textResult(`Deleted document ${id} from ${slug}`);
        }

        // ── Admin tools ────────────────────────────────────────────────────
        case "list_users": {
            const result = await client.admin.listUsers();
            return jsonResult(result);
        }

        case "create_user": {
            const argsObj = args as { email: string; displayName?: string; password?: string; roles?: string[] };
            const { email, displayName, password, roles } = argsObj;
            const result = await client.admin.createUser({ email,
displayName,
password,
roles });
            return jsonResult(result);
        }

        case "update_user": {
            const argsObj = args as { userId: string; email?: string; displayName?: string; roles?: string[] };
            const { userId, email, displayName, roles } = argsObj;
            const result = await client.admin.updateUser(userId, { email,
displayName,
roles });
            return jsonResult(result);
        }

        case "delete_user": {
            const argsObj = args as { userId: string };
            const { userId } = argsObj;
            const result = await client.admin.deleteUser(userId);
            return jsonResult(result);
        }

        case "list_roles": {
            const result = await client.admin.listRoles();
            return jsonResult(result);
        }

        // ── Storage Tools ──────────────────────────────────────────────────
        case "storage_list_objects": {
            const argsObj = args as { prefix?: string; bucket?: string; maxResults?: number; pageToken?: string };
            const { prefix = "", bucket, maxResults, pageToken } = argsObj;
            const result = await client.storage.listObjects(prefix, { bucket, maxResults, pageToken });
            return jsonResult(result);
        }

        case "storage_delete_object": {
            const argsObj = args as { key: string; bucket?: string };
            const { key, bucket } = argsObj;
            await client.storage.deleteObject(key, bucket);
            return textResult(`Deleted object "${key}" successfully.`);
        }

        case "storage_get_metadata": {
            const argsObj = args as { key: string; bucket?: string };
            const { key, bucket } = argsObj;
            const result = await client.storage.getSignedUrl(key, bucket);
            return jsonResult(result);
        }

        // ── Cron Tools ─────────────────────────────────────────────────────
        case "cron_list_jobs": {
            const result = await client.cron.listJobs();
            return jsonResult(result);
        }

        case "cron_get_job": {
            const argsObj = args as { jobId: string };
            const result = await client.cron.getJob(argsObj.jobId);
            return jsonResult(result);
        }

        case "cron_trigger_job": {
            const argsObj = args as { jobId: string };
            const result = await client.cron.triggerJob(argsObj.jobId);
            return jsonResult(result);
        }

        case "cron_get_job_logs": {
            const argsObj = args as { jobId: string; limit?: number };
            const result = await client.cron.getJobLogs(argsObj.jobId, { limit: argsObj.limit });
            return jsonResult(result);
        }

        case "cron_toggle_job": {
            const argsObj = args as { jobId: string; enabled: boolean };
            const result = await client.cron.toggleJob(argsObj.jobId, argsObj.enabled);
            return jsonResult(result);
        }

        // ── Function Tools ─────────────────────────────────────────────────
        case "invoke_function": {
            const argsObj = args as { name: string; payload?: unknown; method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path?: string };
            const { name: funcName, payload, method, path: funcPath } = argsObj;
            const result = await client.functions.invoke(funcName, payload, { method, path: funcPath });
            return jsonResult(result);
        }

        // ── Dev server management ──────────────────────────────────────────
        case "rebase_dev_start": {
            if (devProcess && !devProcess.killed) {
                return textResult("Dev server is already running (PID " + devProcess.pid + ")");
            }
            devLogs.length = 0;
            const pm = detectPackageManager(PROJECT_DIR);
            const { command: runCmd, args: runArgs } = getRunCommand(pm);
            devProcess = spawn(runCmd, [...runArgs, "dev"], {
                cwd: resolve(PROJECT_DIR, "app"),
                shell: true,
                env: { ...process.env }
            });
            devProcess.stdout?.on("data", (d: Buffer) => appendDevLog(d.toString()));
            devProcess.stderr?.on("data", (d: Buffer) => appendDevLog(d.toString()));
            devProcess.on("close", (code) => {
                appendDevLog(`\n[dev server exited with code ${code}]`);
                devProcess = null;
            });
            // Wait a moment for initial output
            await new Promise((r) => setTimeout(r, 2000));
            return textResult(`Dev server started (PID ${devProcess?.pid})\n\n${devLogs.join("")}`);
        }

        case "rebase_dev_logs": {
            const argsObj = args as { lines?: number } | undefined;
            const lineCount = argsObj?.lines ?? 50;
            const recent = devLogs.slice(-lineCount);
            if (recent.length === 0) {
                return textResult(devProcess ? "No output captured yet." : "Dev server is not running.");
            }
            return textResult(recent.join(""));
        }

        case "rebase_dev_stop": {
            if (!devProcess || devProcess.killed) {
                return textResult("Dev server is not running.");
            }
            devProcess.kill("SIGTERM");
            return textResult("Dev server stopped.");
        }

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
});

// ── Resources ───────────────────────────────────────────────────────────────

function findCollectionsDir(): string | null {
    const candidates = [
        resolve(PROJECT_DIR, "app", "config", "collections"),
        resolve(PROJECT_DIR, "config", "collections"),
        resolve(PROJECT_DIR, "collections")
    ];
    for (const dir of candidates) {
        if (existsSync(dir)) return dir;
    }
    return null;
}

server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources: Array<{ uri: string; name: string; description: string; mimeType: string }> = [];

    // Collection files
    const collectionsDir = findCollectionsDir();
    if (collectionsDir) {
        const files = readdirSync(collectionsDir).filter((f) => f.endsWith(".ts") && f !== "index.ts");
        for (const file of files) {
            const name = file.replace(/\.ts$/, "");
            resources.push({
                uri: `rebase://collections/${name}`,
                name: `Collection: ${name}`,
                description: `TypeScript collection definition for "${name}"`,
                mimeType: "text/typescript"
            });
        }
    }

    // Generated schema
    const schemaPath = resolve(PROJECT_DIR, "app", "backend", "src", "schema.generated.ts");
    if (existsSync(schemaPath)) {
        resources.push({
            uri: "rebase://schema",
            name: "Generated Drizzle Schema",
            description: "Auto-generated Drizzle ORM schema from collection definitions",
            mimeType: "text/typescript"
        });
    }

    return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "rebase://schema") {
        const schemaPath = resolve(PROJECT_DIR, "app", "backend", "src", "schema.generated.ts");
        if (!existsSync(schemaPath)) {
            throw new Error("Generated schema not found. Run `rebase schema generate` first.");
        }
        return {
            contents: [{
                uri,
                mimeType: "text/typescript",
                text: readFileSync(schemaPath, "utf-8")
            }]
        };
    }

    const collectionMatch = uri.match(/^rebase:\/\/collections\/(.+)$/);
    if (collectionMatch) {
        const name = collectionMatch[1];
        const collectionsDir = findCollectionsDir();
        if (!collectionsDir) throw new Error("Collections directory not found.");

        const absoluteCollectionsDir = resolve(collectionsDir);
        const filePath = resolve(absoluteCollectionsDir, `${name}.ts`);
        if (!filePath.startsWith(absoluteCollectionsDir)) {
            throw new Error("Access denied: path traversal detected");
        }
        if (!existsSync(filePath)) throw new Error(`Collection "${name}" not found.`);

        return {
            contents: [{
                uri,
                mimeType: "text/typescript",
                text: readFileSync(filePath, "utf-8")
            }]
        };
    }

    throw new Error(`Unknown resource: ${uri}`);
});

// ── Start ───────────────────────────────────────────────────────────────────

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

if (process.env.NODE_ENV !== "test") {
    main().catch(console.error);
}
