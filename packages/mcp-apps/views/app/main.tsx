/**
 * The view a server serves when its project has none of its own (no admin
 * frontend built with the Rebase Vite plugin): the admin panel with no
 * customizations, drawing the collections the server sent. A project that
 * builds its admin gets a view of its own instead, running its own app —
 * see `startMcpView` in `@rebasepro/cms/mcp-view`.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { Rebase } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { startMcpView, type ViewBridge } from "@rebasepro/cms/mcp-view";
import { CollectionTable } from "../collection-table/CollectionTable";
import "../index.css";

const NO_COLLECTIONS: never[] = [];

function root(): HTMLElement {
    return document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
}

/** Start the view: on this window's host, or on `bridge` (a test's stand-in). */
export function startGenericView(bridge?: ViewBridge): ViewBridge {
    return startMcpView({
        ...(bridge && { bridge }),
        appInfo: { name: "rebase", version: "0.3.0" },
        // An admin with nothing of its own: the embed host fills in the data,
        // the person, and the collections the server sent.
        mountApp: () => createRoot(root()).render(
            <Rebase>
                <RebaseCMS collections={NO_COLLECTIONS}/>
                <RebaseShell/>
            </Rebase>
        ),
        mountTable: (host, container) => createRoot(container).render(<CollectionTable bridge={host}/>)
    });
}
