
"use client";
import React, { PropsWithChildren, useEffect, useState } from "react";

import * as Collapsible from "@radix-ui/react-collapsible";
import { defaultBorderMixin, fieldBackgroundMixin } from "../styles";
import { ChevronDownIcon } from "lucide-react";
import { cls } from "../util";
import { useInjectStyles } from "../hooks";

export function ExpandablePanel({
                                    title,
                                    children,
                                    invisible = false,
                                    expanded,
                                    onExpandedChange,
                                    initiallyExpanded = true,
                                    titleClassName,
                                    asField,
                                    className,
                                    innerClassName
                                }: PropsWithChildren<{
    title: React.ReactNode,
    invisible?: boolean,
    initiallyExpanded?: boolean;
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void,
    titleClassName?: string,
    asField?: boolean,
    className?: string,
    innerClassName?: string
}>) {

    useInjectStyles("ExpandablePanel", `
.CollapsibleContent {
  overflow: hidden;
}
.CollapsibleContent[data-state='open'] {
  animation: slideDown 220ms ease-out
}
.CollapsibleContent[data-state='closed'] {
  animation: slideUp 220ms ease-out;
}

@keyframes slideDown {
  from {
    height: 0;
  }
  to {
    height: var(--radix-collapsible-content-height);
  }
}

@keyframes slideUp {
  from {
    height: var(--radix-collapsible-content-height);
  }
  to {
    height: 0;
  }
}`);

    const [open, setOpen] = useState(expanded !== undefined ? expanded : initiallyExpanded);
    const [allowOverflow, setAllowOverflow] = useState(open);

    useEffect(() => {
        if (open) {
            setTimeout(() => {
                setAllowOverflow(true);
            }, 220);
        } else {
            setAllowOverflow(false);
        }
    }, [open]);

    useEffect(() => {
        if (expanded !== undefined)
            setOpen(expanded);
    }, [expanded]);

    return (<>
            <Collapsible.Root
                className={cls(
                    !invisible && defaultBorderMixin + " border",
                    "rounded-lg",
                    "w-full",
                    className
                )}
                open={open}
                onOpenChange={(updatedOpen: boolean) => {
                    onExpandedChange?.(updatedOpen);
                    setOpen(updatedOpen);
                }}>

                <Collapsible.Trigger asChild>
                    <div
                        className={cls(
                            "rounded-t-lg flex items-center justify-between w-full min-h-[52px]",
                            "hover:bg-surface-hover active:bg-surface-active",
                            invisible ? "border-b px-2" : "p-4",
                            open ? "py-6" : "py-4",
                            "transition-all duration-200",
                            invisible && defaultBorderMixin,
                            asField && fieldBackgroundMixin,
                            titleClassName,
                            "cursor-pointer"
                        )}
                        role="button"
                        tabIndex={0}
                        aria-expanded={open}
                        // A role="button" has to answer Enter and Space itself:
                        // Radix's trigger listens for click only, and a div does
                        // not turn a key into a click, so the header took focus and
                        // then ignored the keyboard. Only for keys pressed on the
                        // header — a control inside the title keeps its own keys.
                        onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault(); // Space would scroll the page
                            event.currentTarget.click();
                        }}
                    >
                        {title}
                        <ChevronDownIcon className={cls("transition", open ? "rotate-180" : "")}/>
                    </div>
                </Collapsible.Trigger>

                <Collapsible.Content
                    className={cls("CollapsibleContent")}
                    style={{
                        overflow: allowOverflow ? "visible" : "hidden"
                    }}
                >
                    <div className={innerClassName}>
                        {children}
                    </div>
                </Collapsible.Content>
            </Collapsible.Root>
        </>
    )
}
