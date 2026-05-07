import { Alert, Button, CircularProgress, cls, defaultBorderMixin, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Label, Menu, Tooltip, Typography } from "@rebasepro/ui";
import { CheckSquare as CheckBoxIcon, ChevronRight as ChevronRightIcon, Database as StorageIcon, Plus, RefreshCw, Square as CheckBoxOutlineBlankIcon } from "lucide-react";
import { areDataSourcesEqual, DataSource, isDatabaseDataSource, Team } from "../types";

import { useAuthController, useSnackbarController } from "@rebasepro/core";
import { useDataki as useDatakiHook } from "../DatakiProvider";
import { useTeamGCPDataSources } from "./hooks/useTeamGCPDataSources";
import { DatakiAuthController } from "../hooks/useDatakiAuthController";
import { User as FirebaseUser } from "@firebase/auth";
;
import { DatakiLogin } from "./DatakiLogin";
import React, { useEffect } from "react";
import { AvailableUserGCPProjects } from "./teams/TeamGCPProjects";
import equal from "react-fast-compare";
import { TeamChip } from "./TeamChip";
import { useDbConnectionDialog } from "../hooks/useDbConnectionDialog";
import { datasourceToString, formatDataSource } from "../utils/datasource";
import { ConnectPostgresButton } from "./databases/ConnectPostgresButton";
import { ConnectGoogleProjectButton } from "./databases/ConnectGoogleProjectButton";
import { ConnectGoogleSheetsButton } from "./databases/ConnectGoogleSheetsButton";
import { DEFAULT_POSTGRES_CONNECTION } from "./teams/defaults";
import SupabaseConnection from "./SupabaseConnection";
import { AnimateHeight } from "./AnimateHeight";
import { refreshTeamDataSources } from "../api";
import { GoogleSheetsPicker } from "./GoogleSheetsPicker";
import { DataSourceLabel, getDataSourceIcon } from "./DataSourceLabel";
import FileUploadButton from "./files/FileUploadButton";

const PREVIEW_DATASOURCES_COUNT = 1;

export type DataSourceSelectionProps = {
    initialProjectId?: string;
    onProjectIdChange?: (projectId: string) => void;
    projectDisabled?: boolean;
    selectedDataSources: DataSource[];
    setSelectedDataSources: (dataSources: DataSource[]) => void;
    className?: string;
    initialDataSourceSelectionOpen?: boolean;
    onDataSourceSelectionOpenChange?: (open: boolean) => void;
    compact?: boolean; // New compact mode for chat UI
}

