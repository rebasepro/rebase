import { Button, cls, IconButton, Tooltip, Typography, CircularProgressCenter, ErrorBoundary } from "@rebasepro/ui";
import { Copy, Clock, Plus } from "lucide-react";
import React, { useEffect, useState } from "react";
import {
    ChatMessage,
    ChatSession,
    DashboardFilterConfig,
    DashboardWidgetConfig,
    DataSource,
    DryChartWidgetConfig, DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    FilterWidgetItem,
    ParamFilter
} from "../types";
import { DashboardPanel } from "./DashboardPanel";
import { DatakiChatSession, getInitialDataSources } from "./chat/DatakiChatSession";
import { useDataki } from "../DatakiProvider";
import { useLocation, useNavigate } from "react-router";
import { useAuthController } from "@rebasepro/core";
import { ChatHistory } from "./ChatHistory";
import { DashboardState } from "../hooks/useCreateDashboardState";
import { generateWidgetId } from "../utils/widgets";
import { WidgetDragProvider } from "./chat/WidgetDragContext";

export type DashboardChatController = {
    selectedSession: ChatSession | undefined,
    setSelectedSession: (session: ChatSession | undefined) => void
}

export const useDashboardChatController = (): DashboardChatController => {

    const [selectedSession, setSelectedSession] = React.useState<ChatSession | undefined>(undefined);

    return {
        selectedSession,
        setSelectedSession
    };

}

