/**
 * How to write show_app's code: the modules an app imports, and what each
 * gives it. The guide is what {@link SHOW_APP_GUIDE_TOOL} returns; show_app's
 * own description carries only {@link SHOW_APP_ESSENTIALS}, because a host
 * cuts a long description short (claude.ai at about 4,000 characters, which
 * left the UI kit's half of the guide unread). The hosted connector serves
 * the same two.
 *
 * Every name it imports or documents is one the view serves
 * (`MCP_APP_MODULES` in `@rebasepro/types`); `test/mcp-app-guide.test.ts`
 * holds it to that list, both ways.
 */

/** The tool that returns {@link SHOW_APP_CODE_GUIDE}. */
export const SHOW_APP_GUIDE_TOOL = "show_app_guide";

/**
 * What show_app's description says of the code: where the guide is, and the
 * mistakes an app written without it makes. Short enough to be read whole.
 */
export const SHOW_APP_ESSENTIALS = `
Call ${SHOW_APP_GUIDE_TOOL} before writing the code: it gives every hook, component and prop an app may use, with a worked example. Props guessed from other libraries draw nothing. In short:
- One TSX module, default-exporting a React component with no props. Its only imports: "react"; "@rebasepro/app" (useRows, useRow, useRowCount, useAggregate, useRowWrites: the rows of the project's tables, as the user); "@rebasepro/cms" (CollectionPanel, RecordForm, FormField, RecordDetail, FieldValue, useSidePanel: the admin panel's own views and forms of a table); "@rebasepro/ui" (the UI kit: SplitView, KpiGrid, KpiTile, ChartCard, BarChart, TimeSeriesChart, Card, Button, Tabs, …).
- A list and a form: <SplitView master={…} detail={…} selected={…} onClearSelection={…} /> inside a parent with a height (style={{ height: 560 }}), never grid columns side by side.
- Figures and charts: KpiTile and BarChart, not drawn by hand.
- Tailwind's standard utilities only: an arbitrary value (h-[560px]) does nothing.`;

/**
 * The example's imports, written into it when the guide is built: spelled out
 * in this file, they would read as this module importing React and the admin
 * packages to the scanners that keep the server headless.
 */
const EXAMPLE_IMPORTS: ReadonlyArray<readonly [names: string, module: string]> = [
    ["{ useState }", "react"],
    ["{ Button, KpiGrid, KpiTile, SplitView }", "@rebasepro/ui"],
    ["{ useRowCount, useRowWrites }", "@rebasepro/app"],
    ["{ CollectionPanel, RecordForm, FormField }", "@rebasepro/cms"]
];

