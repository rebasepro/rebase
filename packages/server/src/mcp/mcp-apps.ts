/**
 * MCP Apps: the views a tool result can be shown in, inside the client.
 *
 * The MCP Apps extension (`io.modelcontextprotocol/ui`) lets a tool name a
 * `ui://` resource in its `_meta.ui.resourceUri`. A host that supports it
 * reads that resource — one self-contained HTML document — renders it in a
 * sandboxed iframe next to the conversation, and hands it the tool's input and
 * result over `postMessage`. Everything the view does after that (page, edit a
 * cell) is a `tools/call` the host relays back to this endpoint, with the same
 * token, so it runs as the same person under the same RLS as the model's own
 * calls. The view holds no credential and opens no connection of its own.
 *
 * A host without the extension ignores `_meta` and reads the tool's text
 * result, which is the full answer on its own.
 *
 * The HTML itself is built by `@rebasepro/mcp-apps`; this file only knows its
 * shape, so `@rebasepro/server` carries no UI code.
 */

/**
 * Compile an app the model wrote for the view (show_app's `code`): the code
 * to run, or the error to hand back. Built by `@rebasepro/mcp-apps`, and
 * loaded with the views.
 */
export type McpAppCompiler = (source: string) => { ok: true; code: string } | { ok: false; error: string };

/** Where the compiler comes from, asked once, on the first show_app. */
export type McpAppCompilerSource = () => Promise<McpAppCompiler>;

/** The MIME type a view resource is served as. */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/** One view: a `ui://` resource and the document behind it. */
export interface McpAppResource {
    /** `ui://…`, the value a tool's `_meta.ui.resourceUri` names. */
    uri: string;
    name: string;
    description: string;
    /** The whole document: scripts and styles inline, nothing fetched. */
    html: string;
}

/**
 * Where the views come from, asked once and remembered.
 *
 * A function rather than the list because the HTML is large: it is loaded on
 * the first `/mcp` request that needs it (any client's first `initialize` or
 * `tools/list`), not when the backend boots.
 */
export type McpAppsSource = () => Promise<readonly McpAppResource[]>;

/**
 * The `_meta.ui` a resource carries on both `resources/list` and
 * `resources/read`.
 *
 * No CSP domains: the view fetches nothing, so the host's default — no
 * network at all — is the policy it should run under. An image cell tries
 * the image and shows a label when the host blocks it: a project's image
 * hosts are its data, unknown when this is listed, and the spec takes only
 * named origins. `prefersBorder` because
 * a table reads as an object of its own in the transcript.
 */
export function mcpAppResourceMeta(): Record<string, unknown> {
    return { ui: { csp: {}, prefersBorder: true } };
}

/**
 * The `_meta` a tool that opens a view is listed with.
 *
 * The nested `ui.resourceUri` is the current form; the flat `ui/resourceUri`
 * key is the one hosts read before it, still checked by the reference host.
 */
export function mcpAppToolMeta(resourceUri: string): Record<string, unknown> {
    return { ui: { resourceUri }, "ui/resourceUri": resourceUri };
}

/** The file a project's admin build writes its own view to (`rebaseMcpViewPlugin`). */
export const PROJECT_VIEW_FILE = "rebase-view.html";

/**
 * The views to serve, with the project's own document in place of the
 * generic one where the project built it: its admin app, started inside the
 * view, so its custom views, fields and actions are what the client draws.
 *
 * Looked for at `REBASE_MCP_VIEW` (a path to the file), then beside each
 * frontend `serveSPA` serves. Read once, with the views.
 */
export function withProjectView(
    apps: readonly McpAppResource[],
    candidates: readonly string[],
    readFile: (file: string) => string | undefined
): readonly McpAppResource[] {
    for (const file of candidates) {
        const html = readFile(file);
        if (html) return apps.map(app => ({ ...app, html }));
    }
    return apps;
}
