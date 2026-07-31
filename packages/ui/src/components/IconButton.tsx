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
// Padding is per-size so the glyph always fits: a flat p-2 left only 12px of
// content width at `smallest`, which is what squashed the icon.
const sizeClasses = {
    medium: "w-10 !h-10 min-w-10 min-h-10 p-2.5",
    small: "w-8 !h-8 min-w-8 min-h-8 p-1.5",
    smallest: "w-7 !h-7 min-w-7 min-h-7 p-1.5",
    large: "w-12 !h-12 min-w-12 min-h-12 p-3"
}
const shapeClasses = {
    circular: "rounded-full",
    square: "rounded-md"
}

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
            {children}
        </Component>
    );
};

export const IconButton = React.forwardRef(IconButtonInner as React.ForwardRefRenderFunction<HTMLButtonElement, IconButtonProps<any>>) as React.ComponentType<IconButtonProps<any>>;
