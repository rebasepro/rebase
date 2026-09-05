import { useState, useEffect, useCallback, useMemo } from "react";
import { client } from "./client";
import type { User, RebaseSession } from "@rebasepro/client";

// ===== Auth Hook =====
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Wait for the client to finish restoring a session before deciding there
    // is none. `getSession()` is synchronous and answers `null` while a restore
    // is still in flight — which is always, on the first render of a cookie-mode
    // app: the refresh token is in an HttpOnly cookie the page cannot read, so
    // the client has to ask the server. Reading it synchronously rendered the
    // signed-out view for one round trip on every reload.
    client.auth.isInitialized().then(() => {
      if (cancelled) return;
      const session: RebaseSession | null = client.auth.getSession();
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Subscribe to auth changes
    const unsubscribe = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setUser(session?.user ?? null);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await client.auth.signInWithEmail(email, password);
    setUser(result.user);
    return result;
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    const result = await client.auth.signUp(email, password, displayName);
    setUser(result.user);
    return result;
  }, []);

  const signOut = useCallback(async () => {
    await client.auth.signOut();
    setUser(null);
  }, []);

  return { user,
loading,
signIn,
signUp,
signOut };
}

// ===== Collection Hook =====
type FindParams = NonNullable<Parameters<ReturnType<typeof client.data.collection>["find"]>[0]>;

/**
 * A live query.
 *
 * `observe()` emits from the local row database before any request goes out,
 * then re-emits on every change to the rows it covers — this app's own writes,
 * queued writes reaching the server, rollbacks, and changes pushed over
 * realtime. So none of the mutation handlers below need to refetch.
 */
export function useCollection(
  slug: string,
  options?: { limit?: number; page?: number; orderBy?: FindParams["orderBy"]; where?: FindParams["where"] }
) {
  const [data, setData] = useState<any[]>([]);
  const [meta, setMeta] = useState({ total: 0,
limit: 20,
offset: 0,
hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);

  const limit = options?.limit ?? 20;
  const page = options?.page ?? 1;
  const offset = (page - 1) * limit;
  const where = JSON.stringify(options?.where);

  const params = useMemo(() => ({
    limit,
    offset,
    orderBy: options?.orderBy,
    where: options?.where
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [limit, offset, options?.orderBy, where]);

  useEffect(() => {
    // No loading reset here: switching collections remounts this view (the
    // list is keyed by slug), and a page change re-emits from the local
    // database immediately, so there is nothing to wait behind.
    const unsubscribe = client.data.collection(slug).observe(
      params,
      (result) => {
        setData(result.data);
        setMeta(result.meta);
        setFromCache(result.fromCache);
        setHasPendingWrites(result.hasPendingWrites);
        setError(null);
        setLoading(false);
      },
      (err: Error) => {
        setError(err.message || "Failed to fetch data");
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [slug, params]);

  const refetch = useCallback(
    () => client.data.collection(slug).find(params).catch(() => undefined),
    [slug, params]
  );

  return { data,
meta,
loading,
error,
fromCache,
hasPendingWrites,
refetch };
}

// ===== Offline Status Hook =====
export function useOfflineStatus() {
  const [status, setStatus] = useState(() => client.offline!.status());
  useEffect(() => client.offline!.onStatusChange(setStatus), []);
  return status;
}
