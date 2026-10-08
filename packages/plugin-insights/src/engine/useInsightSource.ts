import { useEffect, useState } from "react";
import { useAuthController } from "@rebasepro/app";
import { useInsightsEngine } from "./InsightsProvider";
import { sourceCacheKey, type SourceResult } from "./InsightsEngine";

interface Settled {
    key: string;
    result: SourceResult | null;
    error: Error | null;
}

/**
 * Reads one source for the signed-in user.
 *
 * Waits for auth to settle: a source runs under the caller's permissions, so
 * fetching before the user is known would compute the figures for nobody.
 */
export function useInsightSource(sourceId: string): {
    result: SourceResult | null;
    loading: boolean;
    error: Error | null;
} {
    const engine = useInsightsEngine();
    const { initialLoading, authLoading, user, loginSkipped } = useAuthController();
    const authReady = !initialLoading && !authLoading && (Boolean(user) || loginSkipped);
    const userId = user?.uid ?? null;
    const key = sourceCacheKey(sourceId, userId);

    const [settled, setSettled] = useState<Settled | null>(null);

    useEffect(() => {
        if (!authReady || !engine) return;

        let cancelled = false;
        engine.load(sourceId, userId).then(
            (result) => {
                if (!cancelled) setSettled({ key, result, error: null });
            },
            (error: unknown) => {
                if (!cancelled) setSettled({ key, result: null, error: error instanceof Error ? error : new Error(String(error)) });
            }
        );
        return () => {
            cancelled = true;
        };
    }, [engine, sourceId, userId, key, authReady]);

    // What settled for another source or another user is not this one's.
    const current = settled?.key === key ? settled : null;
    // A cache hit renders on the first pass rather than after a skeleton frame.
    const cached = !current && authReady && engine ? engine.peek(sourceId, userId) : null;

    return {
        result: current?.result ?? cached,
        loading: !current && !cached,
        error: current?.error ?? null
    };
}
