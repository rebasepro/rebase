import { History, Type } from "lucide-react";
import React, { useEffect, useState } from "react";
import {
    collection,
    doc,
    getDoc,
    getFirestore,
    limit as firestoreLimit,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    Timestamp,
    where
} from "@firebase/firestore";
import {
    ChatSession,
    Dashboard,
    DashboardFilterConfig,
    DashboardPage,
    DashboardUpdateType,
    DashboardWidgetConfig,
    DatakiUser,
    DryChartWidgetConfig,
    DryFilterWidgetConfig,
    DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    FilterWidgetItem,
    GCPProject,
    Position,
    Team,
    TextItem,
    WidgetDeltaUpdate,
    WidgetSize
} from "./types";
import { generateWidgetId } from "./utils/widgets";
import { randomString, removeUndefined } from "@rebasepro/utils";
import equal from "react-fast-compare"
import { convertWidgetToDashboardConfig, reorderPageWidgetsIfNeeded } from "./utils/dashboards";

import {
    DatakiConfig,
    DatakiConfigContext,
    DatakiConfigParams,
    ListenChatSessionsParams,
    useDataki
} from "./DatakiContext";

// Re-export for backward compatibility
export { useDataki };
export type { DatakiConfig };

export function useBuildDatakiConfig({
    enabled = true,
    firebaseApp,
    getDatakiAuthToken,
    apiEndpoint,
    user,
    authLoading = false,
    appBarRef,
}: DatakiConfigParams): DatakiConfig {

    const userSessionsPath = `/users/${user?.uid}/chat_sessions`;

    const dashboardsRef = React.useRef<Dashboard[]>([]);

    const [userData, setUserData] = useState<DatakiUser | null>(null);

    const [dashboards, setDashboards] = useState<Dashboard[]>([]);
    const [dashboardsLoading, setDashboardsLoading] = useState<boolean>(true);

    const [teams, setTeams] = useState<Team[]>([]);
    const [teamsLoading, setTeamsLoading] = useState<boolean>(true);

    const [relatedUsers, setRelatedUsers] = useState<DatakiUser[]>([]);

    //listen to user data
    useEffect(() => {
        if (!enabled) return;
        if (!firebaseApp) return; // Don't throw error, just wait for firebaseApp
        const firestore = getFirestore(firebaseApp);
        if (!firestore) return;

        if (!user?.uid) {
            setUserData(null);
            return;
        }

        return onSnapshot(doc(firestore, "users", user.uid).withConverter(timestampToDateConverter), {
            next: (snapshot) => {
                if (!snapshot.exists()) {
                    setUserData(null);
                    return;
                }
                const userData = {
                    id: snapshot.id,
                    ...snapshot.data()
                } as DatakiUser;
                setUserData(userData);
            },
            error: (e) => {
                console.error("Error listening to user data:", e);
                console.error(e);
            }
        });
    }, [enabled, firebaseApp, user?.uid]);

    //listen to related users
    useEffect(() => {
        if (!enabled) return;
        if (!user?.uid) return;
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) return;

        return onSnapshot(
            query(
                collection(firestore, "users"),
                where("related_users", "array-contains", user.uid)
            ),
            {
                next: (snapshot) => {
                    const relatedUsers = snapshot.docs.map(doc => {
                        return {
                            id: doc.id,
                            ...doc.data()
                        } as unknown as DatakiUser;
                    });
                    setRelatedUsers(relatedUsers);
                },
                error: (e) => {
                    console.error("Error listening to related users:", e);
                    console.error(e);
                }
            }
        );
    }, [enabled, firebaseApp, user?.uid]);

    useEffect(() => {
        if (!enabled) {
            setDashboardsLoading(false);
            return;
        }
        if (!firebaseApp) return; // Don't throw error, just wait for firebaseApp
        const firestore = getFirestore(firebaseApp);
        if (!firestore) return;

        // Don't set loading to false until auth has finished loading
        if (authLoading) {
            return;
        }

        // If no user, just set empty dashboards and mark as not loading
        // Individual dashboard access will be handled by the dashboard route
        if (!user?.uid) {
            updateDashboards([]);
            setDashboardsLoading(false);
            return;
        }

        setDashboardsLoading(true); // Keep loading true until first snapshot arrives
        return onSnapshot(
            query(
                collection(firestore, "dashboards").withConverter(timestampToDateConverter),
                where("deleted", "==", false),
                where("_users_read", "array-contains", user.uid),
                orderBy("updated_at", "desc")
            ),
            {
                next: (snapshot) => {
                    const updatedDashboards = snapshot.docs.map(doc => {
                        return {
                            id: doc.id,
                            ...doc.data()
                        } as Dashboard;
                    });
                    updateDashboards(updatedDashboards);
                    setDashboardsLoading(false);
                },
                error: (e) => {
                    console.error(e);
                    setDashboardsLoading(false);
                }
            }
        );
    }, [enabled, firebaseApp, user?.uid, authLoading]);

    useEffect(() => {
        if (!enabled) {
            setTeamsLoading(false);
            return;
        }

        // Don't set loading to false until auth has finished loading
        if (authLoading) {
            return;
        }

        if (!user?.uid) {
            setTeams([]);
            setTeamsLoading(false);
            return;
        }
        if (!firebaseApp) return; // Don't throw error, just wait for firebaseApp
        const firestore = getFirestore(firebaseApp);
        if (!firestore) return;

        setTeamsLoading(true); // Keep loading true until first snapshot arrives
        return onSnapshot(
            query(
                collection(firestore, "teams"),
                where("deleted", "==", false),
                where("users", "array-contains", user.uid)
            ).withConverter(timestampToDateConverter),
            {
                next: (snapshot) => {
                    setTeams(snapshot.docs.map(doc => {
                        return {
                            id: doc.id,
                            ...doc.data()
                        } as Team;
                    }));
                    setTeamsLoading(false);
                },
                error: (e) => {
                    console.error("Error listening to teams:", e);
                    console.error(e);
                    setTeamsLoading(false);
                }
            }
        );
    }, [enabled, firebaseApp, user?.uid, authLoading]);

    function updateDashboards(newDashboards: Dashboard[]) {
        dashboardsRef.current = newDashboards;
        setDashboards(newDashboards);
    }

    async function createTeam(team: Omit<Team, "id">): Promise<Team> {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        if (!user) throw Error("User not found");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");

        console.log("Creating team", team);
        const documentReference = doc(collection(firestore, "teams"));
        const id = documentReference.id;
        const data = {
            ...team,
            deleted: false,
            users: [user.uid],
            created_by: user.uid,
            created_at: new Date(),
            updated_at: new Date()
        };
        await setDoc(documentReference, data);
        return {
            ...data,
            id
        } as unknown as Team;
    }

    async function saveTeam(team: Team) {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        const {
            id,
            ...teamData
        } = team;
        const teamDoc = doc(firestore, "teams", id);
        const docSnapshot = await getDoc(teamDoc);
        if (!docSnapshot.exists()) {
            throw Error("Team not found");
        }
        return setDoc(teamDoc, {
            ...teamData,
            updated_at: new Date()
        });
    }

    async function deleteTeam(teamId: string) {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        const teamDoc = doc(firestore, "teams", teamId);
        const docSnapshot = await getDoc(teamDoc);
        if (!docSnapshot.exists()) {
            throw Error("Team not found");
        }
        return setDoc(teamDoc, {
            deleted: true,
            updated_at: new Date()
        });
    }

    async function getTeam(teamId: string) {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        const teamDoc = doc(firestore, "teams", teamId);
        const docSnapshot = await getDoc(teamDoc);
        if (!docSnapshot.exists()) {
            throw Error("Team not found");
        }
        return {
            id: docSnapshot.id,
            ...docSnapshot.data()
        } as Team;
    }

    const getGcpProject = async (projectId: string): Promise<GCPProject> => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore or gcpProjectsPath not initialised");

        const projectDocRef = doc(firestore, "gcp_projects", projectId);
        const docSnapshot = await getDoc(projectDocRef);

        if (!docSnapshot.exists()) {
            console.warn(`GCP Project with ID ${projectId} not found in Firestore collection gcp_projects.`);
            throw new Error(`GCP Project with ID ${projectId} not found`);
        }

        return {
            id: docSnapshot.id,
            projectId: docSnapshot.id,
            name: docSnapshot.data()?.name ?? `Project ${projectId}`,
            ...docSnapshot.data()
        } as unknown as GCPProject;
    };

    const getUser = async (uid: string) => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        const userDoc = doc(firestore, "users", uid);
        const docSnapshot = await getDoc(userDoc);
        if (!docSnapshot.exists()) {
            throw Error("User not found");
        }
        return {
            id: docSnapshot.id,
            ...docSnapshot.data()
        } as unknown as DatakiUser;
    }

    const updateDashboardPermissions = async ({
        dashboardId,
        uid,
        teamId,
        permissions
    }: {
        dashboardId: string,
        uid?: string,
        teamId?: string,
        permissions: "read" | "write"
    }) => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("updateDashboardPermissions: Dashboard not found");
        const updatedPermissions = dashboard.permissions?.map(p => {
            if (p.uid === uid || (teamId !== undefined && p.team_id === teamId)) {
                return {
                    ...p,
                    type: permissions
                }
            }
            return p;
        }) ?? [];
        return saveDashboard({
            ...dashboard,
            permissions: updatedPermissions
        }, "permissions_update");
    }

    const createChatSessionId = async (): Promise<string> => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore || !userSessionsPath) throw Error("useBuildDatakiConfig Firestore not initialised");
        return doc(collection(firestore, userSessionsPath)).id;
    };

    const saveChatSession = async (session: ChatSession) => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore || !userSessionsPath) throw Error("useBuildDatakiConfig Firestore not initialised");
        const {
            id,
            ...sessionData
        } = session;
        const sessionDoc = doc(firestore, userSessionsPath, id);
        return setDoc(sessionDoc, {
            ...(removeUndefined(sessionData) as object),
            updated_at: new Date()
        });
    };

    const getChatSession = async (sessionId: string) => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore || !userSessionsPath) throw Error("useBuildDatakiConfig Firestore not initialised");
        const sessionDoc = doc(firestore, userSessionsPath, sessionId);
        const docSnapshot = await getDoc(sessionDoc);
        if (!docSnapshot.exists()) {
            return undefined;
        }
        return {
            id: docSnapshot.id,
            ...docSnapshot.data()
        } as ChatSession;
    }

    const listenChatSession = (sessionId: string, onUpdate: (session: ChatSession | null) => void) => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore || !userSessionsPath) throw Error("useBuildDatakiConfig Firestore not initialised");

        const sessionDoc = doc(firestore, userSessionsPath, sessionId);
        return onSnapshot(sessionDoc.withConverter(timestampToDateConverter), {
            next: (snapshot) => {
                if (!snapshot.exists()) {
                    onUpdate(null);
                    return;
                }
                onUpdate({
                    id: snapshot.id,
                    ...snapshot.data()
                } as ChatSession);
            },
            error: (e) => {
                console.error("listenChatSession: Error listening to session:", sessionId, e);
            }
        });
    };

    const listenChatSessions = ({
        dashboardId,
        limit: queryLimit = 20,
        onChatSessionsUpdate
    }: ListenChatSessionsParams) => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore || !userSessionsPath) throw Error("useBuildDatakiConfig Firestore not initialised");

        // If a dashboardId is provided, filter by it; otherwise fetch all sessions
        const baseCollection = collection(firestore, userSessionsPath);
        console.debug("listenChatSessions: Querying chat sessions", { dashboardId, userSessionsPath, limit: queryLimit });
        const sessionsRef = dashboardId === undefined
            ? query(baseCollection, orderBy("updated_at", "desc"), firestoreLimit(queryLimit))
            : query(baseCollection, where("dashboardId", "==", dashboardId), orderBy("updated_at", "desc"), firestoreLimit(queryLimit));

        return onSnapshot(sessionsRef.withConverter(timestampToDateConverter), {
            next: async (snapshot) => {
                console.debug("listenChatSessions: Got", snapshot.docs.length, "sessions for dashboardId:", dashboardId);
                const sessions = snapshot.docs.map(async doc => {
                    return {
                        id: doc.id,
                        ...doc.data()
                    } as ChatSession;
                });
                onChatSessionsUpdate?.(await Promise.all(sessions));
            },
            error: (e) => {
                console.error("listenChatSessions: Error querying chat sessions for dashboardId:", dashboardId, e);
                // If this is an index error, the error message will contain a URL to create the index
                if (e instanceof Error && e.message.includes("index")) {
                    console.error("listenChatSessions: A Firestore index may be required. Check the error message for a link to create it.");
                }
            }
        });

    }

    const saveDashboard = async (dashBoard: Dashboard, updateType?: DashboardUpdateType) => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        const {
            id,
            ...dashboardData
        } = dashBoard;
        const dashboardDoc = doc(firestore, "dashboards", id);

        // update dashboards ref
        if (dashboardsRef.current.map(d => d.id).includes(id)) {
            dashboardsRef.current = dashboardsRef.current.map(d => d.id === id ? dashBoard : d);
            updateDashboards(dashboardsRef.current);
        } else {
            dashboardsRef.current = [dashBoard, ...dashboardsRef.current];
            updateDashboards(dashboardsRef.current);
        }

        const pages = (dashboardData.pages ?? []).map(reorderPageWidgetsIfNeeded);

        const data = {
            ...dashboardData,
            pages,
            updated_at: new Date(),
            updated_by: user?.uid,
            updated_type: updateType ?? null
        };
        console.log("Saving dashboard", dashboardDoc.id, data, updateType);
        return setDoc(dashboardDoc, data, { merge: true });
    };

    const listenDashboard = (id: string, onDashboardUpdate: (dashboard: Dashboard | null) => void, onError: (error: Error) => void) => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        return onSnapshot(doc(firestore, "dashboards", id).withConverter(timestampToDateConverter), {
            next: (snapshot) => {
                if (!snapshot.exists()) {
                    onDashboardUpdate(null);
                    return;
                }
                const dashboard = {
                    id: snapshot.id,
                    ...snapshot.data()
                } as Dashboard;
                onDashboardUpdate(dashboard);
            },
            error: (e) => {
                console.error(e);
                onError(e);
            }
        });
    };

    const listenDashboardHistory = (id: string, onHistoryUpdate: (history: Dashboard[]) => void, historyLimit: number = 20) => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        return onSnapshot(
            query(
                collection(firestore, "dashboards", id, "history"),
                orderBy("updated_at", "desc"),
                firestoreLimit(historyLimit)
            ).withConverter(timestampToDateConverter), {
            next: async (snapshot) => {
                const history = snapshot.docs.map(async doc => {
                    const updatedByUser = doc.data().updated_by ? await getUser(doc.data().updated_by) : null;
                    return {
                        id,
                        revision: doc.id,
                        ...doc.data(),
                        updatedByUser
                    } as Dashboard;
                });
                onHistoryUpdate(await Promise.all(history));
            },
            error: (e) => {
                console.error(e);
            }
        });

    }

    const createDashboard = async (dashboardData?: Partial<Dashboard>): Promise<Dashboard> => {
        if (user === null)
            throw Error("User not found");
        if (!firebaseApp)
            throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        const documentReference = doc(collection(firestore, "dashboards"));
        const id = documentReference.id;
        const data = initializeDashboard(user.uid, dashboardData);
        const newDashboard = { id, ...data };
        updateDashboards([newDashboard, ...dashboardsRef.current]);
        await setDoc(documentReference, data);
        return newDashboard;
    };

    const duplicateDashboard = async (dashboardId: string): Promise<Dashboard> => {
        if (user === null)
            throw Error("User not found");
        if (!firebaseApp)
            throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");

        const sourceDashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!sourceDashboard) throw Error("duplicateDashboard: Dashboard not found");

        const documentReference = doc(collection(firestore, "dashboards"));
        const id = documentReference.id;

        // Create a copy with new IDs for widgets
        const duplicatedPages = sourceDashboard.pages.map(page => ({
            ...page,
            id: randomString(20),
            widgets: page.widgets.map(widget => ({
                ...widget,
                id: generateWidgetId()
            }))
        }));

        const data = {
            ...sourceDashboard,
            title: `${sourceDashboard.title || "Untitled"} (Copy)`,
            pages: duplicatedPages,
            created_at: new Date(),
            updated_at: new Date(),
            created_by: user.uid,
            updated_by: user.uid,
            updated_type: "dashboard_create" as DashboardUpdateType,
            owner: user.uid,
            _users_write: [user.uid],
            _users_read: [user.uid],
            copy_of: sourceDashboard.id,
            permissions: [{
                uid: user.uid,
                type: "write" as const
            }]
        };

        // Remove the id from data object
        const {
            id: _id,
            ...dataWithoutId
        } = data;

        const newDashboard = { id, ...dataWithoutId };
        updateDashboards([newDashboard, ...dashboardsRef.current]);
        await setDoc(documentReference, dataWithoutId);
        return newDashboard;
    };

    const deleteDashboard = async (id: string) => {
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        const dashboard = dashboardsRef.current.find(d => d.id === id);
        if (!dashboard) throw Error("deleteDashboard: Dashboard not found");
        dashboard.deleted = true;
        return saveDashboard(dashboard, "dashboard_delete");
    }

    const addDashboardText = (dashboardId: string, pageId: string, node: TextItem) => {
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("addDashboardText: Dashboard not found");
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) throw Error("addDashboardText: Page not found");
        page.widgets.push(node);
        return saveDashboard(dashboard, "text_update");
    };

    const updateDashboardText = (dashboardId: string, pageId: string, id: string, node: TextItem) => {
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("updateDashboardText: Dashboard not found");
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) throw Error("updateDashboardText: Page not found");
        const widgetIndex = page.widgets.findIndex(w => w.id === id);
        if (widgetIndex === -1) throw Error("updateDashboardText: Widget not found");
        page.widgets.splice(widgetIndex, 1, node);
        return saveDashboard(dashboard, "text_update");
    };

    const addDashboardWidget = (id: string, widget: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig | DryFilterWidgetConfig): DashboardWidgetConfig | FilterWidgetItem => {
        const dashboard = dashboardsRef.current.find(d => d.id === id);
        if (!dashboard) throw Error("addDashboardWidget: Dashboard not found");
        const dashboardPage = dashboard.pages[0];
        const newWidget = convertWidgetToDashboardConfig(dashboardPage, widget);
        dashboardPage.widgets.push(newWidget);
        saveDashboard(dashboard, "widget_create").catch(console.error);
        return newWidget;
    };

    const onWidgetResize = (dashboardId: string, pageId: string, id: string, size: WidgetSize) => {
        console.log("onWidgetResize", dashboardId, pageId, id, size)
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("addDashboardWidget: Dashboard not found");
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) throw Error("addDashboardWidget: Page not found");
        const widget = page.widgets.find(w => w.id === id);
        if (!widget) throw Error("addDashboardWidget: Widget not found");
        widget.size = size;
        return saveDashboard(dashboard, "widget_resize");
    };

    const onWidgetMove = (dashboardId: string, pageId: string, id: string, position: Position) => {
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("addDashboardWidget: Dashboard not found");
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) throw Error("addDashboardWidget: Page not found");
        const widget = page.widgets.find(w => w.id === id);
        if (!widget) throw Error("addDashboardWidget: Widget not found");
        if (equal(widget.position, position)) return;
        console.log("onWidgetMove", dashboardId, pageId, id, position)
        widget.position = position;
        return saveDashboard(dashboard, "widget_move");
    };

    const onWidgetRemove = (dashboardId: string, pageId: string, id: string) => {
        console.log("onWidgetRemove", dashboardId, pageId, id)
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("addDashboardWidget: Dashboard not found");
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) throw Error("addDashboardWidget: Page not found");
        const widgetIndex = page.widgets.findIndex(w => w.id === id);
        if (widgetIndex === -1) throw Error("addDashboardWidget: Widget not found");
        page.widgets.splice(widgetIndex, 1);
        return saveDashboard(dashboard, "widget_remove");
    };

    const onWidgetsRemove = (dashboardId: string, pageId: string, ids: string[]) => {
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("addDashboardWidget: Dashboard not found");
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) throw Error("addDashboardWidget: Page not found");
        const widgets = page.widgets.filter(w => !ids.includes(w.id));
        page.widgets = widgets;
        return saveDashboard(dashboard, "widgets_remove");
    };

    const onWidgetUpdate = (dashboardId: string, pageId: string, id: string, widget: DashboardWidgetConfig | FilterWidgetItem) => {
        console.log("updateDashboardWidget", dashboardId, pageId, id, widget)
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("addDashboardWidget: Dashboard not found");
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) throw Error("addDashboardWidget: Page not found");
        const existingWidget = page.widgets.find(w => w.id === id);
        if (!existingWidget) throw Error("addDashboardWidget: Widget not found");
        const widgetIndex = page.widgets.findIndex(w => w.id === id);
        if (widgetIndex === -1) throw Error("addDashboardWidget: Widget not found");
        const currentWidget = page.widgets[widgetIndex];
        if (equal(currentWidget, widget)) return;
        page.widgets.splice(widgetIndex, 1, widget);
        return saveDashboard(dashboard, "widget_update");
    };

    const updateDashboard = (dashboardId: string, dashboardData: Partial<Dashboard>, updateType?: DashboardUpdateType) => {
        console.log("updateDashboard", dashboardId, dashboardData)
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakConfig Firestore not initialised");
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("addDashboardWidget: Dashboard not found");

        // Exclude _users_read and _users_write - let the Cloud Function manage them
        const {
            _users_read,
            _users_write,
            ...dashboardWithoutUserArrays
        } = dashboard;

        const updatedDashboard = {
            ...dashboardWithoutUserArrays,
            ...dashboardData
        };
        return saveDashboard(updatedDashboard, updateType);
    };

    const updateDashboardPage = (dashboardId: string, pageId: string, pageData: Partial<DashboardPage>) => {
        console.log("updateDashboardPage", dashboardId, pageId, pageData)
        if (!firebaseApp) throw Error("useBuildDatakiConfig Firebase not initialised");
        const firestore = getFirestore(firebaseApp);
        if (!firestore) throw Error("useBuildDatakiConfig Firestore not initialised");
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("addDashboardWidget: Dashboard not found");
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) throw Error("addDashboardWidget: Page not found");
        const updatedPage = {
            ...page,
            ...pageData
        };

        // Exclude _users_read and _users_write - let the Cloud Function manage them
        const {
            _users_read,
            _users_write,
            ...dashboardWithoutUserArrays
        } = dashboard;

        const updatedDashboard = {
            ...dashboardWithoutUserArrays,
            pages: dashboard.pages.map(p => p.id === pageId ? updatedPage : p)
        };
        return saveDashboard(updatedDashboard, "page_update");
    };

    const revertDashboard = async (dashboard: Dashboard) => {
        console.log("revertDashboard", dashboard.id);
        const updatedDashboard = {
            id: dashboard.id,
            title: dashboard.title,
            pages: dashboard.pages
        };
        return updateDashboard(dashboard.id, updatedDashboard, "dashboard_revert");
    }

    const addFilterToDashboard = (dashboardId: string, pageId: string, filter: DashboardFilterConfig) => {
        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("addDashboardWidget: Dashboard not found");
        const page = dashboard.pages.find(p => p.id === pageId);
        if (!page) throw Error("addDashboardWidget: Page not found");
        if (!page.filters) {
            page.filters = [];
        }

        const existingFilterIndex = page.filters.findIndex(f => f.key === filter.key);
        let updateType: DashboardUpdateType;

        if (existingFilterIndex !== -1) {
            // Replace existing filter
            page.filters.splice(existingFilterIndex, 1, filter);
            updateType = "filter_update";
        } else {
            // Add new filter
            page.filters.push(filter);
            updateType = "filter_add";
        }

        return saveDashboard(dashboard, updateType);
    }

    const addFilterAndUpdateWidgets = (dashboardId: string, pageId: string, filter: DashboardFilterConfig, widgetUpdates: WidgetDeltaUpdate[]) => {

        const dashboard = dashboardsRef.current.find(d => d.id === dashboardId);
        if (!dashboard) throw Error("addDashboardWidget: Dashboard not found");
        const dashboardPage = dashboard.pages.find(p => p.id === pageId);
        if (!dashboardPage) throw Error("addDashboardWidget: Page not found");

        // apply all widgetUpdates
        const updates = widgetUpdates.map(update => {
            const widget = dashboardPage.widgets
                .find(w => w.id === update.widgetId) as DashboardWidgetConfig;
            if (widget?.type !== "chart" && widget?.type !== "table" && widget?.type !== "scorecard") {
                throw new Error("FilterSuggestionView INTERNAL: No widget found " + update.widgetId);
            }
            const updatedWidget = {
                ...widget,
                ...update.delta
            } as DashboardWidgetConfig;
            return updatedWidget;
        });

        // replace the updated widgets in the dashboard page
        const updatedWidgets = dashboardPage.widgets.map(widget => {
            const update = updates.find(u => u.id === widget.id);
            if (update) {
                return update;
            }
            return widget;
        });
        const updatedDashboardPage: DashboardPage = {
            ...dashboardPage,
            widgets: updatedWidgets,
            filters: [...(dashboardPage.filters ?? []), filter]
        };

        // Exclude _users_read and _users_write - let the Cloud Function manage them
        const {
            _users_read,
            _users_write,
            ...dashboardWithoutUserArrays
        } = dashboard;

        const updatedDashboard: Dashboard = {
            ...dashboardWithoutUserArrays,
            pages: dashboard.pages.map(p => p.id === pageId ? updatedDashboardPage : p)
        };

        return saveDashboard(updatedDashboard, "filter_add");
    }

    return {
        loading: dashboardsLoading || teamsLoading,
        apiEndpoint,
        getDatakiAuthToken,
        userData,
        teams,
        getTeam,
        createTeam,
        saveTeam,
        deleteTeam,
        getUser,
        updateDashboardPermissions,
        createChatSessionId,
        saveChatSession,
        getChatSession,
        listenChatSession,
        listenChatSessions,
        dashboards,
        createDashboard,
        duplicateDashboard,
        saveDashboard,
        updateDashboard,
        deleteDashboard,
        listenDashboard,
        listenDashboardHistory,
        addDashboardText,
        updateDashboardText,
        addDashboardWidget,
        onWidgetResize,
        onWidgetUpdate,
        onWidgetMove,
        onWidgetRemove,
        onWidgetsRemove,
        revertDashboard,
        updateDashboardPage,
        relatedUsers,
        getGcpProject,
        addFilterToDashboard,
        addFilterAndUpdateWidgets,
        firebaseApp,
        appBarRef
    };
}

