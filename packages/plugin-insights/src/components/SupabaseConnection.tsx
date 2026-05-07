import { Button, Card, CircularProgress, cls, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LoadingButton, Menu, MenuItem, Typography } from "@rebasepro/ui";
import { CheckCircle as CheckCircleIcon, MoreVertical } from "lucide-react";
import React, { useEffect, useState } from "react";
import {
    ApiError,
    disconnectSupabase,
    getSupabaseCredentials,
    getSupabaseProjects,
    initiateSupabaseConnection
} from "../api";
import { useDataki } from "../DatakiProvider";
import { DatabaseConnectionConfig, DatabaseDataSource } from "../types";
import SupabaseLogo from "./images/supabase-logo-icon.svg";
import { AnimateHeight } from "./AnimateHeight";

interface SupabaseConnectionProps {
    onConnectionSuccess?: () => void;
    onConnectionError?: (error: string) => void;
    onDatabaseSelected?: (config: Partial<DatabaseConnectionConfig>) => void;
    existingDataSources?: DatabaseDataSource[];
    className?: string;
}

interface SupabaseDatabaseConfig {
    projectName: string;
    host: string;
    port: number;
    db_name: string;
    db_user: string;
    db_pass: string;
    connection_string?: string;
    note?: string;
}

export const SupabaseConnection: React.FC<SupabaseConnectionProps> = ({
    onConnectionSuccess,
    onConnectionError,
    onDatabaseSelected,
    existingDataSources = [],
    className
}) => {
    const dataki = useDataki();
    const apiEndpoint = dataki.apiEndpoint;

    const [dialogOpen, setDialogOpen] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [databaseConfigs, setDatabaseConfigs] = useState<SupabaseDatabaseConfig[]>([]);
    const [loadingProjects, setLoadingProjects] = useState(false);

    useEffect(() => {
        // Check URL params for dialog state and OAuth callback
        const urlParams = new URLSearchParams(window.location.search);

        // Check if dialog should be open from URL
        const shouldOpenDialog = urlParams.get("supabase_dialog") === "true";
        if (shouldOpenDialog) {
            setDialogOpen(true);
        }

        // Check for connection status from OAuth callback redirect
        if (urlParams.get("supabase_connected") === "true") {
            setIsConnected(true);
            setDialogOpen(true); // Open dialog when returning from OAuth
            onConnectionSuccess?.();
            // Clean up URL but preserve dialog state
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete("supabase_connected");
            newUrl.searchParams.set("supabase_dialog", "true");
            window.history.replaceState({}, document.title, newUrl.toString());
        }

        const error = urlParams.get("error");
        if (error) {
            setErrorMessage(decodeURIComponent(error));
            onConnectionError?.(decodeURIComponent(error));
            setDialogOpen(true); // Open dialog to show error
            // Clean up URL but preserve dialog state
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete("error");
            newUrl.searchParams.set("supabase_dialog", "true");
            window.history.replaceState({}, document.title, newUrl.toString());
        }

        // Check for existing valid connection
        checkExistingConnection();
    }, []);

    useEffect(() => {
        if (isConnected && dialogOpen) {
            fetchSupabaseData();
        }
    }, [isConnected, dialogOpen]);

    const checkExistingConnection = async () => {
        try {
            const firebaseAccessToken = await dataki.getDatakiAuthToken();
            const credentials = await getSupabaseCredentials(firebaseAccessToken, apiEndpoint);
            if (credentials && credentials.access_token) {
                setIsConnected(true);
            } else {
                setIsConnected(false);
            }
        } catch (error) {
            setIsConnected(false);
            console.log("Could not verify existing Supabase connection.");
        }
    };

    const fetchSupabaseData = async () => {
        setLoadingProjects(true);
        try {
            const firebaseAccessToken = await dataki.getDatakiAuthToken();
            const projs = await getSupabaseProjects(firebaseAccessToken, apiEndpoint);
            console.log("Supabase projects data:", projs);

            // Extract database configs from the projects data
            const allDatabaseConfigs: SupabaseDatabaseConfig[] = [];
            for (const project of projs) {
                if (project.region && project.id && project.databaseConfig) {
                    console.log("Processing project:", project);

                    // Use the actual database config from the API
                    const dbConfig = project.databaseConfig;
                    const host = dbConfig.host;
                    const port = dbConfig.port;
                    const database = dbConfig.database;
                    const user = dbConfig.user;

                    allDatabaseConfigs.push({
                        projectName: project.name,
                        host: host,
                        port: port,
                        db_name: database,
                        db_user: user,
                        db_pass: "", // Will need to be filled by user
                        note: dbConfig.note || "Password required"
                    });
                }
            }
            setDatabaseConfigs(allDatabaseConfigs);
        } catch (error) {
            const errorMsg = error instanceof ApiError ? error.message : "Failed to fetch Supabase data.";
            setErrorMessage(errorMsg);
            // If fetching fails, the token might be expired/revoked.
            setIsConnected(false);
        } finally {
            setLoadingProjects(false);
        }
    };

    // URL state management functions
    const updateDialogStateInUrl = (open: boolean) => {
        console.log("Updating supabase dialog state in URL:", open);
        const newUrl = new URL(window.location.href);
        if (open) {
            newUrl.searchParams.set("supabase_dialog", "true");
        } else {
            newUrl.searchParams.delete("supabase_dialog");
        }
        window.history.replaceState({}, document.title, newUrl.toString());
    };

    const handleDialogOpenChange = (open: boolean) => {
        setDialogOpen(open);
        updateDialogStateInUrl(open);
    };

    const handleButtonClick = async () => {
        if (!isConnected) {
            // If not connected, go directly to OAuth flow
            setIsConnecting(true);
            setErrorMessage("");
            try {
                const firebaseAccessToken = await dataki.getDatakiAuthToken();
                // Add dialog state to return URL so dialog opens when coming back
                const returnUrl = new URL(window.location.href);
                returnUrl.searchParams.set("supabase_dialog", "true");
                const { auth_url } = await initiateSupabaseConnection(firebaseAccessToken, apiEndpoint, returnUrl.toString());
                window.location.href = auth_url;
            } catch (error) {
                const errorMsg = error instanceof ApiError ? error.message : "Failed to start connection process.";
                setErrorMessage(errorMsg);
                onConnectionError?.(errorMsg);
                setIsConnecting(false);
                // Open dialog to show error
                handleDialogOpenChange(true);
            }
        } else {
            // If already connected, just open the dialog
            handleDialogOpenChange(true);
        }
    };

    const handleConnect = async () => {
        setIsConnecting(true);
        setErrorMessage("");
        try {
            const firebaseAccessToken = await dataki.getDatakiAuthToken();
            const { auth_url } = await initiateSupabaseConnection(firebaseAccessToken, apiEndpoint, window.location.href);
            window.location.href = auth_url; // Redirect to Supabase to authorize
        } catch (error) {
            const errorMsg = error instanceof ApiError ? error.message : "Failed to start connection process.";
            setErrorMessage(errorMsg);
            onConnectionError?.(errorMsg);
            setIsConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        try {
            const firebaseAccessToken = await dataki.getDatakiAuthToken();
            await disconnectSupabase(firebaseAccessToken, apiEndpoint);

            // Update local state
            setIsConnected(false);
            setDatabaseConfigs([]);
            setErrorMessage("");

            // Close the dialog
            handleDialogOpenChange(false);

            // Optional: Show success message or call callback
            onConnectionSuccess?.();
        } catch (error) {
            const errorMsg = error instanceof ApiError ? error.message : "Failed to disconnect from Supabase.";
            setErrorMessage(errorMsg);
            onConnectionError?.(errorMsg);
        }
    };

    const handleDatabaseSelect = (config: SupabaseDatabaseConfig) => {
        const dbConfig: Partial<DatabaseConnectionConfig> = {
            name: `${config.projectName} (Supabase)`,
            type: "postgresql",
            host: config.host,
            port: config.port,
            databaseName: config.db_name,
            user: config.db_user,
            password: "", // User will need to provide this
        };

        onDatabaseSelected?.(dbConfig);
        handleDialogOpenChange(false);
    };

    const isDatabaseExisting = (host: string, user: string) => {
        return existingDataSources.some(ds => ds.host === host && ds.user === user);
    };

    const renderDialogContent = () => {
        if (!isConnected) {
            return (
                <div className="space-y-4">
                    <Typography variant="body1">
                        Connect to your Supabase account to access your projects and databases.
                    </Typography>
                    <div className="flex">
                        <LoadingButton
                            color={"neutral"}
                            onClick={handleConnect}
                            loading={isConnecting}
                            variant="outlined"
                            className="flex items-center gap-2"
                        >
                            <img src={SupabaseLogo} alt="Supabase" className="w-4 h-4" />
                            Connect Supabase
                        </LoadingButton>
                    </div>
                    {errorMessage && (
                        <div
                            className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded">
                            {errorMessage}
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Typography variant="body1">
                        Select a Supabase database to connect:
                    </Typography>
                </div>

                {/* Loading state with AnimateHeight */}
                <AnimateHeight isOpen={loadingProjects}>
                    <div className="flex justify-center py-4">
                        <CircularProgress size={"small"} />
                    </div>
                </AnimateHeight>

                {/* Database list with AnimateHeight */}
                <AnimateHeight isOpen={!loadingProjects && databaseConfigs.length > 0}>
                    <div className="space-y-2 p-1">
                        {databaseConfigs.map((config, index) => {
                            const isExisting = isDatabaseExisting(config.host, config.db_user);
                            return (
                                <Card
                                    key={index}
                                    className={cls(
                                        "p-3 cursor-pointer hover:bg-surface-50 dark:hover:bg-gray-800 border",
                                        isExisting ? "opacity-60" : ""
                                    )}
                                    onClick={() => !isExisting && handleDatabaseSelect(config)}
                                >
                                    <div className="flex flex-col items-start justify-between">
                                        <div className="flex flex-row items-center gap-2 w-full">
                                            <Typography variant="label" className="font-medium flex-1">
                                                {config.projectName}
                                            </Typography>
                                            {isExisting && (
                                                <div className="flex items-center gap-2">
                                                    <CheckCircleIcon color="success" size={"smallest"} />
                                                    <Typography variant="caption" className="font-medium">
                                                        Already connected
                                                    </Typography>
                                                </div>

                                            )}
                                        </div>
                                        <Typography variant="caption" className="text-gray-600 dark:text-gray-400">
                                            {config.host}:{config.port}/{config.db_name}
                                        </Typography>
                                        <Typography variant="caption" className="text-gray-600 dark:text-gray-400">
                                            User: {config.db_user}
                                        </Typography>

                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                </AnimateHeight>

                {/* No projects found state with AnimateHeight */}
                <AnimateHeight isOpen={!loadingProjects && databaseConfigs.length === 0}>
                    <Typography variant="body2" className="text-gray-600 dark:text-gray-400 text-center py-4">
                        No Supabase projects found.
                    </Typography>
                </AnimateHeight>
            </div>
        );
    };

    return (
        <>
            <Card
                className={cls("bg-transparent dark:bg-transparent flex flex-row gap-2 items-center justify-center px-3 py-1.5 cursor-pointer hover:bg-surface-50 dark:hover:bg-gray-800", "hover:ring-transparent", className)}
                onClick={() => handleButtonClick()}
            >
                <img
                    src={SupabaseLogo}
                    alt="Supabase icon"
                    className={`w-3.5 h-3.5`}
                />
                <Typography variant="caption" className="font-medium">
                    Connect Supabase
                </Typography>
            </Card>

            <Dialog
                maxWidth="lg"
                open={dialogOpen}
                onOpenChange={handleDialogOpenChange}
            >
                <DialogTitle className="flex items-center gap-2">
                    <div className={"flex-1 flex items-center gap-4"}>
                        <img src={SupabaseLogo} alt="Supabase" className="w-5 h-5" />
                        Supabase Connection
                    </div>
                    {isConnected && <Menu trigger={<IconButton
                        className="text-gray-500 hover:text-gray-700"
                        onClick={() => setDialogOpen(false)}>
                        <MoreVertical size="small" />
                    </IconButton>}>
                        <MenuItem
                            onClick={handleDisconnect}>
                            Disconnect
                        </MenuItem>
                    </Menu>}

                </DialogTitle>
                <DialogContent>
                    {renderDialogContent()}
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => handleDialogOpenChange(false)}>
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default SupabaseConnection;
