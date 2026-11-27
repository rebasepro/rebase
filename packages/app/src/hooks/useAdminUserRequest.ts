import { useCallback } from "react";
import { apiBaseOf } from "./ApiConfigContext";
import { useAuthController } from "./useAuthController";
import { useRebaseClient } from "./useRebaseClient";

/**
 * Call an admin user route (`/admin/users/<path>`) as the signed-in caller,
 * and turn a refusal into an error carrying the server's message.
 *
 * What the account actions run on — reset a password, reset two-step
 * verification, switch an account off — in the admin panel's users collection
 * and in the Studio's Tables editor alike, so both send the same request and
 * the server judges both the same way (`users:write`, never above the caller).
 *
 * @group Hooks
 */
export function useAdminUserRequest(): <T>(path: string, init?: { method: string; body?: unknown }) => Promise<T> {
    const client = useRebaseClient<{ baseUrl?: string, apiPath?: string }>();
    const { getAuthToken } = useAuthController();
    return useCallback(async <T,>(path: string, init?: { method: string; body?: unknown }): Promise<T> => {
        const token = await getAuthToken?.();
        const response = await fetch(`${apiBaseOf(client) ?? ""}/admin/users/${path}`, {
            method: init?.method ?? "GET",
            headers: {
                ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
                ...(token ? { "Authorization": `Bearer ${token}` } : {})
            },
            ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        const body: unknown = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(errorMessageOf(body) ?? response.statusText);
        return body as T;
    }, [client, getAuthToken]);
}

/** The message an error answer carries: `{ error: { message } }`, or `{ message }`. */
function errorMessageOf(body: unknown): string | undefined {
    if (typeof body !== "object" || body === null) return undefined;
    const error = "error" in body ? body.error : undefined;
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && error.message) {
        return error.message;
    }
    return "message" in body && typeof body.message === "string" && body.message ? body.message : undefined;
}
