import type { MCP_APP_MODULES, McpAppModule } from "@rebasepro/types";

/** The names a module with a served list hands out. */
export type McpAppModuleExport<M extends McpAppModule> =
    (typeof MCP_APP_MODULES)[M] extends readonly (infer N extends string)[] ? N : string;
