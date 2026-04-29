import { User } from "../users";
import { RebaseData } from "./data";
import { EmailService } from "./email";

/**
 * Event type for authentication state changes
 */
export type AuthChangeEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED';

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
    
    // Extensible for backend implementations
    [key: string]: any;
}

/**
 * Overarching abstraction that unites Data, Auth, Storage, and Email.
 * Adapters for Supabase or Firebase simply need to implement this interface.
 */
export interface RebaseClient<DB = any> {
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
    
    /** Optional admin panel specific tasks */
    admin?: any;
    
    // Generic extensibility
    [key: string]: any;
}
