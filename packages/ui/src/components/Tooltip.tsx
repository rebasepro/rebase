"use client";
import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cls } from "../util";
import { useInjectStyles } from "../hooks";
import { usePortalContainer } from "../hooks/PortalContainerContext";
import { IconButton } from "./IconButton";

/**
 * A Radix tooltip only describes its trigger (`aria-describedby`, and only
 * while open); it never names it. Wrapped around an icon-only button with no
 * name of its own, the title was the one word that said what the button does,
 * and a screen reader announced "button". So a string title names an
 * icon-only button (no text, no `aria-label`/`aria-labelledby`) it wraps.
 */
function nameFromTitle(children: React.ReactNode, title: React.ReactNode): React.ReactNode {
    if (typeof title !== "string" || !React.isValidElement<Record<string, unknown>>(children)) return children;
    const type = children.type;
    if (type !== IconButton && type !== "button" && type !== "a") return children;
    const props = children.props;
    if (props["aria-label"] || props["aria-labelledby"]) return children;
    const hasText = React.Children.toArray(props.children as React.ReactNode)
        .some((child) => typeof child === "string" || typeof child === "number");
    if (hasText) return children;
    return React.cloneElement(children, { "aria-label": title });
}

export type TooltipProps = {
    open?: boolean,
    defaultOpen?: boolean,
    onOpenChange?: (open: boolean) => void,
    side?: "top" | "bottom" | "left" | "right",
    align?: "start" | "center" | "end",
    sideOffset?: number,
    title?: string | React.ReactNode,
    delayDuration?: number;
    asChild?: boolean;
    tooltipClassName?: string,
    tooltipStyle?: React.CSSProperties;
    children: React.ReactNode,
    className?: string,
    container?: HTMLElement,
    style?: React.CSSProperties;
};

export const Tooltip = ({
                            open,
                            defaultOpen,
                            side = "bottom",
                            delayDuration = 200,
                            sideOffset,
                            align,
                            onOpenChange,
                            title,
                            tooltipClassName,
                            tooltipStyle,
                            children,
                            asChild = false,
                            container,
                            className,
                            style
                        }: TooltipProps) => {

    useInjectStyles("Tooltip", styles);

    // Get the portal container from context
    const contextContainer = usePortalContainer();

    // Prioritize manual prop, fallback to context container
    const finalContainer = (container ?? contextContainer ?? undefined) as HTMLElement | undefined;

    if (!title)
        return <>{children}</>;

    children = nameFromTitle(children, title);

    const trigger = asChild
        ? <TooltipPrimitive.Trigger asChild={true}>
            {children}
        </TooltipPrimitive.Trigger>
        : <TooltipPrimitive.Trigger asChild={true}>
            <div style={style} className={className}>
                {children}
            </div>
        </TooltipPrimitive.Trigger>;

    return (
        <TooltipPrimitive.Provider delayDuration={delayDuration}>
            <TooltipPrimitive.Root {...(open !== undefined ? { open,
onOpenChange } : {})} defaultOpen={defaultOpen}>
                {trigger}
                <TooltipPrimitive.Portal container={finalContainer}>
                    <TooltipPrimitive.Content
                        className={cls("TooltipContent",
                            "max-w-lg leading-relaxed",
                            "z-50 rounded-md px-3 py-2 text-xs leading-none bg-surface-800/95 dark:bg-surface-raised-hover font-medium text-white shadow-2xl select-none duration-400 ease-in transform opacity-100",
                            tooltipClassName)}
                        style={tooltipStyle}
                        sideOffset={sideOffset === undefined ? 4 : sideOffset}
                        align={align}
                        side={side}>
                        {title}
                    </TooltipPrimitive.Content>
                </TooltipPrimitive.Portal>
            </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
    );
};

const styles = `

.TooltipContent {
  animation-duration: 220ms;
  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}

.TooltipContent[data-state='delayed-open'][data-side='top'] {
  animation-name: slideDownAndFade;
}
.TooltipContent[data-state='delayed-open'][data-side='right'] {
  animation-name: slideLeftAndFade;
}
.TooltipContent[data-state='delayed-open'][data-side='bottom'] {
  animation-name: slideUpAndFade;
}
.TooltipContent[data-state='delayed-open'][data-side='left'] {
  animation-name: slideRightAndFade;
}


@keyframes slideUpAndFade {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideRightAndFade {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes slideDownAndFade {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideLeftAndFade {
  from {
    opacity: 0;
    transform: translateX(4px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}`;
