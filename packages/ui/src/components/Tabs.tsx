
import React, { createContext, useContext, useRef, useState, useEffect, useMemo } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cls } from "../util";
import { defaultBorderMixin } from "../styles";

export type TabVariant = "standard" | "boxy" | "pill";

const TabsContext = createContext<{ variant: TabVariant }>({ variant: "standard" });
import { IconButton } from "./IconButton";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { iconSize } from "../icons/Icon";

export type TabsProps = {
    value: string,
    children: React.ReactNode,
    innerClassName?: string,
    className?: string,
    variant?: TabVariant,
    onValueChange: (value: string) => void
};

export function Tabs({
    value,
    onValueChange,
    className,
    innerClassName,
    variant = "standard",
    children
}: TabsProps) {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [showLeftScroll, setShowLeftScroll] = useState(false);
    const [showRightScroll, setShowRightScroll] = useState(false);
    const [isScrollable, setIsScrollable] = useState(false);

    const checkScroll = () => {
        if (scrollContainerRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
            setShowLeftScroll(scrollLeft > 0);
            setShowRightScroll(Math.ceil(scrollLeft + clientWidth) < scrollWidth);
            setIsScrollable(scrollWidth > clientWidth);
        }
    };

    useEffect(() => {
        checkScroll();
        window.addEventListener("resize", checkScroll);

        let observer: ResizeObserver;
        if (scrollContainerRef.current) {
            observer = new ResizeObserver(checkScroll);
            observer.observe(scrollContainerRef.current);
            if (scrollContainerRef.current.firstElementChild) {
                observer.observe(scrollContainerRef.current.firstElementChild);
            }
        }

        return () => {
            window.removeEventListener("resize", checkScroll);
            observer?.disconnect();
        };
    }, [children]);

    const scroll = (direction: "left" | "right") => {
        if (scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            const scrollAmount = Math.max(container.clientWidth / 2, 200);
            const targetScroll = container.scrollLeft + (direction === "left" ? -scrollAmount : scrollAmount);

            container.scrollTo({
                left: targetScroll,
                behavior: "smooth"
            });
            // checkScroll will be called by onScroll event
        }
    };

    const contextValue = useMemo(() => ({ variant }), [variant]);

    return <TabsContext.Provider value={contextValue}>
        <TabsPrimitive.Root
            value={value}
            onValueChange={onValueChange}
            className={cls("relative flex flex-row items-center min-w-0 w-full", className)}
        >
            {isScrollable && (
                <button
                    type="button"
                    disabled={!showLeftScroll}
                    aria-label="Scroll tabs left"
                    onClick={() => scroll("left")}
                    className={cls(
                        "absolute left-0 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center rounded-md transition-all h-8 w-6",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400",
                        !showLeftScroll ? "pointer-events-none opacity-0" : "text-surface-600 dark:text-surface-400 hover:bg-surface-hover",
                        "bg-surface-card border shadow-sm", defaultBorderMixin
                    )}
                >
                    <ChevronLeftIcon size={iconSize.smallest}/>
                </button>
            )}
            <div
                ref={scrollContainerRef}
                className="flex-1 overflow-x-auto no-scrollbar min-w-0"
                onScroll={checkScroll}
                style={{ scrollbarWidth: "none",
msOverflowStyle: "none" }}
            >
                <TabsPrimitive.List className={cls(
                    // A segmented track is a region, not an object: an inset fill and no border.
                    variant === "standard" && "inline-flex h-9 items-center justify-start rounded-md bg-surface-field p-1 text-surface-600 dark:text-surface-400 gap-2",
                    // Folder tabs sit on the strip's bottom edge, so the list aligns
                    // them to the end; the active tab overlaps that edge by 1px.
                    variant === "boxy" && "flex items-end h-full",
                    variant === "pill" && "flex items-center gap-0.5",
                    innerClassName)
                }>
                    {children}
                </TabsPrimitive.List>
            </div>
            {isScrollable && (
                <button
                    type="button"
                    disabled={!showRightScroll}
                    aria-label="Scroll tabs right"
                    onClick={() => scroll("right")}
                    className={cls(
                        "absolute right-0 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center rounded-md transition-all h-8 w-6",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400",
                        !showRightScroll ? "pointer-events-none opacity-0" : "text-surface-600 dark:text-surface-400 hover:bg-surface-hover",
                        "bg-surface-card border shadow-sm", defaultBorderMixin
                    )}
                >
                    <ChevronRightIcon size={iconSize.smallest}/>
                </button>
            )}
        </TabsPrimitive.Root>
    </TabsContext.Provider>;
}

export type TabProps = {
    value: string,
    className?: string,
    innerClassName?: string,
    children: React.ReactNode,
    disabled?: boolean
};

export function Tab({
    value,
    className,
    innerClassName,
    children,
    disabled
}: TabProps) {
    const { variant } = useContext(TabsContext);

    return (
        <TabsPrimitive.Trigger
            value={value}
            disabled={disabled}
            className={cls(
                "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-white transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-surface-400 focus-visible:ring-offset-2",
                "disabled:pointer-events-none disabled:opacity-50",
                variant === "standard" && "rounded-md px-3 py-1 data-[state=active]:bg-surface-lifted data-[state=active]:text-surface-900 data-[state=active]:shadow-sm dark:data-[state=active]:text-surface-50",
                // A folder tab. The active one is cut from the same surface as the
                // panel it opens and sits over the strip's hairline (`-mb-px`), so
                // it reads as CONNECTED to what it shows rather than underlined,
                // and the primary is not spent on it. The vertical dividers and
                // the blue underline this variant used to draw were the boxiest
                // thing on the record view; the reference separates tabs with
                // nothing but their own rounded tops.
                variant === "boxy" && cls(
                    "flex-shrink-0 flex items-center gap-1.5 px-3.5 h-9 cursor-pointer text-xs font-medium transition-colors group relative box-border",
                    "rounded-t-lg -mb-px border border-transparent border-b-0",
                    "data-[state=active]:bg-surface-card data-[state=active]:border-hairline",
                    "data-[state=active]:text-text-primary dark:data-[state=active]:text-text-primary-dark",
                    "text-text-secondary dark:text-text-secondary-dark hover:bg-surface-hover"
                ),
                variant === "pill" && cls(
                    "px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors",
                    "data-[state=active]:bg-primary/10 data-[state=active]:text-primary dark:data-[state=active]:bg-primary/20 dark:data-[state=active]:text-primary",
                    "text-text-disabled dark:text-text-disabled-dark hover:text-text-secondary dark:hover:text-text-secondary-dark"
                ),
                className,
                variant === "standard" && innerClassName
            )}
        >
            {children}
        </TabsPrimitive.Trigger>
    );
}
