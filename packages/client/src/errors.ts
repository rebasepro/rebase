/**
 * Client-side logic error (e.g. accessing an unknown collection when a typed
 * dictionary is available). A subclass of {@link RebaseApiError}, so a single
 * `catch (e) { if (e instanceof RebaseApiError) ... }` covers it too.
 *
 * The canonical definition now lives in `@rebasepro/types`; re-exported here to
 * preserve the historical `import { RebaseClientError } from ".../errors"` path.
 */
export { RebaseClientError } from "@rebasepro/types";
