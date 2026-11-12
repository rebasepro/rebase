/**
 * EXPERIMENTAL. The apps saved to the project (save_app), for the person
 * signed in: theirs, their roles' and the team's. Opening one runs it as
 * Claude runs it, sandboxed (`SavedAppFrame`).
 *
 * Not in the navigation by default. A project that wants it adds the view:
 *
 * ```tsx
 * import { savedAppsView } from "@rebasepro/cms";
 * <RebaseCMS tableCustomizations={tableCustomizations} views={[savedAppsView]} />
 * ```
 */
import React, { useEffect, useMemo, useState } from "react";
import type { AppView } from "@rebasepro/cms-types";
import { useApiBase, useApiConfig } from "@rebasepro/app";
import { Alert, ArrowLeftIcon, Card, Chip, CircularProgress, Container, IconButton, Typography, cls } from "@rebasepro/ui";
import { createAdminAppsClient, isRecord } from "./admin_apps_client";
import { SavedAppFrame } from "./saved_app_frame";

interface AppSummary {
    id: string;
    title: string;
    visibility: "personal" | "roles" | "team";
    roles: string[];
    collections: string[];
    updatedAt: string;
}

/** Who an app is for, as the list says it. */
function audience(app: AppSummary): string {
    if (app.visibility === "team") return "Team";
    if (app.visibility === "roles") return app.roles.join(", ");
    return "Only you";
}

function summariesOf(result: unknown): AppSummary[] {
    const content = isRecord(result) ? result.structuredContent : undefined;
    const apps = isRecord(content) && Array.isArray(content.apps) ? content.apps : [];
    return apps.filter(isRecord).flatMap(app => typeof app.id === "string" && typeof app.title === "string"
        ? [{
            id: app.id,
            title: app.title,
            visibility: app.visibility === "team" || app.visibility === "roles" ? app.visibility : "personal",
            roles: Array.isArray(app.roles) ? app.roles.filter((role): role is string => typeof role === "string") : [],
            collections: Array.isArray(app.collections) ? app.collections.filter((name): name is string => typeof name === "string") : [],
            updatedAt: typeof app.updatedAt === "string" ? app.updatedAt : ""
        }]
        : []);
}

export function SavedAppsView() {
    const apiBase = useApiBase();
    const getAuthToken = useApiConfig()?.getAuthToken;
    const client = useMemo(() => apiBase ? createAdminAppsClient(apiBase, getAuthToken) : undefined, [apiBase, getAuthToken]);
    const [apps, setApps] = useState<AppSummary[]>();
    const [error, setError] = useState<string>();
    const [open, setOpen] = useState<AppSummary>();

    useEffect(() => {
        if (!client) return;
        let cancelled = false;
        client.request("tools/call", { name: "list_apps", arguments: {} })
            .then(result => {
                if (!cancelled) setApps(summariesOf(result));
            })
            .catch((reason: unknown) => {
                if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
            });
        return () => {
            cancelled = true;
        };
    }, [client]);

    return (
        <Container maxWidth="6xl" className="flex flex-col gap-4 py-6">
            {open && client ? (
                <>
                    <div className="flex items-center gap-2">
                        <IconButton size="small" aria-label="Back to saved apps" onClick={() => setOpen(undefined)}>
                            <ArrowLeftIcon/>
                        </IconButton>
                        <Typography variant="h6" className="truncate">{open.title}</Typography>
                        <Chip size="small">{audience(open)}</Chip>
                    </div>
                    <SavedAppFrame client={client} appId={open.id}/>
                </>
            ) : (
                <>
                    <div className="flex flex-col gap-1">
                        <Typography variant="h5">Saved apps</Typography>
                        <Typography variant="body2" color="secondary">
                            Apps built with Claude and saved to this project. Each one runs as you, on the data you can reach.
                        </Typography>
                    </div>
                    {!client && <Alert color="warning" size="small">This admin panel has no API address to load saved apps from.</Alert>}
                    {error && <Alert color="error" size="small">{error}</Alert>}
                    {client && !error && !apps && (
                        <div className="flex items-center gap-2"><CircularProgress size="small"/><Typography variant="body2" color="secondary">Loading saved apps…</Typography></div>
                    )}
                    {apps && apps.length === 0 && (
                        <Typography variant="body2" color="secondary">
                            No saved apps yet. Ask Claude to build one with show_app, then to save it with save_app.
                        </Typography>
                    )}
                    {apps && apps.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {apps.map(app => (
                                <Card key={app.id} onClick={() => setOpen(app)} className={cls("flex flex-col gap-2 p-4 cursor-pointer hover:bg-surface-card-hover")}>
                                    <Typography variant="subtitle2" className="truncate">{app.title}</Typography>
                                    <Typography variant="caption" color="secondary" className="truncate">{app.collections.join(", ")}</Typography>
                                    <div className="flex items-center justify-between gap-2">
                                        <Chip size="small">{audience(app)}</Chip>
                                        {app.updatedAt && (
                                            <Typography variant="caption" color="secondary">
                                                {new Date(app.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                            </Typography>
                                        )}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    )}
                </>
            )}
        </Container>
    );
}

/** The view to add to `views` for saved apps in the navigation. */
export const savedAppsView: AppView = {
    slug: "apps",
    name: "Saved apps",
    description: "Apps built with Claude and saved to this project.",
    icon: "LayoutDashboard",
    view: <SavedAppsView/>
};
