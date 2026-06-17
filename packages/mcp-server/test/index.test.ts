import { describe, it, expect, vi, beforeEach } from "vitest";
import { server, ALL_TOOLS } from "../src/index";

// Mock the child_process spawn for CLI tools
const mockSpawn = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn()
};
vi.mock("node:child_process", () => ({
    spawn: vi.fn(() => mockSpawn)
}));

// Mock the Rebase Client SDK
const mockClient = {
    data: {
        collection: vi.fn(() => ({
            find: vi.fn().mockResolvedValue([{ id: "doc-1", title: "Test Doc" }]),
            findById: vi.fn().mockResolvedValue({ id: "doc-1", title: "Test Doc" }),
            create: vi.fn().mockResolvedValue({ id: "doc-2", title: "New Doc" }),
            update: vi.fn().mockResolvedValue({ id: "doc-1", title: "Updated Doc" }),
            delete: vi.fn().mockResolvedValue(undefined)
        }))
    },
    admin: {
        listUsers: vi.fn().mockResolvedValue([{ email: "user@rebase.pro" }]),
        createUser: vi.fn().mockResolvedValue({ email: "new@rebase.pro" }),
        updateUser: vi.fn().mockResolvedValue({ userId: "1", email: "updated@rebase.pro" }),
        deleteUser: vi.fn().mockResolvedValue(true),
        listRoles: vi.fn().mockResolvedValue(["admin", "user"])
    }
};

vi.mock("@rebasepro/client", () => ({
    createRebaseClient: () => mockClient
}));

describe("MCP Server", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("registers all expected tools", () => {
        const toolNames = ALL_TOOLS.map(t => t.name);
        expect(toolNames).toContain("rebase_schema_generate");
        expect(toolNames).toContain("rebase_db_push");
        expect(toolNames).toContain("list_documents");
        expect(toolNames).toContain("get_document");
        expect(toolNames).toContain("create_document");
        expect(toolNames).toContain("update_document");
        expect(toolNames).toContain("delete_document");
        expect(toolNames).toContain("list_users");
        expect(toolNames).toContain("create_user");
    });

    it("handles list tools request", async () => {
        const handler = (server as any)._requestHandlers.get("tools/list");
        expect(handler).toBeDefined();
        
        const result = await handler({
            method: "tools/list"
        });
        expect(result.tools.length).toEqual(ALL_TOOLS.length);
    });

    it("routes call tool requests to client data operations", async () => {
        const handler = (server as any)._requestHandlers.get("tools/call");
        expect(handler).toBeDefined();

        // 1. get_document
        const getResult = await handler({
            method: "tools/call",
            params: {
                name: "get_document",
                arguments: { collection: "posts", id: "1" }
            }
        });
        expect(getResult.content[0].text).toContain("doc-1");

        // 2. create_document
        const createResult = await handler({
            method: "tools/call",
            params: {
                name: "create_document",
                arguments: { collection: "posts", data: { title: "New Doc" } }
            }
        });
        expect(createResult.content[0].text).toContain("doc-2");
    });

    it("routes call tool requests to admin operations", async () => {
        const handler = (server as any)._requestHandlers.get("tools/call");
        expect(handler).toBeDefined();

        // list_users
        const usersResult = await handler({
            method: "tools/call",
            params: {
                name: "list_users",
                arguments: {}
            }
        });
        expect(usersResult.content[0].text).toContain("user@rebase.pro");
    });
});
