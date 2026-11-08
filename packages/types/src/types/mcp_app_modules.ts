/**
 * The modules an app Claude writes for show_app may import, and from each the
 * names the MCP view serves.
 *
 * An app imports the real package names, so the code reads — and pastes into
 * a project — like every other piece of Rebase code. Inside the view each
 * name is the package's own part: `"*"` serves the whole module, a list
 * serves exactly those exports. The one list three readers share, so none
 * can drift from the others:
 *
 * - the view's module registry (`@rebasepro/cms/mcp-view`), which hands an
 *   app these exports and no others;
 * - the server's compiler for show_app, which refuses any other import
 *   before the app opens, naming it;
 * - show_app's guide (`SHOW_APP_CODE_GUIDE` in `@rebasepro/server`), which a
 *   test holds to this list.
 */
export const MCP_APP_MODULES = {
    "react": "*",
    // What JSX compiles to; never written by hand.
    "react/jsx-runtime": "*",
    // The UI kit whole: layout, inputs, dialogs, icons, SplitView, the KPI tiles and charts.
    "@rebasepro/ui": "*",
    // The project's rows, flat, as the person: read, counted, aggregated, written.
    "@rebasepro/app": [
        "useRows",
        "useRow",
        "useRowCount",
        "useAggregate",
        "useRowWrites"
    ],
    // The admin panel's own blocks and atoms, with the project's custom views, fields and actions.
    "@rebasepro/cms": [
        "CollectionPanel",
        "CollectionToolbar",
        "CollectionSearchBar",
        "CollectionFiltersButton",
        "CollectionViewModeToggle",
        "CollectionAddButton",
        "EntityFormPanel",
        "EntityViewPanel",
        "FormField",
        "FieldValue",
        "useSidePanel",
        "useCollectionRegistryController"
    ]
} as const satisfies Readonly<Record<string, "*" | readonly string[]>>;

/** A module an app may import. */
export type McpAppModule = keyof typeof MCP_APP_MODULES;

/** The names a module with a served list hands out. */
export type McpAppModuleExport<M extends McpAppModule> =
    (typeof MCP_APP_MODULES)[M] extends readonly (infer N extends string)[] ? N : string;
