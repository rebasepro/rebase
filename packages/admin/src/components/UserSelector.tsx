
import {
    ChevronDownIcon,
    CircularProgress,
    cls,
    defaultBorderMixin,
    fieldBackgroundDisabledMixin,
    fieldBackgroundHoverMixin,
    fieldBackgroundInvisibleMixin,
    fieldBackgroundMixin,
    focusedDisabled,
    IconButton,
    iconSize,
    PopoverPrimitive,
    SearchIcon,
    Separator,
    usePortalContainer,
    XIcon
} from "@rebasepro/ui";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { User } from "@rebasepro/types";
import { apiBaseOf, useRebaseClient, useAuthController, UserDisplay } from "@rebasepro/app";
import { EmptyValue } from "../preview";
import { useResolvedUser } from "../hooks/useResolvedUsers";

interface UserSelectorItem {
    uid: string;
    label: string;
    description?: string;
    user: User;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Local hook to fetch users from the collection REST API with search and pagination.
 */
function useUserSelector({ pageSize = DEFAULT_PAGE_SIZE }: { pageSize?: number } = {}) {
    const client = useRebaseClient<{ baseUrl?: string, apiPath?: string }>();
    const { getAuthToken } = useAuthController();

    const [items, setItems] = useState<UserSelectorItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [currentSearch, setCurrentSearch] = useState("");
    const offsetRef = useRef(0);
    const userCacheRef = useRef<Map<string, User>>(new Map());
    // Stamped by every request; only the newest one is allowed to write state.
    // Typing "alice" issues one request per keystroke and nothing cancels them,
    // so the response for "al" landing after the response for "alice" replaced
    // the list — and `offsetRef` — with results for a string the user had
    // already moved past. Same shape as `useRelationSelector`.
    const requestIdRef = useRef(0);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchUsers = useCallback(async (searchStr: string, offset: number, append: boolean) => {
        const apiBase = apiBaseOf(client);
        if (!apiBase) return;
        const requestId = ++requestIdRef.current;
        const superseded = () => requestId !== requestIdRef.current;
        setIsLoading(true);
        try {
            const token = await getAuthToken?.();
            const params = new URLSearchParams({
                limit: String(pageSize),
                offset: String(offset)
            });
            if (searchStr) params.set("search", searchStr);
            // `/admin/users`, not `/users`. `apiBaseOf` returns the API root
            // (`/api`), and the users endpoint lives under the auth adapter's
            // admin router — `/api/users` is a 404, which is why this list was
            // always empty. The collection route `/api/data/users` would answer,
            // but it serves the raw row, `passwordHash` included.
            const response = await fetch(`${apiBase}/admin/users?${params}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });
            if (!response.ok) throw new Error("Failed to fetch users");
            const data = await response.json();
            if (superseded()) return;
            const rows: Record<string, unknown>[] = data.data ?? data.users ?? [];
            const newItems: UserSelectorItem[] = rows.map((r: Record<string, unknown>) => {
                const user: User = {
                    uid: (r.uid as string) ?? (r.id as string) ?? "",
                    email: (r.email as string) ?? "",
                    displayName: (r.displayName as string) ?? (r.display_name as string) ?? null,
                    photoURL: (r.photoURL as string) ?? (r.photo_url as string) ?? null,
                    providerId: "custom",
                    isAnonymous: false,
                    roles: (r.roles as string[]) ?? []
                };
                userCacheRef.current.set(user.uid, user);
                return { uid: user.uid,
label: user.displayName ?? user.email ?? user.uid,
user };
            });
            setItems(prev => append ? [...prev, ...newItems] : newItems);
            setHasMore(newItems.length >= pageSize);
            offsetRef.current = offset + newItems.length;
        } catch {
            if (superseded()) return;
            setHasMore(false);
        } finally {
            if (!superseded()) setIsLoading(false);
        }
    }, [client?.baseUrl, client?.apiPath, getAuthToken, pageSize]);

    useEffect(() => {
        offsetRef.current = 0;
        fetchUsers("", 0, false);
    }, [fetchUsers]);

    const search = useCallback((searchStr: string) => {
        // Debounced like the relation picker's type-ahead: a request per
        // keystroke is both wasteful and the thing that makes an out-of-order
        // response likely in the first place.
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => {
            setCurrentSearch(searchStr);
            offsetRef.current = 0;
            fetchUsers(searchStr, 0, false);
        }, searchStr.trim() ? 300 : 0);
    }, [fetchUsers]);

    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        };
    }, []);

    const loadMore = useCallback(() => {
        fetchUsers(currentSearch, offsetRef.current, true);
    }, [fetchUsers, currentSearch]);

    const getUser = useCallback((uid: string): User | null => {
        return userCacheRef.current.get(uid) ?? null;
    }, []);

    return { items,
isLoading,
hasMore,
search,
loadMore,
getUser };
}

export interface UserSelectorProps {
    className?: string;
    name?: string;
    id?: string;
    value?: string | null;
    onValueChange?: (userId: string | null) => void;
    placeholder?: React.ReactNode;
    /**
     * `large` is the form's size and is on the shared 28/32/40/48 control
     * scale, so a user picker lines up with the text field beside it.
     *
     * `small` and `medium` predate that scale (42 and 56) and are kept as they
     * are because the table cells and the filter row are built around them.
     */
    size?: "small" | "medium" | "large";
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
        const contextPortalContainer = usePortalContainer();

        const scrollContainerRef = useRef<HTMLDivElement>(null);
        const sentinelRef = useRef<HTMLDivElement>(null);
        const observerRef = useRef<IntersectionObserver | null>(null);
        const localTriggerRef = useRef<HTMLButtonElement | null>(null);

        const handleButtonRef = useCallback((node: HTMLButtonElement | null) => {
            localTriggerRef.current = node;
            if (typeof ref === "function") {
                ref(node);
            } else if (ref) {
                ref.current = node;
            }
        }, [ref]);
        const contentRef = useRef<HTMLDivElement | null>(null);
        const searchInputRef = useRef<HTMLInputElement | null>(null);

        // Resolve the currently selected user for display
        const selectedUser: User | null = value ? getUser(value) ?? null : null;

        // If the user isn't in the cache, try to find in available items
        const listedUser: User | null = selectedUser
            ?? (value ? availableItems.find(i => i.uid === value)?.user ?? null : null);

        // Neither the loaded page nor the cache holds it: ask for that uid
        // specifically. The list is one page of ten, so any installation with
        // more users than that rendered an assigned field as *empty* — and an
        // editor who is shown "no value" sets one, overwriting an assignment
        // the UI never admitted was there. Lookups are coalesced and cached
        // per API base by `useResolvedUser`, so a table of these costs one
        // request.
        const fetchedUser = useResolvedUser(value && !listedUser ? value : undefined);
        const resolvedUser: User | null = listedUser ?? fetchedUser;

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
                const triggerEl = localTriggerRef.current;
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

        const resolvedPlaceholder = placeholder || <EmptyValue className={"ml-2"}/>;
        // See RelationSelector: a modal dialog cancels wheel events outside its
        // own content, so a list portaled to the body opens unscrollable.
        const portalContainer = (contextPortalContainer ?? (typeof document !== "undefined" ? document.body : undefined)) ?? undefined;

        return (
            <>
                <PopoverPrimitive.Root open={isPopoverOpen} onOpenChange={handleRootOpenChange} modal={false}>
                    <PopoverPrimitive.Trigger asChild>
                        <button
                            ref={handleButtonRef}
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
                                    "min-h-[56px] py-2 px-4": size === "medium",
                                    "min-h-[48px] py-1 px-4": size === "large"
                                },
                                // `rounded-lg` like every other field box —
                                // `rounded-md` made this the one control in a
                                // row with a different corner.
                                "w-full select-none rounded-lg text-sm relative flex items-center",
                                invisible ? fieldBackgroundInvisibleMixin : fieldBackgroundMixin,
                                disabled ? fieldBackgroundDisabledMixin : fieldBackgroundHoverMixin,
                                className
                            )}
                        >
                            <div className="flex justify-between items-center w-full">
                                {resolvedUser ? (
                                    <div className="flex flex-row items-center gap-1 truncate flex-1 min-w-0 mr-2">
                                        <UserDisplay user={resolvedUser}/>
                                    </div>
                                ) : value ? (
                                    // A uid we could not resolve — deleted, or
                                    // hidden from this viewer. Show it raw: the
                                    // placeholder here would claim the field is
                                    // unset, which is the one thing it is not.
                                    <span className="text-sm truncate text-text-primary dark:text-text-primary-dark">
                                        {value}
                                    </span>
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
                                            <XIcon size={iconSize.small}/>
                                        </IconButton>
                                    )}
                                    <ChevronDownIcon
                                        size={size === "small" ? iconSize.small : iconSize.medium}
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
                            className={cls("z-50 overflow-hidden border bg-white dark:bg-surface-800 rounded-lg min-w-72", defaultBorderMixin)}
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
                                            size={iconSize.smallest}/>
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
                                            <CircularProgress size="smallest"/>
                                        </div>
                                    )}
                                </div>
                                <Separator orientation="horizontal" className="my-0"/>
                                <CommandPrimitive.List
                                    ref={scrollContainerRef}
                                    style={{
                                        maxHeight: "40vh",
                                        overflowY: "auto"
                                    }}
                                >
                                    {isLoading && availableItems.length === 0 && (
                                        <div className="flex items-center justify-center py-6">
                                            <CircularProgress size="small"/>
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
                                                    <UserDisplay user={item.user}/>
                                                </CommandPrimitive.Item>
                                            );
                                        })}
                                        {availableItems.length > 0 && hasMore && (
                                            <div ref={sentinelCallbackRef} className="h-1 w-full"
                                                style={{ visibility: "hidden" }}/>
                                        )}
                                        {isLoading && availableItems.length > 0 && (
                                            <div className="flex items-center justify-center py-4">
                                                <CircularProgress size="smallest"/>
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
