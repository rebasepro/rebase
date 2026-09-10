/**
 * Globals this site puts on `window`, and the one Google Analytics puts there.
 *
 * Declared rather than reached with `(window as any)`, which is how all four of
 * them were read. `any` on the *object* silences everything downstream, not just
 * the property that is genuinely unknown: `(window as any).gtag(...)` checks
 * neither that `gtag` exists nor what it is called with, and
 * `(window as any).pageObserver.disconnect()` was one typo away from a runtime
 * error no build would report. Each of these is optional here because each is
 * genuinely absent until something sets it — GA4 until its snippet loads, and
 * the rest until their own module runs.
 */
declare global {
    interface Window {
        /**
         * GA4's command queue function. Absent when the snippet has not loaded,
         * or was declined — every call site tests for it first.
         *
         * Typed loosely on purpose: `gtag` is variadic over several unrelated
         * command shapes ("event", "config", "consent", …) and this site only
         * ever sends events. The looseness is in the *arguments*, which is where
         * Google's own contract is loose, rather than on `window`.
         */
        gtag?: (...args: unknown[]) => void;

        /** The scroll/reveal observer, kept so a re-run can disconnect the old one. */
        pageObserver?: IntersectionObserver;

        /** The analytics singleton, so a second script load does not build a second. */
        __rb_analytics?: unknown;

        /** Exposed for inline `onclick` handlers in page markup. */
        getVariant?: (experimentId: string) => string | null;
        /** Exposed for inline `onclick` handlers in page markup. */
        trackConversion?: (experimentId: string, action: string) => void;
    }
}

export {};
