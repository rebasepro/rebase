import { Code, Copy, History, MessageSquare, Palette, RefreshCw, Share2, Type } from "lucide-react";
import React, { useDeferredValue, useEffect, useRef } from "react";
import { Button, cls, IconButton, Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarPortal, MenubarSeparator, MenubarShortcut, MenubarTrigger, TextField, Tooltip } from "@rebasepro/ui";
import { Dashboard } from "../../types";
import { DownloadButton } from "./DownloadButton";
import { DashboardState } from "../../hooks/useCreateDashboardState";
import { useDataki } from "../../DatakiProvider";

export const DashboardAppbar = React.memo(({
    dashboard,
    dashboardState,
    onSharedClick,
    onEmbedClick,
    onNewWidgetClick,
    onDuplicateClick,
    onStartTextPlacement,
    onRefreshAll,
    onThemeClick,
    isThemeOpen,
    className,
    readOnly,
    onHistoryClick,
    isHistoryOpen
}: {
    dashboard: Dashboard,
    dashboardState: DashboardState,
    onSharedClick: () => void,
    onEmbedClick: () => void,
    onNewWidgetClick: () => void,
    onDuplicateClick: () => void,
    onStartTextPlacement?: (type: "title" | "subtitle" | "text" | null) => void,
    onRefreshAll?: () => void,
    onThemeClick?: () => void,
    isThemeOpen?: boolean,
    className?: string,
    readOnly: boolean,
    onHistoryClick: () => void,
    isHistoryOpen: boolean
}) => {

    return (
        <Menubar
            className={cls("flex-1 z-10 flex items-center bg-transparent dark:bg-transparent rounded-2xl gap-0 px-2 shadow-none py-0", className)}>

            {readOnly && <div className={"font-semibold text-sm"}>{dashboard.title}</div>}
            {!readOnly && <DashboardNameTextField readOnly={readOnly}
                title={dashboard.title}
                id={dashboard.id} />}

            {!readOnly && <div className={"flex items-center gap-0 px-0 mx-2"}>
                <Tooltip title={"Download as .pdf"}>
                    <DownloadButton dashboardContainerRef={dashboardState.dashboardContainerRef} />
                </Tooltip>
                <Tooltip title={"Dashboard history"}>
                    <IconButton variant="ghost" onClick={onHistoryClick} toggled={isHistoryOpen}>
                        <History />
                    </IconButton>
                </Tooltip>
                <Tooltip title={"Duplicate this dashboard"}>
                    <IconButton variant="ghost" onClick={onDuplicateClick}>
                        <Copy />
                    </IconButton>
                </Tooltip>
                <Tooltip title={"Share this dashboard"}>
                    <IconButton variant="ghost" onClick={onSharedClick}>
                        <Share2 />
                    </IconButton>
                </Tooltip>
                <Tooltip title={"Embed this dashboard"}>
                    <IconButton variant="ghost" onClick={onEmbedClick}>
                        <Code />
                    </IconButton>
                </Tooltip>
                {onThemeClick && <Tooltip title={"Dashboard theme"}>
                    <IconButton variant="ghost" onClick={onThemeClick} toggled={isThemeOpen}>
                        <Palette />
                    </IconButton>
                </Tooltip>}
            </div>}

            {!readOnly && <div className={"flex items-center gap-0 px-0 mx-2"}>
                <Tooltip title={"Drag to add title"}>
                    <div
                        draggable={true}
                        unselectable="on"
                        onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", "");
                            onStartTextPlacement?.("title");
                        }}
                        onDragEnd={() => {
                            // Always clear placement mode when drag ends (with delay to let drop handler run first)
                            setTimeout(() => onStartTextPlacement?.(null as any), 0);
                        }}
                        className="cursor-move"
                    >
                        <IconButton variant="ghost" className="pointer-events-none">
                            <Type />
                        </IconButton>
                    </div>
                </Tooltip>
                <Tooltip title={"Drag to add heading"}>
                    <div
                        draggable={true}
                        unselectable="on"
                        onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", "");
                            onStartTextPlacement?.("subtitle");
                        }}
                        onDragEnd={() => {
                            // Always clear placement mode when drag ends (with delay to let drop handler run first)
                            setTimeout(() => onStartTextPlacement?.(null as any), 0);
                        }}
                        className="cursor-move"
                    >
                        <IconButton variant="ghost" className="pointer-events-none">
                            <Type size={"small"} />
                        </IconButton>
                    </div>
                </Tooltip>
            </div>}

            {/*{!readOnly && <MenubarMenu>*/}
            {/*    <MenubarTrigger className={"rounded-xl"}>*/}
            {/*        Edit*/}
            {/*    </MenubarTrigger>*/}
            {/*    <MenubarPortal>*/}
            {/*        <MenubarContent>*/}
            {/*            <MenubarItem disabled={!dashboardState.canCopy}*/}
            {/*                         onSelect={dashboardState.onCopy}>*/}
            {/*                Copy{" "}*/}
            {/*                <MenubarShortcut>*/}
            {/*                    ⌘ C*/}
            {/*                </MenubarShortcut>*/}
            {/*            </MenubarItem>*/}
            {/*            <MenubarItem disabled={!dashboardState.canPaste}*/}
            {/*                         onSelect={dashboardState.onPaste}>*/}
            {/*                Paste{" "}*/}
            {/*                <MenubarShortcut>*/}
            {/*                    ⌘ V*/}
            {/*                </MenubarShortcut>*/}
            {/*            </MenubarItem>*/}
            {/*            <MenubarSeparator/>*/}
            {/*            <MenubarItem disabled={!dashboardState.canUndo}*/}
            {/*                         onSelect={dashboardState.onUndo}>*/}
            {/*                Undo{" "}*/}
            {/*                <MenubarShortcut>*/}
            {/*                    ⌘ Z*/}
            {/*                </MenubarShortcut>*/}
            {/*            </MenubarItem>*/}
            {/*            <MenubarItem disabled={!dashboardState.canRedo}*/}
            {/*                         onSelect={dashboardState.onRedo}>*/}
            {/*                Redo{" "}*/}
            {/*                <MenubarShortcut>*/}
            {/*                    ⇧ ⌘ Z*/}
            {/*                </MenubarShortcut>*/}
            {/*            </MenubarItem>*/}
            {/*        </MenubarContent>*/}
            {/*    </MenubarPortal>*/}
            {/*</MenubarMenu>}*/}

            {!readOnly && onRefreshAll && <Tooltip title={"Refresh all widgets"}>
                <IconButton variant="ghost" onClick={onRefreshAll} className={"mr-4"}>
                    <RefreshCw />
                </IconButton>
            </Tooltip>}

            {!readOnly && <Button
                variant={"outlined"}
                color={"neutral"}
                className={"rounded-xl"}
                onClick={onNewWidgetClick}>
                <MessageSquare size={"small"} />
                Edit
            </Button>}

        </Menubar>
    );
});

function DashboardNameTextField({
    title: titleProp,
    id,
    readOnly
}: { title?: string, id: string, readOnly: boolean }) {
    const datakiConfig = useDataki();
    const savedTitle = useRef(titleProp);
    const [title, setTitle] = React.useState(titleProp);
    const deferredTitle = useDeferredValue(title);
    useEffect(() => {
        if (deferredTitle !== savedTitle.current) {
            datakiConfig.updateDashboard(id, { title: deferredTitle }, "title_update");
            savedTitle.current = deferredTitle;
        }
    }, [deferredTitle]);

    return (
        <TextField
            className={"font-semibold rounded-xl text-sm w-64"}
            inputClassName={"rounded-xl"}
            // invisible={true}
            disabled={readOnly}
            size={"small"}
            placeholder={"Untitled dashboard"}
            onChange={(e) => setTitle(e.target.value)}
            value={title}
        />
    );
}

