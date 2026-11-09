import React from "react";
import { Clock, DollarSign, Truck } from "lucide-react";
import {
    BarChart, Button, ChartCard, Chip, KpiGrid, KpiTile, Select, SelectItem,
    Table, TableBody, TableCell, TableHeader, TableRow, TextField, TimeSeriesChart,
} from "@rebasepro/ui";
import type { ChipColorKey } from "@rebasepro/ui";

/* The order desk Claude draws in the home page's 0.29 section, as the
   artifact beside the conversation. Every piece is the kit's own component
   from `@rebasepro/ui` source — KpiTile, ChartCard, BarChart,
   TimeSeriesChart, Table, Select, TextField — not a drawing of one. Only the
   figures are made up, and the frame says so.

   It is live on purpose: Ship on a row, or a status changed in the form,
   moves the row, the KPIs and the status chart together, the way the real
   desk's hooks re-read after a write. In an app the table and the form are
   `CollectionPanel` and `RecordForm` reading through `<Rebase>`; with no
   backend here they are the same kit parts over local state. */

type Status = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";

interface Order {
    id: string;
    number: string;
    customer: string;
    total: number;
    status: Status;
    tracking: string;
    notes: string;
}

const STATUSES: Status[] = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

const STATUS_COLOR: Record<Status, ChipColorKey> = {
    pending: "yellow",
    confirmed: "blue",
    shipped: "purple",
    delivered: "green",
    cancelled: "gray",
};

const ORDERS: Order[] = [
    { id: "1", number: "#1048", customer: "Elena Ruiz", total: 284, status: "pending", tracking: "", notes: "" },
    { id: "2", number: "#1047", customer: "James Park", total: 59.99, status: "pending", tracking: "", notes: "Gift wrap" },
    { id: "3", number: "#1046", customer: "Amara Okafor", total: 149.5, status: "confirmed", tracking: "", notes: "" },
    { id: "4", number: "#1045", customer: "Lukas Weber", total: 412, status: "pending", tracking: "", notes: "" },
    { id: "5", number: "#1044", customer: "Sofia Rossi", total: 89.5, status: "shipped", tracking: "1Z 999 AA1 01 2345 6784", notes: "" },
    { id: "6", number: "#1043", customer: "Noah Martin", total: 199, status: "confirmed", tracking: "", notes: "Leave at reception" },
    { id: "7", number: "#1042", customer: "Mei Tanaka", total: 245, status: "delivered", tracking: "1Z 999 AA1 01 2345 6701", notes: "" },
];

/* Everything outside the visible page of rows, so the totals read like a
   real shop's. The rows on screen are added on top. */
const BASE_COUNTS: Record<Status, number> = { pending: 15, confirmed: 35, shipped: 141, delivered: 411, cancelled: 9 };
const BASE_REVENUE = 35_700;

const REVENUE_PER_DAY = [1840, 2210, 1975, 2630, 2480, 3120, 2890, 2410, 2760, 3340, 3010, 3580, 3290, 3870];
const DAY_MS = 86_400_000;

const USD = { style: "currency", currency: "USD" } as const;
const USD_COMPACT = { style: "currency", currency: "USD", notation: "compact" } as const;

