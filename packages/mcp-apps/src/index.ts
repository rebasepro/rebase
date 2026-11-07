/**
 * The MCP App view `@rebasepro/server` serves at `/mcp` as `ui://`
 * resources: one document, scripts and styles inline, in which every show_*
 * tool's screen is drawn with the admin panel's own components.
 *
 * The server reads this shape structurally (`McpAppResource` in
 * `packages/server/src/mcp/mcp-apps.ts`), so neither package imports the other.
 */
import appHtml from "../dist/views/app.html?raw";

export { compileApp, MAX_APP_SOURCE, type AppCompileResult } from "./compile";
export { APP_MODULES } from "./app-modules";

export interface McpAppView {
    uri: string;
    name: string;
    description: string;
    html: string;
}

export const MCP_APPS: readonly McpAppView[] = [
    {
        // The URI show_collection, show_record and show_app name (`MCP_APP_URI` in the server).
        uri: "ui://rebase/app.html",
        name: "Rebase",
        description: "A project's collections, records and counts, in the Rebase admin panel's own views, where the connection may read and change them.",
        html: appHtml
    },
    {
        // What show_collection named before (`COLLECTION_TABLE_URI`): the same
        // document, for a host still holding a tool listing from then. It
        // draws the old table for a result that carries only its columns.
        uri: "ui://rebase/collection-table.html",
        name: "Collection table",
        description: "Rows of a Rebase collection, in the admin panel's collection view.",
        html: appHtml
    }
];
