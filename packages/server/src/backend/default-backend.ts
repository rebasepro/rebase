/**
 * The process default: the backend the module-level API answers for.
 *
 * `rebase` outside any request, `verifyAccessToken` and the other JWT helpers,
 * `getAccessModel`, `verifyCredential`, `extractUserFromToken`, the auth
 * limiters exported as constants, and topics and queues published from code
 * no backend is running. Each is one shallow step above the backend's own
 * services, for code that has no backend in hand — a function file, a script,
 * a test.
 *
 * `initializeRebaseBackend` installs its backend here. `createRebaseBackend`
 * does not: a backend built by hand answers for itself
 * (`backend.services`, `backend.rebase`) and sets nothing anyone else reads,
 * so two of them in one process stay two. Make one of them the default when
 * the process uses the module-level API.
 *
 * @module
 */
import type { RebaseServerClient } from "@rebasepro/types";
import { processJwtService, setDefaultJwtService } from "../auth/jwt";
import { setDefaultAccessControl } from "../auth/access";
import { configureCredentials } from "../auth/verify-credential";
import { configureUserPicking } from "../auth/user-picking";
import { setSharedRateLimitStore } from "../auth/rate-limiter";
import { _initRebase } from "../singleton";
import { setDefaultBackendScope } from "./scope";
import type { BackendServices } from "./services";

/**
 * Make `backend` the process default: what `rebase`, the JWT helpers,
 * `getAccessModel`, `verifyCredential` and topics and queues answer for
 * outside any request a backend is serving.
 *
 * @example
 * ```ts
 * const backend = await createRebaseBackend({ database, auth, collections, provision: true });
 * setDefaultBackend(backend); // `import { rebase } from "@rebasepro/server"` is now this backend, everywhere
 * ```
 */
export function setDefaultBackend(backend: { rebase: RebaseServerClient; services: BackendServices }): void {
    const { services } = backend;
    // A backend given no JWT secret signs with the process default already;
    // installing that as the default would point it at itself.
    if (services.jwt !== processJwtService) setDefaultJwtService(services.jwt);
    setDefaultAccessControl(services.access);
    configureCredentials({ apiKeyStore: services.apiKeyStore, authAdapter: services.authAdapter });
    configureUserPicking(services.collections);
    setSharedRateLimitStore(services.rateLimitStore);
    _initRebase(backend.rebase);
    setDefaultBackendScope({ rebase: backend.rebase, topics: services.topics, queues: services.queues });
}
