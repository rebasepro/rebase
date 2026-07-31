"use client";
import React from "react";
import { cls } from "../util";

export type IconButtonProps<C extends React.ElementType> =
    Omit<(C extends "button" ? React.ButtonHTMLAttributes<HTMLButtonElement> : React.ComponentProps<C>), "onClick">
    & {
    size?: "medium" | "small" | "smallest" | "large";
    variant?: "ghost" | "filled",
    shape?: "circular" | "square",
    disabled?: boolean;
    toggled?: boolean;
    component?: C;
    onClick?: React.MouseEventHandler<any>;
    "aria-label"?: string;
}

const buttonClasses = "hover:bg-surface-accent-200 hover:bg-opacity-75 hover:bg-surface-accent-200/75 dark:hover:bg-surface-accent-800 hover:scale-[1.04] active:scale-95 transition-transform";
// `[&>svg]:shrink-0` is load-bearing: without it flex compresses the icon to
// whatever width is left after padding, so an 18px icon in a 28px button
// rendered 12x18 — visibly squashed rather than merely small.
const baseClasses = "inline-flex items-center justify-center text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-colors ease-in-out duration-150 [&>svg]:shrink-0";
const colorClasses = "text-surface-accent-500 visited:text-surface-accent-500 dark:text-surface-accent-300 dark:visited:text-surface-accent-300";
// Padding stays a flat p-2 (as it always was). Callers pass their own icon
// sizes, so tightening it here shrinks the content box under an icon that was
// sized for the old one and makes the icon overflow. `shrink-0` above is what
// actually fixes the squashing — the icon keeps its own dimensions and simply
// eats into the padding.
const sizeClasses = {
    medium: "w-10 !h-10 min-w-10 min-h-10 p-2",
    small: "w-8 !h-8 min-w-8 min-h-8 p-2",
    smallest: "w-7 !h-7 min-w-7 min-h-7 p-2",
    large: "w-12 !h-12 min-w-12 min-h-12 p-2"
}
const shapeClasses = {
    circular: "rounded-full",
    square: "rounded-md"
}

/** Icon size used when the caller doesn't set one on the child. */
const defaultIconSize = {
    smallest: 16,
    small: 18,
    medium: 20,
    large: 24
} as const;

const IconButtonInner = <C extends React.ElementType = "button">({
                                                                     children,
                                                                     className,
                                                                     size = "medium",
                                                                     variant = "ghost",
                                                                     shape = "circular",
                                                                     disabled,
                                                                     toggled,
                                                                     component,
                                                                     ...props
                                                                 }: IconButtonProps<C>, ref: React.ForwardedRef<HTMLButtonElement>) => {

    const bgClasses = variant === "ghost" ? "bg-transparent" : "bg-surface-accent-200 bg-opacity-50 bg-surface-accent-200/50 dark:bg-surface-900 dark:bg-opacity-50 dark:bg-surface-900/50";
    const Component: React.ElementType<any> = component || "button";
    const isNativeButton = Component === "button";

    // Give the icon a size that matches the button when the caller didn't pick
    // one. Without this a bare <IconButton size="smallest"><PencilIcon/></…>
    // renders lucide's 24px default inside a 28px button, so icon size ended up
    // depending on whether each call site happened to pass one — which is what
    // made a row of icon buttons look randomly sized. An explicit `size` on the
    // child always wins.
    const sizedChildren = React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        if ((child.props as { size?: unknown }).size !== undefined) return child;
        return React.cloneElement(child as React.ReactElement<{ size?: number }>,
            { size: defaultIconSize[size] });
    });
    return (
        <Component
            type={isNativeButton ? "button" : undefined}
            role={isNativeButton ? undefined : "button"}
            ref={ref}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : undefined}
            {...props}
            className={cls(
                disabled ? "opacity-50 pointer-events-none" : "cursor-pointer",
                toggled ? "outline outline-2 outline-primary" : "",
                "text-inherit dark:text-inherit",
                colorClasses,
                bgClasses,
                baseClasses,
                buttonClasses,
                shapeClasses[shape],
                sizeClasses[size],
                className
            )}>
            {sizedChildren}
        </Component>
    );
};

export const IconButton = React.forwardRef(IconButtonInner as React.ForwardRefRenderFunction<HTMLButtonElement, IconButtonProps<any>>) as React.ComponentType<IconButtonProps<any>>;
