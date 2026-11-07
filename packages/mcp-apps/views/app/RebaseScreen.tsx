import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryRouter } from "react-router";
import { Rebase } from "@rebasepro/app";
import { CollectionPanel, CollectionsProvider, EntityFormPanel } from "@rebasepro/cms";
import type { AdminCollection, AuthController } from "@rebasepro/cms-types";
import type { User } from "@rebasepro/types";
import {
    Alert,
    Button,
    Card,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Maximize2Icon,
    Tooltip,
    Typography,
    cls,
    iconSize
} from "@rebasepro/ui";
import type { HostContext, McpAppBridge } from "../bridge";
import { createToolDriver, describeChanges, type ToolDriver, type ViewChange, type WritePlan } from "./tool-driver";
import { filterOf, findCollection, orderOf, type AppBlock, type CollectionBlock, type RecordBlock, type Screen } from "./payload";
import { AppErrorBoundary, describeAppError, loadApp, type AppError } from "./code-app";
import { AppSdkProvider } from "./sdk";
import { VIEW_STORAGE_SOURCE } from "./storage-source";

/** A collection's height in the conversation, where the host sizes the frame to the document. */
const INLINE_COLLECTION_HEIGHT = 460;

/**
 * The tallest the screen is in the conversation; past it, it scrolls inside.
 * A record's form and the confirmation of a save open over the frame, centred
 * in it: in a frame as tall as everything on the screen they would open where
 * the person is not looking.
 */
const INLINE_MAX_HEIGHT = 640;

interface PendingPlan {
    plan: WritePlan;
    answer: (confirmed: boolean) => void;
}

/**
 * The admin panel's own views, over the tools of the server that served this
 * one: `<Rebase>` with a driver that calls them, a router of its own (the
 * views link by path, and there is no address bar here), and the screen's
 * collections. On it, one block: a collection, a record, or an app the model
 * wrote.
 */
