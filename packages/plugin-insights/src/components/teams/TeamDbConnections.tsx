import { CircularProgress, IconButton, Paper, Table, TableBody, TableCell, TableRow, Typography } from "@rebasepro/ui";
import { Database as StorageIcon, Trash2 } from "lucide-react";
import React, { useEffect } from "react";
import SupabaseLogo from "../images/supabase-logo-icon.svg";
import PostgresLogo from "../images/postgresql-icon.svg";
import MySQLLogo from "../images/mysql-logo.svg";
import { Team } from "../../types";
import { useTeamDBConnections } from "../hooks/useTeamDBConnections";
import { useDbConnectionDialog } from "../../hooks/useDbConnectionDialog";
import { AnimateHeight } from "../AnimateHeight";
import { ConnectPostgresButton } from "../databases/ConnectPostgresButton";
import { ConnectMySQLButton } from "../databases/ConnectMySQLButton";
import SupabaseConnection from "../SupabaseConnection";
import { DEFAULT_MYSQL_CONNECTION, DEFAULT_POSTGRES_CONNECTION } from "./defaults";

export function TeamDbConnections({ team, onAnalyticsEvent }: { team: Team; onAnalyticsEvent?: (event: string, params?: any) => void }) {
    const {
        connections,
        loading,
        loadConnections
    } = useTeamDBConnections(team.id);

    const {
        openDialog,
        setShowDeleteConfirm,
        deletingId,
        DbConnectionDialogComponent,
        DeleteDbConnectionDialogComponent
    } = useDbConnectionDialog({
        teamId: team.id,
        onConnectionsChange: loadConnections,
        onAnalyticsEvent
    });

    useEffect(() => {
        loadConnections();
    }, [loadConnections]);

    const hasData = connections.length > 0;

    return (
        <div className="w-full space-y-2">
            <div className="flex justify-between items-center gap-4">
                <Typography variant="subtitle2" className={"flex-1"}>Database Connections</Typography>
            </div>

            {/* AnimateHeight for connections table */}
            <AnimateHeight isOpen={!loading && connections.length > 0}>
                <Paper className="overflow-hidden">
                    <Table className={"w-full rounded-lg overflow-hidden"}>
                        <TableBody>
                            {connections.map(conn => {
                                let icon;
                                if (conn.type === "mysql") {
                                    icon = <div
                                        className="w-12 h-12  bg-surface-100 dark:bg-surface-800 p-1 rounded-xl flex items-center justify-center">

                                        <img
                                            src={MySQLLogo}
                                            alt="MySQL icon"
                                            className={`inline w-12 h-12`}
                                        />
                                    </div>;
                                } else if (conn.type === "postgresql") {
                                    if (conn.host?.includes("supabase.co")) {
                                        icon = <div
                                            className="w-12 h-12  bg-surface-100 dark:bg-surface-800 p-3 rounded-xl flex items-center justify-center">
                                            <img
                                                src={SupabaseLogo}
                                                alt="Supabase icon"
                                                className={`inline w-12 h-12 `}
                                            />
                                        </div>;
                                    } else {
                                        icon = <div
                                            className="w-12 h-12  bg-surface-100 dark:bg-surface-800 p-3 rounded-xl flex items-center justify-center">
                                            <img
                                                src={PostgresLogo}
                                                alt="PostgreSQL icon"
                                                className={`inline w-12 h-12 `}
                                            />
                                        </div>;
                                    }
                                } else {
                                    icon = <div
                                        className="w-12 h-12  bg-surface-100 dark:bg-surface-800 p-3 rounded-xl flex items-center justify-center">
                                        <StorageIcon size={"small"} />
                                    </div>;
                                }
                                return (
                                    <TableRow
                                        key={conn.id}
                                        onClick={() => openDialog(conn)}
                                        className="hover:bg-surface-50 dark:hover:bg-gray-800 cursor-pointer"
                                    >
                                        <TableCell className={"flex gap-6 items-center w-full"}>

                                            {icon}
                                            <div className="flex flex-col flex-1">
                                                <Typography variant="body1"
                                                    className="font-medium">{conn.name}</Typography>
                                                <Typography variant="caption"
                                                    color="secondary">{conn.type?.toUpperCase()}</Typography>
                                            </div>
                                        </TableCell>
                                        <TableCell align={"right"}>
                                            <Typography variant="caption">{conn.host}:{conn.port}</Typography>
                                            <Typography variant="caption"
                                                color="secondary">{conn.databaseName}</Typography>
                                            {/*<Typography variant="caption"*/}
                                            {/*            color="secondary">{conn.id}</Typography>*/}
                                        </TableCell>
                                        <TableCell align="right" style={{ width: "64px" }}>
                                            <IconButton
                                                size={"smallest"}
                                                color="error"
                                                onClick={(e) => {
                                                    e.stopPropagation(); // Prevent row click
                                                    setShowDeleteConfirm(conn);
                                                }}
                                                disabled={deletingId === conn.id}
                                                title="Delete Connection"
                                            >
                                                {deletingId === conn.id ? <CircularProgress size="small" /> :
                                                    <Trash2 size="smallest" />}
                                            </IconButton>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </Paper>
            </AnimateHeight>

            {/* No connections placeholder */}
            <AnimateHeight isOpen={(!loading && !hasData) || (loading && hasData)}>
                <Paper className="overflow-hidden p-8 flex justify-center items-center">
                    {loading && !hasData && <CircularProgress />}
                    {!loading && !hasData &&
                        <Typography variant="body2" color="secondary">No database connections found</Typography>}
                </Paper>
            </AnimateHeight>

            <div className="flex gap-2">

                <SupabaseConnection
                    existingDataSources={connections}
                    onDatabaseSelected={(config) => {
                        onAnalyticsEvent?.("database_connection_dialog_opened", {
                            team_id: team.id,
                            connection_type: "supabase"
                        });
                        openDialog({
                            type: "postgresql",
                            ...config,
                            teamId: team.id
                        });
                    }} />
                <ConnectPostgresButton onClick={() => {
                    onAnalyticsEvent?.("database_connection_dialog_opened", {
                        team_id: team.id,
                        connection_type: "postgresql"
                    });
                    openDialog({
                        ...DEFAULT_POSTGRES_CONNECTION,
                        teamId: team.id
                    });
                }} />
                <ConnectMySQLButton onClick={() => {
                    onAnalyticsEvent?.("database_connection_dialog_opened", {
                        team_id: team.id,
                        connection_type: "mysql"
                    });
                    openDialog({
                        ...DEFAULT_MYSQL_CONNECTION,
                        teamId: team.id
                    });
                }} />

            </div>

            {/*<button*/}
            {/*    className=""*/}
            {/*>*/}
            {/*    <img src={ConnectSupabaseImage} alt="Supabase Logo"/>*/}
            {/*</button>*/}
            {DbConnectionDialogComponent}
            {DeleteDbConnectionDialogComponent}
        </div>
    );
}
