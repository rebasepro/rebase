import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdminCollection } from "@rebasepro/cms-types";
import {
    Alert,
    Button,
    Card,
    CircularProgress,
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
import { CollectionPanel } from "../components/CollectionPanel";
import { RecordForm } from "../components/RecordForm";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import type { HostContext, McpAppBridge } from "./bridge";
import { describeFailedWrite, type WriteFailure, type WritePlan } from "./tool_driver";
import { filterOf, orderOf, type AppBlock, type CollectionBlock, type RecordBlock, type Screen } from "./payload";
import { AppErrorBoundary, loadApp, type AppError } from "./code_app";
import { AppCollections } from "./app_modules";
import { createViewStore, useViewStore, type ViewStore } from "./store";

/**
 * The tallest the screen is in the conversation; past it, a collection
 * scrolls inside its own block, and anything else inside the screen. A
 * record's form and the confirmation of a save open over the frame, centred
 * in it: in a frame as tall as everything on the screen they would open where
 * the person is not looking.
 */
const INLINE_MAX_HEIGHT = 640;

/** A write's plan waiting for the person's answer. */
export interface PendingPlan {
    plan: WritePlan;
    answer: (confirmed: boolean) => void;
}

export interface McpScreenProps {
    bridge: McpAppBridge;
    screen: Screen;
    /** The host's context, as it changes. */
    hostContext: ViewStore<HostContext>;
    /** The write plan to confirm, as it changes. */
    pendingPlan: ViewStore<PendingPlan | undefined>;
    /** The last write the server refused, as it changes: shown to the person, once each. */
    writeFailure?: ViewStore<WriteFailure | undefined>;
    onAppError: (error: AppError) => void;
}

/**
 * What the embedded app's shell draws (`renderCms` of the embed host): the
 * one block the tool opened — a collection, a record, or an app the model
 * wrote — inside the providers the app's own `<RebaseShell>` set up, so its
 * collections, custom views, entity views, fields and actions are the ones
 * drawn.
 */
export function McpScreen({ bridge, screen, hostContext, pendingPlan, writeFailure, onAppError }: McpScreenProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const context = useViewStore(hostContext);
    const pending = useViewStore(pendingPlan);
    const [refused, dismissRefused] = useRefusedWrite(writeFailure);
    const registry = useCollectionRegistryController();
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

    const collectionOf = (name: string): AdminCollection | undefined => registry.getCollection(name);
    const heading = screen.title ?? (block.type === "app" ? undefined : blockTitle(block, collectionOf(block.collection)));

    let body: React.ReactNode;
    if (!registry.initialised && !registry.collections?.length) {
        body = <CircularProgress size="smallest"/>;
    } else if (block.type === "app") {
        body = <AppView block={block} onError={onAppError}/>;
    } else {
        const collection = collectionOf(block.collection);
        body = !collection
            ? <Alert color="error" size="small">The collection &quot;{block.collection}&quot; is not in this view.</Alert>
            : block.type === "collection"
                ? <CollectionView block={block} collection={collection}/>
                : <RecordView block={block} collection={collection}/>;
    }

    return (
        <div ref={rootRef}
             className={cls("flex flex-col gap-4 p-4 w-full min-w-0 bg-surface-sheet text-text-primary dark:text-text-primary-dark overflow-y-auto", fullscreen && "h-screen")}
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
            {refused && (
                // Sticky: the inline frame scrolls inside, and the button that
                // wrote may be far below its top.
                <Alert color="error" size="small" outerClassName="sticky top-0 z-10" onDismiss={dismissRefused}>
                    {`Could not ${describeFailedWrite(refused)}: ${refused.message}`}
                </Alert>
            )}
            {body}
            <Dialog open={pending !== undefined} onOpenChange={open => !open && pending?.answer(false)} maxWidth="sm">
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
                    <Button variant="text" color="neutral" onClick={() => pending?.answer(false)}>Cancel</Button>
                    <Button variant="filled" color="primary" onClick={() => pending?.answer(true)}>Save</Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}

function blockTitle(block: CollectionBlock | RecordBlock, collection: AdminCollection | undefined): string {
    if (block.type === "record") {
        const name = collection?.singularName ?? collection?.name ?? block.collection;
        return block.id === undefined ? `New ${name.toLowerCase()}` : name;
    }
    return collection?.name ?? block.collection;
}

/**
 * show_collection: the admin panel's collection view, where a row opens its
 * form over the screen. It sizes to its rows, up to what the screen leaves
 * it — inline, the screen's height cap; full screen, the window — and then
 * scrolls inside.
 */
function CollectionView({ block, collection }: {
    block: CollectionBlock;
    collection: AdminCollection;
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
        <CollectionPanel
            collection={collection.slug}
            title={false}
            className="flex-1 rounded-xl overflow-hidden"
            {...(block.view && { viewMode: block.view })}
            {...(sort && { orderBy: sort })}
            collectionOverrides={overrides}
        />
    );
}

/** show_record: the admin panel's form, for a row or a new one. */
function RecordView({ block, collection }: { block: RecordBlock; collection: AdminCollection }) {
    // A new row's form becomes that row's once it is saved.
    const [created, setCreated] = useState<string | number>();
    const id = block.id ?? created;
    return (
        <Card className="min-w-0 overflow-hidden">
            <RecordForm
                key={String(id ?? "new")}
                collection={collection}
                id={id}
                {...(id === undefined && block.values && { defaultValues: block.values })}
                onSaved={params => {
                    if (id === undefined) setCreated(params.id);
                }}
            />
        </Card>
    );
}

/**
 * show_app: the app the model wrote, held to the collections it was opened
 * with, and its failure shown in its place.
 */
function AppView({ block, onError }: {
    block: AppBlock;
    onError: (error: AppError) => void;
}) {
    const loaded = useMemo(() => loadApp(block.code), [block.code]);

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
            <AppCollections names={block.collections}>
                <Component/>
            </AppCollections>
        </AppErrorBoundary>
    );
}

/**
 * The last write the server refused, until the person dismisses it: an app's
 * code can drop the rejection, and a button the app drew shows nothing of its
 * own (the admin's own controls show theirs). Shown in the screen, not as a
 * snackbar, which the sandboxed frame left off its edge.
 */
function useRefusedWrite(store: ViewStore<WriteFailure | undefined> | undefined): [WriteFailure | undefined, () => void] {
    const failure = useViewStore(store ?? NO_FAILURES);
    const [dismissed, setDismissed] = useState<WriteFailure | undefined>(undefined);
    const dismiss = useCallback(() => setDismissed(failure), [failure]);
    return [failure !== dismissed ? failure : undefined, dismiss];
}

const NO_FAILURES = createViewStore<WriteFailure | undefined>(undefined);
