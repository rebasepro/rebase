/**
 * Compatibility shim for react-grid-layout v2.
 *
 * In RGL v2 `Layout` became `readonly LayoutItem[]`.
 * The Dataki code mutates layouts freely, so we keep our own
 * mutable aliases and cast at the boundary.
 */

export type {
    LayoutItem,
    Layout,
    EventCallback,
} from "react-grid-layout";

import type { Layout as RGLLayout, LayoutItem as RGLLayoutItem } from "react-grid-layout";

/** Mutable copy of Layout for the Dataki code that mutates layouts */
export type MutableLayout = RGLLayoutItem[];

/** Cast a readonly RGL Layout to a mutable one (shallow). */
export function asMutable(layout: RGLLayout): MutableLayout {
    return [...layout];
}
