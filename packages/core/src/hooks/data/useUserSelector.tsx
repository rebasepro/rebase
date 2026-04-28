import { useCallback, useEffect, useRef, useState } from "react";
import { User, UserManagementDelegate } from "@rebasepro/types";
import { useInternalUserManagementController } from "../useInternalUserManagementController";

export interface UserSelectorItem {
    uid: string;
    label: string;
    description?: string;
    user: User;
}

export interface UseUserSelectorProps {
    /**
     * Page size for pagination. Defaults to 10.
     */
    pageSize?: number;
}

export interface UserSelectorController {
    items: UserSelectorItem[];
    isLoading: boolean;
    error: Error | undefined;
    search: (searchString: string) => void;
    loadMore: () => void;
    hasMore: boolean;
    getUser: (uid: string) => User | null;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Hook to manage user selection with server-side search and pagination.
 * Similar to useRelationSelector but for the UserManagementDelegate.
 *
 * If the delegate provides `searchUsers`, this hook uses server-side
 * search/pagination. Otherwise it falls back to client-side filtering
 * over the in-memory `users` array.
 */
export function useUserSelector(
    { pageSize = DEFAULT_PAGE_SIZE }: UseUserSelectorProps = {}
): UserSelectorController {

    const userManagement = useInternalUserManagementController<User>();

    const [items, setItems] = useState<UserSelectorItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const isLoadingRef = useRef(false);
    const [error, setError] = useState<Error | undefined>();
    const [hasMore, setHasMore] = useState(true);
    const [currentSearch, setCurrentSearch] = useState<string>("");
    const [limit, setLimit] = useState<number>(pageSize);

    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const setLoadingState = useCallback((loading: boolean) => {
        isLoadingRef.current = loading;
        setIsLoading(loading);
    }, []);

    const userToItem = useCallback((user: User): UserSelectorItem => {
        return {
            uid: user.uid,
            label: user.displayName || user.email || user.uid,
            description: user.displayName && user.email ? user.email : undefined,
            user
        };
    }, []);

    const fetchData = useCallback(() => {
        if (!userManagement) return;

        setError(undefined);
        setLoadingState(true);

        if (userManagement.searchUsers) {
            // Server-side search + pagination
            userManagement.searchUsers({
                search: currentSearch || undefined,
                limit,
                offset: 0
            }).then(({ users, total }) => {
                setItems(users.map(userToItem));
                setHasMore(users.length < total);
                setLoadingState(false);
            }).catch((err: unknown) => {
                console.error("useUserSelector: Error fetching users:", err);
                setError(err instanceof Error ? err : new Error(String(err)));
                setLoadingState(false);
            });
        } else {
            // Client-side fallback: filter in-memory users list
            const allUsers = userManagement.users ?? [];
            const searchLower = currentSearch.toLowerCase();
            const filtered = currentSearch
                ? allUsers.filter((u: User) => {
                    const name = (u.displayName || "").toLowerCase();
                    const email = (u.email || "").toLowerCase();
                    return name.includes(searchLower) || email.includes(searchLower);
                })
                : allUsers;

            const page = filtered.slice(0, limit);
            setItems(page.map(userToItem));
            setHasMore(page.length < filtered.length);
            setLoadingState(false);
        }
    }, [userManagement, currentSearch, limit, userToItem, setLoadingState]);

    // Search function with debouncing
    const search = useCallback((searchString: string) => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        searchTimeoutRef.current = setTimeout(() => {
            setLimit(pageSize);
            setCurrentSearch(searchString);
        }, searchString.trim() ? 300 : 0);
    }, [pageSize]);

    // Load more function
    const loadMore = useCallback(() => {
        if (!isLoadingRef.current && hasMore && items.length > 0) {
            setLoadingState(true);
            setLimit(prev => prev + pageSize);
        }
    }, [hasMore, items.length, pageSize, setLoadingState]);

    // Fetch when search/limit changes
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Cleanup debounce timer
    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, []);

    const getUser = useCallback((uid: string): User | null => {
        return userManagement?.getUser(uid) ?? null;
    }, [userManagement]);

    return {
        items,
        isLoading,
        error,
        search,
        loadMore,
        hasMore,
        getUser
    };
}
