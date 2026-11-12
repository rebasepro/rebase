/**
 * `@rebasepro/cms/mcp-view`: a project's admin app, inside an MCP App view.
 *
 * A client like Claude shows what the show_* tools open (a table's rows, a
 * record, an app the model wrote) in a sandboxed frame next to the
 * conversation. This is what runs in that frame: it speaks the host's
 * protocol, reads and writes through the server's tools as the person, and
 * draws with the admin panel's own components — inside the project's own
 * admin app, so its `customizeTable` customizations, custom views, entity
 * views, fields, previews, actions, plugins and slots are the ones drawn.
 *
 * The tables are the descriptors the tool result carries, redacted by the
 * server for this person: `<RebaseCMS>` renders them in place of the ones
 * its client would fetch, projected and customized exactly as on the
 * project's own page — the project's code customizations, then the UI
 * preferences the result carries (`ui-config.json` as the server knows it,
 * the workspace's, the person's), folded by the panel's own composition. The
 * generic view has no code customizations; the preferences still apply.
 *
 * ```ts
 * // the project's view entry (the Vite plugin generates it)
 * import { startMcpView } from "@rebasepro/cms/mcp-view";
 * startMcpView({ mountApp: () => import("./main") });
 * ```
 *
 * The app mounts as it does on its own page; `<Rebase>`, `<RebaseCMS>`,
 * `<RebaseStudio>` and `<RebaseShell>` find the embed host this sets
 * (`setRebaseEmbedHost` in `@rebasepro/app`) and stand in what the frame
 * cannot give them: data through the tools, the tables from the result, the
 * person already signed in, no routes, no network.
 *
 * @module
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { getTitlePropertyKeyForValues, looksLikeIdentifierValue, setRebaseEmbedHost, type RebaseEmbedHost } from "@rebasepro/app";
import type { AdminCollection, AuthController } from "@rebasepro/cms-types";
import type { SecurityOperation, SecurityRule, User } from "@rebasepro/types";
import { Alert } from "@rebasepro/ui";
import { McpAppBridge, type HostContext, type ToolResult, type ViewBridge } from "./bridge";
import { createToolDriver, describeChanges, describeRefusal, needsConfirmation, type ToolDriver, type ViewChange, type WriteFailure, type WriteIntent } from "./tool_driver";
import { findCollection, parseResult, type Screen, type TableGrant } from "./payload";
import { collectionsFromTables } from "../tables";
import { describeAppError, type AppError } from "./code_app";
import { McpScreen, type PendingPlan } from "./screen";
import { VIEW_STORAGE_SOURCE } from "./storage_source";
import { createViewStore } from "./store";

export { APPS_PROTOCOL_VERSION, McpAppBridge, isRecord } from "./bridge";
export type { HostContext, ToolResult, DisplayMode, ViewBridge } from "./bridge";
export { createToolDriver, DEFAULT_ACTIONS, SaveCancelledError, describeChanges, describeFailedWrite, describeRefusal, needsConfirmation } from "./tool_driver";
export type { CallTool, SeedPage, ToolDriver, ViewActions, WritePlan, WriteIntent, ViewChange, WriteFailure } from "./tool_driver";
export { parseResult, actionsOf, filterOf } from "./payload";
export type { Screen, Block, TableGrant, ScreenPreferences } from "./payload";

export interface McpViewOptions {
    /**
     * Mount the app, once the host is set: import the project's entry (which
     * renders its app as it would on its page), or render a default one into
     * `#root`. Given the screen the tool opened.
     */
    mountApp: (screen: Screen) => void | Promise<unknown>;
    /** Name and version the view gives the host. */
    appInfo?: { name: string; version: string };
    /** The channel to the host; a new one on this window's parent by default. */
    bridge?: ViewBridge;
}

/**
 * Connect to the host, wait for the tool's result, set the embed host from
 * it, and mount the app.
 */
