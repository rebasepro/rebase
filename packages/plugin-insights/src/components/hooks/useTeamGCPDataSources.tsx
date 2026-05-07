import { useCallback, useEffect, useRef, useState } from "react";
import { GCPProject, Team } from "../../types";
import {
    checkUserHasGCPPermissions,
    fetchUserGCPProjects,
    linkGcpProjectToTeam,
    unlinkGcpProjectFromTeam
} from "../../api";
import { User as FirebaseUser } from "@firebase/auth";
import { useAuthController, useSnackbarController } from "@rebasepro/core";
import { SnackbarController } from "@rebasepro/types";
import { DatakiAuthController } from "../../hooks/useDatakiAuthController";
import { DatakiConfig } from "../../DatakiProvider";

export type DisplayGCPProject = GCPProject & {
    linked: boolean;
    error?: string;
};

export interface UseTeamDatasourcesProps {
    team: Team;
    datakiConfig: DatakiConfig;
    authController: DatakiAuthController;
    snackbar: SnackbarController;
}

const STABLE_EMPTY_ARRAY: readonly string[] = Object.freeze([]);

export function useTeamGCPDataSources({
                                          team,
                                          datakiConfig,
                                          authController,
                                          snackbar
                                      }: UseTeamDatasourcesProps) {

    const [linkedTeamCGPProjects, setLinkedTeamCGPProjects] = useState<DisplayGCPProject[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(true);
    const [linkedProjectsError, setLinkedProjectsError] = useState<string | undefined>(undefined);

    const [availableGcpProjects, setAvailableGcpProjects] = useState<DisplayGCPProject[]>([]);
    const [loadingAvailableProjects, setLoadingAvailableProjects] = useState(false);
    const [availableProjectsError, setAvailableProjectsError] = useState<string | undefined>(undefined);

    const [userHasPermissionsLoading, setUserHasPermissionsLoading] = useState<boolean>(true);
    const [userHasGCPPermissionsState, setUserHasGCPPermissionsState] = useState<boolean>(false);

    const [linkStates, setLinkStates] = useState<Record<string, { loading: boolean, error?: string }>>({});
    const [unlinkStates, setUnlinkStates] = useState<Record<string, { loading: boolean, error?: string }>>({});

    const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);

    // Check user GCP permissions
    useEffect(() => {
        if (!authController.user?.uid) {
            setUserHasPermissionsLoading(false);
            setUserHasGCPPermissionsState(false);
            return;
        }
        setUserHasPermissionsLoading(true);
        checkUserHasGCPPermissions(authController.user.uid, datakiConfig.apiEndpoint)
            .then(setUserHasGCPPermissionsState)
            .catch(e => {
                console.error("Error checking GCP permissions:", e);
                setLinkedProjectsError("Could not verify Google Cloud permissions.");
                setUserHasGCPPermissionsState(false);
            })
            .finally(() => setUserHasPermissionsLoading(false));
    }, [authController.user?.uid, datakiConfig.apiEndpoint]);

    const linkedGcpProjects = team?.linked_gcp_projects ?? STABLE_EMPTY_ARRAY;

    const loadLinkedTeamProjects = useCallback(async () => {
        setLoadingProjects(true);
        setLinkedProjectsError(undefined);
        setLinkedTeamCGPProjects([]);

        const linkedProjectIds = linkedGcpProjects;

        if (!linkedProjectIds || linkedProjectIds.length === 0) {
            setLoadingProjects(false);
            return;
        }

        let failedProjects: { projectId: string, reason: string }[] = [];
        try {
            const projectPromises = linkedProjectIds.map((projectId: string) =>
                datakiConfig.getGcpProject(projectId)
                    .then((project: any) => ({
                        ...project,
                        linked: true
                    } as DisplayGCPProject))
                    .catch((error: any) => {
                        failedProjects.push({
                            projectId,
                            reason: error.message
                        });
                        console.error(`Failed to load linked project ${projectId}:`, error);
                        return {
                            projectId,
                            name: projectId,
                            linked: true,
                            error: error.message
                        } as DisplayGCPProject;
                    })
            );

            const results = await Promise.allSettled(projectPromises);

            const successfullyLoadedProjects = results
                .filter(result => result.status === "fulfilled" && result.value)
                .map(result => (result as PromiseFulfilledResult<DisplayGCPProject>).value);

            const sorted = successfullyLoadedProjects.sort((a, b) => a.name.localeCompare(b.name));
            setLinkedTeamCGPProjects(sorted);

            const failedCount = failedProjects.length;
            if (failedCount > 0) {
                setLinkedProjectsError(`Failed to load details for ${failedCount} linked project(s): ` + failedProjects.map(e => e.projectId).join(", "));
            }

        } catch (e: any) {
            console.error("Error loading linked GCP projects:", e);
            setLinkedProjectsError(e.message ?? "Failed to load linked Google Cloud projects.");
            setLinkedTeamCGPProjects([]);
        } finally {
            setLoadingProjects(false);
        }
    }, [datakiConfig, linkedGcpProjects]);

    // Load projects if user has permissions
    useEffect(() => {
        loadLinkedTeamProjects();
    }, []);

    const loadAvailableProjects = useCallback(async () => {
        const accessToken = await datakiConfig.getDatakiAuthToken();
        setLoadingAvailableProjects(true);
        setAvailableProjectsError(undefined);
        try {
            const result = await fetchUserGCPProjects(accessToken, datakiConfig.apiEndpoint);
            const enrichedProjects = result.map(project => ({
                ...project,
                linked: linkedGcpProjects?.includes(project.projectId) ?? false
            } as DisplayGCPProject));
            const sorted = enrichedProjects.sort((a, b) => a.name.localeCompare(b.name));
            setAvailableGcpProjects(sorted);
        } catch (e: any) {
            console.error("Error fetching available GCP projects:", e);
            setAvailableProjectsError(e.message ?? "Failed to load available Google Cloud projects.");
            setAvailableGcpProjects([]);
        } finally {
            setLoadingAvailableProjects(false);
        }
    }, [datakiConfig, linkedGcpProjects]);

    const initialRequest = useRef(false);
    useEffect(() => {
        if (userHasGCPPermissionsState && !initialRequest.current) {
            loadAvailableProjects();
            initialRequest.current = true;
        } else if (!userHasGCPPermissionsState) {
            setAvailableGcpProjects([]);
            initialRequest.current = false;
        }
    }, [userHasGCPPermissionsState, loadAvailableProjects]);

    const linkProject = useCallback(async (project: GCPProject) => {
        const projectId = project.projectId;
        const projectName = project.name;
        const token = await datakiConfig.getDatakiAuthToken();
        setLinkStates(prev => ({
            ...prev,
            [projectId]: { loading: true }
        }));
        try {
            const success = await linkGcpProjectToTeam(team.id, projectId, projectName, token, datakiConfig.apiEndpoint);
            if (success) {
                snackbar.open({
                    message: "Project linked successfully",
                    type: "success"
                });
                const newlyLinkedProject = {
                    ...project,
                    linked: true
                } as DisplayGCPProject;
                setLinkedTeamCGPProjects(prev => [...prev, newlyLinkedProject].sort((a, b) => a.name.localeCompare(b.name)));
                setAvailableGcpProjects(prev => prev.map(p => p.projectId === projectId ? {
                    ...p,
                    linked: true
                } : p));
                setLinkStates(prev => ({
                    ...prev,
                    [projectId]: { loading: false }
                }));
            } else {
                throw new Error("Linking operation returned false.");
            }
        } catch (error: any) {
            console.error("Error linking project:", error);
            snackbar.open({
                message: error.message ?? "Error linking project",
                type: "error"
            });
            setLinkStates(prev => ({
                ...prev,
                [projectId]: {
                    loading: false,
                    error: error.message
                }
            }));
        }
    }, [datakiConfig, team.id, snackbar]);

    const unlinkProject = useCallback(async (projectId: string) => {
        const token = await datakiConfig.getDatakiAuthToken();
        setUnlinkStates(prev => ({
            ...prev,
            [projectId]: { loading: true }
        }));
        try {
            const success = await unlinkGcpProjectFromTeam(team.id, projectId, token, datakiConfig.apiEndpoint);
            if (success) {
                snackbar.open({
                    message: "Project unlinked successfully",
                    type: "success"
                });
                setLinkedTeamCGPProjects(prev => prev.filter(p => p.projectId !== projectId));
                setAvailableGcpProjects(prev => prev.map(p => p.projectId === projectId ? {
                    ...p,
                    linked: false
                } : p));
                setUnlinkStates(prev => ({
                    ...prev,
                    [projectId]: { loading: false }
                }));
            } else {
                throw new Error("Unlinking operation returned false.");
            }
        } catch (error: any) {
            console.error("Error unlinking project:", error);
            snackbar.open({
                message: error.message ?? "Error unlinking project",
                type: "error"
            });
            setUnlinkStates(prev => ({
                ...prev,
                [projectId]: {
                    loading: false,
                    error: error.message
                }
            }));
        }
    }, [datakiConfig, team.id, snackbar]);

    return {
        linkedTeamProjects: linkedTeamCGPProjects,
        loadingProjects,
        linkedProjectsError,
        availableGcpProjects,
        loadingAvailableProjects,
        availableProjectsError,
        userHasPermissionsLoading,
        userHasGCPPermissions: userHasGCPPermissionsState,
        linkStates,
        unlinkStates,
        isLinkDialogOpen,
        setIsLinkDialogOpen,
        linkProject,
        unlinkProject,
    };
}
