import React, { useState, useEffect, useCallback } from "react";
import {
  User, Folder, ShoppingCart, LayoutList,
  TextAlignStart, Hash, List, Flag, ChevronDown, Copy,
  PanelLeftClose, WandSparkles, EllipsisVertical, X,
  CircleCheck, Truck, Banknote
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
  /** The row's real primary key, which is what the bar's id chip copies. */
  uid: string;
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
  { id: "ORD-2026-0006", uid: "e83f10dc…58d5", image: "/img/demo/products/aviator-rb3025.jpg", paymentStatus: "paid", customer: "Elizabeth", status: "Confirmed", date: "8 May", items: 3, total: "$284.00", email: "elizabeth@mail.com", address: "123 Main St, London" },
  { id: "ORD-2026-0036", uid: "7b41a9c2…10ae", image: "/img/demo/products/baseball-cap.jpg", paymentStatus: "paid", customer: "James", status: "Delivered", date: "1d ago", items: 1, total: "$59.99", email: "james@mail.com", address: "45 Park Ave, NYC" },
  { id: "ORD-2026-0061", uid: "c204ef58…9d31", image: "/img/demo/products/wine-decanter.jpg", paymentStatus: "paid", customer: "Elizabeth", status: "Shipped", date: "3d ago", items: 2, total: "$149.50", email: "elizabeth@mail.com", address: "123 Main St, London" },
  { id: "ORD-2026-0056", uid: "19be7a04…4f6c", image: "/img/demo/products/chess-set.jpg", paymentStatus: "refunded", customer: "Jennifer", status: "Cancelled", date: "8 May", items: 5, total: "$412.00", email: "jennifer@mail.com", address: "78 Oak Rd, Berlin" },
  { id: "ORD-2026-0026", uid: "a6f3c118…2b77", image: "/img/demo/products/corkscrew.jpg", paymentStatus: "refunded", customer: "Susan", status: "Cancelled", date: "1d ago", items: 1, total: "$34.99", email: "susan@mail.com", address: "9 Elm St, Paris" },
  { id: "ORD-2026-0019", uid: "4d90e2ba…c015", image: "/img/demo/products/invisible-shelf.jpg", paymentStatus: "paid", customer: "Michael", status: "Confirmed", date: "5d ago", items: 4, total: "$199.00", email: "michael@mail.com", address: "22 Maple Dr, Tokyo" },
  { id: "ORD-2026-0042", uid: "f5127ac9…8e40", image: "/img/demo/products/casio-collection.jpg", paymentStatus: "pending", customer: "Sarah", status: "Processing", date: "2d ago", items: 2, total: "$89.50", email: "sarah@mail.com", address: "55 Pine Ln, Sydney" },
  { id: "ORD-2026-0088", uid: "2ac6b83d…7159", image: "/img/demo/products/predator-2.jpg", paymentStatus: "paid", customer: "David", status: "Delivered", date: "6 May", items: 3, total: "$245.00", email: "david@mail.com", address: "11 Cedar Ct, Toronto" },
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

/* ─── The record, as the panel edits it ───────────────────────────────────
   Read off the shipped markup of a split-pane record:

     EntityForm / FieldBlock  the 52px top bar on the SHEET, the folder tab
                              strip, and the record pane's own `bg-surface-card`
     FieldBlock               label ABOVE the control, 13px medium in the
                              PRIMARY ink, the property's type icon before it at
                              14px in the disabled tier, required marker after,
                              description under the control in the caption tier
     FormSections             `flex flex-col gap-8`; every section after the
                              first carries an uppercase rule-header
     the grid                 `gap-x-4 gap-y-5 grid-cols-1 @2xl:grid-cols-4`
                              with per-field spans
     the controls             an editable field is `bg-surface-field` + hairline
                              at `min-h-[32px]`; a COMPUTED one is a
                              `hairline-strong` outline with no fill at
                              `min-h-12 opacity-80` — the panel says "you cannot
                              type here" with the box, not with a disabled grey

   The outlined box with a shrunk label floating inside its border is the form
   this one replaced; nothing in the panel draws one any more. */

/** One field: label, control, description. */
function FormField({ label, icon, span, required, description, highlighted, children }: {
  label: string;
  icon: React.ReactNode;
  /** Columns on the four-column grid. */
  span: 1 | 2 | 3 | 4;
  required?: boolean;
  description?: string;
  highlighted?: boolean;
  children: React.ReactNode;
}) {
  const spanClass = span === 1 ? "@2xl/col:col-span-1"
    : span === 2 ? "@2xl/col:col-span-2"
      : span === 3 ? "@2xl/col:col-span-3"
        : "@2xl/col:col-span-4";
  return (
    <div className={spanClass}>
      <div className="relative flex flex-col min-w-0">
        <div className="flex items-center gap-1.5 font-medium mb-1.5 text-[13px] text-text-primary dark:text-text-primary-dark">
          <span className="shrink-0 text-text-disabled dark:text-text-disabled-dark [&>svg]:size-3.5">{icon}</span>
          <span className="truncate">{label}</span>
          {required && <span className="text-red-500 dark:text-red-500 -ml-1">*</span>}
        </div>
        <div className={`min-w-0 rounded-lg transition-shadow duration-300 ${highlighted ? "ring-2 ring-primary" : ""}`}>
          {children}
        </div>
        {description && (
          <p className="typography-caption text-text-disabled dark:text-text-disabled-dark mt-1.5 ml-0.5 leading-snug">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/** A section rule: uppercase name, then a hairline across the rest of the row. */
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2.5 w-full mb-3.5">
      <span className="text-xs font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark whitespace-nowrap">{title}</span>
      <span className="flex-1 border-t border-hairline"/>
    </div>
  );
}

const FORM_GRID = "grid min-w-0 gap-x-4 gap-y-5 grid-cols-1 @2xl/col:grid-cols-4";
/** An editable control: filled, hairlined, 32px. */
const CONTROL = "rounded-lg relative max-w-full bg-surface-field border border-hairline min-h-[32px] flex items-center px-3 text-sm";
/** A computed one: outlined, unfilled, 48px, held back to 80%. */
const COMPUTED = "w-full flex items-center rounded-lg border border-hairline-strong px-3 min-h-12 opacity-80";

/** One meta row of the record block. */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 min-w-0">
      <span className="text-xs text-text-disabled dark:text-text-disabled-dark shrink-0">{label}</span>
      <span className="font-mono text-xs text-text-secondary dark:text-text-secondary-dark truncate">{value}</span>
    </div>
  );
}

function OrderDetailPanel({ order, highlightedField }: {
  order: Order; highlightedField: string | null;
}) {
  return (
    /* The record pane is a CARD on the sheet: the bar and the tab strip above it
       stay on the sheet, and the active tab joins the card by taking its fill. */
    <div className="relative flex flex-col h-full w-full bg-surface-card">
      {/* The 52px bar: where you are, what this record is, and what you can do
          to it. The record's name lives HERE at 15px — a display-size title
          inside the form was the older layout. */}
      <div className="h-[52px] shrink-0 flex items-center gap-2 pl-1.5 pr-2 bg-surface-sheet">
        <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-surface-accent-500 dark:text-surface-accent-300">
          <PanelLeftClose size={16}/>
        </span>
        <p className="typography-caption text-text-disabled dark:text-text-disabled-dark whitespace-nowrap hidden sm:block">Orders&nbsp;/</p>
        <span className="font-headers font-semibold text-[15px] tracking-tight truncate min-w-0">{order.id}</span>
        <span className="hidden md:inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap px-2 py-0.5 rounded-md font-mono text-[11px] text-text-secondary dark:text-text-secondary-dark bg-surface-field">
          {order.uid}
          <Copy size={12}/>
        </span>
        <div className="flex-1"/>
        <span className="text-xs text-text-disabled dark:text-text-disabled-dark whitespace-nowrap hidden md:inline">Saved</span>
        <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-surface-raised text-surface-accent-500 dark:text-surface-accent-300">
          <WandSparkles size={16}/>
        </span>
        {/* Disabled because nothing is dirty — the panel's resting state. */}
        <span className="flex items-stretch rounded-lg overflow-hidden">
          <span className="typography-button inline-flex items-center justify-center bg-surface-raised text-text-disabled dark:text-text-disabled-dark min-h-[32px] px-2">Save</span>
          <span className="typography-button inline-flex items-center justify-center bg-surface-raised text-text-disabled dark:text-text-disabled-dark min-h-[32px] px-1.5 border-l border-hairline">
            <ChevronDown size={16}/>
          </span>
        </span>
        <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-surface-accent-500 dark:text-surface-accent-300">
          <EllipsisVertical size={16}/>
        </span>
        <span className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full ml-2 text-surface-accent-500 dark:text-surface-accent-300">
          <X size={16}/>
        </span>
      </div>

      {/* Folder tabs: the active one takes the card's fill and its hairline, and
          sits a pixel over the strip's rule so the two shapes join. */}
      <div className="h-10 shrink-0 flex items-stretch border-b px-2 min-w-0 bg-surface-sheet border-hairline">
        <span className="flex-shrink-0 flex items-center gap-1.5 px-3.5 font-medium box-border rounded-t-lg -mb-px border border-b-0 bg-surface-card border-hairline text-text-primary dark:text-text-primary-dark h-full text-sm min-w-[90px] justify-center">
          <ShoppingCart size={16}/>Order
        </span>
        <span className="flex-shrink-0 flex items-center gap-1.5 px-3.5 font-medium box-border rounded-t-lg -mb-px border border-transparent border-b-0 text-text-secondary dark:text-text-secondary-dark h-full text-sm min-w-[90px] justify-center">
          <User size={16}/>Customer
        </span>
      </div>

      {/* The form column, at the panel's own widths and padding. */}
      <div className="flex-1 min-h-0 overflow-y-auto flex justify-center items-start">
        <div className="@container/col w-full max-w-3xl flex flex-col pt-6 pb-12 px-5 sm:px-8">
          <div className="flex flex-col gap-8">
            <section className="min-w-0">
              <div className={FORM_GRID}>
                <FormField label="Customer" icon={<TextAlignStart/>} span={2} required
                  highlighted={highlightedField === "customer"}>
                  <div className={CONTROL}>{order.customer}</div>
                </FormField>

                <FormField label="Email" icon={<TextAlignStart/>} span={2} required
                  highlighted={highlightedField === "email"}>
                  <div className={CONTROL}>{order.email}</div>
                </FormField>

                <FormField label="Status" icon={<List/>} span={2}
                  highlighted={highlightedField === "status"}>
                  <div className={`${CONTROL} justify-between gap-2`}>
                    <span className={`chip ${STATUS_CHIP[order.status]}`}>{order.status}</span>
                    <ChevronDown size={16} className="text-text-disabled dark:text-text-disabled-dark shrink-0"/>
                  </div>
                </FormField>

                <FormField label="Payment" icon={<List/>} span={2}
                  highlighted={highlightedField === "payment"}>
                  <div className={`${CONTROL} justify-between gap-2`}>
                    <span className={`chip ${PAYMENT_CHIP[order.paymentStatus]}`}>{PAYMENT_LABEL[order.paymentStatus]}</span>
                    <ChevronDown size={16} className="text-text-disabled dark:text-text-disabled-dark shrink-0"/>
                  </div>
                </FormField>

                <FormField label="Shipping Address" icon={<TextAlignStart/>} span={4}
                  highlighted={highlightedField === "address"}>
                  <div className="rounded-md relative max-w-full min-h-[64px] bg-surface-field border border-hairline px-3 py-2 text-sm">
                    {order.address}
                  </div>
                </FormField>
              </div>
            </section>

            <section className="min-w-0">
              <SectionHeader title="Totals"/>
              <div className={FORM_GRID}>
                <FormField label="Total" icon={<Hash/>} span={1}
                  description="Sum of the order's line items"
                  highlighted={highlightedField === "total"}>
                  <div className={COMPUTED}><span className="font-mono tabular-nums">{order.total}</span></div>
                </FormField>

                <FormField label="Items" icon={<Hash/>} span={1}
                  description="Line items in this order"
                  highlighted={highlightedField === "items"}>
                  <div className={COMPUTED}><span className="font-mono tabular-nums">{order.items}</span></div>
                </FormField>

                <FormField label="Priority" icon={<Flag/>} span={1}
                  description="Ships before the rest of the queue">
                  <div className={COMPUTED}>
                    <span className="border-2 shrink-0 w-5 h-5 rounded flex items-center justify-center bg-surface-card border-surface-accent-800 dark:border-surface-accent-500"/>
                  </div>
                </FormField>
              </div>
            </section>
          </div>

          {/* The record block: what the row is, rather than what it says. */}
          <div className="mt-8 pt-5 border-t max-w-sm border-hairline">
            <div className="flex flex-col gap-2.5">
              <p className="typography-caption text-xs font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">Record</p>
              <MetaRow label="ID" value={order.uid}/>
              <MetaRow label="Created" value="11/07/2026"/>
              <MetaRow label="Updated" value="01/09/2026"/>
            </div>
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
