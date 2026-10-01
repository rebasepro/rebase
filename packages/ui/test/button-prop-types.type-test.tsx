import React from "react";
import { Button, IconButton, LoadingButton } from "../src";

/**
 * `Button` and `IconButton` reject props they do not have.
 *
 * Both were typed against `ComponentPropsWithoutRef<ElementType>` — as good as
 * `any` — so on the two most-used controls in the product (386 call sites) a
 * misspelt or invented prop compiled and landed on the DOM: 26 `IconButton`s
 * passed a `color` it does not have (the obsolete HTML attribute; the icon
 * stayed grey), two `Button`s an `endIcon` that never rendered, and one a
 * `loading` that drew no spinner.
 *
 * Compile-time only: named `.type-test.tsx` so jest leaves it alone, read by
 * `tsconfig.tests.json` through `packages/ui/test`. Each `@ts-expect-error`
 * fails the typecheck if its line starts compiling.
 */

// @ts-expect-error — not a prop of IconButton
export const iconButtonInventedProp = <IconButton aria-label="Delete" totallyMadeUpProp={42}/>;

// @ts-expect-error — IconButton has no `color`; the HTML attribute is left out on purpose
export const iconButtonColor = <IconButton aria-label="Delete" color="primary"/>;

// @ts-expect-error — not a prop of Button
export const buttonInventedProp = <Button totallyMadeUpProp={42}>Save</Button>;

// @ts-expect-error — Button has no `endIcon`
export const buttonEndIcon = <Button endIcon={<span/>}>Save</Button>;

// @ts-expect-error — `loading` belongs to LoadingButton
export const buttonLoading = <Button loading>Save</Button>;

// What they do accept still compiles: their own props, the element's props,
// and those of a `component` they render instead.
export const fine = [
    <Button key="a" color="primary" variant="filled" type="submit" form="f" onClick={() => undefined}>Save</Button>,
    <Button key="b" component="a" href="/docs">Docs</Button>,
    <IconButton key="c" aria-label="Delete" size="small" onClick={() => undefined} title="Delete"/>,
    <IconButton key="d" aria-label="Open" component="a" href="/x"/>,
    <LoadingButton key="e" loading={true} color="primary">Save</LoadingButton>
];
