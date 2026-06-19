import type React from "react";

// ── Scoped component name unions ──────────────────────────────────────

/**
 * Components that can only be overridden at the **app level** via the
 * `components` prop on `<Rebase>`.
 *
 * These are shell-level / global components that exist outside of any
 * specific collection context.
 *
 * @group Component Overrides
 */
export type AppComponentName =
    // ── Shell / Layout ──
    | "Shell.AppBar"
    | "Shell.Drawer"
    | "Shell.DrawerNavigationItem"
    | "Shell.DrawerNavigationGroup"

    // ── Home Page ──
    | "HomePage"
    | "HomePage.CollectionCard"

    // ── Auth ──
    | "Auth.LoginView";

/**
 * Components that can be overridden at the **collection level**
 * (on an individual collection definition) or at the **app level**
 * (as a default for all collections).
 *
 * When set at the app level, these act as defaults. When set on a
 * specific collection, they override the app-level default for that
 * collection only.
 *
 * @group Component Overrides
 */
export type CollectionComponentName =
    // ── Collection View ──
    | "Collection.View"
    | "Collection.Table"
    | "Collection.Card"
    | "Collection.EmptyState"
    | "Collection.Actions"

    // ── Entity / Form ──
    | "Entity.Form"
    | "Entity.FormActions"
    | "Entity.DetailView"
    | "Entity.SidePanel"
    | "Entity.Preview"
    | "Entity.MissingReference";

/**
 * All overridable component names across all scopes.
 * @group Component Overrides
 */
export type OverridableComponentName = AppComponentName | CollectionComponentName;

// ── Override entry ────────────────────────────────────────────────────

/**
 * A single component override entry.
 *
 * - **Eject mode** (default): Your component fully replaces the built-in one.
 *   It receives the same props as the original.
 *
 * - **Wrap mode** (`wrap: true`): Your component wraps the original. The
 *   built-in component is passed as `OriginalComponent` in props, so you can
 *   render it inside your custom layout/logic.
 *
 * @example
 * ```tsx
 * // Eject — full replacement
 * { Component: MyCustomAppBar }
 *
 * // Wrap — augment the original
 * {
 *     Component: ({ OriginalComponent, ...props }) => (
 *         <div>
 *             <MyBanner />
 *             <OriginalComponent {...props} />
 *         </div>
 *     ),
 *     wrap: true
 * }
 * ```
 *
 * @group Component Overrides
 */
export interface ComponentOverride<P = any> {
    /**
     * The replacement component. Receives the same props as the built-in
     * component it replaces.
     *
     * When `wrap` is true, an additional `OriginalComponent` prop is injected
     * containing the default component, allowing you to render it within
     * your custom wrapper.
     */
    Component: React.ComponentType<P>;

    /**
     * When true, the original default component is injected as the
     * `OriginalComponent` prop into your Component, enabling the
     * wrapping pattern (similar to Docusaurus's `--wrap` swizzle mode).
     *
     * When false or omitted, your component fully replaces the default
     * (similar to Docusaurus's `--eject` swizzle mode).
     *
     * @default false
     */
    wrap?: boolean;
}

// ── Override maps by scope ────────────────────────────────────────────

/**
 * Collection-scoped overrides. Only collection-level components
 * can be overridden here.
 *
 * Set on a collection's `components` field to customize
 * components for that specific collection.
 *
 * @example
 * ```tsx
 * const productsCollection = {
 *     name: "Products",
 *     slug: "products",
 *     components: {
 *         "Entity.Form": { Component: ProductForm },
 *         "Collection.EmptyState": { Component: ProductsEmptyState },
 *         "Collection.Card": { Component: ProductCard },
 *     }
 * };
 * ```
 *
 * @group Component Overrides
 */
export type CollectionComponentOverrideMap = {
    [K in CollectionComponentName]?: ComponentOverride;
};

/**
 * App-level overrides. Includes both app-only components (Shell, HomePage, Auth)
 * and collection-level components (as defaults for all collections).
 *
 * Pass this to the `components` prop on `<Rebase>`.
 *
 * Collection-level components set here act as **defaults** — they apply to all
 * collections unless a specific collection overrides them in its own
 * `components`.
 *
 * @example
 * ```tsx
 * <Rebase
 *     client={client}
 *     components={{
 *         // App-level: only available here
 *         "Shell.AppBar": { Component: MyAppBar },
 *         "HomePage": { Component: MyDashboard },
 *
 *         // Collection defaults: apply to ALL collections
 *         "Entity.FormActions": {
 *             Component: MyFormActions,
 *             wrap: true
 *         },
 *         "Collection.EmptyState": { Component: MyEmptyState },
 *     }}
 * />
 * ```
 *
 * @group Component Overrides
 */
export type ComponentOverrideMap = {
    [K in OverridableComponentName]?: ComponentOverride;
};
