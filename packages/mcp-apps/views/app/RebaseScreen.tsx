import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryRouter } from "react-router";
import { Rebase } from "@rebasepro/app";
import {
    CollectionPanel,
    CollectionsProvider,
    EntityFormPanel,
    SidePanelControllerContext,
    useSidePanel
} from "@rebasepro/cms";
import type { AdminCollection, AuthController, SidePanelController } from "@rebasepro/cms-types";
import type { DataDriver, User } from "@rebasepro/types";
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
import type { HostContext, McpAppBridge } from "../bridge";
import { createToolDriver, describeChanges, type WritePlan } from "./tool-driver";
import { filterOf, findCollection, type Block, type CollectionBlock, type MetricBlock, type RecordBlock, type Screen } from "./payload";

/** Below this width a block that follows another goes under it rather than beside it. */
const SIDE_BY_SIDE_WIDTH = 880;

/** A collection block's height in the conversation, where the host sizes the frame to the document. */
const INLINE_COLLECTION_HEIGHT = 460;

/**
 * The tallest the screen is in the conversation; past it, it scrolls inside.
 * A record's form and the confirmation of a save open over the frame, centred
 * in it: in a frame as tall as everything on the screen they would open where
 * the person is not looking.
 */
const INLINE_MAX_HEIGHT = 640;

/** The row selected in each collection block, by block key. */
type Selection = Record<string, string | number | undefined>;

interface PendingPlan {
    plan: WritePlan;
    answer: (confirmed: boolean) => void;
}

/**
 * A screen of the admin panel's own views, over the tools of the server that
 * served this one: `<Rebase>` with a driver that calls them, a router of its
 * own (the views link by path, and there is no address bar here), and the
 * screen's collections.
 */
