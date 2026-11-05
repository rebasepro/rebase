/**
 * The MCP App views `@rebasepro/server` serves at `/mcp` as `ui://`
 * resources. Each `html` is a whole document, scripts and styles inline.
 *
 * The server reads this shape structurally (`McpAppResource` in
 * `packages/server/src/mcp/mcp-apps.ts`), so neither package imports the other.
 */
import collectionTableHtml from "../dist/views/collection-table.html?raw";

export interface McpAppView {
    uri: string;
    name: string;
    description: string;
    html: string;
}

export const MCP_APPS: readonly McpAppView[] = [
    {
        // The URI show_collection names (`COLLECTION_TABLE_URI` in the server).
        uri: "ui://rebase/collection-table.html",
        name: "Collection table",
        description: "Rows of a Rebase collection as a table, with in-place editing where the connection may write.",
        html: collectionTableHtml
    }
];