export function startMcpView(options: McpViewOptions): ViewBridge {
    installSubmitFix();
    const bridge = options.bridge ?? new McpAppBridge();
    let started = false;

    bridge.ontoolresult = (result: ToolResult) => {
        if (started) return;
        started = true;
        const parsed = parseResult(result);
        if (parsed.kind === "error") {
            showError(parsed.message);
            return;
        }
        setRebaseEmbedHost(embedHost(bridge, parsed.screen));
        Promise.resolve(options.mountApp(parsed.screen))
            .catch(error => showError(`The view could not start: ${error instanceof Error ? error.message : String(error)}`));
    };

    // The host's light or dark, on the class the UI kit's `dark:` variant reads.
    bridge.watchHostContext(context => {
        if (context.theme) document.documentElement.classList.toggle("dark", context.theme === "dark");
    });

    void bridge.connect(options.appInfo ?? { name: "rebase", version: "0.3.0" });
    return bridge;
}

/** What the app runs on, here: the tools, the person, the frame's storage and theme, and the screen to draw. */
function embedHost(bridge: ViewBridge, screen: Screen): RebaseEmbedHost {
    const pending = createViewStore<PendingPlan | undefined>(undefined);
    const refused = createViewStore<WriteFailure | undefined>(undefined);
    const saved = createViewStore<WriteIntent | undefined>(undefined);
    const context = createViewStore<HostContext>(bridge.hostContext);
    bridge.watchHostContext(next => context.set(next));

    const told = modelContext(bridge);
    // The tables as the panel draws them — projected and customized, then
    // narrowed — once `<RebaseCMS>` has composed them; until then, and for a
    // table the app left out, as the CMS projects the descriptor. What a write
    // is sent by (a date-only column as its day, a belongsTo under its key) and
    // what a row is called.
    const projected: AdminCollection[] = collectionsFromTables(screen.tables);
    let drawn: readonly AdminCollection[] = [];
    const collectionOf = (name: string): AdminCollection | undefined =>
        findCollection(drawn, name) ?? findCollection(projected, name);
    const tools: ToolDriver = createToolDriver({
        callTool: (name, args) => bridge.callTool(name, args),
        actions: screen.actions,
        ...(screen.firstPage && { seed: screen.firstPage }),
        ...(screen.seeds && { seeds: screen.seeds }),
        // A table's collection by its slug: the name the tools, the model and
        // the admin panel all use.
        collection: collectionOf,
        confirm: plan => new Promise<boolean>(resolve => pending.set({
            plan,
            answer: confirmed => {
                pending.set(undefined);
                resolve(confirmed);
            }
        })),
        onWritten: intent => {
            if (!needsConfirmation(intent)) saved.set(intent);
        },
        onChange: told.changes,
        rowLabel: (name, id, row) => rowTitle(collectionOf(name), id, row),
        onWriteFailed: failure => {
            refused.set(failure);
            told.writeFailed(failure);
        }
    });

    const host: RebaseEmbedHost = {
        dataDriver: tools.driver,
        // Code can write without a click, so the row hooks ask the person
        // before each write; a save made with the admin's own controls goes
        // as on any screen. A courtesy, not the boundary: every call is the
        // server's tool as the person, under their RLS and granted scopes.
        rowHooksDriver: tools.confirmingDriver,
        authController: viewerAuth(screen.viewer),
        storageSource: VIEW_STORAGE_SOURCE,
        mode: bridge.hostContext.theme === "dark" ? "dark" : "light",
        tables: screen.tables,
        uiPreferences: screen.preferences,
        narrowCollections: collections => {
            drawn = narrowCollections(collections, screen.grants);
            return [...drawn];
        },
        renderCms: () => (
            <McpScreen
                bridge={bridge}
                screen={screen}
                hostContext={context}
                pendingPlan={pending}
                savedWrite={saved}
                writeFailure={refused}
                onAppError={told.appError}
            />
        )
    };
    // The theme follows the host's.
    bridge.watchHostContext(next => {
        const mode = next.theme === "dark" ? "dark" : "light";
        if (mode !== host.mode) {
            host.mode = mode;
            setRebaseEmbedHost({ ...host });
        }
    });
    return host;
}