export const SHOW_APP_CODE_GUIDE = `
The app is one TSX module whose default export is a React component (hooks welcome, no props). It runs in the conversation inside the project's admin panel, as the user, and imports Rebase's own packages, so the same code works in the project. It may import only these names:
- "react".
- "@rebasepro/app", the rows of the project's tables as the user, under their RLS, as query_table returns them (dates as ISO text, a belongsTo as its foreign-key column, e.g. authorId); \`where\` and \`orderBy\` are query_table's. Each hook names its table by the name list_tables gives ("orders"), as the SDK's data.table("orders") does.
  useRows(table, { where?, orderBy?, limit?, offset?, searchString? }) → { rows, total, hasMore, loadMore, loading, error, refresh }
  useRow(table, id) → { row, loading, error, refresh }
  useRowCount(table, where?) → { count, loading, error }
  useAggregate(table, { select: [{ fn: "count" | "sum" | "avg" | "min" | "max", field? }], groupBy?, where?, orderBy?, limit? }) → { result, loading, error } — result is one row per group, each value under its alias (count, sum_total).
  useRowWrites() → { create(table, values, id?), update(table, id, values), remove(table, id), saving, error }
- "@rebasepro/cms", the admin panel's own parts, with the project's custom fields, views and actions. The admin panel calls a table's view a collection: each part names its table as collection="orders".
  <CollectionPanel collection where? orderBy? ("field:desc") fields? viewMode? ("table" | "list" | "cards" | "kanban") toolbar? ("full" | "compact" | "none") rowActions?(row, id) onRowClick?(row, id) highlightedIds? title? /> — the admin's collection view: search, filters, paging; it sizes to its rows and scrolls past its height. where={{ status: ["==", "pending"] }} fixes which rows it holds, as useRows' where, and follows state (a tab, a bar clicked). fields picks and orders the columns. toolbar="compact" is search, the view switch and New; "none" hides it; or compose one: <CollectionToolbar start? end? /> holding CollectionSearchBar, CollectionFiltersButton, CollectionViewModeToggle, CollectionAddButton. rowActions draws your JSX on every row, card and kanban card — the table's last column — handed the row and its id: rowActions={(row, id) => <Button size="small" onClick={() => update("orders", id, { status: "shipped" })}>Ship</Button>}; a click there does not open the row. onRowClick is handed the clicked row as useRows reads it and its id, a string; without it, a row opens its form. highlightedIds={[id]} draws those rows as selected.
  <RecordForm collection id? fields? compact? defaultValues? onSaved?({ row, id }) /> — the record form, a new row's without id. fields shows only those, in that order; compact is the dense form for a side card. Children lay the fields out your way: <RecordForm collection="orders" id={id}><div className="grid grid-cols-2 gap-3"><FormField name="status" /><FormField name="notes" /></div></RecordForm>.
  <RecordDetail collection id fields? /> — one row, read-only.
  <FieldValue collection field value /> — one value, drawn as the admin draws it: an enum as its chip, a date, a foreign key as the related row's title (field="customer" value={order.customerId}).
  useSidePanel().open({ path, id? }) — open a row's form over the app; without id, a new row's.
- "@rebasepro/ui", the UI kit: Card, Button, IconButton, Typography, Tabs, Tab, Chip, Alert, TextField, Select, SelectItem, Checkbox, Dialog, DialogTitle, DialogContent, DialogActions, Separator, CircularProgress, Tooltip, cls, Lucide icons with an Icon suffix (PlusIcon), and:
  <SplitView master detail? selected? onClearSelection? detailTitle? /> — a list and what is open in it, side by side when wide, the detail over the list with a back bar when narrow; given selected, the detail shows only while it is set. It fills its parent: give the parent a height (style={{ height: 560 }}).
  <KpiGrid periodDays?> of <KpiTile label value format? previous? goodWhen? ("up" | "down") loading? /> — previous is the earlier period's value, shown as the change.
  <ChartCard title headline? action?> around <BarChart bars={[{ key, label, value }]} format? onBarClick? /> or <TimeSeriesChart series={[{ id, label, points: [{ at, value }] }]} variant? ("area" | "line") height? />; formatNumber(value, format?).
  Lay out and space with Tailwind's standard utilities (flex, grid, gap-*, p-*, w-*, h-64/h-80/h-96, text-sm, …); colours come from the kit (bg-surface-card, text-text-secondary), never hard-coded. Arbitrary values (h-[560px], w-[42%]) do not exist in the view and do nothing: give an exact size with style={{ height: 560 }}.
Width: the app is about 700px wide in the conversation, the whole window when the person expands it. Never put a list and a form side by side in grid columns: use SplitView, which chooses by its own width.
useRowWrites asks the user before it writes, so the app does not write without their click; a declined write rejects ("Not saved"), and one the server refuses rejects with its reason, which the view also shows the user and tells you. The admin's own controls (a form's Save, a delete, a table edit, a row action) behave as they do on show_table. That question is a courtesy, not the boundary: every read and write is this server's tool called as the user, under their RLS and the scopes their connection was granted, so the app can do nothing you could not do with the same tools. You are told what they saved. What changes refreshes every view of that table. The app may use only the tables listed in \`tables\`; the first page and count of each are read before it opens, so its first render waits on none of them.

Example:
${EXAMPLE_IMPORTS.map(([names, module]) => `import ${names} from ${JSON.stringify(module)};`).join("\n")}

export default function OrderDesk() {
    const [selected, setSelected] = useState<{ row: Record<string, unknown>; id: string }>();
    const pending = useRowCount("orders", { status: ["==", "pending"] });
    const { update, saving } = useRowWrites();
    return (
        <div className="flex flex-col gap-4">
            <KpiGrid><KpiTile label="Pending" value={pending.count} loading={pending.loading} /></KpiGrid>
            <div style={{ height: 560 }}>
                <SplitView
                    selected={selected}
                    onClearSelection={() => setSelected(undefined)}
                    detailTitle={selected && String(selected.row.number)}
                    master={<CollectionPanel collection="orders" viewMode="list" toolbar="compact" title={false}
                        fields={["number", "status", "total"]} where={{ status: ["==", "pending"] }} orderBy="placed_at:desc"
                        rowActions={(row, id) => <Button size="small" disabled={saving} onClick={() => update("orders", id, { status: "shipped" })}>Ship</Button>}
                        onRowClick={(row, id) => setSelected({ row, id })} highlightedIds={selected ? [selected.id] : []} />}
                    detail={selected && (
                        <RecordForm key={selected.id} collection="orders" id={selected.id} compact>
                            <div className="grid grid-cols-2 gap-3">
                                <FormField name="status" />
                                <FormField name="tracking_number" />
                            </div>
                            <FormField name="notes" />
                        </RecordForm>
                    )} />
            </div>
        </div>
    );
}`;
/**
 * EXPERIMENTAL. The guide's last part, where the artifact kit is served: how
 * to make the same app a Claude artifact — a page that keeps, that its owner
 * shares inside their organization, and that reads the project as whoever
 * opens it, through their own Rebase connector. Only for a server that knows
 * where the kit is (`kitUrl`, the published `rebase-artifact.js`), so nothing
 * points the model at a script that is not there.
 */
