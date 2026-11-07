/**
 * The storage the admin panel's file fields and previews ask, in a view that
 * can fetch nothing of its own.
 *
 * A field that stores a file holds its path, and a preview asks the storage
 * source for an address to draw it from — a customer's avatar beside their
 * name, in every row that points at them. With no storage source that asked
 * nothing and threw. Here an address the field already holds is its own
 * address (the host may still refuse to load it, and the preview then shows
 * its placeholder); a path names nothing the view can reach, and draws as a
 * file that is not there. Nothing is uploaded or deleted from here.
 */
import type { StorageSource } from "@rebasepro/types";

const UNAVAILABLE = "Files cannot be uploaded or removed from this view. Open the project's admin panel to change them.";

export const VIEW_STORAGE_SOURCE: StorageSource = {
    async getSignedUrl(keyOrUrl) {
        return /^https?:\/\//i.test(keyOrUrl) ? { url: keyOrUrl } : { url: null, fileNotFound: true };
    },
    async getObject() {
        return null;
    },
    async putObject() {
        throw new Error(UNAVAILABLE);
    },
    async deleteObject() {
        throw new Error(UNAVAILABLE);
    },
    async listObjects() {
        return { prefixes: [], items: [] };
    }
};
