import React, { useState, useEffect, useCallback } from "react";
import {
  User, Folder, ShoppingCart,
  LayoutList, CircleDot, Hash, Type,
  CircleCheck, Truck, Banknote, X, Maximize2, Code
} from "lucide-react";

import { AdminDrawer, AdminToolbar, SHELL_ROOT, SHELL_SHEET } from "./admin/AdminChrome";

/* ─── Responsive hook ─── */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

/* ─── Types ─── */
interface Order {
  id: string;
  /** The first line of the order, standing in as the record's preview. */
  image: string;
  paymentStatus: "paid" | "pending" | "refunded";
  customer: string;
  status: "Confirmed" | "Delivered" | "Shipped" | "Cancelled" | "Processing";
  date: string;
  items: number;
  total: string;
  email: string;
  address: string;
}

/* ─── Mock Data ─── */
const MOCK_ORDERS: Order[] = [
  { id: "ORD-2026-0006", image: "/img/demo/products/aviator-rb3025.jpg", paymentStatus: "paid", customer: "Elizabeth", status: "Confirmed", date: "8 May", items: 3, total: "$284.00", email: "elizabeth@mail.com", address: "123 Main St, London" },
  { id: "ORD-2026-0036", image: "/img/demo/products/baseball-cap.jpg", paymentStatus: "paid", customer: "James", status: "Delivered", date: "1d ago", items: 1, total: "$59.99", email: "james@mail.com", address: "45 Park Ave, NYC" },
  { id: "ORD-2026-0061", image: "/img/demo/products/wine-decanter.jpg", paymentStatus: "paid", customer: "Elizabeth", status: "Shipped", date: "3d ago", items: 2, total: "$149.50", email: "elizabeth@mail.com", address: "123 Main St, London" },
  { id: "ORD-2026-0056", image: "/img/demo/products/chess-set.jpg", paymentStatus: "refunded", customer: "Jennifer", status: "Cancelled", date: "8 May", items: 5, total: "$412.00", email: "jennifer@mail.com", address: "78 Oak Rd, Berlin" },
  { id: "ORD-2026-0026", image: "/img/demo/products/corkscrew.jpg", paymentStatus: "refunded", customer: "Susan", status: "Cancelled", date: "1d ago", items: 1, total: "$34.99", email: "susan@mail.com", address: "9 Elm St, Paris" },
  { id: "ORD-2026-0019", image: "/img/demo/products/invisible-shelf.jpg", paymentStatus: "paid", customer: "Michael", status: "Confirmed", date: "5d ago", items: 4, total: "$199.00", email: "michael@mail.com", address: "22 Maple Dr, Tokyo" },
  { id: "ORD-2026-0042", image: "/img/demo/products/casio-collection.jpg", paymentStatus: "pending", customer: "Sarah", status: "Processing", date: "2d ago", items: 2, total: "$89.50", email: "sarah@mail.com", address: "55 Pine Ln, Sydney" },
  { id: "ORD-2026-0088", image: "/img/demo/products/predator-2.jpg", paymentStatus: "paid", customer: "David", status: "Delivered", date: "6 May", items: 3, total: "$245.00", email: "david@mail.com", address: "11 Cedar Ct, Toronto" },
];

/* An enum value resolves to a hue in the collection config, and the panel draws
   that hue as a TINTED chip. `chip` + `chip-<hue>` in global.css carry the exact
   geometry and the exact composite the product ships — never restate either. */
const STATUS_CHIP: Record<Order["status"], string> = {
  Confirmed: "chip-blue",
  Delivered: "chip-green",
  Shipped: "chip-indigo",
  Cancelled: "chip-red",
  Processing: "chip-yellow",
};

const PAYMENT_CHIP: Record<Order["paymentStatus"], string> = {
  paid: "chip-green",
  pending: "chip-yellow",
  refunded: "chip-red",
};

/* A chip shows the enum's LABEL, never its key. The panel reads labels off
   `enumValues` in the collection config, and a value that reaches the screen as
   its own identifier is a config with no labels — not something to imitate. */