export function showAppArtifactGuide(kitUrl: string): string {
    return `
As an artifact. When the person wants to keep the app, come back to it, or share it with their team, and you can publish a Claude artifact, publish one instead of calling show_app again. The page runs the same code, drawn with the same components, through each viewer's own Rebase connector, so every viewer sees what their own Rebase account may, and nothing else. Check the code with show_app first: the page compiles it the same way. The page is these four elements, with the same TSX:
<script type="application/json" id="rebase-app">{"connector": "Rebase", "project": "<project id or name>", "title": "Order desk", "tables": ["orders"]}</script>
<script type="text/plain" id="rebase-app-code">…the app's TSX, unchanged…</script>
<div id="root"></div>
<script type="module" src="${kitUrl}"></script>
"connector" is the connector's name in the viewer's claude.ai ("Rebase" unless they renamed it); "project" is for the hosted Rebase connector, which reaches many projects, and a project's own connector takes none. Declare the connector in the artifact's capabilities with the tools the page calls: {"mcp": {"servers": [{"server": "Rebase", "tools": ["show_app", "query"]}]}} on the hosted connector, ["show_app", "query_table", "get_row", "count_rows", "aggregate_rows"] on a project's own. Add the write tools ("write"; or "create_row", "update_row", "delete_row") only when the app changes data, and each viewer is asked whether the page may make changes. Every write still goes plan, then confirm. On the hosted connector, "write" first answers a plan and a token and changes nothing, and the kit calls it again with the token only once the viewer has said yes; on a project's own connector, the kit asks before it sends. The kit asks in the viewer's terms (the row by its title, each field as old → new, a Create, Save or Delete button) for a new row, a delete, and any write the app's code makes without a click; a change to one row made by the viewer's own click (a form's Save, a row action, a button the app draws) was their yes, so it goes without a second question and the page says what was saved. So write only through useRowWrites and the admin's components, from a click where the viewer means to change something: put no other script on the page that calls the connector, and never send a confirm token yourself. The page is private until its owner shares it; say so when you give the link.`;
}