export function RebaseScreen({ bridge, screen, context }: {
    bridge: McpAppBridge;
    screen: Screen;
    context: HostContext;
}) {
    const [pending, setPending] = useState<PendingPlan>();
    const told = useModelContext(bridge);

    const tools = useMemo<ToolDriver>(() => createToolDriver({
        callTool: (name, args) => bridge.callTool(name, args),
        actions: screen.actions,
        confirm: plan => new Promise<boolean>(answer => setPending({ plan, answer })),
        onChange: told.changes,
        // An app names a collection as the model wrote it, the admin panel by
        // slug: both are watched as the slug, so a change refreshes both.
        canonical: name => findCollection(screen.collections, name)?.slug ?? name
    }), [bridge, screen.actions, screen.collections, told.changes]);

    const authController = useMemo(() => viewerAuth(screen.viewer), [screen.viewer]);
    const mode = context.theme === "dark" ? "dark" : "light";
    const modeController = useMemo(() => ({ mode, setMode: () => undefined }), [mode]) satisfies { mode: "light" | "dark"; setMode: () => void };

    const answer = (confirmed: boolean) => {
        pending?.answer(confirmed);
        setPending(undefined);
    };

    return (
        <Rebase
            dataSources={[{ key: "(default)", engine: "postgres", driver: tools.driver }]}
            authController={authController}
            modeController={modeController}
            storageSource={VIEW_STORAGE_SOURCE}
        >
            <MemoryRouter>
                <CollectionsProvider collections={screen.collections}>
                    <ScreenLayout bridge={bridge} screen={screen} context={context} tools={tools} onAppError={told.appError}/>
                </CollectionsProvider>
            </MemoryRouter>
            <Dialog open={pending !== undefined} onOpenChange={open => !open && answer(false)} maxWidth="sm">
                <DialogTitle variant="subtitle1">Confirm this change</DialogTitle>
                <DialogContent className="flex flex-col gap-2">
                    <Typography variant="body2">{pending?.plan.summary}</Typography>
                    {pending?.plan.effects?.map(effect => (
                        <Typography key={effect} variant="body2" color="secondary">{effect}</Typography>
                    ))}
                    {pending?.plan.reversible && (
                        <Typography variant="caption" color="secondary">Undo: {pending.plan.reversible}</Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button variant="text" color="neutral" onClick={() => answer(false)}>Cancel</Button>
                    <Button variant="filled" color="primary" onClick={() => answer(true)}>Save</Button>
                </DialogActions>
            </Dialog>
        </Rebase>
    );
}

/**
 * What the model is told, sent with the person's next message: the changes
 * they made here, and an app's failure. Each update replaces the last, so
 * both go every time.
 */
function useModelContext(bridge: McpAppBridge) {
    const state = useRef<{ changes?: string; error?: string }>({});
    const send = useCallback(() => {
        const text = [state.current.changes, state.current.error].filter(Boolean).join("\n");
        if (text) void bridge.updateModelContext(text).catch(() => undefined);
    }, [bridge]);
    return useMemo(() => ({
        changes: (changes: readonly ViewChange[]) => {
            state.current.changes = describeChanges(changes);
            send();
        },
        appError: (error: AppError) => {
            state.current.error = describeAppError(error);
            send();
        }
    }), [send]);
}

/**
 * The person the server drew the screen for, as the admin panel asks about
 * them: the security rules it evaluates before offering an action read
 * `uid` and `roles`. Signing out means nothing here — the host holds the
 * connection.
 */
function viewerAuth(viewer: Screen["viewer"]): AuthController {
    const user: User = {
        uid: viewer.uid,
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "mcp",
        isAnonymous: false,
        roles: viewer.roles
    };
    return {
        user,
        initialLoading: false,
        authLoading: false,
        loginSkipped: true,
        storageEnabled: false,
        signOut: async () => undefined,
        getAuthToken: async () => "",
        extra: undefined,
        setExtra: () => undefined
    };
}

function ScreenLayout({ bridge, screen, context, tools, onAppError }: {
    bridge: McpAppBridge;
    screen: Screen;
    context: HostContext;
    tools: ToolDriver;
    onAppError: (error: AppError) => void;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const fullscreen = context.displayMode === "fullscreen";
    const canExpand = !fullscreen && context.availableDisplayModes?.includes("fullscreen") === true;
    const block = screen.blocks[0];

    // The host sizes the frame to the document, which it cannot measure
    // across the sandbox.
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const measure = () => {
            const html = document.documentElement;
            const previous = html.style.height;
            html.style.height = "max-content";
            bridge.sizeChanged(Math.ceil(html.getBoundingClientRect().height));
            html.style.height = previous;
        };
        const observer = new ResizeObserver(measure);
        observer.observe(root);
        measure();
        return () => observer.disconnect();
    }, [bridge]);

    const heading = screen.title ?? (block.type === "app" ? undefined : blockTitle(block, screen.collections));

    return (
        <div ref={rootRef}
             className={cls("flex flex-col gap-4 p-4 bg-surface-sheet overflow-y-auto", fullscreen && "h-screen")}
             style={fullscreen ? undefined : { maxHeight: INLINE_MAX_HEIGHT }}>
            {(heading || canExpand) && (
                <div className="flex items-center justify-between gap-3 min-h-8">
                    <Typography variant="subtitle2" noWrap>{heading}</Typography>
                    {canExpand && (
                        <Tooltip title="Expand">
                            <IconButton
                                size="small"
                                aria-label="Expand"
                                onClick={() => void bridge.requestDisplayMode("fullscreen").catch(() => undefined)}
                            >
                                <Maximize2Icon size={iconSize.smallest}/>
                            </IconButton>
                        </Tooltip>
                    )}
                </div>
            )}
            {block.type === "app"
                ? <AppView block={block} screen={screen} tools={tools} onError={onAppError}/>
                : <BlockView block={block} screen={screen} fullscreen={fullscreen}/>}
        </div>
    );
}

function blockTitle(block: CollectionBlock | RecordBlock, collections: readonly AdminCollection[]): string {
    const collection = findCollection(collections, block.collection);
    if (block.type === "record") {
        const name = collection?.singularName ?? collection?.name ?? block.collection;
        return block.id === undefined ? `New ${name.toLowerCase()}` : name;
    }
    return collection?.name ?? block.collection;
}

function BlockView({ block, screen, fullscreen }: {
    block: CollectionBlock | RecordBlock;
    screen: Screen;
    fullscreen: boolean;
}) {
    const collection = findCollection(screen.collections, block.collection);
    if (!collection) {
        return <Alert color="error" size="small">The collection &quot;{block.collection}&quot; is not in this view.</Alert>;
    }
    return block.type === "collection"
        ? <CollectionView block={block} collection={collection} fullscreen={fullscreen}/>
        : <RecordView block={block} collection={collection}/>;
}

/** show_collection: the admin panel's collection view, where a row opens its form over the screen. */
function CollectionView({ block, collection, fullscreen }: {
    block: CollectionBlock;
    collection: AdminCollection;
    fullscreen: boolean;
}) {
    const overrides = useMemo<Partial<AdminCollection>>(() => {
        // The model's filter, as one the person can clear.
        const where = filterOf(block.where);
        return {
            ...(where && { defaultFilter: where }),
            ...(block.limit !== undefined && { pagination: block.limit })
        };
    }, [block.where, block.limit]);
    const sort = orderOf(block.orderBy);

    return (
        <div className={cls("min-h-0 rounded-xl overflow-hidden", fullscreen && "h-[80vh]")}
             style={fullscreen ? undefined : { height: INLINE_COLLECTION_HEIGHT }}>
            <CollectionPanel
                collection={collection}
                title={false}
                className="h-full flex flex-col"
                {...(block.view && { viewMode: block.view })}
                {...(sort && { sort })}
                collectionOverrides={overrides}
            />
        </div>
    );
}

/** show_record: the admin panel's form, for a row or a new one. */
function RecordView({ block, collection }: { block: RecordBlock; collection: AdminCollection }) {
    // A new row's form becomes that row's once it is saved.
    const [created, setCreated] = useState<string | number>();
    const id = block.id ?? created;
    return (
        <Card className="min-w-0 overflow-hidden">
            <EntityFormPanel
                key={String(id ?? "new")}
                collection={collection}
                entityId={id}
                {...(id === undefined && block.values && { defaultValues: block.values })}
                onSaved={params => {
                    if (id === undefined && params.entityId !== undefined) setCreated(params.entityId);
                }}
            />
        </Card>
    );
}

/** show_app: the app the model wrote, with the SDK it imports, and its failure shown in its place. */
function AppView({ block, screen, tools, onError }: {
    block: AppBlock;
    screen: Screen;
    tools: ToolDriver;
    onError: (error: AppError) => void;
}) {
    const loaded = useMemo(() => loadApp(block.code), [block.code]);
    const sdk = useMemo(() => ({
        data: tools.data,
        collections: screen.collections,
        allowed: block.collections
    }), [tools.data, screen.collections, block.collections]);

    // A module that failed as it loaded is told once.
    useEffect(() => {
        if (loaded.error) onError(loaded.error);
    }, [loaded, onError]);

    const failure = (error: AppError) => (
        <Alert color="error" size="small">
            The app failed{error.line ? ` at line ${error.line}` : ""}: {error.message}
        </Alert>
    );
    if (!loaded.Component) return failure(loaded.error ?? { message: "The app did not load." });
    const { Component } = loaded;
    return (
        <AppErrorBoundary lineOffset={loaded.lineOffset} onError={onError} fallback={failure}>
            <AppSdkProvider value={sdk}>
                <Component/>
            </AppSdkProvider>
        </AppErrorBoundary>
    );
}
