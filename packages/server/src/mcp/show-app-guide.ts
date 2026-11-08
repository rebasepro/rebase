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
    ["{ CollectionPanel, EntityFormPanel }", "@rebasepro/cms"]
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
- "@rebasepro/cms", the admin panel's own parts, with the project's custom fields, views and actions:
  <CollectionPanel path where? fields? viewMode? ("table" | "list" | "cards" | "kanban") sort? (["field", "desc"]) toolbar? onRowClick?(row, id) highlightedIds? collectionOverrides? title? /> — search, filters, paging; it sizes to its rows and scrolls past its height. where={{ status: ["==", "pending"] }} fixes which rows it holds, as useRows' where, and follows state (a tab, a bar clicked). fields picks and orders the columns. toolbar={null} hides the toolbar; a smaller one is <CollectionToolbar start? end? /> holding CollectionSearchBar, CollectionFiltersButton, CollectionViewModeToggle, CollectionAddButton. onRowClick is handed the clicked row as useRows reads it and its id, a string; without it, a row opens its form. highlightedIds={[id]} draws those rows as selected.
  <EntityFormPanel path id? defaultValues? fields? layout? onSaved?({ row, id }) /> — the record form, a new row's without id. layout is your arrangement of <FormField name /> elements.
  <EntityViewPanel path id fields? /> — one row, read-only.
  <FieldValue row path field /> — one value of a row, drawn as the admin draws it (enum chip, date, relation title).
  useSidePanel().open({ path, id? }) — open a row's form over the app; without id, a new row's.
- "@rebasepro/ui", the UI kit: Card, Button, IconButton, Typography, Tabs, Tab, Chip, Alert, TextField, Select, SelectItem, Checkbox, Dialog, DialogTitle, DialogContent, DialogActions, Separator, CircularProgress, Tooltip, cls, Lucide icons with an Icon suffix (PlusIcon), and:
  <SplitView master detail? onBack? detailTitle? /> — a list and what is open in it, side by side when wide, the detail over the list with a back bar when narrow. It fills its parent: give the parent a height (style={{ height: 560 }}).
  <KpiGrid periodDays?> of <KpiTile label value format? previous? goodWhen? ("up" | "down") loading? /> — previous is the earlier period's value, shown as the change.
  <ChartCard title headline? action?> around <BarChart bars={[{ key, label, value }]} format? onBarClick? /> or <TimeSeriesChart series={[{ id, label, points: [{ at, value }] }]} variant? ("area" | "line") height? />; formatNumber(value, format?).
  Lay out and space with Tailwind's standard utilities (flex, grid, gap-*, p-*, w-*, h-64/h-80/h-96, text-sm, …); colours come from the kit (bg-surface-card, text-text-secondary), never hard-coded. Arbitrary values (h-[560px], w-[42%]) do not exist in the view and do nothing: give an exact size with style={{ height: 560 }}.
Width: the app is about 700px wide in the conversation, the whole window when the person expands it. Never put a list and a form side by side in grid columns: use SplitView, which chooses by its own width.
useRowWrites asks the user before it writes, so the app does not write without their click; a declined write rejects ("Not saved"). The admin's own controls (a form's Save, a delete, a table edit, a row action) behave as they do on show_collection. That question is a courtesy, not the boundary: every read and write is this server's tool called as the user, under their RLS and the scopes their connection was granted, so the app can do nothing you could not do with the same tools. You are told what they saved. What changes refreshes every view of that collection. The app may use only the collections listed in \`collections\`.

Example:
${EXAMPLE_IMPORTS.map(([names, module]) => `import ${names} from ${JSON.stringify(module)};`).join("\n")}

export default function OrderDesk() {
    const [id, setId] = useState<string>();
    const pending = useRowCount("orders", { status: ["==", "pending"] });
    const { update, saving } = useRowWrites();
    return (
        <div className="flex flex-col gap-4">
            <KpiGrid><KpiTile label="Pending" value={pending.count} loading={pending.loading} /></KpiGrid>
            <div style={{ height: 560 }}>
                <SplitView
                    master={<CollectionPanel path="orders" viewMode="list" fields={["number", "status", "total"]} title={false}
                        onRowClick={(row, id) => setId(id)} highlightedIds={id ? [id] : []} />}
                    detail={id && (
                        <div className="flex flex-col gap-2 p-2">
                            <Button disabled={saving} onClick={() => update("orders", id, { status: "shipped" })}>Mark shipped</Button>
                            <EntityFormPanel key={id} path="orders" id={id} />
                        </div>
                    )}
                    detailTitle={id}
                    onBack={() => setId(undefined)} />
            </div>
        </div>
    );
}`;
