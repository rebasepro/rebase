"use client";
import React from "react";
import * as Collapsible from "@radix-ui/react-collapsible";

import { cls } from "../util";
import { useInjectStyles } from "../hooks";

interface CollapseProps {
    children?: React.ReactNode;
    className?: string;
    in?: boolean;
    duration?: number;
}

export const Collapse = React.memo(({
                             children,
                             className,
                             in: isOpen = false,
                             duration = 220
                         }: CollapseProps) => {

    useInjectStyles(`Collapse-${duration}`, `
.CollapseContent-${duration} {
  overflow: hidden;
}
.CollapseContent-${duration}[data-state='open'] {
  animation: collapseSlideDown ${duration}ms ease-out;
}
.CollapseContent-${duration}[data-state='closed'] {
  animation: collapseSlideUp ${duration}ms ease-in;
}

@keyframes collapseSlideDown {
  from {
    height: 0;
  }
  to {
    height: var(--radix-collapsible-content-height);
  }
}

@keyframes collapseSlideUp {
  from {
    height: var(--radix-collapsible-content-height);
  }
  to {
    height: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .CollapseContent-${duration}[data-state] {
    animation: none;
  }
}
`);

    return (
        <Collapsible.Root
            open={isOpen}
            className={className}>

            <Collapsible.Content
                className={cls(`CollapseContent-${duration}`)}
            >
                {children}
            </Collapsible.Content>
        </Collapsible.Root>
    )
});

Collapse.displayName = "Collapse";
