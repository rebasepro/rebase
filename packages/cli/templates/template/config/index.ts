/**
 * Shared collections index file
 * Collections defined here are used by both the frontend and backend
 */

export { collections } from "./collections/index.js";

// Who may read, write, delete and list files in storage. Exported from here
// because that is where the runtime and `rebase cloud deploy` look for it — the
// bundle manifest records whether this export exists, so a managed deploy can be
// refused with a readable message instead of turning into a boot crash-loop.
export { storageAuthorize } from "./storage.js";
