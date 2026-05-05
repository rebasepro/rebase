import { User } from "../users";
import { RebaseData } from "./data";
import { EmailService } from "./email";

/**
 * Event type for authentication state changes
 */
export type AuthChangeEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED";

/**
 * Standard session interface representing an authenticated state
 */
export interface RebaseSession {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    user: User;
}

import { StorageSource } from "./storage";

/**
 * Unified Authentication Client Interface
 * Pure functional SDK interface, decoupled from UI and React hooks
 */
export interface AuthClient {
    /**
     * Get the current user from the server or cache
     */
    getUser(): Promise<User | null>;

    /**
     * Get the currently active session
     */
    getSession(): RebaseSession | null;

    /**
     * Sign out the current user and clear local session
     */
    signOut(): Promise<void>;

    /**
     * Subscribe to authentication state changes
     */
    onAuthStateChange(callback: (event: AuthChangeEvent, session: RebaseSession | null) => void): () => void;

    /**
     * Manually refresh the session token
     */
    refreshSession(): Promise<RebaseSession>;
}

/**
 * User record as returned by the Admin API.
 * @group Admin
 */
export interface AdminUser {
    uid: string;
    email: string;
    displayName: string | null;
    photoURL: string | null;
    provider: string;
    roles: string[];
    createdAt: string;
    updatedAt: string;
}

/**
 * Role record as returned by the Admin API.
 * @group Admin
 */
export interface AdminRole {
    id: string;
    name: string;
    isAdmin: boolean;
    defaultPermissions: Record<string, unknown> | null;
    config: Record<string, unknown> | null;
}

/**
 * Client-side Admin API interface.
 * Provides user and role management operations.
 * @group Admin
 */
export interface AdminAPI {
    listUsers(): Promise<{ users: AdminUser[] }>;
    listUsersPaginated(options?: {
        search?: string;
        limit?: number;
        offset?: number;
        orderBy?: string;
        orderDir?: "asc" | "desc";
    }): Promise<{ users: AdminUser[]; total: number; limit: number; offset: number }>;
    getUser(userId: string): Promise<{ user: AdminUser }>;
    createUser(data: { email: string; displayName?: string; password?: string; roles?: string[] }): Promise<{ user: AdminUser }>;
    updateUser(userId: string, data: { email?: string; displayName?: string; password?: string; roles?: string[] }): Promise<{ user: AdminUser }>;
    deleteUser(userId: string): Promise<{ success: boolean }>;
    listRoles(): Promise<{ roles: AdminRole[] }>;
    getRole(roleId: string): Promise<{ role: AdminRole }>;
    createRole(data: { id: string; name: string; isAdmin?: boolean; defaultPermissions?: Record<string, unknown>; config?: Record<string, unknown> }): Promise<{ role: AdminRole }>;
    updateRole(roleId: string, data: { name?: string; isAdmin?: boolean; defaultPermissions?: Record<string, unknown>; config?: Record<string, unknown> }): Promise<{ role: AdminRole }>;
    deleteRole(roleId: string): Promise<{ success: boolean }>;
    bootstrap(): Promise<{ success: boolean; message: string; user: { uid: string; roles: string[] } }>;
}

/**
 * Overarching abstraction that unites Data, Auth, Storage, and Email.
 * Adapters for Supabase or Firebase simply need to implement this interface.
 */
export interface RebaseClient<DB = unknown> {
    /** Unified Data access layer */
    data: RebaseData;

    /** Unified Authentication layer */
    auth: AuthClient;

    /** Unified Storage layer */
    storage?: StorageSource;

    /**
     * Server-side email service.
     *
     * Available when SMTP (or a custom `sendEmail` function) is configured
     * in the backend auth config. `undefined` when email is not configured.
     *
     * > **Note:** This is only available on the server-side `rebase` singleton.
     * > The client-side SDK does not include an email service.
     */
    email?: EmailService;

    /** Admin API for user and role management */
    admin?: AdminAPI;
}