export function OrderDeskPreview() {
    const [orders, setOrders] = React.useState(ORDERS);
    const [openId, setOpenId] = React.useState<string>("1");
    const open = orders.find((o) => o.id === openId);
    const [draft, setDraft] = React.useState<Order | undefined>(open);
    const [savedId, setSavedId] = React.useState<string>();

    React.useEffect(() => { setDraft(orders.find((o) => o.id === openId)); }, [openId]);

    const write = (id: string, patch: Partial<Order>) => {
        setOrders((all) => all.map((o) => (o.id === id ? { ...o, ...patch } : o)));
        setSavedId(id);
        window.setTimeout(() => setSavedId((current) => (current === id ? undefined : current)), 1600);
    };

    const counts = STATUSES.reduce<Record<Status, number>>((acc, s) => {
        acc[s] = BASE_COUNTS[s] + orders.filter((o) => o.status === s).length;
        return acc;
    }, { ...BASE_COUNTS });
    const revenue = BASE_REVENUE + orders.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + o.total, 0);

    // A fixed reference day, so the server render and the island agree.
    const today = Date.UTC(2026, 10, 9);
    const revenuePoints = REVENUE_PER_DAY.map((value, i) => ({
        at: new Date(today - (REVENUE_PER_DAY.length - 1 - i) * DAY_MS).toISOString().slice(0, 10),
        value,
    }));

    const dirty = draft && open && (draft.status !== open.status || draft.tracking !== open.tracking || draft.notes !== open.notes);

    return (
        <div className="@container flex flex-col gap-4 p-4 sm:p-5">
            <KpiGrid>
                <KpiTile label="Pending" icon={<Clock size={14}/>} value={counts.pending} previous={23}
                    goodWhen="down" periodDays={7}/>
                <KpiTile label="Shipped" icon={<Truck size={14}/>} value={counts.shipped} previous={126}
                    periodDays={7}/>
                <KpiTile label="Revenue" icon={<DollarSign size={14}/>} value={revenue} previous={35_150}
                    periodDays={7} format={USD_COMPACT} sparkline={REVENUE_PER_DAY}/>
            </KpiGrid>

            <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-4">
                <ChartCard title="Revenue per day">
                    <TimeSeriesChart height={150} format={USD}
                        series={[{ id: "revenue", label: "Revenue", points: revenuePoints }]}/>
                </ChartCard>
                <ChartCard title="Orders by status">
                    <BarChart bars={STATUSES.map((s) => ({ key: s, label: s, value: counts[s] }))
                        .sort((a, b) => b.value - a.value)}/>
                </ChartCard>
            </div>

            <div className="grid grid-cols-1 @2xl:grid-cols-[minmax(0,1fr)_16rem] gap-4 items-start">
                <div className="rounded-xl border border-hairline overflow-hidden">
                    <Table className="w-full">
                        <TableHeader>
                            <TableCell className="px-3 py-2 text-xs">Order</TableCell>
                            <TableCell className="px-3 py-2 text-xs">Customer</TableCell>
                            <TableCell className="px-3 py-2 text-xs text-right">Total</TableCell>
                            <TableCell className="px-3 py-2 text-xs">Status</TableCell>
                            <TableCell className="px-3 py-2 text-xs"><span className="sr-only">Actions</span></TableCell>
                        </TableHeader>
                        <TableBody>
                            {orders.map((o) => (
                                <TableRow key={o.id} onClick={() => setOpenId(o.id)}
                                    aria-selected={o.id === openId}
                                    className={o.id === openId ? "h-10 !bg-primary/10" : "h-10"}>
                                    <TableCell className="px-3 py-2 font-mono text-xs">{o.number}</TableCell>
                                    <TableCell className="px-3 py-2 text-xs truncate max-w-[9rem]">{o.customer}</TableCell>
                                    <TableCell className="px-3 py-2 text-xs text-right tabular-nums">
                                        {new Intl.NumberFormat("en-US", USD).format(o.total)}
                                    </TableCell>
                                    <TableCell className="px-3 py-2">
                                        <Chip size="smallest" colorScheme={STATUS_COLOR[o.status]}>{o.status}</Chip>
                                    </TableCell>
                                    <TableCell className="px-2 py-1.5 text-right">
                                        {(o.status === "pending" || o.status === "confirmed") && (
                                            <Button size="smallest" variant="outlined"
                                                onClick={(e: React.MouseEvent) => {
                                                    e.stopPropagation();
                                                    write(o.id, { status: "shipped" });
                                                    if (o.id === openId) setDraft((d) => (d ? { ...d, status: "shipped" } : d));
                                                }}>
                                                Ship
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* The form beside the list: always the same box, so picking a
                    row swaps its contents and nothing below it moves. */}
                <div className="rounded-xl border border-hairline bg-surface-card p-4 flex flex-col gap-3 min-h-[19rem]">
                    {draft ? (
                        <>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="font-mono text-xs text-text-secondary dark:text-text-secondary-dark">{draft.number}</span>
                                <span className="text-xs truncate">{draft.customer}</span>
                            </div>
                            <Select label="Status" size="medium" fullWidth value={draft.status}
                                onValueChange={(value) => setDraft({ ...draft, status: value as Status })}>
                                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </Select>
                            <TextField label="Tracking number" size="medium" value={draft.tracking}
                                onChange={(e) => setDraft({ ...draft, tracking: e.target.value })}/>
                            <TextField label="Notes" size="medium" multiline minRows={2} value={draft.notes}
                                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}/>
                            <div className="mt-auto flex items-center justify-end gap-2">
                                <span className="mr-auto text-xs text-emerald-400" aria-live="polite">
                                    {savedId === draft.id ? "Saved" : ""}
                                </span>
                                <Button size="small" variant="text" disabled={!dirty}
                                    onClick={() => setDraft(open)}>
                                    Discard
                                </Button>
                                <Button size="small" variant="filled" disabled={!dirty}
                                    onClick={() => write(draft.id, { status: draft.status, tracking: draft.tracking, notes: draft.notes })}>
                                    Save
                                </Button>
                            </div>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