export function DatakiProvider({
    config,
    children
}: { config: DatakiConfig, children: React.ReactNode }) {

    return <DatakiConfigContext.Provider value={config}>
        {children}
    </DatakiConfigContext.Provider>;
}

const timestampToDateConverter = {
    toFirestore(data: any) {
        return data; // This can be customized based on your write needs
    },
    fromFirestore(snapshot: any, options: any) {
        const data = snapshot.data(options);
        return convertTimestamps(data);
    }
};

function convertTimestamps(data: any): any {
    if (data instanceof Timestamp) {
        return data.toDate(); // Convert Timestamp directly if the item is a Timestamp
    } else if (Array.isArray(data)) {
        return data.map(item => convertTimestamps(item)); // Process arrays recursively
    } else if (data !== null && typeof data === "object") {
        for (const key in data) {
            data[key] = convertTimestamps(data[key]); // Recursively process object properties
        }
        return data;
    }
    return data; // Return the data if it is neither a Timestamp nor a complex object/array
}

function initializeDashboard(uid: string, dashboardData?: Partial<Dashboard>): Omit<Dashboard, "id"> {
    return {
        created_at: new Date(),
        updated_at: new Date(),
        _users_write: [uid],
        _users_read: [uid],
        owner: uid,
        permissions: [{
            uid,
            type: "write"
        }],
        pages: [{
            id: randomString(20),
            widgets: [],
            filters: [],
        }],
        deleted: false,
        updated_by: uid,
        updated_type: "dashboard_create",
        ...dashboardData
    };
}

