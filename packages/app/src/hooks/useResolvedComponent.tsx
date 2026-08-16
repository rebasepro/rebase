import React, { useMemo } from "react";
import { lazyChunk } from "@rebasepro/ui";
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

const lazyCache = new WeakMap<object | ((...args: any[]) => any), React.ComponentType<any>>();

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
    key: object | ((...args: any[]) => any),
    loader: () => Promise<{ default: React.ComponentType<P> }>
): React.ComponentType<P> {
    const cached = lazyCache.get(key);
    if (cached) return cached as React.ComponentType<P>;

    // SAFETY: React.lazy returns LazyExoticComponent which is structurally compatible with ComponentType<P>
    // `lazyChunk`, not `lazy`: a custom view is a chunk like any other, and a
    // tab left open across a deploy cannot fetch it either.
    const LazyComponent = lazyChunk(loader) as React.ComponentType<P>;
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
            // `load()` resolves to `ComponentLike<P>` — the structural stand-in
            // that lets `ComponentRef` live in the React-free core. This function
            // is the one place that boundary is crossed, so it is the one place
            // the widening is asserted: `ComponentLike` accepts a return type of
            // `unknown` where React wants `ReactNode`. What actually arrives is
            // whatever the collection file pointed at, and rendering it is
            // React's problem either way.
            () => (ref as LazyComponentRef<P>).load() as Promise<{ default: React.ComponentType<P> }>
        );
    }

    // 3. Function — either a React component or a lazy import loader.
    if (typeof ref === "function") {
        const fn = ref as (...args: any[]) => any;

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

        // Zero-parameter function — either a React component that takes no props,
        // or a lazy loader `() => import(...)`.
        //
        // Nothing here can be decided with certainty from the outside, so the
        // signals are ordered by how much they can be trusted, and the strongest
        // one is what the function *does*, not what it is called.
        //
        // The name alone is not usable evidence, which is what this used to rely on.
        // `admin: { Preview: () => import("./BodyPartsPreview") }` gives the arrow
        // the *inferred* name "Preview" — JS names an anonymous function after the
        // property key it is assigned to — so the "starts with an uppercase letter,
        // therefore a component" rule matched every lazy loader written in the
        // documented way. The thunk was then handed to React as a component, React
        // called it, got a Promise back, and rendered nothing. That is what a blank
        // custom preview column in the demo was.
        const source = (() => {
            try {
                return Function.prototype.toString.call(fn);
            } catch {
                return "";
            }
        })();

        // A dynamic module load in the body is the strongest signal, and it outranks
        // the name: a toolchain cannot rename it away without breaking the fetch,
        // whereas the name is often not the author's at all.
        //
        // Both spellings are checked because the body reaching us depends on the
        // transform. Vite and any ESM build keep `import(...)`; ts-jest and other
        // CommonJS transforms rewrite it to `require(...)`. Matching only the first
        // passes in the browser and fails in the test suite, which is precisely how
        // this went unnoticed. A zero-argument *component* containing either call is
        // not a thing — components import at module scope.
        const loadsAChunk = /\b(?:import|require)\s*\(/.test(source);

        if (!loadsAChunk && fn.name && /^[A-Z]/.test(fn.name)) {
            // Named like a component and does not load a chunk: a component.
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
