import {
    httpMethodToOperation,
    isOperationAllowed,
    ApiKeyOperation
} from "../src/auth/api-keys/api-key-permission-guard";
import type { ApiKeyPermission } from "../src/auth/api-keys/api-key-types";

describe("httpMethodToOperation", () => {
    it("maps GET to read", () => {
        expect(httpMethodToOperation("GET")).toBe("read");
    });

    it("maps HEAD to read", () => {
        expect(httpMethodToOperation("HEAD")).toBe("read");
    });

    it("maps OPTIONS to read", () => {
        expect(httpMethodToOperation("OPTIONS")).toBe("read");
    });

    it("maps POST to write", () => {
        expect(httpMethodToOperation("POST")).toBe("write");
    });

    it("maps PUT to write", () => {
        expect(httpMethodToOperation("PUT")).toBe("write");
    });

    it("maps PATCH to write", () => {
        expect(httpMethodToOperation("PATCH")).toBe("write");
    });

    it("maps DELETE to delete", () => {
        expect(httpMethodToOperation("DELETE")).toBe("delete");
    });

    it("is case-insensitive", () => {
        expect(httpMethodToOperation("get")).toBe("read");
        expect(httpMethodToOperation("post")).toBe("write");
        expect(httpMethodToOperation("delete")).toBe("delete");
        expect(httpMethodToOperation("Patch")).toBe("write");
    });

    it("defaults unknown methods to read", () => {
        expect(httpMethodToOperation("CONNECT")).toBe("read");
        expect(httpMethodToOperation("TRACE")).toBe("read");
        expect(httpMethodToOperation("UNKNOWN")).toBe("read");
    });
});

describe("isOperationAllowed", () => {
    it("allows operation with exact collection match", () => {
        const permissions: ApiKeyPermission[] = [
            { collection: "users",
operations: ["read", "write"] }
        ];
        expect(isOperationAllowed(permissions, "users", "read")).toBe(true);
        expect(isOperationAllowed(permissions, "users", "write")).toBe(true);
    });

    it("denies operation not in the operations list", () => {
        const permissions: ApiKeyPermission[] = [
            { collection: "users",
operations: ["read"] }
        ];
        expect(isOperationAllowed(permissions, "users", "write")).toBe(false);
        expect(isOperationAllowed(permissions, "users", "delete")).toBe(false);
    });

    it("denies operation for non-matching collection", () => {
        const permissions: ApiKeyPermission[] = [
            { collection: "users",
operations: ["read", "write", "delete"] }
        ];
        expect(isOperationAllowed(permissions, "posts", "read")).toBe(false);
    });

    it("allows wildcard collection '*' to match any collection", () => {
        const permissions: ApiKeyPermission[] = [
            { collection: "*",
operations: ["read"] }
        ];
        expect(isOperationAllowed(permissions, "users", "read")).toBe(true);
        expect(isOperationAllowed(permissions, "posts", "read")).toBe(true);
        expect(isOperationAllowed(permissions, "anything", "read")).toBe(true);
    });

    it("wildcard collection still checks operations", () => {
        const permissions: ApiKeyPermission[] = [
            { collection: "*",
operations: ["read"] }
        ];
        expect(isOperationAllowed(permissions, "users", "write")).toBe(false);
        expect(isOperationAllowed(permissions, "users", "delete")).toBe(false);
    });

    it("returns false for empty permissions array", () => {
        expect(isOperationAllowed([], "users", "read")).toBe(false);
    });

    it("checks all permission entries and grants if any match", () => {
        const permissions: ApiKeyPermission[] = [
            { collection: "users",
operations: ["read"] },
            { collection: "posts",
operations: ["write"] },
            { collection: "comments",
operations: ["read", "write", "delete"] }
        ];
        expect(isOperationAllowed(permissions, "users", "read")).toBe(true);
        expect(isOperationAllowed(permissions, "posts", "write")).toBe(true);
        expect(isOperationAllowed(permissions, "comments", "delete")).toBe(true);
        expect(isOperationAllowed(permissions, "users", "write")).toBe(false);
        expect(isOperationAllowed(permissions, "posts", "read")).toBe(false);
    });

    it("handles overlapping permissions correctly", () => {
        const permissions: ApiKeyPermission[] = [
            { collection: "users",
operations: ["read"] },
            { collection: "users",
operations: ["write"] }
        ];
        expect(isOperationAllowed(permissions, "users", "read")).toBe(true);
        expect(isOperationAllowed(permissions, "users", "write")).toBe(true);
        expect(isOperationAllowed(permissions, "users", "delete")).toBe(false);
    });

    it("handles mixed wildcard and specific permissions", () => {
        const permissions: ApiKeyPermission[] = [
            { collection: "*",
operations: ["read"] },
            { collection: "users",
operations: ["write", "delete"] }
        ];
        // Wildcard read for everything
        expect(isOperationAllowed(permissions, "posts", "read")).toBe(true);
        // Specific write/delete for users
        expect(isOperationAllowed(permissions, "users", "write")).toBe(true);
        expect(isOperationAllowed(permissions, "users", "delete")).toBe(true);
        // No write for non-users
        expect(isOperationAllowed(permissions, "posts", "write")).toBe(false);
    });
});
