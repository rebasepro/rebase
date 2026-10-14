/**
 * What one backend holds that a request, a socket, a cron run or a script has
 * to ask *that* backend for — its keys, its roles and scopes, its rate-limit
 * counts, its API keys, its collections.
 *
 * Every backend built by `createRebaseBackend` has its own, on
 * `backend.services`, and its route groups put them on each request
 * (`c.var.services`) before anything else runs. Nothing here is process state:
 * two backends in one process are two sets of these, and a token, a key or a
 * count in one means nothing to the other.
 *
 * The module-level API — `verifyAccessToken`, `getAccessModel`,
 * `verifyCredential`, the auth limiters — answers for the process default
 * instead, which `initializeRebaseBackend` (or `setDefaultBackend`) installs.
 *
 * Types only, so the request-path modules that read `c.var.services` can name
 * the shape without importing anything.
 *
 * @module
 */
import type { AuthAdapter, CollectionConfig, QueueRuntime, TopicRuntime } from "@rebasepro/types";
import type { JwtService } from "../auth/jwt";
import type { AccessControl } from "../auth/access";
import type { AuthLimiters } from "../auth/rate-limiter";
import type { RateLimitStore } from "../auth/rate-limit-store";
import type { ApiKeyStore } from "../auth/api-keys/api-key-store";

export interface BackendServices {
    /**
     * Signs and verifies this backend's tokens: sessions, download links, MFA
     * challenges, MCP grants. Its own when `auth.jwtSecret` gave it one; a
     * backend given none signs with the process default's (`configureJwt`).
     */
    jwt: JwtService;
    /** The roles and scopes this backend serves, and how a personal key finds its owner. */
    access: AccessControl;
    /** The auth routes' rate limiters — login, reset, OTP, MFA — counting in this backend's store. */
    authLimiters: AuthLimiters;
    /**
     * The store this backend shares its rate-limit counts in across replicas —
     * SQL, or `rateLimit.store` — when it has one.
     */
    rateLimitStore?: RateLimitStore;
    /** Where this backend keeps its API keys (`rk_`), when it keeps any. */
    apiKeyStore?: ApiKeyStore;
    /**
     * How this backend judges a session — whether it was revoked, whether its
     * account still exists, and the roles the account holds now: its auth
     * adapter, the built-in auth when `auth` is a config object, the app's own
     * when it is an adapter. Every door the backend serves asks it, and so does
     * `backend.verifyCredential`. Absent on a backend with no `auth`.
     */
    authAdapter?: AuthAdapter;
    /** The collections this backend serves, as they are now — a live schema edit included. */
    collections(): readonly CollectionConfig[];
    /**
     * How this backend publishes to the topics `config/resources.ts` declares,
     * into its own job queue. Absent when it declares none.
     */
    topics?: TopicRuntime;
    /** How this backend enqueues on its declared queues. Absent when it declares none. */
    queues?: QueueRuntime;
}
