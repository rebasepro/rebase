import React, { lazy, useMemo } from "react";
import type { ComponentRef, LazyComponentRef } from "@rebasepro/types";
import { isLazyComponentRef } from "@rebasepro/types";

/**
 * Internal cache for resolved lazy components.
 *
 * `React.lazy()` must return the SAME wrapper across renders — if we call
 * `lazy(loader)` on every render, React will treat each result as a new
 * component type and unmount/remount on each render cycle.
 *
 * This WeakMap keeps a stable mapping from a `ComponentRef` (object/function)
 * to the `React.lazy()` wrapper it produced. Strings are keyed by a separate
 * plain Map since they can't be WeakMap keys.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazyCache = new WeakMap<object | Function, React.ComponentType<any>>();

/**
 * Resolves a `ComponentRef` into a renderable `React.ComponentType`.
 *
 * This hook handles all three forms of `ComponentRef`:
 *
 * 1. **`LazyComponentRef`** (produced by the Vite plugin from string paths):
 *    Wraps the lazy loader with `React.lazy()` for automatic code-splitting.
 *
 * 2. **`() => Promise<{ default: ComponentType }>`** (manual lazy import):
 *    Also wraps with `React.lazy()`. Distinguished from regular components
 *    by checking that the function has no parameters and is not a known
 *    React internal (no `$$typeof`).
 *
 * 3. **Direct `React.ComponentType`**:
 *    Returned as-is.
 *
 * If the ref is `undefined` or a raw string (which should never happen at
 * runtime in the browser since the Vite plugin transforms strings), returns `undefined`.
 *
 * The returned component is stable across re-renders as long as the `ref`
 * is referentially stable.
 *
 * **Usage:** Wrap the rendered component in `<Suspense>` to handle the
 * loading state of lazy components.
 *
 * @example
 * ```tsx
 * const ResolvedField = useResolvedComponent(property.ui?.Field);
 * if (!ResolvedField) return null;
 * return (
 *     <Suspense fallback={<CircularProgress />}>
 *         <ResolvedField {...fieldProps} />
 *     </Suspense>
 * );
 * ```
 * */
export function useResolvedComponent<P = unknown>(
    ref: ComponentRef<P> | undefined
): React.ComponentType<P> | undefined {
    return useMemo(() => resolveComponentRef(ref), [ref]);
}

/**
 * Wraps a loader function with `React.lazy()`, caching the result so the
 * same loader always returns the same lazy component identity.
 */
function getOrCreateLazy<P>(
    key: object | Function,
    loader: () => Promise<{ default: React.ComponentType<P> }>
): React.ComponentType<P> {
    const cached = lazyCache.get(key);
    if (cached) return cached as React.ComponentType<P>;

    // SAFETY: React.lazy returns LazyExoticComponent which is structurally compatible with ComponentType<P>
    const LazyComponent = lazy(loader) as React.ComponentType<P>;
    lazyCache.set(key, LazyComponent);
    return LazyComponent;
}

/**
 * Pure function version of the resolver, for use outside React components.
 * Same resolution logic as `useResolvedComponent`.
 *
 * Results are cached per reference identity — calling this multiple times
 * with the same `ref` object returns the same `React.ComponentType`.
 */
export function resolveComponentRef<P = unknown>(
    ref: ComponentRef<P> | undefined
): React.ComponentType<P> | undefined {
    if (ref == null) return undefined;

    // 1. String — should not happen at runtime (Vite transforms them).
    //    Log a warning and bail out.
    if (typeof ref === "string") {
        console.warn(
            `[Rebase] Encountered a raw string ComponentRef ("${ref}") at runtime. ` +
            "This usually means the Vite transform plugin did not process this file. " +
            "Ensure the file is inside the configured collectionsDir."
        );
        return undefined;
    }

    // 2. LazyComponentRef — produced by the Vite plugin from string paths.
    //    The object has { __rebaseLazy: true, load: () => import(...) }.
    if (isLazyComponentRef(ref)) {
        return getOrCreateLazy<P>(
            ref as object,
            () => (ref as LazyComponentRef<P>).load()
        );
    }

    // 3. Function — either a React component or a lazy import loader.
    if (typeof ref === "function") {
        const fn = ref as Function;

        // Class components (React.Component / PureComponent) have this flag
        if (fn.prototype?.isReactComponent) {
            return ref as React.ComponentType<P>;
        }

        // React internals (forwardRef, memo, etc.) carry $$typeof
        if ("$$typeof" in fn) {
            return ref as React.ComponentType<P>;
        }

        // A function with declared parameters (fn.length > 0) is a regular
        // component that accepts props — return as-is.
        if (fn.length > 0) {
            return ref as React.ComponentType<P>;
        }

        // Zero-parameter function — could be a React component with no props
        // OR a lazy loader `() => import(...)`. We distinguish by checking
        // if `fn.name` looks like a component (starts with uppercase) or is
        // an anonymous arrow.
        //
        // Convention: named function components always start with an
        // uppercase letter. Dynamic import wrappers are typically anonymous
        // arrows or have lowercase names.
        const name = fn.name;
        if (name && /^[A-Z]/.test(name)) {
            // Named component (e.g. `function MyField() { ... }`) — return as-is
            return ref as React.ComponentType<P>;
        }

        // Treat as a lazy loader — wrap with React.lazy, cached by identity.
        return getOrCreateLazy<P>(
            fn,
            ref as () => Promise<{ default: React.ComponentType<P> }>
        );
    }

    // 4. React wrapper objects (React.forwardRef, React.memo) —
    //    These are objects with $$typeof but are not functions.
    if (typeof ref === "object" && "$$typeof" in (ref as object)) {
        return ref as unknown as React.ComponentType<P>;
    }

    // 5. Unknown shape — return undefined to be safe
    return undefined;
}
