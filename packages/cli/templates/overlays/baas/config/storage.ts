import { isPublicStoragePath, type StorageAuthorize } from "@rebasepro/types";

/**
 * Who may do what to files in storage.
 *
 * Storage is **not** under row-level security. Tables are: a request runs as
 * `rebase_user` and Postgres decides row by row. Object storage has no equivalent,
 * so keys share one flat namespace and this hook is the whole authorization model.
 * Without it the server refuses to boot in production, because "authenticated"
 * would be the only thing between a signed-in caller and every file in the bucket —
 * they can `GET /storage/list?prefix=` to enumerate every key, then read, overwrite
 * or delete any of them.
 *
 * It lives in `backend/src/` rather than a config package because BaaS mode has no
 * config package: collections come from the live database, so there is nothing to
 * declare and nowhere else to put this.
 *
 * ## The default this starter ships
 *
 * A deliberately conservative one, because a BaaS project's storage semantics are
 * whatever *your* application says they are and this file cannot know:
 *
 * | operation | who |
 * | --- | --- |
 * | `read` of `public/…` | anyone, signed in or not |
 * | everything else | a signed-in caller under their own `users/<uid>/` prefix |
 *
 * Gating `list` on the prefix is the important half. Enumeration is what turns "keys
 * are hard to guess" into "keys are known", and it is step one of the attack the
 * boot guard exists to prevent.
 *
 * ## Replace this with your model
 *
 * Prefix rules are a starting point, not a general answer: they work for writes
 * because a write *puts* the object there, but anything already in the bucket needs
 * the row that owns it consulted. `ctx.data` is handed in for exactly that — trusted,
 * RLS-bypassing reads, because the hook *is* the authorization decision and running
 * it through a reader already narrowed by the caller's permissions would be circular:
 *
 * ```ts
 * export const storageAuthorize: StorageAuthorize = async ({ key, user, operation, data }) => {
 *     if (operation === "read" && isPublicStoragePath(key)) return true;
 *     if (!user) return false;
 *     const row = (await data?.collection("attachments").find({
 *         where: { storage_key: ["==", key] }, limit: 1
 *     }))?.data?.[0];
 *     return row?.owner_id === user.uid;
 * };
 * ```
 *
 * If your bucket really is a public read-only CDN, `storagePublicRead: true` says so
 * instead. If every signed-in caller is genuinely trusted with every file,
 * `storageInsecureAllowAnyAuthenticated: true` says *that* — it is named to be read
 * twice. Both are set on `initializeRebaseBackend` in `index.ts`.
 */
export const storageAuthorize: StorageAuthorize = ({ key, user, operation }) => {
    // The `public/` prefix is the framework's convention for world-readable objects.
    if (operation === "read" && isPublicStoragePath(key)) {
        return true;
    }

    // `user` is null on routes that allow unauthenticated access.
    if (!user) {
        return false;
    }

    // Each caller gets their own namespace. A listing is scoped the same way, so a
    // prefix outside it — including the empty prefix, which would enumerate the
    // whole bucket — is denied.
    return key.startsWith(`users/${user.uid}/`);
};
