/**
 * The two principals a storage read can be granted without a user: the reader
 * of a declared-public object, and the bearer of a download token.
 *
 * `checkAuthorized` does not ask the `storageAuthorize` hook about either — the
 * public prefix and the token are the authorization. That skip used to be
 * decided on the principal's `uid` string (`"public"`, `"download-token"`), so
 * any identity carrying that uid skipped the hook: a custom `AuthAdapter` whose
 * `verifyRequest` returns `{ uid: "public" }` for a guest could then upload,
 * delete and list anywhere, with the hook never asked.
 *
 * Each principal is now one object, set only by the middleware that granted
 * it (`publicObjectAuth`, `fileTokenAuth`) and recognised by identity. An
 * adapter builds a new object per request, so it can name the uid but never be
 * the grant.
 */

/** The principal `publicObjectAuth` grants an anonymous read of a public object. */
export const PUBLIC_OBJECT_PRINCIPAL: { readonly uid: string; readonly roles: string[] } = Object.freeze({
    uid: "public",
    roles: ["public"]
});

/** The principal `fileTokenAuth` grants a read covered by a valid download token. */
export const DOWNLOAD_TOKEN_PRINCIPAL: { readonly uid: string; readonly roles: string[] } = Object.freeze({
    uid: "download-token",
    roles: ["reader"]
});

/** Whether `user` is the grant `publicObjectAuth` made — the object, not the uid. */
export function isPublicObjectGrant(user: unknown): boolean {
    return user === PUBLIC_OBJECT_PRINCIPAL;
}

/** Whether `user` is the grant `fileTokenAuth` made — the object, not the uid. */
export function isDownloadTokenGrant(user: unknown): boolean {
    return user === DOWNLOAD_TOKEN_PRINCIPAL;
}
