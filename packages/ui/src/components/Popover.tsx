"use client";
import React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { focusedDisabled, paperMixin } from "../styles";
import { cls } from "../util";
import { useInjectStyles } from "../hooks";
import { usePortalContainer } from "../hooks/PortalContainerContext";

export type PopoverSide = "top" | "right" | "bottom" | "left";
export type PopoverAlign = "start" | "center" | "end";

export interface PopoverProps {
    trigger: React.ReactNode;
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    side?: PopoverSide;
    sideOffset?: number;
    align?: PopoverAlign;
    alignOffset?: number;
    arrowPadding?: number;
    sticky?: "partial" | "always";
    hideWhenDetached?: boolean;
    avoidCollisions?: boolean;
    enabled?: boolean;
    modal?: boolean;
    className?: string;
    portalContainer?: HTMLElement | null;
    onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
    onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
}

export function Popover({
                            trigger,
                            children,
                            open,
                            onOpenChange,
                            side,
                            sideOffset = 5,
                            align,
                            alignOffset,
                            arrowPadding,
                            sticky,
                            hideWhenDetached,
                            avoidCollisions,
                            enabled = true,
                            modal = false,
                            portalContainer,
                            className,
                            onMouseEnter,
                            onMouseLeave
                        }: PopoverProps) {

    useInjectStyles("Popover", popoverStyles);

    // Get the portal container from context
    const contextContainer = usePortalContainer();

    // Prioritize manual prop, fallback to context container
    const finalContainer = (portalContainer ?? contextContainer ?? undefined) as HTMLElement | undefined;

    if (!enabled)
        return <>{trigger}</>;

    return <PopoverPrimitive.Root open={open}
                                  onOpenChange={onOpenChange}
                                  modal={modal}>

        <PopoverPrimitive.Trigger asChild>
            {trigger}
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal container={finalContainer}>
            <PopoverPrimitive.Content
                // `z-50`, the floating layer — see the note in `Menu`. Below it
                // a popover opened from inside a dialog or a side panel is
                // painted under the thing that owns its trigger.
                // `focusedDisabled`, as Menu and Select: the panel takes focus
                // when opened from the keyboard and is not a control to ring.
                className={cls(paperMixin, focusedDisabled,
                    "PopoverContent z-50", className)}
                side={side}
                sideOffset={sideOffset}
                align={align}
                alignOffset={alignOffset}
                arrowPadding={arrowPadding}
                sticky={sticky}
                hideWhenDetached={hideWhenDetached}
                avoidCollisions={avoidCollisions}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}>

                {children}
                <PopoverPrimitive.Arrow className="fill-surface-card"/>
            </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>;
}

const popoverStyles = `
.PopoverContent {
  animation-duration: 400ms;
  animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}
.PopoverContent[data-state='open'][data-side='top'] {
  animation-name: popoverSlideDownAndFade;
}
.PopoverContent[data-state='open'][data-side='right'] {
  animation-name: popoverSlideLeftAndFade;
}
.PopoverContent[data-state='open'][data-side='bottom'] {
  animation-name: popoverSlideUpAndFade;
}
.PopoverContent[data-state='open'][data-side='left'] {
  animation-name: popoverSlideRightAndFade;
}

@keyframes popoverSlideUpAndFade {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes popoverSlideRightAndFade {
  from {
    opacity: 0;
    transform: translateX(-2px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes popoverSlideDownAndFade {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes popoverSlideLeftAndFade {
  from {
    opacity: 0;
    transform: translateX(2px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .PopoverContent[data-state] {
    animation: none;
  }
}
`;
