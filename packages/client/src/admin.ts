import type { Transport } from "./transport";
import { AdminUser } from "@rebasepro/types";

export type { AdminUser };


export interface CreateAdminOptions {
    adminPath?: string;
}

/** The window and filter `GET /admin/users` takes. */
export interface ListUsersOptions {
    search?: string;
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDir?: "asc" | "desc";
}

export function createAdmin(transport: Transport, options?: CreateAdminOptions) {
    const opts = options || {};
    const adminPath = opts.adminPath || "/admin";

    /**
     * One page of users — the route's default is 25 — with the `total` that
     * says whether there are more. Takes the same window as
     * {@link listUsersPaginated}; without one, it used to hand back the first
     * page typed as the whole list.
     */
    async function listUsers(options?: ListUsersOptions) {
        return listUsersPaginated(options);
    }

    async function listUsersPaginated(options?: ListUsersOptions) {
        const params = new URLSearchParams();
        if (options?.limit !== undefined) params.set("limit", String(options.limit));
        if (options?.offset !== undefined) params.set("offset", String(options.offset));
        if (options?.search) params.set("search", options.search);
        if (options?.orderBy) params.set("orderBy", options.orderBy);
        if (options?.orderDir) params.set("orderDir", options.orderDir);
        const qs = params.toString();
        return transport.request<{ users: AdminUser[]; total: number; limit: number; offset: number }>(
            adminPath + "/users" + (qs ? "?" + qs : ""), { method: "GET" }
        );
    }

    async function getUser(userId: string) {
        return transport.request<{ user: AdminUser }>(adminPath + "/users/" + encodeURIComponent(userId), { method: "GET" });
    }

    async function createUser(data: { email: string, displayName?: string, password?: string, roles?: string[] }) {
        return transport.request<{ user: AdminUser }>(adminPath + "/users", {
            method: "POST",
            body: JSON.stringify(data)
        });
    }

    async function updateUser(userId: string, data: { email?: string, displayName?: string, password?: string, roles?: string[] }) {
        return transport.request<{ user: AdminUser }>(adminPath + "/users/" + encodeURIComponent(userId), {
            method: "PUT",
            body: JSON.stringify(data)
        });
    }

    async function deleteUser(userId: string) {
        return transport.request<{ success: boolean }>(adminPath + "/users/" + encodeURIComponent(userId), {
            method: "DELETE"
        });
    }

    async function resetPassword(userId: string, options?: { password?: string }) {
        return transport.request<{ user: AdminUser; temporaryPassword?: string; invitationSent?: boolean; emailDeliveryFailed?: boolean }>(
            adminPath + "/users/" + encodeURIComponent(userId) + "/reset-password",
            {
                method: "POST",
                ...(options?.password ? { body: JSON.stringify({ password: options.password }) } : {})
            }
        );
    }

    async function listRoles() {
        return transport.request<{ roles: Array<{ id: string; name: string }> }>(
            adminPath + "/roles",
            { method: "GET" }
        );
    }

    async function bootstrap() {
        return transport.request<{ success: boolean; message: string; user: { uid: string; roles: string[] } }>(adminPath + "/bootstrap", {
            method: "POST"
        });
    }

    return {
        listUsers,
        listUsersPaginated,
        getUser,
        createUser,
        updateUser,
        deleteUser,
        resetPassword,
        listRoles,
        bootstrap
    };
}
