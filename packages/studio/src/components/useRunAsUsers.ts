import { useEffect, useMemo, useState } from "react";
import { useRebaseClient, useRebaseContext, type SelectableUser } from "@rebasepro/app";
import { hasAdminRole, type RebaseClient } from "@rebasepro/types";

/** How many users one search of a "Run as" picker lists. */
const USER_PAGE_SIZE = 50;

/** The fields a picker row shows, copied off an account or the signed-in user. */
function toSelectableUser(user: SelectableUser): SelectableUser {
    return {
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
        roles: user.roles
    };
}

export interface RunAsUsers {
    /** The signed-in user first, then the users the latest search found. */
    users: SelectableUser[];
    /** The signed-in user, the picker's "self" row. */
    currentUser: SelectableUser | null;
    loading: boolean;
    /** Search the project's users on the server. */
    onSearchTextChange: (searchText: string) => void;
    /**
     * How many users the latest search matched on the server, set only when
     * that is more than the one page listed — so the picker can say so rather
     * than present the page as everyone.
     */
    totalCount?: number;
}

/**
 * The users a "Run as" picker offers.
 *
 * The signed-in user, and — for an administrator, the only caller the server
 * lets run a request as someone else — the project's users, searched on the
 * server. Disabled accounts are left out: nothing can run as them, and the
 * server refuses them.
 */
export function useRunAsUsers(): RunAsUsers {
    const signedIn = useRebaseContext().authController?.user;
    const client = useRebaseClient<RebaseClient>();
    const adminApi = hasAdminRole(signedIn?.roles) ? client?.admin : undefined;

    const [search, setSearch] = useState("");
    const [listed, setListed] = useState<SelectableUser[]>([]);
    const [totalCount, setTotalCount] = useState<number | undefined>(undefined);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!adminApi) return;
        let cancelled = false;
        setLoading(true);
        adminApi.listUsersPaginated({ search: search || undefined, limit: USER_PAGE_SIZE })
            .then(({ users, total }) => {
                if (cancelled) return;
                setListed(users.filter((u) => !u.disabled).map(toSelectableUser));
                setTotalCount(total > users.length ? total : undefined);
            })
            .catch((err: unknown) => {
                console.warn("Could not list users for the \"Run as\" picker", err);
                if (!cancelled) {
                    setListed([]);
                    setTotalCount(undefined);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [adminApi, search]);

    const currentUser = useMemo((): SelectableUser | null => (signedIn ? toSelectableUser(signedIn) : null), [signedIn]);

    const users = useMemo(
        () => [...(currentUser ? [currentUser] : []), ...listed.filter((u) => u.uid !== currentUser?.uid)],
        [currentUser, listed]
    );

    return { users, currentUser, loading, onSearchTextChange: setSearch, totalCount };
}
