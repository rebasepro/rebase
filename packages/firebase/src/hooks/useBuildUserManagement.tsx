import React, { useCallback, useEffect } from "react";
import { deepEqual as equal } from "fast-equals";

import { removeUndefined } from "@rebasepro/utils";
import {
    DataDriver,
    Entity,
    User
} from "@rebasepro/types";
import {
    AuthController
} from "@rebasepro/cms-types";
import { FirebaseAccessGate } from "./useFirebaseAccessGate";

export interface Role {
    id: string;
    name: string;
    isAdmin?: boolean;
}

type UserWithRoleIds<USER extends User = User> = Omit<USER, "roles"> & { roles: string[] };

export interface UserManagementDelegateParams<CONTROLLER extends AuthController<User> = AuthController<User>> {

    authController: CONTROLLER;

    /**
     * The delegate in charge of persisting the data.
     */
    dataSourceDelegate?: DataDriver;

    /**
     * Path where the plugin users configuration is stored.
     * Default: __FIRECMS/config/users
     * You can specify a different path if you want to store the user management configuration in a different place.
     * Please keep in mind that the FireCMS users are not necessarily the same as the Firebase users (but they can be).
     * The path should be relative to the root of the database, and should always have an odd number of segments.
     */
    usersPath?: string;

    /**
     * Path where the plugin roles configuration is stored.
     * Default: __FIRECMS/config/roles
     */
    rolesPath?: string;

    /**
     * The roles that are available in the user management system.
     * If you provide this, the user management system will not fetch the roles from the database.
     */
    roles?: Role[];

    /**
     * If there are no roles in the database, provide a button to create the default roles.
     */
    allowDefaultRolesCreation?: boolean;

}

/**
 * Why the access gate answered the way it did.
 *
 * `users-unreadable` is a state of its own because it used to be
 * indistinguishable from `bootstrap`: the users listener's `onError` empties
 * the user list, so a `permission-denied` on the users path — a rules
 * misconfiguration, a rules deploy that has not landed, a renamed path —
 * reached the gate as "no users created yet" and every authenticated user was
 * let in. An unreadable list is not an empty one, and only one of the two may
 * open the door.
 */
export type AccessDecision =
    | "loading"
    | "no-user"
    | "users-unreadable"
    | "bootstrap"
    | "known-user"
    | "unknown-user";

/**
 * Decide whether a user may access the CMS, given the state of the user
 * management collection.
 *
 * A plain function rather than logic inside the gate callback so the states
 * that must stay distinct can be asserted without a React render.
 */
export function resolveAccessDecision({
    loading,
    usersError,
    users,
    user
}: {
    loading: boolean;
    usersError?: Error;
    users: { email?: string | null }[];
    user: { email?: string | null } | null;
}): AccessDecision {
    if (loading) return "loading";
    if (!user) return "no-user";
    if (usersError) return "users-unreadable";
    if (users.length === 0) return "bootstrap";
    const known = users.some(u => u.email?.toLowerCase() === user.email?.toLowerCase());
    return known ? "known-user" : "unknown-user";
}

/**
 * This hook is used to build a user management object that can be used to
 * manage users and roles in a Firestore backend.
 * @param authController
 * @param dataSourceDelegate
 * @param usersPath
 * @param rolesPath
 * @param roles
 * @param allowDefaultRolesCreation
 */
export function useBuildUserManagement<CONTROLLER extends AuthController<User> = AuthController<User>,
    USER extends User = CONTROLLER extends AuthController<infer U> ? U : User>