const PAYMENT_LABEL: Record<Order["paymentStatus"], string> = {
  paid: "Paid",
  pending: "Pending",
  refunded: "Refunded",
};

/* ─── Stat card ───────────────────────────────────────────────────────────
   InsightsScorecardView.tsx, the non-embedded scorecard: a card on the sheet,
   `rounded-xl bg-surface-card` with a hairline. The header grammar is one line
   — 14px icon in the secondary tier, then the label in the micro tier — and the
   value sits under it, not beside it. Label left / icon far right with the
   value and its delta sharing a baseline is the layout the product retired,
   because it made every tile read as two unrelated corners. */
function StatCard({ title, value, comparison, icon, isHighlighted = false }: {
  title: string;
  value: string;
  comparison?: { value: string; positive: boolean };
  icon?: React.ReactNode;
  isHighlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-xl flex flex-col min-w-0 bg-surface-card border px-5 py-4 transition-all duration-300 ${
        isHighlighted ? "border-primary/40 ring-1 ring-primary/30" : "border-hairline"
      }`}
      style={{ minHeight: 92 }}
    >
      <div className="flex flex-col min-w-0 mb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && (
            <span className="shrink-0 flex items-center text-text-secondary dark:text-text-secondary-dark [&>svg]:size-3.5">
              {icon}
            </span>
          )}
          <span className="typography-micro truncate text-surface-400 dark:text-surface-400">{title}</span>
        </div>
      </div>
      <div className="font-headers font-semibold leading-tight tracking-display tabular-nums break-all text-text-primary dark:text-text-primary-dark text-xl">
        {value}
      </div>
      {comparison && (
        <div className="mt-1">
          <span className={`font-mono tabular-nums font-medium text-xs ${comparison.positive ? "text-emerald-500" : "text-red-500"}`}>
            {comparison.value}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Columns ─────────────────────────────────────────────────────────────
   One definition, read by the header and by every row, so a label can never end
   up over a column that is not there.

   What a narrowing row gives up first is a priority, not a breakpoint, and the
   title is budgeted BEFORE any column is granted its width: a list that runs
   out of room shows fewer columns rather than squeezing its titles to an
   ellipsis. Constants and arithmetic are CollectionListViewBinding's, so the
   split pane here drops exactly what the panel's split pane drops. */
const ROW_PADDING_WIDTH = 40;   // `mx-2` + `px-3`, both sides
const CHECKBOX_WIDTH = 32;      // `w-8`
const IMAGE_WIDTH = 40;         // `w-10`
const COLUMN_GAP = 16;          // `gap-4`
const TITLE_COMFORTABLE_WIDTH = 320;

const PRIORITY_DECLARED = 2000;
const PRIORITY_DATE = PRIORITY_DECLARED;
const PRIORITY_STATUS = PRIORITY_DECLARED + 1;

type ListColumn = {
  key: "payment" | "status" | "date";
  label: string;
  width: string;
  widthPx: number;
  align: "left" | "right";
  priority: number;
};

const COLUMNS: ListColumn[] = [
  { key: "payment", label: "Payment", width: "w-28", widthPx: 112, align: "left", priority: PRIORITY_DECLARED },
  { key: "status", label: "Status", width: "w-32", widthPx: 128, align: "left", priority: PRIORITY_STATUS },
  { key: "date", label: "Updated at", width: "w-20", widthPx: 80, align: "right", priority: PRIORITY_DATE },
];

/** The columns that fit beside a comfortable title at this container width. */
function fitColumns(containerWidth: number | undefined): ListColumn[] {
  // Unmeasured: the title alone, which is the answer we would rather flash than
  // a row of columns squeezing it down to an ellipsis.
  if (containerWidth === undefined) return [];

  const chrome = ROW_PADDING_WIDTH + CHECKBOX_WIDTH + COLUMN_GAP + IMAGE_WIDTH + COLUMN_GAP;
  const available = containerWidth - chrome - TITLE_COMFORTABLE_WIDTH;
  const cost = (col: ListColumn) => col.widthPx + COLUMN_GAP;

  let total = COLUMNS.reduce((acc, col) => acc + cost(col), 0);
  if (total <= available) return COLUMNS;

  const dropped = new Set<string>();
  for (const col of [...COLUMNS].sort((a, b) => a.priority - b.priority)) {
    if (total <= available) break;
    dropped.add(col.key);
    total -= cost(col);
  }
  return COLUMNS.filter(col => !dropped.has(col.key));
}

/** Measure a box the way the panel does, so the fit reacts to the split. */
function useContainerWidth<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.offsetWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const cellClass = (col: ListColumn) =>
  `flex-shrink-0 ${col.width} flex items-center overflow-hidden ${col.align === "right" ? "justify-end" : "justify-start"}`;

/** ListHeader (CollectionListViewBinding): 11px uppercase labels on the sheet,
    one rule under them, and an empty cell over the checkbox and the thumbnail. */
function ListHeader({ columns }: { columns: ListColumn[] }) {
  const label = "inline-flex items-center gap-1 max-w-full text-[11px] leading-none uppercase tracking-wider font-medium text-surface-400 dark:text-surface-500";
  return (
    <div className="flex items-center gap-4 px-5 py-1.5 select-none border-b bg-surface-sheet border-hairline">
      <div className="flex-shrink-0 w-8"/>
      <div className="flex-shrink-0 w-10"/>
      <div className="flex-1 min-w-0 flex items-center">
        <span className={label}><span className="truncate">Order</span></span>
      </div>
      {columns.length > 0 && (
        <div className="flex items-center gap-4 flex-shrink-0 ml-auto">
          {columns.map((col) => (
            <div key={col.key} className={cellClass(col)}>
              <span className={label}><span className="truncate">{col.label}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Checkbox, `size="smallest"`: a 16px square inside a 28px round hover well. */
function RowCheckbox() {
  return (
    <div className="p-2 w-7 h-7 inline-flex items-center justify-center rounded-full">
      <div className="border-2 shrink-0 relative w-4 h-4 rounded-sm flex items-center justify-center bg-surface-card border-surface-accent-800 dark:border-surface-accent-500"/>
    </div>
  );
}

/* ─── One row ─────────────────────────────────────────────────────────────
   A row has NO fill of its own: it is text on the sheet, and only the row being
   touched or opened takes a shape — an alpha highlight, inset and rounded,
   because it is an object the moment it appears. The hairline under every row
   that used to live here turned each highlight into a pill floating on a ruled
   page; `py-0.5` in the fixed-height slot gives two neighbours their air. */
function OrderRow({ order, isHovered, isActive, columns, onHover, onLeave }: {
  order: Order; isHovered: boolean;
  /** The record currently open beside the list — not a checkbox selection. */
  isActive: boolean;
  columns: ListColumn[];
  onHover: () => void; onLeave: () => void;
}) {
  return (
    <div className="py-0.5" style={{ height: 64, overflow: "hidden" }}>
      <div
        className={`flex items-center gap-4 cursor-pointer group transition-colors duration-200 relative h-full mx-2 rounded-lg py-3 px-3 ${
          isActive ? "bg-surface-active" : isHovered ? "bg-surface-hover" : ""
        }`}
        onMouseEnter={onHover}
        onMouseLeave={onLeave}
      >
        <div className="flex-shrink-0 w-8">
          {/* Opening a record highlights its row; it does not tick its box.
              Selection and the open record are two different states in the
              panel, and they only share the highlight. */}
          <RowCheckbox/>
        </div>

        {/* The record's preview, in the 40px media well the panel draws for it:
            raised, hairlined, and `object-cover` so a portrait and a landscape
            shot occupy the same square. */}
        <div className="flex-shrink-0 relative w-10 h-10">
          <div className="w-10 h-10 rounded-lg border relative overflow-hidden bg-surface-raised border-hairline">
            <img className="w-full h-full object-cover" loading="lazy" src={order.image} alt=""/>
          </div>
        </div>

        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="truncate">
            <div className="typography-body2 font-semibold text-surface-900 dark:text-surface-50 truncate">
              <span className="text-sm">{order.id}</span>
            </div>
          </div>
          <div className="truncate mt-0.5">
            <div className="typography-caption text-surface-500 dark:text-surface-400 truncate">
              {order.customer} · {order.total} · {order.items} item{order.items > 1 ? "s" : ""}
            </div>
          </div>
        </div>

        {columns.length > 0 && (
          <div className="flex items-center gap-4 flex-shrink-0 ml-auto">
            {columns.map((col) => (
              <div key={col.key} className={cellClass(col)}>
                {col.key === "payment" && <span className={`chip ${PAYMENT_CHIP[order.paymentStatus]}`}>{PAYMENT_LABEL[order.paymentStatus]}</span>}
                {col.key === "status" && <span className={`chip ${STATUS_CHIP[order.status]}`}>{order.status}</span>}
                {col.key === "date" && (
                  <p className="typography-caption whitespace-nowrap text-surface-400 dark:text-surface-500 font-medium">{order.date}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── The record, as the panel reads it ───────────────────────────────────
   `EntityViewBinding` + `FieldBlock`, which is where the form's grammar
   actually lives now:

     - The label sits ABOVE the control, 13px medium in the PRIMARY ink, with
       the property's type icon before it at 14px in the disabled tier and the
       required marker after it. There is no floating label and no box: the
       outlined field with a shrunk label inside its border is the form this
       one replaced.
     - Fields lay out on a four-column grid (`@2xl:grid-cols-4`) with per-field
       spans, `gap-x-8 gap-y-7` in read mode — wider gutters than edit mode,
       because a read row has no control edges to separate it.
     - A read value is `min-h-8 … text-sm` in the primary ink: one control's
       height, so a row of short values lines up with the taller ones beside it.

   The panel renders the label identically in read and edit, deliberately — a
   record whose labels restyle themselves under Edit reads as two screens. */
function RecordField({ label, icon, span, required, highlighted, children }: {
  label: string;
  icon: React.ReactNode;
  /** Columns on the four-column grid. */
  span: 1 | 2 | 3 | 4;
  required?: boolean;
  highlighted?: boolean;
  children: React.ReactNode;
}) {
  const spanClass = span === 1 ? "@2xl/col:col-span-1"
    : span === 2 ? "@2xl/col:col-span-2"
      : span === 3 ? "@2xl/col:col-span-3"
        : "@2xl/col:col-span-4";
  return (
    <div className={`relative flex flex-col min-w-0 ${spanClass}`}>
      <div className="flex items-center gap-1.5 font-medium leading-tight mb-1.5 text-[13px] text-text-primary dark:text-text-primary-dark">
        <span className="shrink-0 text-text-disabled dark:text-text-disabled-dark [&>svg]:size-3.5">{icon}</span>
        <span className="truncate">{label}</span>
        {required && <span className="text-red-500 dark:text-red-500 -ml-1">*</span>}
      </div>
      {/* The demo's own affordance, not the panel's: the loop walks the record
          and something has to say which field it is reading. A ring would need
          a box to sit on, and the box is exactly what this pass removed. */}
      <div className={`min-w-0 rounded-md -mx-1.5 px-1.5 transition-colors duration-300 ${
        highlighted ? "bg-primary/12" : "bg-transparent"
      }`}>
        <div className="min-h-8 flex flex-col justify-center min-w-0 text-sm text-text-primary dark:text-text-primary-dark">
          {children}
        </div>
      </div>
    </div>
  );
}

function OrderDetailPanel({ order, highlightedField }: {
  order: Order; highlightedField: string | null;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Panel top bar */}
      <div className="h-14 flex items-center px-3 border-b border-hairline shrink-0 gap-1">
        <button className="p-1.5 rounded text-surface-400"><X size={18} /></button>
        <button className="p-1.5 rounded text-surface-400"><Maximize2 size={14} /></button>
        <div className="flex-1" />
        <button className="px-3 py-2 text-xs text-surface-500"><Code size={14} /></button>
        <button className="px-3 py-2 text-xs text-surface-900 dark:text-white font-medium border-b-2 border-primary">Order</button>
      </div>

      {/* The record column: the same widths and padding the panel gives it in a
          split pane, so toggling between read and edit cannot move it. */}
      <div className="flex-1 overflow-y-auto flex flex-row w-full justify-center items-start">
        <div className="@container/col w-full max-w-3xl flex flex-col pt-6 pb-12 px-5 sm:px-8">
          {/* Saved badge */}
          <div className="flex justify-end mb-2" style={{ minHeight: 22 }}>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-raised text-surface-500 dark:text-surface-300 text-[10px] font-semibold" style={{ minWidth: 72 }}>
              ✓ Saved
            </span>
          </div>

          {/* The record's name, lifted out of the grid and into a header. */}
          <div className="typography-h4 text-text-primary dark:text-text-primary-dark mb-2">{order.id}</div>
          <div className="w-full rounded-md bg-surface-well px-3 py-1.5 mb-8">
            <code className="text-[11px] text-surface-500">orders/{order.id}</code>
          </div>

          <div className="grid min-w-0 gap-x-8 gap-y-7 grid-cols-1 @2xl/col:grid-cols-4">
            <RecordField label="Customer" icon={<User/>} span={2} required
              highlighted={highlightedField === "customer"}>
              <span className="truncate">
                <span className="font-medium">{order.customer}</span>
                <span className="text-text-secondary dark:text-text-secondary-dark"> ({order.email})</span>
              </span>
            </RecordField>

            <RecordField label="Status" icon={<CircleDot/>} span={1}
              highlighted={highlightedField === "status"}>
              <span className={`chip ${STATUS_CHIP[order.status]}`}>{order.status}</span>
            </RecordField>

            <RecordField label="Payment" icon={<CircleDot/>} span={1}
              highlighted={highlightedField === "payment"}>
              <span className={`chip ${PAYMENT_CHIP[order.paymentStatus]}`}>{PAYMENT_LABEL[order.paymentStatus]}</span>
            </RecordField>

            <RecordField label="Total" icon={<Hash/>} span={1}
              highlighted={highlightedField === "total"}>
              <span className="font-medium tabular-nums">{order.total}</span>
            </RecordField>

            <RecordField label="Items" icon={<Hash/>} span={1}
              highlighted={highlightedField === "items"}>
              <span className="tabular-nums">{order.items} item{order.items > 1 ? "s" : ""}</span>
            </RecordField>

            <RecordField label="Shipping Address" icon={<Type/>} span={2}
              highlighted={highlightedField === "address"}>
              <span className="truncate">{order.address}</span>
            </RecordField>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ MAIN COMPONENT ═══ */
export function OrdersListDemo({ height = 600 }: { height?: number } = {}) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [highlightedKPI, setHighlightedKPI] = useState<number | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [highlightedField, setHighlightedField] = useState<string | null>(null);

  const isMobile = useMediaQuery("(max-width: 639px)");
  const isMedium = useMediaQuery("(min-width: 640px) and (max-width: 767px)");
  const [listRef, listWidth] = useContainerWidth<HTMLDivElement>();
  const columns = fitColumns(listWidth);

  const panelOpen = selectedOrderId !== null;
  const selectedOrder = MOCK_ORDERS.find((o) => o.id === selectedOrderId);

  const openOrder = useCallback((id: string) => {
    setSelectedOrderId(id);
    setHighlightedField(null);
  }, []);

  const closeOrder = useCallback(() => {
    setSelectedOrderId(null);
    setHighlightedField(null);
  }, []);

  const flashField = useCallback((field: string, ms = 600) => {
    setHighlightedField(field);
    setTimeout(() => setHighlightedField(null), ms);
  }, []);

  // Animation loop
  useEffect(() => {
    let isMounted = true;
    let timer: any = null;
    const wait = (ms: number) => new Promise<void>((r) => { timer = setTimeout(r, ms); });
    const guard = () => isMounted;

    const loop = async () => {
      while (isMounted) {
        // ── Full list view (~2s): flash the scorecards + browse rows ──
        setHighlightedKPI(0);
        await wait(500); if (!guard()) return;
        setHighlightedKPI(1);
        await wait(500); if (!guard()) return;
        setHighlightedKPI(2);
        await wait(400); if (!guard()) return;
        setHighlightedKPI(null);

        setHoveredRow("ORD-2026-0006");
        await wait(250); if (!guard()) return;
        setHoveredRow("ORD-2026-0061");
        await wait(300); if (!guard()) return;

        // ── Open first order in split view ──
        openOrder("ORD-2026-0061");
        setHoveredRow(null);
        await wait(600); if (!guard()) return;

        flashField("customer");
        await wait(500); if (!guard()) return;
        flashField("status");
        await wait(500); if (!guard()) return;

        // ── Switch directly to another order (no full-list return) ──
        setHoveredRow("ORD-2026-0019");
        await wait(300); if (!guard()) return;
        openOrder("ORD-2026-0019");
        setHoveredRow(null);
        await wait(500); if (!guard()) return;

        flashField("total");
        await wait(500); if (!guard()) return;
        flashField("address");
        await wait(500); if (!guard()) return;

        // ── Switch to a third ──
        setHoveredRow("ORD-2026-0042");
        await wait(250); if (!guard()) return;
        openOrder("ORD-2026-0042");
        setHoveredRow(null);
        await wait(500); if (!guard()) return;

        flashField("status");
        await wait(400); if (!guard()) return;

        // ── Close and reset for next loop ──
        closeOrder();
        await wait(500); if (!guard()) return;
        setHoveredRow(null);
        await wait(300); if (!guard()) return;
      }
    };

    loop();
    return () => { isMounted = false; clearTimeout(timer); };
  }, [openOrder, closeOrder, flashField]);

  const NAV_ITEMS = [
    { icon: Folder, label: "Products", active: false },
    { icon: User, label: "Users", active: false },
    { icon: ShoppingCart, label: "Orders", active: true },
  ];

  return (
    <div
      className={SHELL_ROOT}
      style={{ height, width: "100%" }}
    >
      <AdminDrawer items={NAV_ITEMS}/>

      {/* Main */}
      <main className="flex flex-col grow overflow-auto">
        <div className={SHELL_SHEET}>
          {/* The product's toolbar, drawn once in AdminChrome so this tab and the
              table tab beside it cannot drift into two different apps. */}
          <AdminToolbar
            viewIcon={LayoutList}
            viewLabel="List"
            presets={["Open orders", "Awaiting payment", "This week"]}
            addLabel="Add Order"
            count="8"
          />

          {/* Content area — list + record, split. Neither pane paints a ground:
              they are regions of the SHEET, and the only filled objects on it
              are the scorecards. Painting the list `bg-surface-card` made the
              largest area on screen a card, and left the cards sitting on it
              with nowhere to go but further up the ladder. */}
          <div className="flex-1 min-h-0 w-full flex overflow-hidden relative">
            {/* Left: the list (shrinks when a record opens; hidden on mobile) */}
            <div
              className="flex flex-col h-full min-w-0 overflow-hidden transition-all duration-150 ease-out"
              style={{
                // The list only has to identify a record — a title, a subtitle,
                // a thumbnail. The record beside it carries the whole form, and
                // that is the side worth the width. `DEFAULT_PANEL_SIZE` in
                // SplitListView gives the list 22%; this is a demo frame a
                // third of a real window, so it keeps a little more.
                width: panelOpen
                  ? isMobile ? "0%" : isMedium ? "34%" : "32%"
                  : "100%",
                opacity: panelOpen && isMobile ? 0 : 1,
              }}
            >
              <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
                {/* CollectionViewBinding's list surface: a centred, titled
                    reading column. Opening a record collapses the title and the
                    scorecards — one gesture, driven by the same state.

                    Opening a record also drops the centring and the padding, so
                    the list goes edge to edge in the master pane. At 32% of the
                    split there is no measure left to protect, and the inset the
                    reading column needs reads as a stray gutter once the pane
                    is that narrow. */}
                <div className={`flex flex-col w-full ${panelOpen ? "" : "max-w-6xl mx-auto px-3 md:px-4 lg:px-6 py-4"}`}>
                  {/* Collapsible title — grid-rows for a smooth height. */}
                  <div className={`grid transition-[grid-template-rows,transform,margin] duration-150 ease-out ${
                    panelOpen ? "grid-rows-[0fr] -translate-y-2 mt-0 mb-0" : "grid-rows-[1fr] translate-y-0 mt-12 mb-6"
                  }`}>
                    <div className="overflow-hidden flex items-center gap-4">
                      {/* The panel renders a real `h4` here. This is a picture of
                          the panel inside a marketing page, so it takes the tier
                          without the tag: a mock UI that injects headings puts
                          them in the PAGE's outline, and `check:site` reads that
                          outline as an h2 followed by an h4. */}
                      <div className="typography-h4 text-text-primary dark:text-text-primary-dark grow mb-0">Orders</div>
                    </div>
                  </div>

                  {/* The insights plugin's scorecards, on the same collapse. */}
                  <div className={`grid transition-[grid-template-rows] duration-150 ease-out ${
                    panelOpen ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
                  }`}>
                    <div className="overflow-hidden flex-shrink-0">
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-4">
                        <StatCard title="Confirmed" value="15" icon={<CircleCheck/>}
                          comparison={{ value: "+18.0%", positive: true }}
                          isHighlighted={highlightedKPI === 0}/>
                        <StatCard title="Shipped" value="12" icon={<Truck/>}
                          comparison={{ value: "+7.4%", positive: true }}
                          isHighlighted={highlightedKPI === 1}/>
                        <StatCard title="Revenue" value="$36.6K" icon={<Banknote/>}
                          comparison={{ value: "+4.1%", positive: true }}
                          isHighlighted={highlightedKPI === 2}/>
                        <StatCard title="Refunded" value="2" icon={<ShoppingCart/>}
                          comparison={{ value: "−1.2%", positive: false }}
                          isHighlighted={highlightedKPI === 3}/>
                      </div>
                    </div>
                  </div>

                  {/* ListView: the outline is the object. It drops when a record
                      is open, because the list is then a pane, not a card. */}
                  <div ref={listRef} className={`w-full ${panelOpen ? "" : "rounded-lg overflow-hidden border border-hairline"}`}>
                    <ListHeader columns={columns}/>
                    <div className="my-1.5">
                      {MOCK_ORDERS.map((order) => (
                        <OrderRow
                          key={order.id}
                          order={order}
                          isHovered={hoveredRow === order.id}
                          isActive={selectedOrderId === order.id}
                          columns={columns}
                          onHover={() => setHoveredRow(order.id)}
                          onLeave={() => setHoveredRow(null)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: the record, opened beside the list. It carries its own
                left edge the way a card carries its hairline — and no ground of
                its own, because it is a region of the sheet. */}
            <div
              className="flex-1 flex flex-col min-w-0 h-full border-l border-hairline transition-all duration-150 ease-out overflow-hidden"
              style={{
                width: panelOpen
                  ? isMobile ? "100%" : isMedium ? "66%" : "68%"
                  : "0%",
                opacity: panelOpen ? 1 : 0,
                ...(panelOpen && isMobile ? { borderLeft: "none" } : {}),
              }}
            >
              {selectedOrder && (
                <OrderDetailPanel order={selectedOrder} highlightedField={highlightedField} />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
