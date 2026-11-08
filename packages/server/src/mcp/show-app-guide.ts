/**
 * What show_app's description teaches: the modules an app imports, and what
 * each gives it. The hosted connector's show_app says the same.
 *
 * Every name it imports or documents is one the view serves
 * (`MCP_APP_MODULES` in `@rebasepro/types`); `test/mcp-app-guide.test.ts`
 * holds it to that list, both ways.
 */
/**
 * The example's imports, written into it when the guide is built: spelled out
 * in this file, they would read as this module importing React and the admin
 * packages to the scanners that keep the server headless.
 */
const EXAMPLE_IMPORTS: ReadonlyArray<readonly [names: string, module: string]> = [
    ["{ useState }", "react"],
    ["{ Button, KpiGrid, KpiTile, SplitView }", "@rebasepro/ui"],
    ["{ useRowCount, useRowWrites }", "@rebasepro/app"],
    ["{ CollectionPanel, EntityFormPanel, FormField }", "@rebasepro/cms"]
];

export const SHOW_APP_CODE_GUIDE = `
The app is one TSX module whose default export is a React component (hooks welcome, no props). It runs in the conversation inside the project's admin panel, as the user, and imports Rebase's own packages, so the same code works in the project. It may import only these names:
- "react".
- "@rebasepro/app", the project's rows as the user, under their RLS, as query_collection returns them (dates as ISO text, a belongsTo as its foreign key, e.g. authorId); \`where\` and \`orderBy\` are query_collection's.
  useRows(collection, { where?, orderBy?, limit?, offset?, searchString? }) → { rows, total, hasMore, loadMore, loading, error, refresh }
  useRow(collection, id) → { row, loading, error, refresh }
  useRowCount(collection, where?) → { count, loading, error }
  useAggregate(collection, { select: [{ fn: "count" | "sum" | "avg" | "min" | "max", field? }], groupBy?, where?, orderBy?, limit? }) → { result, loading, error } — result is one row per group, each value under its alias (count, sum_total).
  useRowWrites() → { create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }
- "@rebasepro/cms", the admin panel's own parts, with the project's custom fields, views and actions. Each names its collection as collection="orders".
  <CollectionPanel collection where? orderBy? ("field:desc") fields? viewMode? ("table" | "list" | "cards" | "kanban") toolbar? ("full" | "compact" | "none") rowActions?(row, id) onRowClick?(row, id) highlightedIds? title? /> — the admin's collection view: search, filters, paging; it sizes to its rows and scrolls past its height. where={{ status: ["==", "pending"] }} fixes which rows it holds, as useRows' where, and follows state (a tab, a bar clicked). fields picks and orders the columns. toolbar="compact" is search, the view switch and New; "none" hides it; or compose one: <CollectionToolbar start? end? /> holding CollectionSearchBar, CollectionFiltersButton, CollectionViewModeToggle, CollectionAddButton. rowActions draws your JSX on every row, card and kanban card — the table's last column — handed the row and its id: rowActions={(row, id) => <Button size="small" onClick={() => update("orders", id, { status: "shipped" })}>Ship</Button>}; a click there does not open the row. onRowClick is handed the clicked row as useRows reads it and its id, a string; without it, a row opens its form. highlightedIds={[id]} draws those rows as selected.
  <EntityFormPanel collection id? fields? compact? defaultValues? onSaved?({ row, id }) /> — the record form, a new row's without id. fields shows only those, in that order; compact is the dense form for a side card. Children lay the fields out your way: <EntityFormPanel collection="orders" id={id}><div className="grid grid-cols-2 gap-3"><FormField name="status" /><FormField name="notes" /></div></EntityFormPanel>.
  <RecordDetail collection id fields? /> — one row, read-only.
  <FieldValue collection field value /> — one value, drawn as the admin draws it: an enum as its chip, a date, a foreign key as the related row's title (field="customer" value={order.customerId}).
  useSidePanel().open({ path, id? }) — open a row's form over the app; without id, a new row's.
- "@rebasepro/ui", the UI kit: Card, Button, IconButton, Typography, Tabs, Tab, Chip, Alert, TextField, Select, SelectItem, Checkbox, Dialog, DialogTitle, DialogContent, DialogActions, Separator, CircularProgress, Tooltip, cls, Lucide icons with an Icon suffix (PlusIcon), and:
  <SplitView master detail? selected? onClearSelection? detailTitle? /> — a list and what is open in it, side by side when wide, the detail over the list with a back bar when narrow; given selected, the detail shows only while it is set. It fills its parent: give the parent a height (style={{ height: 560 }}).
  <KpiGrid periodDays?> of <KpiTile label value format? previous? goodWhen? ("up" | "down") loading? /> — previous is the earlier period's value, shown as the change.
  <ChartCard title headline? action?> around <BarChart bars={[{ key, label, value }]} format? onBarClick? /> or <TimeSeriesChart series={[{ id, label, points: [{ at, value }] }]} variant? ("area" | "line") height? />; formatNumber(value, format?).
  Lay out and space with Tailwind's standard utilities (flex, grid, gap-*, p-*, w-*, h-64/h-80/h-96, text-sm, …); colours come from the kit (bg-surface-card, text-text-secondary), never hard-coded. Arbitrary values (h-[560px], w-[42%]) do not exist in the view and do nothing: give an exact size with style={{ height: 560 }}.
Width: the app is about 700px wide in the conversation, the whole window when the person expands it. Never put a list and a form side by side in grid columns: use SplitView, which chooses by its own width.
useRowWrites asks the user before it writes, so the app does not write without their click; a declined write rejects ("Not saved"). The admin's own controls (a form's Save, a delete, a table edit, a row action) behave as they do on show_collection. That question is a courtesy, not the boundary: every read and write is this server's tool called as the user, under their RLS and the scopes their connection was granted, so the app can do nothing you could not do with the same tools. You are told what they saved. What changes refreshes every view of that collection. The app may use only the collections listed in \`collections\`; the first page and count of each are read before it opens, so its first render waits on none of them.

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
                        <EntityFormPanel key={selected.id} collection="orders" id={selected.id} compact>
                            <div className="grid grid-cols-2 gap-3">
                                <FormField name="status" />
                                <FormField name="tracking_number" />
                            </div>
                            <FormField name="notes" />
                        </EntityFormPanel>
                    )} />
            </div>
        </div>
    );
}`;