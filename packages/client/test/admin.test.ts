import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { createAdmin, AdminUser } from "../src/admin";
import type { Transport } from "../src/transport";

function createMockTransport() {
    const mockRequest = jest.fn() as jest.Mock<Transport["request"]>;
    const transport: Transport = {
        request: mockRequest,
        baseUrl: "http://localhost",
        apiPath: "/api/v1",
        fetchFn: globalThis.fetch,
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        getHeaders: jest.fn().mockReturnValue({}),
        resolveToken: jest.fn().mockResolvedValue(null)
    };
    return { transport,
mockRequest };
}

describe("createAdmin", () => {
    let transport: Transport;
    let mockRequest: jest.Mock<Transport["request"]>;

    beforeEach(() => {
        ({ transport, mockRequest } = createMockTransport());
    });

    // -----------------------------------------------------------------------
    // Bootstrap
    // -----------------------------------------------------------------------
    describe("bootstrap", () => {
        it("calls POST /admin/bootstrap", async () => {
            const admin = createAdmin(transport);
            mockRequest.mockResolvedValueOnce({ success: true,
message: "Bootstrapped",
user: { uid: "u1",
roles: ["admin"] } });

            const result = await admin.bootstrap();
            expect(result.success).toBe(true);
            expect(result.user.uid).toBe("u1");
            expect(mockRequest).toHaveBeenCalledWith("/admin/bootstrap", { method: "POST" });
        });

        it("uses custom adminPath", async () => {
            const admin = createAdmin(transport, { adminPath: "/custom-admin" });
            mockRequest.mockResolvedValueOnce({ success: true,
message: "ok",
user: { uid: "u1",
roles: [] } });

            await admin.bootstrap();
            expect(mockRequest).toHaveBeenCalledWith("/custom-admin/bootstrap", { method: "POST" });
        });
    });

    // -----------------------------------------------------------------------
    // Users
    // -----------------------------------------------------------------------
    describe("Users", () => {
        it("listUsers calls GET /admin/users", async () => {
            const admin = createAdmin(transport);
            const users: AdminUser[] = [
                { uid: "u1",
email: "a@b.com",
displayName: null,
photoURL: null,
provider: "local",
roles: [],
createdAt: "",
updatedAt: "" }
            ];
            mockRequest.mockResolvedValueOnce({ users });

            const result = await admin.listUsers();
            expect(result.users).toHaveLength(1);
            expect(result.users[0].uid).toBe("u1");
            expect(mockRequest).toHaveBeenCalledWith("/admin/users", { method: "GET" });
        });

        it("getUser calls GET /admin/users/:id", async () => {
            const admin = createAdmin(transport);
            mockRequest.mockResolvedValueOnce({ user: { uid: "usr_1" } });

            const result = await admin.getUser("usr_1");
            expect(result.user.uid).toBe("usr_1");
            expect(mockRequest).toHaveBeenCalledWith("/admin/users/usr_1", { method: "GET" });
        });

        it("getUser encodes special characters in ID", async () => {
            const admin = createAdmin(transport);
            mockRequest.mockResolvedValueOnce({ user: { uid: "a/b" } });

            await admin.getUser("a/b");
            expect(mockRequest).toHaveBeenCalledWith("/admin/users/a%2Fb", { method: "GET" });
        });

        it("createUser calls POST /admin/users with full payload", async () => {
            const admin = createAdmin(transport);
            mockRequest.mockResolvedValueOnce({ user: { uid: "usr_new" } });

            const data = { email: "admin@example.com",
displayName: "Admin",
password: "secure123",
roles: ["admin"] };
            await admin.createUser(data);

            expect(mockRequest).toHaveBeenCalledWith("/admin/users", { method: "POST",
body: JSON.stringify(data) });
        });

        it("createUser with minimal payload (email only)", async () => {
            const admin = createAdmin(transport);
            mockRequest.mockResolvedValueOnce({ user: { uid: "usr_min" } });

            const data = { email: "user@example.com" };
            await admin.createUser(data);

            expect(mockRequest).toHaveBeenCalledWith("/admin/users", {
                method: "POST",
                body: JSON.stringify({ email: "user@example.com" })
            });
        });

        it("updateUser calls PUT /admin/users/:id", async () => {
            const admin = createAdmin(transport);
            mockRequest.mockResolvedValueOnce({ user: { uid: "usr_1",
roles: ["editor"] } });

            const patch = { roles: ["editor"],
displayName: "New Name" };
            await admin.updateUser("usr_1", patch);

            expect(mockRequest).toHaveBeenCalledWith("/admin/users/usr_1", {
                method: "PUT",
                body: JSON.stringify(patch)
            });
        });

        it("deleteUser calls DELETE /admin/users/:id", async () => {
            const admin = createAdmin(transport);
            mockRequest.mockResolvedValueOnce({ success: true });

            const result = await admin.deleteUser("usr_1");
            expect(result.success).toBe(true);
            expect(mockRequest).toHaveBeenCalledWith("/admin/users/usr_1", { method: "DELETE" });
        });
    });

    // -----------------------------------------------------------------------
    // Default adminPath
    // -----------------------------------------------------------------------
    describe("Custom adminPath", () => {
        it("uses /admin by default", async () => {
            const admin = createAdmin(transport);
            mockRequest.mockResolvedValueOnce({ users: [] });

            await admin.listUsers();
            expect(mockRequest).toHaveBeenCalledWith("/admin/users", { method: "GET" });
        });

        it("uses custom path for all endpoints", async () => {
            const admin = createAdmin(transport, { adminPath: "/v2/admin" });
            mockRequest.mockResolvedValueOnce({ users: [] });

            await admin.listUsers();
            expect(mockRequest).toHaveBeenCalledWith("/v2/admin/users", { method: "GET" });
        });
    });
});
