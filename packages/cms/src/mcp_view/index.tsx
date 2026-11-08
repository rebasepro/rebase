/**
 * `@rebasepro/cms/mcp-view`: a project's admin app, inside an MCP App view.
 *
 * A client like Claude shows what the show_* tools open (a collection, a
 * record, an app the model wrote) in a sandboxed frame next to the
 * conversation. This is what runs in that frame: it speaks the host's
 * protocol, reads and writes through the server's tools as the person, and
 * draws with the admin panel's own components — inside the project's own
 * admin app, so its custom views, entity views, fields, previews, actions,
 * plugins and slots are the ones drawn.
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
 * cannot give them: data through the tools, the person already signed in,
 * no routes, no network.
 *
 * @module
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { getTitlePropertyKeyForValues, looksLikeIdentifierValue, setRebaseEmbedHost, type RebaseEmbedHost } from "@rebasepro/app";
import type { AdminCollection, AuthController } from "@rebasepro/cms-types";
import type { SecurityRule, User } from "@rebasepro/types";
import { Alert } from "@rebasepro/ui";
import { McpAppBridge, type HostContext, type ToolResult } from "./bridge";
import { createToolDriver, describeChanges, describeFailedWrite, type ToolDriver, type ViewChange, type WriteFailure } from "./tool_driver";
import { findCollection, parseResult, type Screen } from "./payload";
import { describeAppError, type AppError } from "./code_app";
import { McpScreen, type PendingPlan } from "./screen";
import { VIEW_STORAGE_SOURCE } from "./storage_source";
import { createViewStore } from "./store";

export { APPS_PROTOCOL_VERSION, McpAppBridge, isRecord } from "./bridge";
import { isRecord } from "./bridge";
export type { HostContext, ToolResult, DisplayMode } from "./bridge";
export { createToolDriver, DEFAULT_ACTIONS, SaveCancelledError, describeChanges, describeFailedWrite } from "./tool_driver";
export type { CallTool, SeedPage, ToolDriver, ViewActions, WritePlan, ViewChange, WriteFailure } from "./tool_driver";
export { parseResult, actionsOf, filterOf } from "./payload";
export type { Screen, Block } from "./payload";

export interface McpViewOptions {
    /**
     * Mount the app, once the host is set: import the project's entry (which
     * renders its app as it would on its page), or render a default one into
     * `#root`. Given the screen the tool opened, for an app with no
     * collections of its own.
     */
    mountApp: (screen: Screen) => void | Promise<unknown>;
    /**
     * Draw a result from a server that predates the admin panel's views
     * (show_collection's columns only): the old table, where the view has it.
     */
    mountTable?: (bridge: McpAppBridge, container: HTMLElement) => void;
    /** Name and version the view gives the host. */
    appInfo?: { name: string; version: string };
    /** The channel to the host; a new one on this window's parent by default. */
    bridge?: McpAppBridge;
}

/**
 * Connect to the host, wait for the tool's result, set the embed host from
 * it, and mount the app.
 */
export function startMcpView(options: McpViewOptions): McpAppBridge {
    installSubmitFix();
    const bridge = options.bridge ?? new McpAppBridge();
    let started = false;

    bridge.ontoolresult = (result: ToolResult) => {
        if (started) return;
        started = true;
        const parsed = parseResult(result);
        if (parsed.kind === "table") {
            const container = document.getElementById("root");
            if (container && options.mountTable) options.mountTable(bridge, container);
            else showError("This view cannot draw this result.");
            return;
        }
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
function embedHost(bridge: McpAppBridge, screen: Screen): RebaseEmbedHost {
    const pending = createViewStore<PendingPlan | undefined>(undefined);
    const refused = createViewStore<WriteFailure | undefined>(undefined);
    const context = createViewStore<HostContext>(bridge.hostContext);
    bridge.watchHostContext(next => context.set(next));

    const told = modelContext(bridge);
    const tools: ToolDriver = createToolDriver({
        callTool: (name, args) => bridge.callTool(name, args),
        actions: screen.actions,
        ...(screen.firstPage && { seed: screen.firstPage }),
        ...(screen.seeds && { seeds: screen.seeds }),
        // A collection by whichever name it was read or written under: its
        // data path (the tools' name, the model's) or its slug (the admin's).
        collection: name => findCollection(screen.collections, name),
        confirm: plan => new Promise<boolean>(resolve => pending.set({
            plan,
            answer: confirmed => {
                pending.set(undefined);
                resolve(confirmed);
            }
        })),
        onChange: told.changes,
        rowLabel: (name, id, row) => rowTitle(findCollection(screen.collections, name), id, row),
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
        narrowCollections: collections => narrowCollections(collections, screen.collections),
        renderCms: () => (
            <McpScreen
                bridge={bridge}
                screen={screen}
                hostContext={context}
                pendingPlan={pending}
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
 * The app's collections as this person may see them here: the project's own
 * configs — with their components — narrowed as the server narrowed the ones
 * it sent (`McpViewPayload` in the server's `mcp/mcp-view.ts`). A field the
 * server left out is left out; one it made read-only is read-only; its
 * security rules (the project's, and the one closing what the connection was
 * not granted) are the ones checked. A collection the server sent nothing
 * for is shown with every change closed: this screen did not ask for it.
 *
 * Where the app has no collections of its own (the view without a project),
 * the server's configs are the collections.
 */
export function narrowCollections(own: AdminCollection[], sent: readonly AdminCollection[]): AdminCollection[] {
    if (own.length === 0) return [...sent];
    const bySlug = new Map(sent.map(collection => [collection.slug, collection]));
    return own.map((collection): AdminCollection => {
        const narrowed = bySlug.get(collection.slug);
        if (!narrowed) {
            return { ...collection, securityRules: [...(collection.securityRules ?? []), CLOSED] };
        }
        const copy = { ...collection };
        return Object.assign(copy, {
            properties: narrowProperties(collection.properties, narrowed.properties),
            securityRules: narrowed.securityRules ?? collection.securityRules
        });
    });
}

/** The fields the server sent, with its read-only marks; the project's own config for each. */
function narrowProperties<P extends Record<string, unknown>>(own: P, sent: Record<string, unknown>): P {
    const narrowed = { ...own };
    for (const key of Object.keys(narrowed)) {
        const sentProperty = sent[key];
        if (!sentProperty) {
            delete narrowed[key];
            continue;
        }
        const property = narrowed[key];
        if (isRecord(sentProperty) && isRecord(sentProperty.admin) && sentProperty.admin.readOnly === true && isRecord(property)) {
            Object.assign(narrowed, { [key]: { ...property, admin: { ...(isRecord(property.admin) ? property.admin : {}), readOnly: true } } });
        }
    }
    return narrowed;
}

/** A restrictive rule no account passes, closing every change. */
const CLOSED: SecurityRule = {
    name: "mcp_view_not_opened",
    mode: "restrictive",
    operations: ["insert", "update", "delete"],
    roles: ["__mcp_view_not_opened__"]
};

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
function modelContext(bridge: McpAppBridge) {
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
            state.refused = `The app tried to ${describeFailedWrite(failure)}, and the server refused: ${failure.message}`;
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
