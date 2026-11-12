/**
 * An embed host: what runs a project's own admin app somewhere other than its
 * own page — inside an MCP App view in Claude — and stands in for what that
 * place cannot give it.
 *
 * The admin app is written once, as `<Rebase>` with its client and auth,
 * `<RebaseCMS>` with its collections, custom views, entity views, plugins and
 * slots, the login screen, Studio and the shell. In an embedding there is no
 * address bar, no sign-in (the host holds the connection) and no network of
 * the app's own: data comes through the host. So the host is set before the
 * app renders, and each part reads it:
 *
 *  - `<Rebase>` takes its data driver, its auth and its storage from the host,
 *    and leaves its own `client` alone;
 *  - `<RebaseCMS>` renders the host's tables in place of the ones its client
 *    would fetch, sets up everything its props declare — table
 *    customizations, custom views, entity views — and draws the host's screen
 *    in place of its routes and navigation;
 *  - the login screen, Studio and the shell draw nothing.
 *
 * Everything the developer customised therefore works in the embedding,
 * because it is the developer's app that runs there, not a copy of its config.
 *
 * Set once per document, before the first render, by the embedding's
 * bootstrap. Outside one it is never set, and every part behaves as before.
 *
 * @internal Framework plumbing between `@rebasepro/cms`' MCP view
 * (`startMcpView`) and the parts that read it — not an app-facing API: an app
 * gives `<Rebase>` its data, auth and storage through its props.
 */
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { AdminCollection, AuthController } from "@rebasepro/cms-types";
import type { DataDriver, StorageSource, TableDescriptor } from "@rebasepro/types";

/** @internal */
export interface RebaseEmbedHost {
    /** Every read and write of the embedded app. */
    dataDriver: DataDriver;
    /**
     * What the row hooks (`useRows`, `useRowWrites`, …) read and write
     * through, where it is not `dataDriver`: in the MCP view, the same tools
     * with each write confirmed by the person first, since code can write
     * without a click. The admin's own views and forms keep `dataDriver`.
     */
    rowHooksDriver?: DataDriver;
    /** Who the app runs as. Already signed in; signing out does nothing. */
    authController: AuthController;
    /** Where files are read from, as far as the embedding can reach them. */
    storageSource: StorageSource;
    /** Light or dark, as the embedding is. */
    mode: "light" | "dark";
    /**
     * The tables the app renders, in place of the ones its client would ask
     * the server for (the embedding has no network of its own): the
     * descriptors the host received, already redacted for this person. The
     * panel projects them and applies the app's `tableCustomizations`, as on
     * the app's own page. Tables handed to `<RebaseCMS tables>` still win.
     */
    tables?: readonly TableDescriptor[];
    /**
     * The app's collections as the embedding may show them to this person —
     * what their connection was not granted closed. Applied to the
     * collections `<RebaseCMS>` composes, so every view and form the app
     * draws is drawn from the narrowed config, with its components.
     */
    narrowCollections: (collections: AdminCollection[]) => AdminCollection[];
    /**
     * What `<RebaseShell>` draws in place of its sign-in gate, routes and
     * layout, inside the providers `<RebaseNavigation>` sets up from what the
     * app registered.
     */
    renderCms: () => ReactNode;
}

let current: RebaseEmbedHost | undefined;
const listeners = new Set<() => void>();

/** @internal Set (or change) the embed host. Called by an embedding before the app renders, and when its context changes. */
export function setRebaseEmbedHost(host: RebaseEmbedHost | undefined): void {
    current = host;
    for (const listener of listeners) listener();
}

/** The embed host, outside React. */
function getRebaseEmbedHost(): RebaseEmbedHost | undefined {
    return current;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** @internal The embed host, re-rendering when it changes; `undefined` outside an embedding. */
export function useRebaseEmbedHost(): RebaseEmbedHost | undefined {
    return useSyncExternalStore(subscribe, getRebaseEmbedHost, getRebaseEmbedHost);
}
