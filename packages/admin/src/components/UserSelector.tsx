import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import {
    CircularProgress,
    CloseIcon,
    cls,
    defaultBorderMixin,
    fieldBackgroundDisabledMixin,
    fieldBackgroundHoverMixin,
    fieldBackgroundInvisibleMixin,
    fieldBackgroundMixin,
    focusedDisabled,
    IconButton,
    KeyboardArrowDownIcon,
    SearchIcon,
    Separator,
    useInjectStyles
} from "@rebasepro/ui";
import { User } from "@rebasepro/types";
import { useUserSelector, UserSelectorItem } from "@rebasepro/core";
import { UserDisplay } from "@rebasepro/core";
import { EmptyValue } from "../preview";

export interface UserSelectorProps {
    className?: string;
    name?: string;
    id?: string;
    value?: string | null;
    onValueChange?: (userId: string | null) => void;
    placeholder?: React.ReactNode;
    size?: "small" | "medium";
    disabled?: boolean;
    invisible?: boolean;
    clearable?: boolean;
    pageSize?: number;
    searchPlaceholder?: string;
    noResultsText?: string;
    loadingText?: string;
}

export const UserSelector = React.forwardRef<
    HTMLButtonElement,
    UserSelectorProps
>(
    (
        {
            value,
            size = "medium",
            onValueChange,
            invisible,
            disabled,
            placeholder,
            clearable = true,
            className,
            pageSize,
            searchPlaceholder = "Search users...",
            noResultsText = "No users found.",
            loadingText = "Loading..."
        },
        ref
    ) => {

        const {
            items: availableItems,
            isLoading,
            hasMore,
            search,
            loadMore,
            getUser
        } = useUserSelector({ pageSize });

        const [isPopoverOpen, setIsPopoverOpen] = useState(false);
        const [searchString, setSearchString] = useState<string>("");

        const scrollContainerRef = useRef<HTMLDivElement>(null);
        const sentinelRef = useRef<HTMLDivElement>(null);
        const observerRef = useRef<IntersectionObserver | null>(null);
        const triggerRef = (ref as React.RefObject<HTMLButtonElement>) || useRef<HTMLButtonElement>(null);
        const contentRef = useRef<HTMLDivElement | null>(null);
        const searchInputRef = useRef<HTMLInputElement | null>(null);

        // Resolve the currently selected user for display
        const selectedUser: User | null = value ? getUser(value) ?? null : null;

        // If the user isn't in the cache, try to find in available items
        const resolvedUser: User | null = selectedUser
            ?? (value ? availableItems.find(i => i.uid === value)?.user ?? null : null);

        // IntersectionObserver for infinite scroll
        const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
            if (observerRef.current) {
                observerRef.current.disconnect();
                observerRef.current = null;
            }
            if (sentinelRef.current !== node) {
                (sentinelRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
            }
            if (!node || !hasMore || isLoading || !loadMore) return;
            const observer = new IntersectionObserver(
                (entries) => {
                    const entry = entries[0];
                    if (entry.isIntersecting && hasMore && !isLoading) loadMore();
                },
                {
                    root: scrollContainerRef.current,
                    rootMargin: "20px",
                    threshold: 0
                }
            );
            observer.observe(node);
            observerRef.current = observer;
        }, [hasMore, isLoading, loadMore]);

        useEffect(() => () => {
            if (observerRef.current) observerRef.current.disconnect();
        }, []);

        // Scroll-based pagination fallback
        useEffect(() => {
            const scrollContainer = scrollContainerRef.current;
            if (!scrollContainer || !hasMore || isLoading || !isPopoverOpen) return;

            const handleScroll = () => {
                const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
                const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;
                if (isNearBottom && hasMore && !isLoading) {
                    loadMore();
                }
            };

            scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
            return () => {
                scrollContainer.removeEventListener("scroll", handleScroll);
            };
        }, [hasMore, isLoading, loadMore, isPopoverOpen]);

        const handleSearchChange = useCallback((newSearchString: string) => {
            setSearchString(newSearchString);
            search(newSearchString);
        }, [search]);

        const handleItemClick = useCallback((item: UserSelectorItem) => {
            if (value === item.uid) {
                // Deselect
                onValueChange?.(null);
            } else {
                onValueChange?.(item.uid);
            }
            setIsPopoverOpen(false);
        }, [value, onValueChange]);

        const handleClear = useCallback((e: React.MouseEvent) => {
            e.stopPropagation();
            e.preventDefault();
            onValueChange?.(null);
        }, [onValueChange]);

        const handleRootOpenChange = useCallback((next: boolean) => {
            if (disabled) return;
            if (next) setIsPopoverOpen(true);
        }, [disabled]);

        // Outside click + Escape handling
        useEffect(() => {
            if (!isPopoverOpen) return;

            function handlePointerDown(ev: MouseEvent) {
                const target = ev.target as Node;
                const triggerEl = triggerRef.current;
                const contentEl = contentRef.current;
                if (triggerEl?.contains(target)) return;
                if (contentEl?.contains(target)) return;
                setIsPopoverOpen(false);
            }

            function handleKey(ev: KeyboardEvent) {
                if (ev.key === "Escape") setIsPopoverOpen(false);
            }

            document.addEventListener("mousedown", handlePointerDown, true);
            document.addEventListener("keydown", handleKey, true);
            return () => {
                document.removeEventListener("mousedown", handlePointerDown, true);
                document.removeEventListener("keydown", handleKey, true);
            };
        }, [isPopoverOpen]);

        useInjectStyles("UserSelector", " [cmdk-group] { max-height: 40vh; overflow-y: auto; } ");

        const resolvedPlaceholder = placeholder || <EmptyValue className={"ml-2"} />;
        const portalContainer = (typeof document !== "undefined" ? document.body : undefined);

        return (
            <>
                <PopoverPrimitive.Root open={isPopoverOpen} onOpenChange={handleRootOpenChange} modal={false}>
                    <PopoverPrimitive.Trigger asChild>
                        <button
                            ref={triggerRef as React.Ref<HTMLButtonElement>}
                            type="button"
                            aria-haspopup="listbox"
                            aria-expanded={isPopoverOpen}
                            data-user-selector-trigger
                            disabled={disabled}
                            onClick={() => {
                                if (disabled) return;
                                setIsPopoverOpen(o => !o);
                            }}
                            className={cls(
                                {
                                    "min-h-[42px] py-1 px-2": size === "small",
                                    "min-h-[56px] py-2 px-4": size === "medium"
                                },
                                "w-full select-none rounded-md text-sm relative flex items-center",
                                invisible ? fieldBackgroundInvisibleMixin : fieldBackgroundMixin,
                                disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin,
                                className
                            )}
                        >
                            <div className="flex justify-between items-center w-full">
                                {resolvedUser ? (
                                    <div className="flex flex-row items-center gap-1 truncate flex-1 min-w-0 mr-2">
                                        <UserDisplay user={resolvedUser} />
                                    </div>
                                ) : (
                                    <span className="text-sm text-text-secondary dark:text-text-secondary-dark">
                                        {resolvedPlaceholder}
                                    </span>
                                )}

                                <div className="flex-shrink-0 flex items-center gap-1">
                                    {clearable && !disabled && value && (
                                        <IconButton
                                            size="small"
                                            onClick={handleClear}>
                                            <CloseIcon size={"small"} />
                                        </IconButton>
                                    )}
                                    <KeyboardArrowDownIcon
                                        size={size === "medium" ? "medium" : "small"}
                                        className={cls("transition", isPopoverOpen ? "rotate-180" : "")}
                                    />
                                </div>
                            </div>
                        </button>
                    </PopoverPrimitive.Trigger>
                    <PopoverPrimitive.Portal container={portalContainer}>
                        <PopoverPrimitive.Content
                            ref={contentRef}
                            data-user-selector-content
                            className={cls("z-50 overflow-hidden border bg-white dark:bg-surface-900 rounded-lg min-w-72", defaultBorderMixin)}
                            align="start"
                            sideOffset={8}
                            side="bottom"
                            avoidCollisions={true}
                            collisionPadding={16}
                            onOpenAutoFocus={(_e) => { /* leave default */ }}
                            onCloseAutoFocus={(e) => {
                                e.preventDefault();
                            }}
                            style={{ width: "var(--radix-popover-trigger-width)" }}
                        >
                            <CommandPrimitive shouldFilter={false}>
                                <div className="flex flex-row items-center">
                                    <div className="relative flex-1">
                                        <SearchIcon
                                            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary dark:text-text-secondary-dark"
                                            size="small" />
                                        <CommandPrimitive.Input
                                            ref={searchInputRef}
                                            className={cls(
                                                focusedDisabled,
                                                "bg-transparent outline-hidden flex-1 h-full w-full pl-10 pr-4 py-3 text-text-primary dark:text-text-primary-dark placeholder:text-text-secondary dark:placeholder:text-text-secondary-dark"
                                            )}
                                            placeholder={searchPlaceholder}
                                            value={searchString}
                                            onValueChange={handleSearchChange}
                                        />
                                    </div>
                                    {isLoading && (
                                        <div className="flex items-center justify-center px-3">
                                            <CircularProgress size="smallest" />
                                        </div>
                                    )}
                                </div>
                                <Separator orientation="horizontal" className="my-0" />
                                <CommandPrimitive.List
                                    ref={scrollContainerRef}
                                    style={{
                                        maxHeight: "40vh",
                                        overflowY: "auto"
                                    }}
                                >
                                    {isLoading && availableItems.length === 0 && (
                                        <div className="flex items-center justify-center py-6">
                                            <CircularProgress size="small" />
                                            <span
                                                className="ml-2 text-sm text-text-secondary dark:text-text-secondary-dark">{loadingText}</span>
                                        </div>
                                    )}
                                    {!isLoading && availableItems.length === 0 && (
                                        <CommandPrimitive.Empty
                                            className="px-4 py-6 text-center text-text-secondary dark:text-text-secondary-dark">
                                            {noResultsText}
                                        </CommandPrimitive.Empty>
                                    )}
                                    <CommandPrimitive.Group>
                                        {availableItems.map((item) => {
                                            const isSelected = value === item.uid;
                                            return (
                                                <CommandPrimitive.Item
                                                    key={item.uid}
                                                    value={item.uid}
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                    }}
                                                    onSelect={() => handleItemClick(item)}
                                                    className={cls(
                                                        "flex flex-row items-center gap-1.5 m-1 p-1.5 rounded-xs cursor-pointer ring-offset-transparent",
                                                        isSelected && "bg-surface-accent-200 dark:bg-surface-accent-950",
                                                        "aria-selected:outline-hidden aria-selected:ring-2 aria-selected:ring-primary/75 aria-selected:ring-offset-2 aria-selected:bg-surface-accent-100 dark:aria-selected:bg-surface-accent-900"
                                                    )}
                                                >
                                                    <UserDisplay user={item.user} />
                                                </CommandPrimitive.Item>
                                            );
                                        })}
                                        {availableItems.length > 0 && hasMore && (
                                            <div ref={sentinelCallbackRef} className="h-1 w-full"
                                                style={{ visibility: "hidden" }} />
                                        )}
                                        {isLoading && availableItems.length > 0 && (
                                            <div className="flex items-center justify-center py-4">
                                                <CircularProgress size="smallest" />
                                                <span
                                                    className="ml-2 text-xs text-text-secondary dark:text-text-secondary-dark">Loading...</span>
                                            </div>
                                        )}
                                    </CommandPrimitive.Group>
                                </CommandPrimitive.List>
                            </CommandPrimitive>
                        </PopoverPrimitive.Content>
                    </PopoverPrimitive.Portal>
                </PopoverPrimitive.Root>
            </>
        );
    }
);

UserSelector.displayName = "UserSelector";
