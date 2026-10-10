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

/** Whether a {@link TooltipProvider} is above: a tooltip under one does not mount its own. */
const SharedTooltipProvider = React.createContext(false);

export type TooltipProviderProps = {
    children: React.ReactNode,
    /**
     * How long, in ms, the pointer rests on a trigger before its tooltip opens.
     * A `Tooltip`'s own `delayDuration` wins over it.
     */
    delayDuration?: number,
    /**
     * How long, in ms, after one tooltip closes the next one opens without the
     * delay — so moving along a row of icons does not wait on each.
     */
    skipDelayDuration?: number
};

/**
 * One provider for every `Tooltip` below it. `<Rebase>` mounts one around the
 * whole admin; mount one yourself around a screen that renders kit tooltips
 * outside it. A `Tooltip` with no provider above still works: it brings its
 * own, as before.
 *
 * Without one, every tooltip mounted a provider of its own — hundreds on a
 * page of table rows — and the skip-delay between neighbouring tooltips never
 * applied, since each provider timed only its own tooltip.
 */
export function TooltipProvider({
    children,
    delayDuration = 200,
    skipDelayDuration = 300
}: TooltipProviderProps) {
    return (
        <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration}>
            <SharedTooltipProvider.Provider value={true}>
                {children}
            </SharedTooltipProvider.Provider>
        </TooltipPrimitive.Provider>
    );
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

    const sharedProvider = React.useContext(SharedTooltipProvider);

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

    const root = (
        <TooltipPrimitive.Root {...(open !== undefined ? { open,
onOpenChange } : {})} defaultOpen={defaultOpen} delayDuration={delayDuration}>
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
    );

    // Under a TooltipProvider the shared one times this tooltip; alone, it
    // brings its own, as every tooltip used to.
    if (sharedProvider) return root;
    return (
        <TooltipPrimitive.Provider delayDuration={delayDuration}>
            {root}
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
