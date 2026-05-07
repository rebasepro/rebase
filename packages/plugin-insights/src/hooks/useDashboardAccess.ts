import { useEffect, useState } from "react";
import { getFirestore, doc, getDoc } from "@firebase/firestore";
import { FirebaseApp } from "@firebase/app";
import { Dashboard } from "../types";

type User = { uid: string; [key: string]: any };

export interface DashboardAccessResult {
    loading: boolean;
    canAccess: boolean;
    isPublic: boolean;
    dashboard: Dashboard | null;
    error: Error | null;
}

export function useDashboardAccess(
    dashboardId: string | undefined,
    firebaseApp: FirebaseApp | undefined,
    user: User | null
): DashboardAccessResult {
    const [loading, setLoading] = useState(true);
    const [canAccess, setCanAccess] = useState(false);
    const [isPublic, setIsPublic] = useState(false);
    const [dashboard, setDashboard] = useState<Dashboard | null>(null);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!dashboardId || !firebaseApp) {
            setLoading(false);
            setCanAccess(false);
            setIsPublic(false);
            setDashboard(null);
            setError(null);
            return;
        }

        const checkAccess = async () => {
            try {
                setLoading(true);
                setError(null);

                const firestore = getFirestore(firebaseApp);
                const dashboardDoc = doc(firestore, "dashboards", dashboardId);
                const docSnapshot = await getDoc(dashboardDoc);

                if (!docSnapshot.exists()) {
                    setCanAccess(false);
                    setIsPublic(false);
                    setDashboard(null);
                    setError(new Error("Dashboard not found"));
                    return;
                }

                const dashboardData = {
                    id: docSnapshot.id,
                    ...docSnapshot.data()
                } as Dashboard;

                setDashboard(dashboardData);

                // Check if dashboard is deleted
                if (dashboardData.deleted) {
                    setCanAccess(false);
                    setIsPublic(false);
                    setError(new Error("Dashboard not found"));
                    return;
                }

                // Check if dashboard is public
                const dashboardIsPublic = !!dashboardData.public;
                setIsPublic(dashboardIsPublic);

                if (dashboardIsPublic) {
                    setCanAccess(true);
                    return;
                }

                // If not public, check if user has access
                if (!user) {
                    setCanAccess(false);
                    return;
                }

                // Check if user has read permissions
                const hasReadAccess = dashboardData._users_read?.includes(user.uid) ?? false;
                setCanAccess(hasReadAccess);

            } catch (err) {
                console.error("Error checking dashboard access:", err);
                setError(err as Error);
                setCanAccess(false);
                setIsPublic(false);
                setDashboard(null);
            } finally {
                setLoading(false);
            }
        };

        checkAccess();
    }, [dashboardId, firebaseApp, user?.uid]);

    return {
        loading,
        canAccess,
        isPublic,
        dashboard,
        error
    };
}
