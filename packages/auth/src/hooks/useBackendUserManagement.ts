import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@rebasepro/types";

/**
 * UserManagement interface - compatible with @rebasepro/user_management
 * Defined inline to avoid dependency on that package
 */
export interface UserManagement<USER extends User = User> {
    loading: boolean;
    hasAdminUsers?: boolean;

    users: USER[];
    saveUser: (user: USER) => Promise<USER>;
    createUser?: (user: USER) => Promise<{
        user: USER;
        invitationSent: boolean;
        temporaryPassword?: string;
    }>;
    resetPassword?: (user: USER) => Promise<{
        user: USER;
        invitationSent: boolean;
        temporaryPassword?: string;
    }>;
    deleteUser: (user: USER) => Promise<void>;

    isAdmin?: boolean;
    allowDefaultRolesCreation?: boolean;
    defineRolesFor: (user: User) => Promise<string[] | undefined> | string[] | undefined;
    getUser: (uid: string) => User | null;

    /**
     * Search users with server-side pagination.
     * When provided, the CMS will use this for the users table
     * instead of loading all users into memory.
     */
    searchUsers?: (options: {
        search?: string;
        limit?: number;
        offset?: number;
        orderBy?: string;
        orderDir?: "asc" | "desc";
        roleId?: string;
    }) => Promise<{ users: USER[]; total: number }>;

    usersError?: Error;
    bootstrapAdmin?: () => Promise<void>;
}

export interface BackendUserManagementConfig {
    /**
     * The Rebase Client instance
     */
    client?: { baseUrl?: string; resolveToken?: () => Promise<string | null> };

    /**
     * Base API URL for the backend (optional, extracted from client if not provided)
     */
    apiUrl?: string;

    /**
     * Function to get the current auth token (optional, extracted from client if not provided)
     */
    getAuthToken?: () => Promise<string>;

    /**
     * Current logged-in user
     */
    currentUser?: User | null;
}

interface ApiUser {
    uid: string;
    email: string;
    displayName?: string | null;
    photoURL?: string | null;
    roles: string[];
    createdAt?: string;
    updatedAt?: string;
}

/** Response shapes from the admin API */
interface ApiUsersResponse { users: ApiUser[]; total: number }
interface ApiUserResponse { user: ApiUser; invitationSent?: boolean; temporaryPassword?: string }

/**
 * Convert API user to Rebase User
 * @param apiUser - The API user object
 */
function convertUser(apiUser: ApiUser): User {
    return {
        uid: apiUser.uid,
        email: apiUser.email,
        displayName: apiUser.displayName || null,
        photoURL: apiUser.photoURL || null,
        providerId: "custom",
        isAnonymous: false,
        roles: apiUser.roles,
        createdAt: apiUser.createdAt ? new Date(apiUser.createdAt) : null
    } as User;
}

/**
 * Hook to manage users and roles via backend API
 * Compatible with Rebase UserManagement interface
 */