export function RebaseScreen({ bridge, screen, context }: {
    bridge: McpAppBridge;
    screen: Screen;
    context: HostContext;
}) {
    const [pending, setPending] = useState<PendingPlan>();
    // Bumped on every change saved here: what counts rows counts again.
    const [version, setVersion] = useState(0);

    const driver = useMemo<DataDriver>(() => createToolDriver({
        callTool: (name, args) => bridge.callTool(name, args),
        actions: screen.actions,
        confirm: plan => new Promise<boolean>(answer => setPending({ plan, answer })),
        onChange: changes => {
            setVersion(current => current + 1);
            // Sent with the person's next message: the rows the model read
            // are not the rows there are any more.
            void bridge.updateModelContext(describeChanges(changes)).catch(() => undefined);
        }
    }), [bridge, screen.actions]);

    const authController = useMemo(() => viewerAuth(screen.viewer), [screen.viewer]);
    const mode = context.theme === "dark" ? "dark" : "light";
    const modeController = useMemo(() => ({ mode, setMode: () => undefined }), [mode]) satisfies { mode: "light" | "dark"; setMode: () => void };

    const answer = (confirmed: boolean) => {
        pending?.answer(confirmed);
        setPending(undefined);
    };

    return (
        <Rebase
            dataSources={[{ key: "(default)", engine: "postgres", driver }]}
            authController={authController}
            modeController={modeController}
        >
            <MemoryRouter>
                <CollectionsProvider collections={screen.collections}>
                    <ScreenLayout bridge={bridge} screen={screen} context={context} driver={driver} version={version}/>
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

function ScreenLayout({ bridge, screen, context, driver, version }: {
    bridge: McpAppBridge;
    screen: Screen;
    context: HostContext;
    driver: DataDriver;
    version: number;
}) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [selection, setSelection] = useState<Selection>({});
    const fullscreen = context.displayMode === "fullscreen";
    const canExpand = !fullscreen && context.availableDisplayModes?.includes("fullscreen") === true;

    // The host sizes the frame to the document, which it cannot measure
    // across the sandbox; and the layout follows the frame's width.
    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const measure = () => {
            setWidth(root.clientWidth);
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

    const select = useCallback((key: string, id: string | number | undefined) => {
        setSelection(current => ({ ...current, [key]: id }));
    }, []);

    const metrics = screen.blocks.filter((block): block is MetricBlock => block.type === "metric");
    const groups = useMemo(() => groupsOf(screen.blocks), [screen.blocks]);
    const sideBySide = width >= SIDE_BY_SIDE_WIDTH;
    const single = screen.blocks.length === 1;
    const heading = screen.title ?? (single ? blockTitle(screen.blocks[0], screen.collections) : undefined);

    return (
        <div ref={rootRef}
             className={cls("flex flex-col gap-4 p-4 bg-surface-sheet overflow-y-auto", fullscreen && "h-screen")}
             style={fullscreen ? undefined : { maxHeight: INLINE_MAX_HEIGHT }}>
            {(heading || canExpand) && (
                <div className="flex items-center justify-between gap-3 min-h-8">
                    <Typography variant={single ? "subtitle2" : "h6"} noWrap>{heading}</Typography>
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

            {metrics.length > 0 && (
                <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
                    {metrics.map(block => (
                        <Metric key={block.key} block={block} driver={driver} version={version}/>
                    ))}
                </div>
            )}

            {groups.map(([source, ...followers]) => {
                const view = (block: CollectionBlock | RecordBlock) => (
                    <BlockView
                        key={block.key}
                        block={block}
                        screen={screen}
                        single={single}
                        fullscreen={fullscreen}
                        driver={driver}
                        selection={selection}
                        followed={screen.blocks.some(other => other.type !== "metric" && other.follows?.block === block.key)}
                        onSelect={select}
                    />
                );
                // The blocks that follow a selection beside it, one under the
                // other, where there is room; under it where there is not.
                return sideBySide && followers.length > 0 ? (
                    <div key={source.key} className="grid grid-cols-2 gap-4 items-start">
                        {view(source)}
                        <div className="flex flex-col gap-4 min-w-0">{followers.map(view)}</div>
                    </div>
                ) : (
                    <div key={source.key} className="flex flex-col gap-4">{[source, ...followers].map(view)}</div>
                );
            })}
        </div>
    );
}

/**
 * The blocks in rows: each block that follows none, with the blocks that
 * follow it beside it. Metrics have their own row.
 */
function groupsOf(blocks: readonly Block[]): (CollectionBlock | RecordBlock)[][] {
    const groups: (CollectionBlock | RecordBlock)[][] = [];
    for (const block of blocks) {
        if (block.type === "metric") continue;
        const source = block.follows?.block;
        const group = source ? groups.find(candidate => candidate.some(member => member.key === source)) : undefined;
        if (group) group.push(block);
        else groups.push([block]);
    }
    return groups;
}

function blockTitle(block: Block, collections: readonly AdminCollection[]): string | undefined {
    if (block.title) return block.title;
    const collection = findCollection(collections, block.collection);
    if (block.type === "record") {
        const name = collection?.singularName ?? collection?.name ?? block.collection;
        return block.id === undefined && !block.follows ? `New ${name.toLowerCase()}` : name;
    }
    return collection?.name ?? block.collection;
}

function BlockView({ block, screen, single, fullscreen, driver, selection, followed, onSelect }: {
    block: CollectionBlock | RecordBlock;
    screen: Screen;
    single: boolean;
    fullscreen: boolean;
    driver: DataDriver;
    selection: Selection;
    followed: boolean;
    onSelect: (key: string, id: string | number | undefined) => void;
}) {
    const collection = findCollection(screen.collections, block.collection);
    const title = single ? undefined : blockTitle(block, screen.collections);
    if (!collection) {
        return <Alert color="error" size="small">The collection &quot;{block.collection}&quot; is not in this view.</Alert>;
    }
    return (
        <section className="flex flex-col gap-2 min-w-0">
            {title && <Typography variant="subtitle2" noWrap>{title}</Typography>}
            {block.type === "collection"
                ? <CollectionView block={block} collection={collection} screen={screen} fullscreen={fullscreen}
                                  driver={driver} selection={selection} followed={followed} onSelect={onSelect}/>
                : <RecordView block={block} collection={collection} screen={screen} driver={driver} selection={selection}/>}
        </section>
    );
}

/**
 * A collection block: the admin panel's collection view. Where another
 * block follows this one, opening a row selects it for that block instead
 * of opening its form over the screen.
 */
function CollectionView({ block, collection, screen, fullscreen, driver, selection, followed, onSelect }: {
    block: CollectionBlock;
    collection: AdminCollection;
    screen: Screen;
    fullscreen: boolean;
    driver: DataDriver;
    selection: Selection;
    followed: boolean;
    onSelect: (key: string, id: string | number | undefined) => void;
}) {
    const parent = useSidePanel();
    const source = block.follows;
    const linked = useLinkedValue(source ? { block: source.block, field: source.field } : undefined, screen, driver, selection);

    const sidePanel = useMemo<SidePanelController>(() => !followed ? parent : {
        ...parent,
        open: props => {
            if (props.entityId !== undefined && !props.copy) onSelect(block.key, props.entityId);
            else parent.open(props);
        }
    }, [followed, parent, onSelect, block.key]);

    const overrides = useMemo<Partial<AdminCollection>>(() => {
        const where = filterOf(block.where);
        return {
            ...(where && { defaultFilter: where }),
            ...(source && linked.value !== undefined && { fixedFilter: { [source.on]: ["==", linked.value] } }),
            ...(block.limit !== undefined && { pagination: block.limit })
        };
    }, [block.where, block.limit, source, linked.value]);

    if (source && linked.value === undefined) {
        return <Placeholder loading={linked.loading} text={`Open a row in ${blockTitle(sourceBlock(screen, source.block), screen.collections) ?? source.block} to see these.`}/>;
    }

    return (
        <div className={cls("min-h-0 rounded-xl overflow-hidden", fullscreen ? "h-[70vh]" : undefined)}
             style={fullscreen ? undefined : { height: INLINE_COLLECTION_HEIGHT }}>
            <SidePanelControllerContext.Provider value={sidePanel}>
                <CollectionPanel
                    // A new link is a new list, not a filter the person set.
                    key={String(linked.value ?? "")}
                    collection={collection}
                    title={false}
                    className="h-full flex flex-col"
                    {...(block.view && { viewMode: block.view })}
                    {...(orderOf(block.orderBy) && { sort: orderOf(block.orderBy) })}
                    collectionOverrides={overrides}
                />
            </SidePanelControllerContext.Provider>
        </div>
    );
}

/** A record block: the admin panel's form, for a row, a selected row, or a new one. */
function RecordView({ block, collection, screen, driver, selection }: {
    block: RecordBlock;
    collection: AdminCollection;
    screen: Screen;
    driver: DataDriver;
    selection: Selection;
}) {
    const linked = useLinkedValue(block.follows, screen, driver, selection);
    // A new row's form becomes that row's once it is saved.
    const [created, setCreated] = useState<string | number>();
    const id = block.follows ? linked.value : block.id ?? created;

    if (block.follows && id === undefined) {
        return <Placeholder loading={linked.loading} text={`Open a row in ${blockTitle(sourceBlock(screen, block.follows.block), screen.collections) ?? block.follows.block} to see it here.`}/>;
    }
    return (
        <Card className="min-w-0 overflow-hidden">
            <EntityFormPanel
                key={String(id ?? "new")}
                collection={collection}
                entityId={id === undefined ? undefined : id}
                {...(id === undefined && block.values && { defaultValues: block.values })}
                onSaved={params => {
                    if (id === undefined && params.entityId !== undefined) setCreated(params.entityId);
                }}
            />
        </Card>
    );
}

/** How many rows match: counted when opened, and again after each change saved here. */
function Metric({ block, driver, version }: { block: MetricBlock; driver: DataDriver; version: number }) {
    const [count, setCount] = useState<number | undefined>(block.count);
    const [failed, setFailed] = useState(false);
    const first = useRef(true);

    useEffect(() => {
        // The count the server sent is the one to show until something changes.
        if (first.current && block.count !== undefined) {
            first.current = false;
            return;
        }
        first.current = false;
        let live = true;
        const filter = filterOf(block.where);
        driver.count?.({ path: block.collection, ...(filter && { filter }) })
            .then(next => live && setCount(next))
            .catch(() => live && setFailed(true));
        return () => {
            live = false;
        };
    }, [driver, block.collection, block.where, block.count, version]);

    return (
        <Card className="p-4 flex flex-col gap-1">
            {count === undefined && !failed
                ? <CircularProgress size="smallest"/>
                : <Typography variant="h5">{failed ? "—" : count?.toLocaleString()}</Typography>}
            <Typography variant="caption" color="secondary" noWrap>{block.title}</Typography>
        </Card>
    );
}

function Placeholder({ text, loading }: { text: string; loading: boolean }) {
    return (
        <Card className="p-6 flex items-center justify-center min-h-32">
            {loading ? <CircularProgress size="smallest"/> : <Typography variant="body2" color="secondary">{text}</Typography>}
        </Card>
    );
}

function sourceBlock(screen: Screen, key: string): Block {
    return screen.blocks.find(block => block.key === key) ?? screen.blocks[0];
}

/**
 * The value a following block keys on: the id of the row selected in its
 * source block, or one of that row's fields — read from the row as the
 * tools serve it, where a belongsTo is its foreign key.
 */
function useLinkedValue(
    follows: { block: string; field?: string } | undefined,
    screen: Screen,
    driver: DataDriver,
    selection: Selection
): { value: string | number | undefined; loading: boolean } {
    const selected = follows ? selection[follows.block] : undefined;
    const [state, setState] = useState<{ value: string | number | undefined; loading: boolean }>({ value: undefined, loading: false });
    const source = follows ? screen.blocks.find(block => block.key === follows.block) : undefined;

    useEffect(() => {
        if (!follows || selected === undefined || !source) {
            setState({ value: undefined, loading: false });
            return;
        }
        if (!follows.field) {
            setState({ value: selected, loading: false });
            return;
        }
        const field = follows.field;
        let live = true;
        setState({ value: undefined, loading: true });
        const sourceCollection = findCollection(screen.collections, source.collection);
        driver.fetchOne({ path: sourceCollection?.slug ?? source.collection, id: selected })
            .then(row => {
                const value = row?.[field];
                if (live) setState({ value: typeof value === "string" || typeof value === "number" ? value : undefined, loading: false });
            })
            .catch(() => live && setState({ value: undefined, loading: false }));
        return () => {
            live = false;
        };
    }, [follows, selected, source, driver, screen.collections]);

    return state;
}

/** A block's `orderBy` as the collection view's `sort`: its first key. */
function orderOf(raw: unknown): [string, "asc" | "desc"] | undefined {
    if (typeof raw === "string" && raw !== "") {
        const [field, direction] = raw.split(":");
        return [field, direction === "desc" ? "desc" : "asc"];
    }
    if (Array.isArray(raw) && raw.length > 0) {
        const first = Array.isArray(raw[0]) ? raw[0] : raw;
        if (typeof first[0] === "string") return [first[0], first[1] === "desc" ? "desc" : "asc"];
    }
    return undefined;
}
