"use client";
import React, { useEffect, useState } from "react";
import { cls } from "../util";
import { defaultBorderMixin } from "../styles";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { usePortalContainer, PortalContainerProvider } from "../hooks/PortalContainerContext";

interface SheetProps {
    children: React.ReactNode;
    open: boolean;
    title?: string;
    modal?: boolean;
    includeBackgroundOverlay?: boolean;
    side?: "top" | "bottom" | "left" | "right";
    darkBackground?: boolean;
    transparent?: boolean;
    onOpenChange?: (open: boolean) => void;
    onPointerDownOutside?: (e: Event) => void;
    onInteractOutside?: (e: Event) => void;
    className?: string;
    style?: React.CSSProperties;
    overlayClassName?: string;
    overlayZIndex?: string;
    overlayStyle?: React.CSSProperties;
    portalContainer?: HTMLElement | null;
}

export const Sheet: React.FC<SheetProps> = ({
    children,
    side = "right",
    title,
    modal = true,
    includeBackgroundOverlay = true,
    open,
    onOpenChange,
    onPointerDownOutside,
    onInteractOutside,
    transparent,
    className,
    style,
    overlayClassName,
    overlayZIndex = "z-50",
    overlayStyle,
    portalContainer,
    ...props
}) => {
    const [displayed, setDisplayed] = useState(false);
    const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);

    // Get the portal container from context
    const contextContainer = usePortalContainer();

    // Prioritize manual prop, fallback to context container
    const finalContainer = (portalContainer ?? contextContainer ?? undefined) as HTMLElement | undefined;

    useEffect(() => {
        const raf = requestAnimationFrame(() => {
            setDisplayed(open);
        });
        return () => cancelAnimationFrame(raf);
    }, [open]);

    const transformValue: Record<string, string> = {
        top: "-translate-y-full",
        bottom: "translate-y-full",
        left: "-translate-x-full",
        right: "translate-x-full"
    };

    const borderClass: Record<string, string> = {
        top: "border-b",
        bottom: "border-t",
        left: "border-r",
        right: "border-l"
    };

    return (
        <DialogPrimitive.Root open={displayed || open}
            modal={modal}
            onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal container={finalContainer}>
                {includeBackgroundOverlay && <DialogPrimitive.Overlay
                    className={cls(
                        "outline-none",
                        "fixed inset-0 bg-white/80 dark:bg-surface-900/80",
                        "backdrop-blur-sm transition-all duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in",
                        overlayZIndex,
                        overlayClassName
                    )}
                    style={overlayStyle}
                />}
                <DialogPrimitive.Content
                    {...props}
                    ref={setContentEl}
                    onOpenAutoFocus={(event) => event.preventDefault()}
                    onPointerDownOutside={onPointerDownOutside}
                    onInteractOutside={onInteractOutside}
                    className={cls(
                        "outline-none",
                        borderClass[side],
                        defaultBorderMixin,
                        // No `will-change: transform` / `transform-gpu` here, however
                        // tempting the layer hint is on a panel this size. Either one
                        // makes this element a *containing block* for its
                        // `position: fixed` descendants, and everything portaled into
                        // the panel below — a Select dropdown, above all — is fixed and
                        // positioned in viewport coordinates. Inside a containing block
                        // those coordinates are resolved against the panel instead, so
                        // every popup was displaced by the panel's own offset and a
                        // right-hand Select opened its list off the edge of the screen:
                        // the dropdown was open, just nowhere anyone could see it.
                        "text-surface-accent-900 dark:text-white",
                        "fixed transform z-50 transition-[transform,opacity] ease-in-out",
                        !displayed ? "duration-150" : "duration-100",
                        "outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus:ring-0",
                        transparent ? "" : "shadow-md bg-white dark:bg-surface-900",
                        side === "top" || side === "bottom" ? "w-full" : "h-full",
                        side === "left" || side === "top" ? "left-0 top-0" : "right-0 bottom-0",
                        displayed && open ? "opacity-100" : "opacity-50",
                        !displayed || !open ? transformValue[side] : "",
                        className
                    )}
                    style={style}
                >
                    <DialogPrimitive.Title className="sr-only outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus:ring-0">
                        {title ?? "Sheet"}
                    </DialogPrimitive.Title>
                    <PortalContainerProvider container={contentEl}>
                        {children}
                    </PortalContainerProvider>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
};