export const DashboardChatView = React.memo(function DashboardChatView({
    dashboardState,
    onClose,
    dateRange,
    paramFilters,
    filters,
    hidden,
    onDashboardWidgetUpdated,
    dashboardChatController,
    onStartWidgetPlacement,

}: {
    dashboardState: DashboardState,
    onClose?: () => void,
    dateRange: [Date | null, Date | null],
    paramFilters: ParamFilter[],
    filters: DashboardFilterConfig[],
    hidden?: boolean,
    onDashboardWidgetUpdated?: (widget: DashboardWidgetConfig | FilterWidgetItem) => void,
    dashboardChatController: DashboardChatController,
    onStartWidgetPlacement?: (config: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig | null) => void
}) {

    const datakiConfig = useDataki();
    const navigate = useNavigate();
    const location = useLocation();

    const dashboard = dashboardState.dashboard;
    const page = dashboardState.page;
    const dashboardId = dashboard.id;
    const dashboardPageId = page.id;

    const urlSearchParams = new URLSearchParams(location.search);
    const initialPrompt = urlSearchParams.get("prompt");

    const selectedSession = dashboardChatController.selectedSession;
    const setSelectedSession = dashboardChatController.setSelectedSession;

    const authController = useAuthController();
    if (!authController.user) {
        throw new Error("User not authenticated");
    }
    const { uid } = authController.user;

    const widgetId = selectedSession?.widgetId;
    const initialWidgetConfig = dashboardState?.page.widgets.find(w => w.id === widgetId) as DashboardWidgetConfig | undefined;
    const allDataSources = datakiConfig.teams.flatMap((team: any) => team.dataSources ?? []);
    const [dataSources, setDataSources] = useState<DataSource[]>(initialWidgetConfig?.dataSources ?? getInitialDataSources(selectedSession, uid, allDataSources, dashboardState?.page));

    const dashboardPage = dashboard.pages.find(p => p.id === dashboardPageId);
    if (!dashboardPage) {
        throw new Error("DashboardChatView INTERNAL: No dashboard page found");
    }

    const [mode, setMode] = React.useState<"chat" | "chat_history">("chat");

    const [sessions, setSessions] = React.useState<ChatSession[] | undefined>(undefined);
    const [loading, setLoading] = useState(true);

    // hold the data source dialog open state in the URL
    // so that the user can refresh the page and the dialog remains open
    const initialDataSourceSelectionOpen = urlSearchParams.get("dataSource") === "true";

    async function goToNewChat() {
        const chatId = await datakiConfig.createChatSessionId();
        setSelectedSession(createNewSession(chatId, dashboardId));
    }

    useEffect(() => {
        return datakiConfig.listenChatSessions(
            {
                dashboardId,
                onChatSessionsUpdate: async (updatedSessions: any) => {

                    setSessions(updatedSessions);
                    if (updatedSessions.length > 0) {
                        setSelectedSession(updatedSessions[0]);
                    } else {
                        await goToNewChat();
                    }
                    setLoading(false);
                }
            });
    }, [dashboardId]);

    if (loading || !selectedSession) {
        return <DashboardPanel onClose={onClose}
            title={<>
                <Typography variant={"label"} className={"flex-grow"}>
                    Chat
                </Typography>
            </>}
            className={cls({ hidden })}
            contentClassName={"items-center justify-center"}>
            <CircularProgressCenter />
        </DashboardPanel>
    }

    const usedSession = selectedSession;

    const onMessagesChange = (messages: ChatMessage[]) => {
        const newSession = {
            ...usedSession,
            messages
        };
        setSelectedSession(newSession);
        datakiConfig.saveChatSession(newSession);
    };

    const onDataSourcesChange = (dataSources: DataSource[]) => {
        setDataSources(dataSources);
        const newSession = {
            ...usedSession,
            dataSources
        };
        setSelectedSession(newSession);
        datakiConfig.saveChatSession(newSession);
    }

    const onProjectIdChange = (projectId: string) => {
        const newSession = {
            ...usedSession,
            projectId
        };
        setSelectedSession(newSession);
        datakiConfig.saveChatSession(newSession);
    }

    const widgetActions = (dryConfig: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig) => {
        const existingWidget = dashboardPage?.widgets.find(w => w.id === dryConfig?.id);

        const actions = dashboardId && dashboardPageId && existingWidget && dryConfig
            ? <>
                <Tooltip title={"Add this view as a new widget"}>
                    <IconButton size={"small"}
                        onClick={() => {
                            if (!dashboardId || !dashboardPageId) {
                                throw new Error("WidgetChatMessageView INTERNAL: No dashboard page found");
                            }
                            const newConfig = {
                                ...dryConfig,
                                id: generateWidgetId()
                            }
                            const dashboardWidget = datakiConfig.addDashboardWidget(dashboardId, newConfig);
                            return onDashboardWidgetUpdated?.(dashboardWidget);
                        }}>
                        <Copy size={"small"} />
                    </IconButton>
                </Tooltip>

                <Button color={"neutral"}
                    size={"small"}
                    onClick={() => {
                        console.log("Updating widget", dryConfig);
                        const result = {
                            ...existingWidget,
                            ...dryConfig
                        } satisfies DashboardWidgetConfig;
                        datakiConfig.onWidgetUpdate(dashboardId, dashboardPageId, existingWidget.id, result);
                        onDashboardWidgetUpdated?.(result);
                    }}>
                    Update widget
                </Button>
            </>
            : (dryConfig
                ? <Button color={"neutral"}
                    size={"small"}
                    onClick={() => {
                        if (!dashboardId || !dashboardPageId) {
                            throw new Error("WidgetChatMessageView INTERNAL: No dashboard page found");
                        }
                        const dashboardWidget = datakiConfig.addDashboardWidget(dashboardId, dryConfig);
                        return onDashboardWidgetUpdated?.(dashboardWidget);
                    }}>
                    Add to dashboard
                </Button>
                : null);

        return actions;
    }

    const chatSessionElement = (
        <DatakiChatSession
            key={selectedSession.id}
            // onAnalyticsEvent={onAnalyticsEvent}
            className={"bg-white dark:bg-surface-900"}
            session={usedSession}
            dataSources={dataSources}
            initialPrompt={initialPrompt ?? undefined}
            onDataSourcesChange={onDataSourcesChange}
            onProjectIdChange={onProjectIdChange}
            onMessagesChange={onMessagesChange}
            includeLargePadding={false}
            onDashboardWidgetUpdated={onDashboardWidgetUpdated}
            padding={false}
            initialDataSourceSelectionOpen={initialDataSourceSelectionOpen}
            dashboardState={dashboardState}
            onDataSourceSelectionOpenChange={(open: boolean) => {
                const searchParams = new URLSearchParams(location.search);
                if (open) searchParams.set("dataSource", "true");
                else searchParams.delete("dataSource");
                navigate({
                    search: searchParams.toString()
                }, { replace: true });
            }}
            dateRange={dateRange}
            paramFilters={paramFilters}
            filters={filters}
            widgetActionsAlways={widgetActions}
        />
    );

    return <DashboardPanel onClose={onClose}
        title={<>
            <Typography variant={"label"} className={"flex-grow"}>
                Chat
            </Typography>
            <Typography variant={"caption"} color={"disabled"}>{selectedSession.id}</Typography>
        </>}
        className={cls({ hidden })}
        endComponent={<>
            <IconButton size={"small"}
                onClick={async () => {
                    setMode("chat")
                    goToNewChat();
                }}>
                <Plus size={16} />
            </IconButton>
            <IconButton size={"small"} onClick={() => {
                setMode("chat_history");
            }}>
                <Clock size={16} />
            </IconButton>
        </>}>

        {mode === "chat" && <ErrorBoundary>
            {onStartWidgetPlacement
                ? <WidgetDragProvider
                    onWidgetDragStart={onStartWidgetPlacement}
                    onWidgetDragEnd={() => setTimeout(() => onStartWidgetPlacement(null), 0)}>
                    {chatSessionElement}
                </WidgetDragProvider>
                : chatSessionElement}
        </ErrorBoundary>}

        {mode === "chat_history" && <ChatHistory dashboardId={dashboardId}
            onNewChatClick={async () => {
                setMode("chat");
                goToNewChat();
            }}
            onEntryClick={(session: any) => {
                setMode("chat");
                setSelectedSession(session);
            }} />}
    </DashboardPanel>;
});

export function createNewSession(chatId: string, dashboardId: string, widgetId?: string, widgetError?: Error): ChatSession {
    return {
        id: chatId,
        dashboardId,
        created_at: new Date(),
        updated_at: new Date(),
        messages: [],
        dataSources: [],
        widgetId: widgetId ?? null,
        initialMessage: widgetError ? `Error: ${widgetError.message}` : null,
    } satisfies ChatSession;
}
