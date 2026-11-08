/**
 * `@rebasepro/cms/mcp-view`: what a project's build of its MCP App view
 * imports (`rebaseMcpViewPlugin` generates that entry) — see
 * `./mcp_view/index.tsx`. The runtime's other parts (the bridge, the tool
 * driver, the payload) are its own; `@rebasepro/mcp-apps` builds from source
 * and reaches them there.
 */
export { startMcpView } from "./mcp_view/index";
export type { McpViewOptions } from "./mcp_view/index";
