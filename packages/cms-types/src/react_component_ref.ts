import type React from "react";
import type { ComponentLike, ComponentRef, LazyComponentRef } from "@rebasepro/types";

/**
 * `ComponentRef`, narrowed to real React types.
 *
 * Core's {@link ComponentRef} describes a component structurally
 * ({@link ComponentLike}) so that `properties.ts` — and therefore the whole
 * property model the backend reads — can live without React. The trade is that
 * the return type is `unknown`, so a function returning something React cannot
 * render type-checks there.
 *
 * Use this type wherever React genuinely exists: authoring a collection's admin
 * options, and inside the admin packages. Assignments flow into core unchanged,
 * because every member of this union is a member of that one.
 */
export type ReactComponentRef<P = any> =
    | string
    | LazyComponentRef<P>
    | (() => Promise<{ default: React.ComponentType<P> }>)
    | React.ComponentType<P>;

/**
 * The `ComponentLike` contract, as a signature the compiler has to keep true.
 *
 * The split rests on one claim: **every form a React component takes is
 * assignable to `ComponentLike`** — function components, class components,
 * `memo`, `forwardRef`. If that stopped holding, core's `ComponentRef` would
 * quietly begin rejecting real components, and the failure would surface far away
 * in whichever collection file happened to use the broken form.
 *
 * So the claim is not left to a test that someone has to run. This function's
 * parameter and return types state it, and `pnpm typecheck` enforces it on every
 * commit. It is also useful on its own: an explicit widening at the point where
 * an authored component enters a collection config.
 *
 * @example
 * import { MyField } from "./MyField";
 * admin: { Field: asComponentRef(MyField) }
 */
export function asComponentRef<P>(component: React.ComponentType<P>): ComponentRef<P> {
    return component;
}

/**
 * The same contract in the other direction: a `ComponentLike` is only renderable
 * once narrowed, and this is the single sanctioned place that narrowing is
 * spelled out. `resolveComponentRef` in `@rebasepro/app` does the runtime half.
 */
export function asReactComponent<P>(component: ComponentLike<P>): React.ComponentType<P> {
    return component as React.ComponentType<P>;
}
