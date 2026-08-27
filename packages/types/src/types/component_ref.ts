/**
 * How a collection points at a UI component without the backend learning about React.
 *
 * This file is the hinge the BaaS/admin split turns on. `ComponentRef` is named
 * by a property's `admin` block (`admin.Field`, `admin.Preview`, `admin.Filter`)
 * and imported by `properties.ts`, which must stay in the React-free core
 * because every backend subsystem — validation,
 * the drizzle schema generator, the OpenAPI generator, the SDK codegen — reads
 * property definitions. If `ComponentRef` needed `React.ComponentType`, the whole
 * property model would have to move to the admin layer with it.
 *
 * So the React types are described structurally instead of imported. Every form
 * a React component takes is assignable to {@link ComponentLike}:
 *
 * - a function component is `(props: P) => ReactNode`
 * - a class component satisfies the construct signature (`Component` has `render`)
 * - `memo` and `forwardRef` return exotic components, which are callable
 *
 * The cost is that the return type is `unknown` rather than `ReactNode`, so a
 * function that returns something React could not render is accepted here.
 * `@rebasepro/cms-types` re-exports a `ReactComponentRef<P>` narrowed against
 * the real `React.ComponentType` for authoring and for the admin's internals,
 * which restores that check where it can be enforced.
 */

/**
 * Structural stand-in for `React.ComponentType<P>`.
 *
 * Deliberately not `Function` or `unknown`: those would accept anything and the
 * resolver's runtime heuristics ({@link ComponentRef} form 3) would be all that
 * stood between a typo and a blank screen.
 */
export type ComponentLike<P = any> =
    | ((props: P) => unknown)
    | (new (props: P, context?: unknown) => { render(): unknown });

/**
 * Internal marker for a lazily-loaded component reference.
 * Created by the Vite transform plugin when converting string paths
 * to deferred `import()` calls. Users should NOT create these manually.
 *
 * @internal
 */
export interface LazyComponentRef<P = unknown> {
    readonly __rebaseLazy: true;
    readonly load: () => Promise<{ default: ComponentLike<P> }>;
}

/**
 * A reference to a UI component that can be provided in three forms:
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
 *    `pnpm check:headless` fails on a collection file that does this.
 *
 * @group Types
 */
export type ComponentRef<P = any> =
    | string
    | LazyComponentRef<P>
    | (() => Promise<{ default: ComponentLike<P> }>)
    | ComponentLike<P>;

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