export function DataSourcesSelection({
    initialProjectId: _initialProjectId,
    onProjectIdChange: _onProjectIdChange,
    selectedDataSources,
    setSelectedDataSources: setSelectedDataSourcesProp,
    initialDataSourceSelectionOpen,
    onDataSourceSelectionOpenChange,
    compact = false
}: DataSourceSelectionProps) {

    const {
        teams,
        loading
    } = useDatakiHook();

    const [dataSourcesInternal, setDataSourcesInternal] = React.useState<DataSource[]>(selectedDataSources);

    // Track all unlinked data sources that have ever been in this session (persists across deselection)
    const allUnlinkedDataSourcesRef = React.useRef<DataSource[]>([]);

    const setSelectedDataSources = (dataSources: DataSource[]) => {
        setDataSourcesInternal(dataSources);
    }

    useEffect(() => {
        if (!loading) {
            // Update internal state to match external selected data sources
            if (!equal(selectedDataSources, dataSourcesInternal)) {
                setDataSourcesInternal(selectedDataSources);
            }

            // Track any new unlinked data sources
            const allTeamDataSources = teams.flatMap((team: Team) => team.dataSources ?? []);
            const currentUnlinked = selectedDataSources.filter(selectedDs =>
                !allTeamDataSources.some((teamDs: DataSource) => areDataSourcesEqual(teamDs, selectedDs))
            );

            // Merge new unlinked sources with existing ones (avoid duplicates)
            currentUnlinked.forEach(newUnlinked => {
                const exists = allUnlinkedDataSourcesRef.current.some(existing =>
                    areDataSourcesEqual(existing, newUnlinked)
                );
                if (!exists) {
                    allUnlinkedDataSourcesRef.current = [...allUnlinkedDataSourcesRef.current, newUnlinked];
                }
            });
        }
    }, [teams, loading, selectedDataSources]);

    const [dialogOpen, setDialogOpen] = React.useState(initialDataSourceSelectionOpen ?? false);
    const [sheetDialogOpenForTeam, setSheetDialogOpenForTeam] = React.useState<string | null>(null);

    const updateDialogOpen = (open: boolean) => {
        setDialogOpen(open);
        if (onDataSourceSelectionOpenChange) {
            onDataSourceSelectionOpenChange(open);
        }
    }

    const dialog = <Dialog maxWidth={"4xl"}
        open={dialogOpen && !sheetDialogOpenForTeam}
        onOpenChange={updateDialogOpen}
        onOpenAutoFocus={(e) => {
            e.preventDefault();
        }}>

        <DialogTitle className={"flex items-center gap-2"}>
            <StorageIcon size={"small"} color={"primary"} />
            <Typography>Select Data Sources</Typography>
        </DialogTitle>

        <DialogContent className={"flex flex-col gap-4 my-8 mx-6"}>

            <div className="space-y-16 w-full">
                {(() => {
                    // Show all unlinked data sources that have been in this session
                    const unlinkedDataSources = allUnlinkedDataSourcesRef.current;

                    return unlinkedDataSources.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <Typography variant="label"
                                    className="text-gray-600 dark:text-gray-400">
                                    Session Data Sources
                                </Typography>
                                <Typography variant="caption"
                                    className="text-gray-500 dark:text-gray-500">
                                    ({unlinkedDataSources.length})
                                </Typography>
                            </div>
                            <Typography variant="body2" color="secondary" className="text-sm">
                                These data sources are available in this session but not permanently
                                linked
                                to a team.
                            </Typography>
                            <div className="space-y-2">
                                {unlinkedDataSources.map((dataSource) => {
                                    const isSelected = dataSourcesInternal.some(ds => areDataSourcesEqual(ds, dataSource));
                                    return (
                                        <DataSourceLabel
                                            dataSource={dataSource}
                                            key={dataSource.type + "_" + ("id" in dataSource ? dataSource.id : JSON.stringify(dataSource))}
                                            className={"w-full"}
                                            selected={isSelected}
                                            onClick={() => {
                                                // Toggle selection
                                                if (isSelected) {
                                                    const newSources = dataSourcesInternal.filter(ds =>
                                                        !areDataSourcesEqual(ds, dataSource)
                                                    );
                                                    setDataSourcesInternal(newSources);
                                                } else {
                                                    setDataSourcesInternal([...dataSourcesInternal, dataSource]);
                                                }
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

                {teams.map((team: Team) => {
                    return (
                        <TeamDataSourceSelection
                            key={team.id}
                            team={team}
                            selectedDataSources={dataSourcesInternal}
                            setSelectedDataSources={setDataSourcesInternal}
                            onSheetDialogOpenChange={(open) => {
                                setSheetDialogOpenForTeam(open ? team.id : null);
                            }}
                        />
                    );
                }
                )}
            </div>

        </DialogContent>
        <DialogActions>
            <div className={"flex-grow"}></div>
            <Button
                variant={"text"} color={"neutral"}
                onClick={() => {
                    updateDialogOpen(false);
                }}>
                Close
            </Button>
            <Button
                color={"neutral"}
                disabled={dataSourcesInternal.length === 0}
                onClick={() => {
                    setSelectedDataSourcesProp(dataSourcesInternal);
                    updateDialogOpen(false);
                }}>
                Done
            </Button>
        </DialogActions>
    </Dialog>;

    // Compact mode for chat UI
    if (compact) {
        const hasNoDataSources = dataSourcesInternal.length === 0;
        const iconImage = dataSourcesInternal.length > 0 ? getDataSourceIcon(dataSourcesInternal[0]) : null;

        // Icon with white color when no datasources (blue background)
        const CompactIcon = iconImage ? (<img
            src={iconImage}
            alt={"Data source icon"}
            className={cls("inline w-4 h-4", hasNoDataSources && "brightness-0 invert")}
        />) : (
            <StorageIcon
                size="smallest"
                className={hasNoDataSources ? "text-white" : "text-primary"}
            />
        );

        return (
            <>
                <Tooltip title={dataSourcesInternal.length > 0
                    ? dataSourcesInternal.map(datasourceToString).join(", ")
                    : "Select data source"}>
                    <button
                        onClick={() => {
                            updateDialogOpen(true);
                        }}
                        className={cls(
                            "shrink-0 cursor-pointer rounded-full p-1.5 px-2.5 flex items-center gap-1.5",
                            "transition-all duration-200",
                            // Always use default border
                            "border",
                            defaultBorderMixin,
                            hasNoDataSources ? [
                                "bg-accent-500 dark:bg-accent-500",
                                "animate-pulse",
                                "hover:bg-accent-600 dark:hover:bg-accent-600",
                            ] : [
                                // Normal styles when datasources are selected
                                "bg-white dark:bg-surface-700",
                                "hover:bg-surface-50 dark:hover:bg-surface-800"
                            ]
                        )}>
                        {CompactIcon}
                        {dataSourcesInternal.length > 0 && (
                            <span
                                className="text-xs font-medium text-surface-700 dark:text-surface-300 whitespace-nowrap">
                                {dataSourcesInternal.length}
                            </span>
                        )}
                    </button>
                </Tooltip>

                {dialog}

            </>
        );
    }

    // Normal mode (existing behavior)
    const iconImage = dataSourcesInternal.length > 0 ? getDataSourceIcon(dataSourcesInternal[0]) : null;
    const Icon = iconImage ? (<img
        src={iconImage}
        alt={"Data source icon"}
        className="inline w-5 h-5"
    />) : <StorageIcon size="small" color="primary" />;

    return (
        <>

            <Label
                onClick={() => {
                    updateDialogOpen(true);
                }}
                className={cls("font-semibold shrink-0 bg-white dark:bg-surface-800 flex-wrap w-fit border cursor-pointer rounded-md p-2 px-3 flex items-center gap-2 [&:has(:checked)]:bg-surface-100 dark:[&:has(:checked)]:bg-surface-800")}>

                {Icon}

                <span className={"font-semibold"}>{!dataSourcesInternal.length && "Select data source"}</span>

                {dataSourcesInternal.length > 0 && dataSourcesInternal.slice(0, PREVIEW_DATASOURCES_COUNT).map(formatDataSource)}

                {dataSourcesInternal.length > PREVIEW_DATASOURCES_COUNT && (
                    <Typography
                        variant={"caption"}>and {dataSourcesInternal.length - PREVIEW_DATASOURCES_COUNT} more</Typography>
                )}

            </Label>

            {dialog}

        </>
    );
}

function AllDataSources({
    teamDataSources,
    selectedDataSources,
    setSelectedDataSources,
    teamId,
    onDatabaseSourcesChange,
    onLinkGoogleProjectClick
}: {
    teamDataSources: DataSource[],
    selectedDataSources: DataSource[],
    setSelectedDataSources: (dataSources: DataSource[]) => void,
    teamId: string,
    onDatabaseSourcesChange?: (sources: DataSource[]) => void,
    onLinkGoogleProjectClick: () => void
}) {

    const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set());

    const toggleSection = (sectionName: string) => {
        const newCollapsed = new Set(collapsedSections);
        if (newCollapsed.has(sectionName)) {
            newCollapsed.delete(sectionName);
        } else {
            newCollapsed.add(sectionName);
        }
        setCollapsedSections(newCollapsed);
    };

    return <div className={"space-y-3"}>

        {/* existing data source listings */}
        <>
            {teamDataSources.length === 0 && (
                <>
                    <Typography variant={"body2"} color="secondary">No data sources found for
                        this team. Add your <b>BigQuery, PostgreSQL, MySQL, Google Sheets or local files</b> connections
                        to start
                        using them.
                    </Typography>
                </>
            )}

            {teamDataSources.length > 0 && (() => {
                // Group data sources by type
                const groupedDataSources: { [key: string]: DataSource[] } = {};

                teamDataSources.forEach((dataSource) => {
                    let typeKey = "";
                    if (isDatabaseDataSource(dataSource)) {
                        typeKey = dataSource.type.charAt(0).toUpperCase() + dataSource.type.slice(1);
                    } else if (dataSource.type === "bigquery") {
                        typeKey = "BigQuery";
                    } else if (dataSource.type === "google_sheets") {
                        typeKey = "Google Sheets";
                    } else if (dataSource.type === "file") {
                        typeKey = "Uploaded Files";
                    }

                    if (typeKey && !groupedDataSources[typeKey]) {
                        groupedDataSources[typeKey] = [];
                    }
                    if (typeKey) {
                        groupedDataSources[typeKey].push(dataSource);
                    }
                });

                return Object.entries(groupedDataSources).map(([type, dataSources]) => {
                    const isCollapsed = collapsedSections.has(type);

                    return (
                        <div key={type} className="grid grid-cols-[120px_1fr] gap-4 items-start">
                            <button
                                onClick={() => toggleSection(type)}
                                className="pt-1 flex items-center justify-between w-full text-left hover:text-gray-800 dark:hover:text-gray-200"
                            >
                                <Typography variant="caption" className="font-medium text-gray-600 dark:text-gray-400">
                                    {type}
                                </Typography>
                                <ChevronRightIcon
                                    size={12}
                                    className={cls(
                                        "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-transform",
                                        isCollapsed ? "" : "rotate-90"
                                    )}
                                />
                            </button>
                            <div>
                                <div className="space-y-2">
                                    {dataSources.map((dataSource) => {
                                        const isSelected = selectedDataSources.some(ds => areDataSourcesEqual(ds, dataSource));

                                        if (isDatabaseDataSource(dataSource)) {
                                            return (
                                                <DataSourceLabel dataSource={dataSource}
                                                    key={dataSource.type + "_" + dataSource.id}
                                                    className={"w-full"}
                                                    selected={isSelected}
                                                    onClick={() => {
                                                        const newSources = [...selectedDataSources];
                                                        const exists = newSources.find(ds => "id" in ds && ds.id === dataSource.id);
                                                        if (exists) {
                                                            newSources.splice(newSources.indexOf(exists), 1);
                                                        } else {
                                                            newSources.push(dataSource);
                                                        }
                                                        setSelectedDataSources(newSources);
                                                    }} />

                                            );
                                        } else if (dataSource.type === "bigquery") {
                                            return (
                                                <DataSourceLabel dataSource={dataSource}
                                                    key={dataSource.type + "_" + (dataSource as any).datasetId + "_" + (dataSource as any).projectId}
                                                    className={"w-full"}
                                                    selected={isSelected}
                                                    onClick={() => {
                                                        const newSources = [...selectedDataSources];
                                                        const exists = newSources.find(ds => areDataSourcesEqual(ds, dataSource));
                                                        if (exists) {
                                                            newSources.splice(newSources.indexOf(exists), 1);
                                                        } else {
                                                            newSources.push({ ...dataSource });
                                                        }
                                                        setSelectedDataSources(newSources);
                                                    }} />
                                            );
                                        } else if (dataSource.type === "google_sheets") {
                                            return (
                                                <DataSourceLabel dataSource={dataSource}
                                                    key={dataSource.type + "_" + dataSource.id}
                                                    className={"w-full"}
                                                    selected={isSelected}
                                                    onClick={() => {
                                                        const newSources = [...selectedDataSources];
                                                        const exists = newSources.find(ds => "id" in ds && ds.id === dataSource.id);
                                                        if (exists) {
                                                            newSources.splice(newSources.indexOf(exists), 1);
                                                        } else {
                                                            newSources.push(dataSource);
                                                        }
                                                        setSelectedDataSources(newSources);
                                                    }} />
                                            );
                                        } else if (dataSource.type === "file") {
                                            return (
                                                <DataSourceLabel dataSource={dataSource}
                                                    key={dataSource.type + "_" + dataSource.id}
                                                    className={"w-full"}
                                                    selected={isSelected}
                                                    onClick={() => {
                                                        const newSources = [...selectedDataSources];
                                                        const exists = newSources.find(ds => "id" in ds && ds.id === dataSource.id);
                                                        if (exists) {
                                                            newSources.splice(newSources.indexOf(exists), 1);
                                                        } else {
                                                            newSources.push(dataSource);
                                                        }
                                                        setSelectedDataSources(newSources);
                                                    }} />
                                            );
                                        }
                                        return null;
                                    })}
                                </div>
                                {
                                    isCollapsed && (
                                        <button
                                            onClick={() => toggleSection(type)}
                                            className="w-full p-2 text-left text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-md hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                                        >
                                            <Typography variant="caption" className="italic">
                                                {dataSources.length} {dataSources.length === 1 ? "source" : "sources"} hidden
                                                - click to expand
                                            </Typography>
                                        </button>
                                    )
                                }
                            </div>
                        </div>
                    );
                });
            })()
            }
        </>
    </div>;
}

export function TeamDataSourceSelection({
    team,
    selectedDataSources,
    setSelectedDataSources,
    onSheetDialogOpenChange
}: {
    team: Team;
    selectedDataSources: DataSource[];
    setSelectedDataSources: (dataSources: DataSource[]) => void;
    onSheetDialogOpenChange: (open: boolean) => void;
}) {

    const datakiConfig = useDatakiHook();
    const authController = useAuthController<FirebaseUser, DatakiAuthController>();
    const snackbar = useSnackbarController();

    const {
        availableGcpProjects,
        loadingAvailableProjects,
        availableProjectsError,
        userHasPermissionsLoading,
        userHasGCPPermissions,
        linkStates,
        isLinkDialogOpen,
        setIsLinkDialogOpen,
        linkProject,
    } = useTeamGCPDataSources({
        team,
        datakiConfig,
        authController,
        snackbar
    });

    const [teamDataSources, setTeamDataSources] = React.useState<DataSource[]>(team.dataSources ?? []);
    const [optimisticSources, setOptimisticSources] = React.useState<DataSource[]>([]);

    useEffect(() => {
        setTeamDataSources(team.dataSources ?? []);
    }, [team.dataSources]);

    const effectiveTeamDataSources = React.useMemo(() => {
        const combined = [...teamDataSources];
        optimisticSources.forEach(opt => {
            if (!combined.some(existing => areDataSourcesEqual(existing, opt))) {
                combined.push(opt);
            }
        });
        return combined;
    }, [teamDataSources, optimisticSources]);

    // // Auto-select new datasources when they are added
    const isInitialMount = React.useRef(true);
    const currentDataSourcesCount = React.useRef(effectiveTeamDataSources.length);
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        if (effectiveTeamDataSources.length > currentDataSourcesCount.current) {
            // Find new datasources that are not currently selected
            const newDataSources = effectiveTeamDataSources.filter(ds =>
                !selectedDataSources.some(selectedDs => areDataSourcesEqual(selectedDs, ds))
            );

            console.log("New data sources detected:", newDataSources);

            // If there are new datasources, automatically add them to selection
            if (newDataSources.length > 0) {
                const updatedSelection = [...selectedDataSources, ...newDataSources];
                setSelectedDataSources(updatedSelection);
            }
        }
        currentDataSourcesCount.current = effectiveTeamDataSources.length;
    }, [effectiveTeamDataSources.length]);

    const updateTeamSelectedDataSources = (dataSources: DataSource[]) => {
        const filteredDataSources = dataSources.filter(ds => {
            return effectiveTeamDataSources.some(existingDs => areDataSourcesEqual(existingDs, ds));
        });
        const finalDataSources = [...selectedDataSources.filter(ds => !effectiveTeamDataSources.some(existingDs => areDataSourcesEqual(existingDs, ds))), ...filteredDataSources];
        setSelectedDataSources(finalDataSources);
    }

    const allTeamSourcesSelected = effectiveTeamDataSources.length > 0 && effectiveTeamDataSources.every(ds => selectedDataSources.some(d => areDataSourcesEqual(d, ds)));
    const [refreshing, setRefreshing] = React.useState(false);

    const [menuOpen, setMenuOpen] = React.useState(false);
    const [pickerActive, setPickerActive] = React.useState(false);
    const [addSheetDialogOpen, setAddSheetDialogOpen] = React.useState(false);
    const [uploadingFiles, setUploadingFiles] = React.useState(false);

    // Hook for managing database connection dialogs
    const {
        openDialog,
        DbConnectionDialogComponent,
        DeleteDbConnectionDialogComponent
    } = useDbConnectionDialog({
        teamId: team.id
    });

    return (
        <div className="space-y-4">

            <div className={"flex items-center gap-2"}>
                <TeamChip team={team} className={"flex-1"} />
                <Tooltip title={"Refresh data sources for this team"}>
                    <IconButton size={"small"}
                        onClick={async () => {
                            setRefreshing(true);
                            refreshTeamDataSources(team.id, await datakiConfig.getDatakiAuthToken(), datakiConfig.apiEndpoint)
                                .then(updatedSources => {
                                    setTeamDataSources(updatedSources);
                                    snackbar.open({
                                        type: "success",
                                        message: "Data sources refreshed"
                                    });
                                })
                                .finally(() => setRefreshing(false));
                        }}
                    >
                        {refreshing ? <CircularProgress size={"smallest"} /> : <RefreshCw size={"small"} />}
                    </IconButton>
                </Tooltip>

                <Menu
                    className={"p-4 gap-2 flex flex-col items-start"}
                    open={menuOpen}
                    onOpenChange={(open) => {
                        if (!open && (pickerActive || uploadingFiles)) return;
                        setMenuOpen(open);
                    }}
                    trigger={<Button
                        variant="text"
                        size={"small"}
                        color={"neutral"}>
                        <Plus size={"small"} />
                        Add Data Source
                    </Button>}>

                    <ConnectGoogleProjectButton
                        className={"w-full"}
                        onClick={() => setIsLinkDialogOpen(true)}
                    />

                    <ConnectGoogleSheetsButton
                        className={"w-full"}
                        onClick={() => {
                            setAddSheetDialogOpen(true);
                            setMenuOpen(false);
                        }}
                    />

                    <ConnectPostgresButton
                        className={"w-full"}
                        onClick={() => openDialog({
                            ...DEFAULT_POSTGRES_CONNECTION,
                            teamId: team.id
                        })} />

                    <SupabaseConnection
                        className={"w-full"}
                        existingDataSources={effectiveTeamDataSources.filter(isDatabaseDataSource)}
                        onDatabaseSelected={(config) => openDialog({
                            type: "postgresql",
                            ...config,
                            teamId: team.id
                        })} />

                    <FileUploadButton
                        className={"w-full"}
                        teamId={team.id}
                        onUploadingChange={(u) => setUploadingFiles(u)}
                        onUploaded={() => { /* state already patched optimistically */
                        }}
                        autoCloseMenu={() => setMenuOpen(false)}
                        onPickerOpen={() => setPickerActive(true)}
                        onPickerClose={() => setPickerActive(false)}
                    />
                </Menu>

                <Button
                    size={"small"}
                    variant="outlined"
                    onClick={() => {
                        if (allTeamSourcesSelected) {
                            updateTeamSelectedDataSources([]);
                        } else {
                            updateTeamSelectedDataSources(effectiveTeamDataSources);
                        }
                    }}
                    color={"neutral"}>
                    {allTeamSourcesSelected ? <CheckBoxIcon size="small" /> :
                        <CheckBoxOutlineBlankIcon size="small" />}
                    {allTeamSourcesSelected ? "Deselect" : "Select"} all
                </Button>
            </div>

            <AllDataSources teamDataSources={effectiveTeamDataSources}
                selectedDataSources={selectedDataSources}
                setSelectedDataSources={updateTeamSelectedDataSources}
                teamId={team.id}
                onDatabaseSourcesChange={setTeamDataSources}
                onLinkGoogleProjectClick={() => setIsLinkDialogOpen(true)} />

            {DbConnectionDialogComponent}
            {DeleteDbConnectionDialogComponent}

            <GoogleSheetsPicker
                open={addSheetDialogOpen}
                onClose={() => {
                    setAddSheetDialogOpen(false);
                }}
                teamId={team.id}
                onSuccess={(newSheet) => {
                    if (newSheet) {
                        setOptimisticSources(prev => [...prev, newSheet]);
                        // We don't need to manually update selectedDataSources here because the effect on effectiveTeamDataSources.length will pick it up
                        // But wait, the effect depends on length change.
                        // If we update optimisticSources, effectiveTeamDataSources changes, length changes -> effect runs -> selects new source.
                    }
                    setAddSheetDialogOpen(false);
                }}
                onPickerActiveChange={(active) => {
                    onSheetDialogOpenChange(active);
                }}
            />

            <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen} maxWidth="2xl" fullWidth>
                <DialogTitle>Link Google Cloud Project</DialogTitle>
                <DialogContent className="space-y-4">
                    <AvailableUserGCPProjects loadingAvailableProjects={loadingAvailableProjects}
                        availableGcpProjects={availableGcpProjects}
                        availableProjectsError={availableProjectsError}
                        linkProject={linkProject}
                        linkStates={linkStates} />
                    {!userHasPermissionsLoading && !userHasGCPPermissions && (
                        <div className="flex flex-col gap-2">
                            <Alert color="info" size={"small"} className="text-sm flex-grow">
                                You need to grant Dataki access to your Google Cloud projects to link them.
                            </Alert>
                            <DatakiLogin authController={authController}
                                datakiConfig={datakiConfig}
                                smallLayout={true}
                                includeGCPScope={true} />
                        </div>
                    )}

                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setIsLinkDialogOpen(false)}>
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    )
        ;
}
