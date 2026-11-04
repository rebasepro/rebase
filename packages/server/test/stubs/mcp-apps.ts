/**
 * Stands in for `@rebasepro/mcp-apps` in a test run.
 *
 * Its real module inlines a built HTML document (`?raw`), which only Vite can
 * load and only after the package is built. The backend imports it lazily,
 * the first time an MCP client asks for a view; a suite that gets that far is
 * handed this one view, a document with nothing in it.
 */
export const MCP_APPS = [{
    uri: "ui://rebase/collection-table.html",
    name: "Collection table",
    description: "A stand-in for the built view.",
    html: "<!doctype html><html><body></body></html>"
}];
