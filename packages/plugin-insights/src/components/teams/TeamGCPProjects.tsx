import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, LoadingButton, Paper, Table, TableBody, TableCell, TableRow, Tooltip, Typography } from "@rebasepro/ui";
import { Link2Off as LinkOffIcon, Link as LinkIcon } from "lucide-react";
import React from "react";
import { GCPProject, Team } from "../../types";
import { useDataki } from "../../DatakiProvider";
import { ErrorView, useAuthController, useSnackbarController } from "@rebasepro/core";
import { DatakiLogin } from "../DatakiLogin";
import { DatakiAuthController } from "../../hooks/useDatakiAuthController";
import { User as FirebaseUser } from "@firebase/auth";
import { DisplayGCPProject, useTeamGCPDataSources } from "../hooks/useTeamGCPDataSources";
import BQLogo from "../images/bq_icon.svg";
import { AnimateHeight } from "../AnimateHeight";

interface TeamLinkedProjectsProps {
    team: Team;
    onAnalyticsEvent?: (event: string, params?: any) => void;
}

export function AvailableUserGCPProjects({
                                             availableGcpProjects,
                                             availableProjectsError,
                                             loadingAvailableProjects,
                                             linkProject,
                                             linkStates
                                         }: {
    loadingAvailableProjects: boolean,
    availableGcpProjects: DisplayGCPProject[],
    availableProjectsError: string | undefined,
    linkProject: (project: GCPProject) => void,
    linkStates: Record<string, { loading: boolean, error?: string }>,
}) {
    return <>
        <Typography color="secondary">
            Select a project to link it with Dataki for this team. Linking allows Dataki to query datasets
            within the project.
        </Typography>

        {loadingAvailableProjects && availableGcpProjects.length === 0 && <CircularProgress/>}
        {availableProjectsError && <ErrorView error={availableProjectsError}/>}

        {!loadingAvailableProjects && !availableProjectsError && availableGcpProjects.length === 0 && (
            <Typography color="secondary">No Google Cloud projects found or accessible.</Typography>
        )}

        {!availableProjectsError && availableGcpProjects.length > 0 && (
            <Paper className="max-h-96 overflow-y-auto">
                <Table className="w-full rounded-lg overflow-hidden">
                    <TableBody>
                        {availableGcpProjects.map((project) => {
                            const linkState = linkStates[project.projectId] ?? { loading: false };
                            return (
                                <TableRow key={project.projectId}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <img src={BQLogo} alt="BigQuery icon" className="w-12 h-12 mr-4"/>
                                            {project.name}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="caption" color="secondary">
                                            {project.projectId}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        {project.linked ? (
                                            <div
                                                className="flex items-center justify-end gap-1 text-green-600">
                                                <LinkIcon size="small"/>
                                                <Typography variant="caption">Linked</Typography>
                                            </div>
                                        ) : (
                                            <LoadingButton
                                                variant="outlined"
                                                size="small"
                                                loading={linkState.loading}
                                                onClick={() => linkProject(project)} // project here is DisplayGCPProject, linkProject expects GCPProject
                                            >
                                                Link
                                            </LoadingButton>
                                        )}
                                        {linkState.error && <Typography color="error"
                                                                        variant="caption">{linkState.error}</Typography>}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Paper>
        )}
        <Alert color="base" className={"text-xs"}>It may take a couple of minutes after linking a project
            before its datasets become available for querying.</Alert>
    </>;
}

export function TeamGCPProjects({ team, onAnalyticsEvent }: TeamLinkedProjectsProps) {

    const datakiConfig = useDataki();
    const authController = useAuthController<FirebaseUser, DatakiAuthController>();
    const snackbar = useSnackbarController();

    const {
        linkedTeamProjects,
        loadingProjects,
        linkedProjectsError,
        availableGcpProjects,
        loadingAvailableProjects,
        availableProjectsError,
        userHasPermissionsLoading,
        userHasGCPPermissions,
        linkStates,
        unlinkStates,
        isLinkDialogOpen,
        setIsLinkDialogOpen,
        linkProject,
        unlinkProject
    } = useTeamGCPDataSources({
        team,
        datakiConfig,
        authController,
        snackbar
    });

    const handleLinkProject = (project: GCPProject) => {
        onAnalyticsEvent?.("gcp_project_link_initiated", {
            team_id: team.id,
            project_id: project.projectId,
            project_name: project.name
        });
        linkProject(project);
    };

    const handleUnlinkProject = (projectId: string) => {
        onAnalyticsEvent?.("gcp_project_unlink_initiated", {
            team_id: team.id,
            project_id: projectId
        });
        unlinkProject(projectId);
    };

    const handleOpenLinkDialog = () => {
        onAnalyticsEvent?.("gcp_project_link_dialog_opened", {
            team_id: team.id
        });
        setIsLinkDialogOpen(true);
    };

    return (
        <div className="space-y-2">
            <div className="flex gap-4 justify-center items-center">
                <Typography variant="subtitle2" className={"flex-1"}>Linked Google Cloud Projects</Typography>
                {userHasPermissionsLoading && <CircularProgress size={"smallest"}/>}
                {userHasGCPPermissions && (
                    <Button
                        variant="filled"
                        size={"small"}
                        color={"neutral"}
                        onClick={handleOpenLinkDialog}
                        disabled={loadingProjects || userHasPermissionsLoading}
                    >
                        <LinkIcon/>
                        Link New Google Project
                    </Button>
                )}
            </div>

            {!userHasPermissionsLoading && !userHasGCPPermissions && (
                <div className="flex gap-4" >
                    <Alert color="info" size={"small"} className="text-sm flex-grow">
                        You need to grant Dataki access to your Google Cloud projects to link them.
                    </Alert>
                    <DatakiLogin authController={authController}
                                 datakiConfig={datakiConfig}
                                 smallLayout={true}
                                 includeGCPScope={true}/>
                </div>
            )}

            {loadingProjects && <CircularProgress/>}
            {linkedProjectsError && <ErrorView error={linkedProjectsError}/>}

            <AnimateHeight isOpen={!loadingProjects && !linkedProjectsError && linkedTeamProjects.length === 0}>
                <Paper className="overflow-hidden p-8 flex justify-center items-center">
                    <Typography variant="body2" color="secondary">No Google Cloud projects are currently linked to this
                        team.</Typography>
                </Paper>
            </AnimateHeight>

            <AnimateHeight isOpen={!loadingProjects && linkedTeamProjects.length > 0}>
                <Paper className="overflow-hidden">
                    <Table className={"w-full rounded-lg overflow-hidden"}>
                        <TableBody>
                            {linkedTeamProjects.map((project) => {
                                const unlinkState = unlinkStates[project.projectId] ?? { loading: false };
                                return (
                                    <TableRow key={project.projectId}>
                                        <TableCell>
                                            <div className="flex items-center gap-2 font-medium">
                                                <img src={BQLogo} alt="BigQuery icon" className="w-12 h-12 mr-4"/>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        {project.name}
                                                        {project.error && <Tooltip title={`Error: ${project.error}`}
                                                                                   side="right">
                                                            <LinkOffIcon size="small" color="error"/>
                                                        </Tooltip>}
                                                    </div>
                                                    <Typography variant="caption" color="secondary">
                                                        {project.projectId}
                                                    </Typography>
                                                    {project.error &&
                                                        <Typography color="error" variant="caption">Could not
                                                            load
                                                            details.</Typography>}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell align="right">
                                            {!project.error && (
                                                <LoadingButton
                                                    variant="text"
                                                    color="neutral"
                                                    size="small"
                                                    loading={unlinkState.loading}
                                                    onClick={() => handleUnlinkProject(project.projectId)}
                                                    title="Unlink Project"
                                                >
                                                    <LinkOffIcon size="small"/>
                                                </LoadingButton>
                                            )}
                                            {unlinkState.error && <Typography color="error"
                                                                              variant="caption">{unlinkState.error}</Typography>}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </Paper>
            </AnimateHeight>

            <Typography color="secondary" variant={"caption"}>
                These projects are linked to Dataki for the team '{team.name}'. Users in this team can query
                BigQuery datasets within these projects.
            </Typography>

            <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen} maxWidth="2xl" fullWidth>
                <DialogTitle>Link Google Cloud Project</DialogTitle>
                <DialogContent className="space-y-4">
                    <AvailableUserGCPProjects loadingAvailableProjects={loadingAvailableProjects}
                                              availableGcpProjects={availableGcpProjects}
                                              availableProjectsError={availableProjectsError}
                                              linkProject={handleLinkProject}
                                              linkStates={linkStates}/>
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setIsLinkDialogOpen(false)}>
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