/**
 * The app's collections as this person may see them here. They were composed
 * from the descriptors the server sent — so a column the person may not read
 * is not in them, and the CMS reads a column's write rule as it does on the
 * project's page — with the project's own customizations and components. What
 * remains is the connection: an operation its scopes were not granted on a
 * table (`data:write`, `data:delete`) is closed by a restrictive rule, which
 * is what the admin panel asks before it offers Add, Save or Delete. A
 * collection the server sent no grant for (one the app declares beside the
 * tables) is shown with every change closed: this screen did not ask for it.
 *
 * None of it is the boundary — every save is the server's write tool, which
 * checks the scopes, the column rules and RLS again — it keeps the view from
 * offering what would be refused.
 */
export function narrowCollections(collections: readonly AdminCollection[], grants: Readonly<Record<string, TableGrant>>): AdminCollection[] {
    return collections.map((collection): AdminCollection => {
        const grant = grants[collection.slug];
        const closed: SecurityOperation[] = [
            ...(grant?.write ? [] : ["insert", "update"] as const),
            ...(grant?.delete ? [] : ["delete"] as const)
        ];
        if (closed.length === 0) return collection;
        // A condition the evaluator decides (false) for everybody: a role no
        // account holds. The `roles` shortcut alone is a condition the
        // client-side evaluator leaves undecided, which the UI reads as allowed.
        const rule: SecurityRule = {
            name: grant ? "mcp_connection_scope" : "mcp_view_not_opened",
            mode: "restrictive",
            operations: closed,
            condition: { kind: "rolesOverlap", roles: [NOT_GRANTED] }
        };
        return { ...collection, securityRules: [...(collection.securityRules ?? []), rule] };
    });
}

/** A role no account holds: the condition of a rule meant never to pass. */
const NOT_GRANTED = "__mcp_connection_not_granted__";

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

/**
 * What the model is told, sent with the person's next message: the changes
 * they made here, and an app's failure. Each update replaces the last, so
 * both go every time.
 */
function modelContext(bridge: ViewBridge) {
    const state: { changes?: string; refused?: string; error?: string } = {};
    const send = () => {
        const text = [state.changes, state.refused, state.error].filter(Boolean).join("\n");
        if (text) void bridge.updateModelContext(text).catch(() => undefined);
    };
    return {
        changes: (changes: readonly ViewChange[]) => {
            state.changes = describeChanges(changes);
            send();
        },
        writeFailed: (failure: WriteFailure) => {
            state.refused = describeRefusal(failure);
            send();
        },
        appError: (error: AppError) => {
            state.error = describeAppError(error);
            send();
        }
    };
}

/**
 * A row's title, as the admin names the record: the collection's title
 * property where the row carries a readable value for it. Nothing where it
 * does not — an opaque id says no more than the caller's fallback.
 */
export function rowTitle(collection: AdminCollection | undefined, id: string, row: Record<string, unknown> | undefined): string | undefined {
    if (!collection || !row) return undefined;
    const key = getTitlePropertyKeyForValues(collection, row, id);
    const value = key ? row[key] : undefined;
    if (typeof value === "number") return String(value);
    return typeof value === "string" && value.trim() !== "" && !looksLikeIdentifierValue(value) ? value : undefined;
}

/** An error where the app would be, before it could start. */
function showError(message: string): void {
    const container = document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
    createRoot(container).render(<div className="p-4"><Alert color="error" size="small">{message}</Alert></div>);
}

/**
 * A host may sandbox the view without `allow-forms`, and then a form's submit
 * button submits nothing: the browser drops the submission before the form's
 * `submit` event — the admin panel's record form saves on that event. The
 * click still happens, so it is turned into the event itself, after the click
 * has finished (a button's own handler may say which save it was).
 */
function installSubmitFix(): void {
    document.addEventListener("click", (event) => {
        const button = event.target instanceof Element ? event.target.closest("button[type=submit]") : null;
        if (!(button instanceof HTMLButtonElement) || !button.form || button.disabled) return;
        event.preventDefault();
        const form = button.form;
        setTimeout(() => form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button })));
    }, true);
}