export function useBackendUserManagement(config: BackendUserManagementConfig): UserManagement {
    const { client, apiUrl, getAuthToken, currentUser } = config;

    // Lazy user cache — populated on demand from search results, saves, and
    // individual API lookups.  We never load ALL users into memory.
    const [userCache, setUserCache] = useState<Map<string, User>>(new Map());
    const [hasAdminUsers, setHasAdminUsers] = useState(false);
    const userRoles = currentUser?.roles ?? [];
    const isUserAdmin = userRoles.some(r => r === "admin" || r === "schema-admin");

    const [loading, setLoading] = useState(() => {
        if (!currentUser) return false;
        if (!isUserAdmin) return false;
        return true;
    });
    const [usersError, setUsersError] = useState<Error | undefined>();

    // Tracks the UID for which roles+users were last successfully loaded.
    // Prevents redundant refetches on React StrictMode double-mounts.
    const lastLoadedUidRef = useRef<string | null>(null);

    const effectiveLoading = loading || !!(currentUser && isUserAdmin && lastLoadedUidRef.current !== currentUser.uid);

    /** Merge one or more users into the cache without replacing the whole Map. */
    const mergeIntoCache = useCallback((incoming: User[]) => {
        setUserCache(prev => {
            const next = new Map(prev);
            for (const u of incoming) {
                next.set(u.uid, u);
            }
            return next;
        });
    }, []);

    // Ref to hold the latest apiRequest so the initial-load effect doesn't
    // re-trigger every time the callback identity changes.
    const apiRequestRef = useRef<typeof apiRequest | null>(null);

    /**
     * Make authenticated API request
     */
    const apiRequest = useCallback(async <T = Record<string, unknown>>(
        endpoint: string,
        method = "GET",
        body?: Record<string, unknown>,
        retryCount = 6,
        signal?: AbortSignal
    ): Promise<T> => {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < retryCount; attempt++) {
            if (signal?.aborted) {
                const error = new Error("Request aborted");
                error.name = "AbortError";
                throw error;
            }

            try {
                // Determine token provider
                const token = getAuthToken ? await getAuthToken() : (client?.resolveToken ? await client.resolveToken() : null);
                const baseUrl = apiUrl || (client?.baseUrl ? client.baseUrl : "");

                // Use /api/admin prefix for admin endpoints
                const response = await fetch(`${baseUrl}/api/admin${endpoint}`, {
                    method,
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { "Authorization": `Bearer ${token}` } : {})
                    },
                    body: body ? JSON.stringify(body) : undefined,
                    signal
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    let errorMessage = "API request failed";
                    try {
                        const errorJson = JSON.parse(errorText);
                        errorMessage = errorJson.error?.message || errorMessage;
                    } catch (e) {
                        errorMessage = errorText || `HTTP error ${response.status}`;
                    }

                    const error = Object.assign(new Error(errorMessage), { status: response.status });
                    throw error;
                }

                return await response.json();
            } catch (error: unknown) {
                if (error instanceof Error && error.name === "AbortError" || signal?.aborted) {
                    throw error;
                }

                lastError = error instanceof Error ? error : new Error(String(error));

                // Retry conditions: Network errors (TypeError) OR 5xx Server Errors (Backend rebooting)
                const isNetworkError = error instanceof TypeError;
                const isServerError = typeof (error as { status?: number }).status === "number" && (error as { status: number }).status >= 500 && (error as { status: number }).status < 600;

                if (attempt < retryCount - 1 && (isNetworkError || isServerError)) {
                    const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // 1s, 2s, 4s...
                    console.warn(`Admin API request to ${endpoint} failed, retrying in ${delay}ms...`);

                    // Wait for delay or abort
                    await new Promise<void>((resolve, reject) => {
                        if (signal?.aborted) return reject(new Error("AbortError"));
                        const timer = setTimeout(resolve, delay);
                        if (signal) {
                            signal.addEventListener("abort", () => {
                                clearTimeout(timer);
                                reject(new Error("AbortError"));
                            }, { once: true });
                        }
                    }).catch(() => {}); // Catch AbortError from wait

                    if (signal?.aborted) {
                        const abortError = new Error("Request aborted");
                        abortError.name = "AbortError";
                        throw abortError;
                    }
                    continue;
                }

                console.error("Admin API error after retries:", error);
                throw error;
            }
        }
        throw lastError;
    }, [apiUrl, getAuthToken]);

    // Keep the ref in sync after every render.
    apiRequestRef.current = apiRequest;



    /**
     * Lightweight admin-existence check: fetch a single admin user.
     * Used by the BootstrapAdminBanner to decide whether to show.
     */
    const checkAdminExists = useCallback(async (signal?: AbortSignal) => {
        try {
            const data = await apiRequest<ApiUsersResponse>("/users?role=admin&limit=1", "GET", undefined, 6, signal);
            const adminUsers: User[] = data.users.map((u: ApiUser) => convertUser(u));
            setHasAdminUsers(adminUsers.length > 0);
            // Also cache these admin users for getUser lookups
            if (adminUsers.length > 0) {
                mergeIntoCache(adminUsers);
            }
            setUsersError(undefined);
        } catch (error: unknown) {
            if (error instanceof Error && error.name === "AbortError") return;
            console.error("Failed to check admin users:", error);
            setUsersError(error instanceof Error ? error : new Error(String(error)));
        }
    }, [apiRequest, mergeIntoCache]);

    /**
     * Initial data load - only when user is logged in
     * Load roles first, then admin users.
     *
     * Dependencies are intentionally limited to `currentUser?.uid` so the
     * effect does NOT re-run when callback identities change.  The latest
     * `apiRequest` is read via `apiRequestRef`.
     */
    useEffect(() => {
        // Don't load if no user is logged in
        if (!currentUser) {
            setLoading(false);
            return;
        }

        // Skip admin API calls for non-admin users — they'd get 403 anyway.
        // This avoids a spurious warning in backend logs on every non-admin login.
        const userRoles = currentUser.roles ?? [];
        const isUserAdmin = userRoles.some(r => r === "admin" || r === "schema-admin");
        if (!isUserAdmin) {
            setLoading(false);
            return;
        }

        // Skip refetch if we already loaded data for this same UID
        // (e.g. React StrictMode unmounts and re-mounts with the same user).
        if (lastLoadedUidRef.current === currentUser.uid) {
            setLoading(false);
            return;
        }

        const abortController = new AbortController();

        const load = async () => {
            setLoading(true);
            const request = apiRequestRef.current!;

            // Lightweight admin-existence check (NOT loading all users)
            if (!abortController.signal.aborted) {
                try {
                    const data = await request<ApiUsersResponse>("/users?role=admin&limit=1", "GET", undefined, 6, abortController.signal);
                    const adminUsers: User[] = data.users.map((u: ApiUser) => convertUser(u));
                    setHasAdminUsers(adminUsers.length > 0);
                    if (adminUsers.length > 0) {
                        mergeIntoCache(adminUsers);
                    }
                    setUsersError(undefined);
                } catch (error: unknown) {
                    if (error instanceof Error && error.name === "AbortError") return;
                    console.error("Failed to check admin users:", error);
                    setUsersError(error instanceof Error ? error : new Error(String(error)));
                }
            }

            if (!abortController.signal.aborted) {
                lastLoadedUidRef.current = currentUser.uid;
                setLoading(false);
            }
        };
        load();

        return () => {
            abortController.abort();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.uid]);

    /**
     * Search users with server-side pagination.
     * This is the primary method used by the UsersView table.
     * Results are also merged into the cache for getUser lookups.
     */
    const searchUsers = useCallback(async (options: {
        search?: string;
        limit?: number;
        offset?: number;
        orderBy?: string;
        orderDir?: "asc" | "desc";
        roleId?: string;
    }): Promise<{ users: User[]; total: number }> => {
        const params = new URLSearchParams();
        if (options.limit !== undefined) params.set("limit", String(options.limit));
        if (options.offset !== undefined) params.set("offset", String(options.offset));
        if (options.search) params.set("search", options.search);
        if (options.orderBy) params.set("orderBy", options.orderBy);
        if (options.orderDir) params.set("orderDir", options.orderDir);
        if (options.roleId) params.set("role", options.roleId);
        const qs = params.toString();

        const data = await apiRequest<ApiUsersResponse>("/users" + (qs ? "?" + qs : ""), "GET");
        const converted = data.users.map((u: ApiUser) => convertUser(u));
        // Feed search results into cache for getUser/defineRolesFor
        mergeIntoCache(converted);
        return {
            users: converted,
            total: data.total
        };
    }, [apiRequest, mergeIntoCache]);

    /**
     * Save user (update existing user)
     */
    const saveUser = useCallback(async (user: User): Promise<User> => {
        const roleIds = user.roles ?? [];

        const data = await apiRequest<ApiUserResponse>(`/users/${user.uid}`, "PUT", {
            email: user.email,
            displayName: user.displayName,
            roles: roleIds
        });
        const updated = convertUser(data.user);
        mergeIntoCache([updated]);
        return updated;
    }, [apiRequest, mergeIntoCache]);

    /**
     * Create a new user with invitation/password generation support.
     * Returns additional info about how credentials were delivered.
     */
    const createUser = useCallback(async (user: User): Promise<{
        user: User;
        invitationSent: boolean;
        temporaryPassword?: string;
    }> => {
        const roleIds = user.roles ?? [];

        const data = await apiRequest<ApiUserResponse>("/users", "POST", {
            email: user.email,
            displayName: user.displayName,
            roles: roleIds
        });
        const created = convertUser(data.user);
        mergeIntoCache([created]);
        return {
            user: created,
            invitationSent: data.invitationSent ?? false,
            temporaryPassword: data.temporaryPassword
        };
    }, [apiRequest, mergeIntoCache]);

    /**
     * Reset the password for an existing user
     */
    const resetPassword = useCallback(async (user: User): Promise<{
        user: User;
        invitationSent: boolean;
        temporaryPassword?: string;
    }> => {
        const data = await apiRequest<ApiUserResponse>(`/users/${user.uid}/reset-password`, "POST");
        const updatedUser = convertUser(data.user);
        mergeIntoCache([updatedUser]);
        return {
            user: updatedUser,
            invitationSent: data.invitationSent ?? false,
            temporaryPassword: data.temporaryPassword
        };
    }, [apiRequest, mergeIntoCache]);

    /**
     * Delete user
     */
    const deleteUser = useCallback(async (user: User): Promise<void> => {
        await apiRequest(`/users/${user.uid}`, "DELETE");
        setUserCache(prev => {
            const next = new Map(prev);
            next.delete(user.uid);
            return next;
        });
    }, [apiRequest]);



    /**
     * Get user by uid
     */
    const getUser = useCallback((uid: string): User | null => {
        return userCache.get(uid) ?? null;
    }, [userCache]);

    /**
     * Define roles for a given user (for authController)
     */
    const defineRolesFor = useCallback(async (user: User): Promise<string[] | undefined> => {
        // Check cache first
        let existingUser = userCache.get(user.uid)
            ?? Array.from(userCache.values()).find(u => u.email === user.email);

        // If not cached, fetch from API
        if (!existingUser) {
            try {
                const data = await apiRequest<ApiUserResponse>(`/users/${user.uid}`, "GET");
                existingUser = convertUser(data.user);
                mergeIntoCache([existingUser]);
            } catch {
                return undefined;
            }
        }

        // Return role IDs as simple strings
        const userRoleIds = existingUser.roles ?? [];
        return userRoleIds;
    }, [userCache, apiRequest, mergeIntoCache]);

    /**
     * Check if current user is admin
     */
    const isAdmin = currentUser?.roles?.includes("admin") ?? false;


    /**
     * Bootstrap default admin
     */
    const bootstrapAdmin = useCallback(async (): Promise<void> => {
        try {
            await apiRequest("/bootstrap", "POST");
            // Re-check admin existence after successful bootstrap
            await checkAdminExists();
        } catch (error) {
            console.error("Failed to bootstrap admin:", error);
            throw error;
        }
    }, [apiRequest, checkAdminExists]);

    // Expose cached users as an array for backward compat (BootstrapAdminBanner,
    // UsersView fallback).  This is NOT the full user list — just the cache.
    const users = Array.from(userCache.values());

    return {
        loading: effectiveLoading,
        users,
        hasAdminUsers,
        saveUser,
        createUser,
        resetPassword,
        deleteUser,
        isAdmin,
        allowDefaultRolesCreation: isAdmin,
        defineRolesFor,
        getUser,
        searchUsers,
        usersError,
        bootstrapAdmin
    };
}
