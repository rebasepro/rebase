import { isPublicStoragePath, type StorageAuthorize } from "@rebasepro/types";

/**
 * Who may do what to files in storage.
 *
 * Storage is **not** under row-level security. Collections are: a request runs as
 * `rebase_user` and Postgres decides row by row. Object storage has no equivalent,
 * so keys share one flat namespace and this hook is the whole authorization model.
 * Without it the server refuses to boot in production, because "authenticated"
 * would be the only thing standing between a signed-in visitor and every file in
 * the bucket — they could `GET /storage/list?prefix=` to enumerate every key, then
 * read, overwrite or delete any of them.
 *
 * ## The model this starter ships
 *
 * A CMS's files are **shared content**, not private per-user documents: hero
 * images, author pictures, product photos. The collections in this template upload
 * to `author_pictures/`, `posts/hero/`, `product_images/` — paths named after the
 * content, not after a user. So the boundary that matters here is not *whose file
 * is this* but *who is allowed to change the library*:
 *
 * | operation | who |
 * | --- | --- |
 * | `read` of `public/…` | anyone, signed in or not |
 * | `read` | any signed-in user — it is content, and the admin panel renders it |
 * | `write`, `delete`, `list` | `admin` or `editor` only |
 *
 * Gating `list` is the important half. Enumeration is what turns "keys are hard to
 * guess" into "keys are trivially known", and it is the first step of the attack
 * the boot guard exists to prevent.
 *
 * ## If your app is multi-tenant, replace this
 *
 * Per-user or per-tenant files need an **ownership** check, and ownership lives in
 * a row rather than in a key — so `ctx.data` hands you trusted, RLS-bypassing read
 * access to answer it:
 *
 * ```ts
 * export const storageAuthorize: StorageAuthorize = async ({ key, user, operation, data }) => {
 *     if (operation === "read" && isPublicStoragePath(key)) return true;
 *     if (!user) return false;
 *
 *     // Writes land under the caller's own prefix.
 *     if (operation === "write") return key.startsWith(`users/${user.uid}/`);
 *     if (operation === "list") return key.startsWith(`users/${user.uid}/`);
 *
 *     // Reads and deletes check the row that owns the object.
 *     const attachment = (await data?.collection("attachments").find({
 *         where: { storage_key: ["==", key] }, limit: 1
 *     }))?.data?.[0];
 *     return attachment?.owner_id === user.uid;
 * };
 * ```
 *
 * Note that a prefix rule alone is not an access-control model for reads — it only
 * works because a write *puts* the object there. Anything already in the bucket
 * needs the row consulted.
 *
 * The two escape hatches, if you would rather not write a hook at all:
 * `storagePublicRead: true` when the bucket genuinely is a public read-only CDN,
 * or `storageInsecureAllowAnyAuthenticated: true` for a single-tenant app where
 * every signed-in user is trusted with every file. Both are set on
 * `initializeRebaseBackend`, which this project does not call: the published
 * runtime boots it. `rebase eject` writes that entry point if you want one.
 */
export const storageAuthorize: StorageAuthorize = ({ key, user, operation }) => {
    // The `public/` prefix is the framework's convention for world-readable
    // objects, and it is what signed download URLs for public assets rely on.
    if (operation === "read" && isPublicStoragePath(key)) {
        return true;
    }

    // Everything else needs a caller. `user` is null on routes that allow
    // unauthenticated access, so this is the anonymous denial.
    if (!user) {
        return false;
    }

    // Content is shared: any signed-in user may read it. A `viewer` has to be able
    // to see the images the admin panel shows them.
    if (operation === "read") {
        return true;
    }

    // Changing or enumerating the library is an editor's job. Matches the roles in
    // `collections/users.ts` — widen this if you add your own.
    const roles = user.roles ?? [];
    return roles.includes("admin") || roles.includes("editor");
};
