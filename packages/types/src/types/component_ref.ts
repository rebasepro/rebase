import type React from "react";

/**
 * Internal marker for a lazily-loaded component reference.
 * Created by the Vite transform plugin when converting string paths
 * to deferred `import()` calls. Users should NOT create these manually.
 *
 * @internal
 */
export interface LazyComponentRef<P = unknown> {
    readonly __rebaseLazy: true;
    readonly load: () => Promise<{ default: React.ComponentType<P> }>;
}

/**
 * A reference to a React component that can be provided in three forms:
 *
 * 1. **String path** (recommended for collection configs):
 *    ```ts
 *    Field: "../../frontend/src/components/MyField"
 *    ```
 *    The Vite plugin transforms this into a `LazyComponentRef` at build time.
 *    On the backend, the string stays inert and is never evaluated.
 *
 * 2. **Lazy import function**:
 *    ```ts
 *    Field: () => import("../../frontend/src/components/MyField")
 *    ```
 *    Standard ES dynamic import. Backend never calls the function.
 *
 * 3. **Direct component reference** (use only in frontend-only code):
 *    ```ts
 *    Field: MyFieldComponent
 *    ```
 *    Importing a component at the top level will pull React into the
 *    backend runtime — only safe in code that the backend never imports.
 *
 * @group Types
 */
export type ComponentRef<P = unknown> =
    | React.ComponentType<P>
    | LazyComponentRef<P>
    | (() => Promise<{ default: React.ComponentType<P> }>)
    | string;

/**
 * Type guard: checks if a value is a `LazyComponentRef` produced by the
 * Vite transform plugin.
 */
export function isLazyComponentRef<P = unknown>(ref: unknown): ref is LazyComponentRef<P> {
    return (
        typeof ref === "object" &&
        ref !== null &&
        "__rebaseLazy" in ref &&
        (ref as Record<string, unknown>).__rebaseLazy === true
    );
}