({
     authController,
     dataSourceDelegate,
     roles: rolesProp,
     usersPath = "__FIRECMS/config/users",
     rolesPath = "__FIRECMS/config/roles",
     allowDefaultRolesCreation
 }: UserManagementDelegateParams<CONTROLLER>) {

    if (!authController) {
        throw Error("useBuildUserManagement: You need to provide an authController since version 3.0.0-beta.11. Check https://firecms.co/docs/pro/migrating_from_v3_beta");
    }

    const rolesDefinedInCode = (rolesProp ?? [])?.length > 0;
    const [rolesLoading, setRolesLoading] = React.useState<boolean>(!rolesDefinedInCode);
    const [usersLoading, setUsersLoading] = React.useState<boolean>(true);
    const [roles, setRoles] = React.useState<Role[]>(rolesProp ?? []);
    const [usersWithRoleIds, setUsersWithRoleIds] = React.useState<UserWithRoleIds<USER>[]>([]);

    const users = usersWithRoleIds.map(u => ({
        ...u
    }) as USER);

    const [rolesError, setRolesError] = React.useState<Error | undefined>();
    const [usersError, setUsersError] = React.useState<Error | undefined>();

    const _usersLoading = usersLoading;
    const _rolesLoading = rolesLoading;

    const loading = _rolesLoading || _usersLoading;

    useEffect(() => {
        if (rolesDefinedInCode) return;
        if (!dataSourceDelegate || !rolesPath) return;
        if (dataSourceDelegate.initialised !== undefined && !dataSourceDelegate.initialised) return;
        if (authController?.initialLoading) return;

        setRolesLoading(true);
        return dataSourceDelegate.listenCollection?.({
            path: rolesPath,
            onUpdate(rows: Record<string, unknown>[]): void {
                setRolesError(undefined);
                console.debug("Updating roles", rows);
                try {
                    const newRoles = rowsToRoles(rows);
                    if (!equal(newRoles, roles)) {
                        setRoles(newRoles);
                    }
                } catch (e) {
                    setRoles([]);
                    console.error("Error loading roles", e);
                    setRolesError(e as Error);
                }
                setRolesLoading(false);
            },
            onError(e: unknown): void {
                setRoles([]);
                console.error("Error loading roles", e);
                setRolesError(e instanceof Error ? e : new Error(String(e)));
                setRolesLoading(false);
            }
        });

    }, [rolesDefinedInCode, dataSourceDelegate?.initialised, authController?.initialLoading, authController?.user?.uid, rolesPath]);

    useEffect(() => {
        if (!dataSourceDelegate || !usersPath) return;
        if (dataSourceDelegate.initialised !== undefined && !dataSourceDelegate.initialised) {
            return;
        }
        if (authController?.initialLoading) {
            return;
        }

        setUsersLoading(true);
        return dataSourceDelegate.listenCollection?.({
            path: usersPath,
            onUpdate(rows: Record<string, unknown>[]): void {
                console.debug("Updating users", rows);
                setUsersError(undefined);
                try {
                    const newUsers = rowsToUsers(rows) as UserWithRoleIds<USER>[];
                    // if (!equal(newUsers, usersWithRoleIds))
                    setUsersWithRoleIds(newUsers);
                } catch (e) {
                    setUsersWithRoleIds([]);
                    console.error("Error loading users", e);
                    setUsersError(e as Error);
                }
                setUsersLoading(false);
            },
            onError(e: unknown): void {
                console.error("Error loading users", e);
                setUsersWithRoleIds([]);
                setUsersError(e instanceof Error ? e : new Error(String(e)));
                setUsersLoading(false);
            }
        });

    }, [dataSourceDelegate?.initialised, authController?.initialLoading, authController?.user?.uid, usersPath]);

    const saveUser = useCallback(async (user: USER): Promise<USER> => {
        if (!dataSourceDelegate) throw Error("useBuildUserManagement Firebase not initialised");
        if (!usersPath) throw Error("useBuildUserManagement Firestore not initialised");

        console.debug("Persisting user", user);

        const roleIds = user.roles;
        const email = user.email?.toLowerCase().trim();
        if (!email) throw Error("Email is required");

        const userExists = users.find(u => u.email?.toLowerCase() === email);
        const data = {
            ...user,
            roles: roleIds ?? [],
            ...(userExists ? {} : { created_on: new Date() })
        };
        // delete the previous user entry if it exists and the uid has changed
        if (userExists && userExists.uid !== user.uid) {
            const row = {
                values: {},
                path: usersPath,
                id: userExists.uid
            }
            await dataSourceDelegate.delete({ row })
                .then(() => {
                    console.debug("Deleted previous user", userExists);
                })
                .catch(e => {
                    console.error("Error deleting user", e);
                });

        }

        return dataSourceDelegate.save({
            status: "existing",
            path: usersPath,
            id: email,
            values: removeUndefined(data) as Record<string, unknown>
        }).then(() => user);
    }, [usersPath, dataSourceDelegate?.initialised]);

    const saveRole = useCallback((role: Role): Promise<void> => {
        if (!dataSourceDelegate) throw Error("useBuildUserManagement Firebase not initialised");
        if (!rolesPath) throw Error("useBuildUserManagement Firestore not initialised");
        console.debug("Persisting role", role);
        const {
            id,
            ...roleData
        } = role;
        return dataSourceDelegate.save({
            status: "existing",
            path: rolesPath,
            id: id,
            values: removeUndefined(roleData) as Record<string, unknown>
        }).then(() => {
            return;
        });
    }, [rolesPath, dataSourceDelegate?.initialised]);

    const deleteUser = useCallback(async (user: User): Promise<void> => {
        if (!dataSourceDelegate) throw Error("useBuildUserManagement Firebase not initialised");
        if (!usersPath) throw Error("useBuildUserManagement Firestore not initialised");
        console.debug("Deleting", user);
        const { uid } = user;
        const row = {
            path: usersPath,
            id: uid,
            values: {}
        };
        await dataSourceDelegate.delete({ row })
    }, [usersPath, dataSourceDelegate?.initialised]);

    const deleteRole = useCallback(async (role: Role): Promise<void> => {
        if (!dataSourceDelegate) throw Error("useBuildUserManagement Firebase not initialised");
        if (!rolesPath) throw Error("useBuildUserManagement Firestore not initialised");
        console.debug("Deleting", role);
        const { id } = role;
        const row = {
            path: rolesPath,
            id: id,
            values: {}
        };
        await dataSourceDelegate.delete({ row })
    }, [rolesPath, dataSourceDelegate?.initialised]);


    const defineRolesFor: ((user: User) => string[] | undefined) = useCallback((user) => {
        if (!usersWithRoleIds) throw Error("Users not loaded");
        const mgmtUser = usersWithRoleIds.find(u => u.email?.toLowerCase() === user?.email?.toLowerCase());
        if (!mgmtUser || !mgmtUser.roles) return undefined;
        return mgmtUser.roles;
    }, [usersWithRoleIds]);

    const accessGate: FirebaseAccessGate<USER> = useCallback(({ user }) => {

        const decision = resolveAccessDecision({
            loading,
            usersError,
            users,
            user
        });

        if (decision === "loading") {
            return false;
        }

        if (decision === "no-user") {
            console.warn("User is null, returning");
            return false;
        }

        if (decision === "users-unreadable") {
            // The users collection could not be read, so we do not know whether
            // this user is in it. Denying is the only safe reading: the
            // bootstrap branch below would otherwise admit everyone.
            console.error("Denying access: the user management collection could not be read", usersError);
            return false;
        }

        if (decision === "bootstrap") {
            console.warn("No users created yet");
            return true; // If there are no users created yet, we allow access to every user
        }

        const mgmtUser = users.find(u => u.email?.toLowerCase() === user?.email?.toLowerCase());
        if (decision === "known-user" && mgmtUser && user) {
            // check if the uid or photoURL needs to be updated in the user management system
            const needsUidUpdate = mgmtUser.uid !== user.uid;
            const needsPhotoUpdate = user.photoURL && mgmtUser.photoURL !== user.photoURL;

            if (needsUidUpdate || needsPhotoUpdate) {
                const updateReason = needsUidUpdate ? "uid" : "photoURL";
                console.debug(`User ${updateReason} has changed, updating user in user management system`);
                saveUser({
                    ...mgmtUser,
                    uid: user.uid,
                    ...(needsPhotoUpdate ? { photoURL: user.photoURL } : {})
                }).then(() => {
                    console.debug("User updated in user management system", mgmtUser);
                }).catch(e => {
                    console.error("Error updating user in user management system", e);
                });
            }
            console.debug("User found in user management system", mgmtUser);
            return true;
        }

        throw Error("Could not find a user with the provided email in the user management system.");
    }, [loading, users, usersError]);

    const userRoles = authController.user ? defineRolesFor(authController.user) : undefined;
    const isAdmin = (userRoles ?? []).some(r => r === "admin");

    const userRoleIds = userRoles;
    useEffect(() => {
        console.debug("Setting user roles", {
            userRoles,
            roles
        });
        authController.setUserRoles?.(userRoles ?? []);
    }, [userRoleIds]);

    const getUser = useCallback((uid: string): USER | null => {
        if (!users) return null;
        const user = users.find(u => u.uid === uid);
        return user ?? null;
    }, [users]);

    return {
        loading,
        roles,
        users,
        saveUser,
        saveRole,
        rolesError,
        deleteUser,
        deleteRole,
        usersError,
        isAdmin,
        allowDefaultRolesCreation: allowDefaultRolesCreation === undefined ? true : allowDefaultRolesCreation,
        defineRolesFor,
        accessGate,
        ...authController,
        initialLoading: authController.initialLoading || loading,
        userRoles: userRoles,
        getUser,
        user: authController.user ? {
            ...authController.user,
            roles: userRoles
        } : null
    }
}

const rowsToUsers = (rows: Record<string, unknown>[]): (UserWithRoleIds)[] => {
    return rows.map((row) => {
        const { id, ...data } = row;
        const newVar = {
            ...data,
            uid: id,
            created_on: data.created_on as Date | undefined,
            updated_on: data.updated_on as Date | undefined
        };
        return newVar as unknown as UserWithRoleIds;
    });
}

const rowsToRoles = (rows: Record<string, unknown>[]): Role[] => {
    return rows.map((row) => ({
        ...row,
        id: row.id
    } as unknown as Role));
}
