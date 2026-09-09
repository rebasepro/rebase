import React, { useState, useEffect, useCallback } from "react";
import {
  ChevronDown, User,
  Folder, ShoppingCart,
  LayoutList, ArrowUpRight, ArrowDownRight,
  Info, Package, X, Maximize2, Code
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
  paymentStatus: "paid" | "pending" | "refunded";
  customer: string;
  customerColor: string;
  status: "Confirmed" | "Delivered" | "Shipped" | "Cancelled" | "Processing";
  date: string;
  items: number;
  total: string;
  email: string;
  address: string;
}

/* ─── Mock Data ─── */
const MOCK_ORDERS: Order[] = [
  { id: "ORD-2026-0006", paymentStatus: "paid", customer: "Elizabeth", customerColor: "#3b82f6", status: "Confirmed", date: "8 May", items: 3, total: "$284.00", email: "elizabeth@mail.com", address: "123 Main St, London" },
  { id: "ORD-2026-0036", paymentStatus: "paid", customer: "James", customerColor: "#22c55e", status: "Delivered", date: "1d ago", items: 1, total: "$59.99", email: "james@mail.com", address: "45 Park Ave, NYC" },
  { id: "ORD-2026-0061", paymentStatus: "paid", customer: "Elizabeth", customerColor: "#3b82f6", status: "Shipped", date: "3d ago", items: 2, total: "$149.50", email: "elizabeth@mail.com", address: "123 Main St, London" },
  { id: "ORD-2026-0056", paymentStatus: "paid", customer: "Jennifer", customerColor: "#a855f7", status: "Cancelled", date: "8 May", items: 5, total: "$412.00", email: "jennifer@mail.com", address: "78 Oak Rd, Berlin" },
  { id: "ORD-2026-0026", paymentStatus: "paid", customer: "Susan", customerColor: "#22c55e", status: "Cancelled", date: "1d ago", items: 1, total: "$34.99", email: "susan@mail.com", address: "9 Elm St, Paris" },
  { id: "ORD-2026-0019", paymentStatus: "paid", customer: "Michael", customerColor: "#f59e0b", status: "Confirmed", date: "5d ago", items: 4, total: "$199.00", email: "michael@mail.com", address: "22 Maple Dr, Tokyo" },
  { id: "ORD-2026-0042", paymentStatus: "pending", customer: "Sarah", customerColor: "#ec4899", status: "Processing", date: "2d ago", items: 2, total: "$89.50", email: "sarah@mail.com", address: "55 Pine Ln, Sydney" },
  { id: "ORD-2026-0088", paymentStatus: "paid", customer: "David", customerColor: "#06b6d4", status: "Delivered", date: "6 May", items: 3, total: "$245.00", email: "david@mail.com", address: "11 Cedar Ct, Toronto" },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  // CHIP_COLORS in DARK mode, the TINTED variant the product draws by default
  // since 2026-09-08 — packages/ui/src/util/chip_colors.ts (`darkTintColor`,
  // `darkTintText`). The solid stops these replaced painted a status as a
  // block; a 14% wash behind hue-coloured ink is a label.
  Confirmed: { bg: "rgba(45, 127, 249, 0.14)", text: "#9cc7ff" },
  Delivered: { bg: "rgba(32, 201, 51, 0.14)", text: "#93e088" },
  Shipped: { bg: "rgba(99, 102, 241, 0.14)", text: "#a5b4fc" },
  Cancelled: { bg: "rgba(248, 43, 96, 0.14)", text: "#ff9eb7" },
  Processing: { bg: "rgba(252, 180, 0, 0.14)", text: "#ffd66e" },
};

/* ─── KPI Card ─── */
function KPICard({ title, subtitle, value, change, icon, isHighlighted = false }: {
  title: string; subtitle: string; value: string;
  change?: { value: string; positive: boolean };
  icon: React.ReactNode; isHighlighted?: boolean;
}) {
  return (
    <div className={`flex-1 min-w-0 rounded-lg border p-2.5 transition-all duration-300 ${
      isHighlighted
        ? "border-primary/40 bg-primary/5 dark:bg-primary/10 shadow-sm"
        // A card is a step ABOVE its ground. These sit on the card surface the
        // rows use, so they take the raised one — the sheet is darker than the
        // thing it would be sitting on.
        : "border-hairline bg-surface-raised"
    }`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-medium text-surface-900 dark:text-surface-200">{title}</div>
        <div className="text-surface-400 dark:text-surface-500">{icon}</div>
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-lg font-semibold text-surface-900 dark:text-white tracking-tight">{value}</div>
        {change && (
          <div className={`flex items-center gap-0.5 text-[10px] font-medium ${change.positive ? "text-emerald-500" : "text-red-400"}`}>
            {change.positive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {change.value}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Order Row ─── */
function OrderRow({ order, isHovered, isSelected, onHover, onLeave }: {
  order: Order; isHovered: boolean; isSelected: boolean;
  onHover: () => void; onLeave: () => void;
}) {
  const statusColor = STATUS_COLORS[order.status];
  return (
    <div
      className={`flex items-center min-w-full border-b border-hairline cursor-pointer transition-colors px-4 ${
        isSelected ? "bg-primary/5" : isHovered ? "bg-surface-field" : ""
      }`}
      style={{ height: 58 }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <div className="flex-shrink-0 w-10 flex items-center justify-center">
        <div className={`border-2 w-4 h-4 rounded flex items-center justify-center transition-colors ${
          isSelected ? "bg-primary border-primary" : "bg-surface-card border-surface-400 border-hairline-strong"
        }`}>
          {isSelected && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 w-8 flex items-center justify-center text-surface-400 dark:text-surface-500">
        <ShoppingCart size={16} />
      </div>
      <div className="flex-grow min-w-0 ml-3">
        <div className="text-sm font-semibold text-surface-900 dark:text-white">{order.id}</div>
        <div className="flex items-center gap-2 mt-0.5">
          {/* An enum value, so it is a chip — not a bordered, uppercase pill. */}
          <span className={`chip chip-xs ${
            order.paymentStatus === "paid" ? "chip-emerald" :
            order.paymentStatus === "pending" ? "chip-yellow" :
            "chip-red"
          }`}>
            {order.paymentStatus}
          </span>
          <span className="text-xs text-surface-500 dark:text-surface-400 font-medium">
            {order.customer}
          </span>
        </div>
      </div>
      <div className="flex-shrink-0 mx-2 sm:mx-4">
        <span className="rounded-md inline-flex items-center px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium whitespace-nowrap"
          style={{ backgroundColor: statusColor.bg, color: statusColor.text }}>
          {order.status}
        </span>
      </div>
      <div className="flex-shrink-0 w-16 text-right text-xs text-surface-400 dark:text-surface-500 hidden sm:block">{order.date}</div>
    </div>
  );
}

/* ─── Order Detail Panel (split view) ─── */
function OrderDetailPanel({ order, onClose, highlightedField }: {
  order: Order; onClose: () => void; highlightedField: string | null;
}) {
  const statusColor = STATUS_COLORS[order.status];
  const fieldClass = (name: string) =>
    `field min-h-[48px] flex flex-col justify-center transition-all duration-300 ${
      highlightedField === name ? "ring-2 ring-primary" : ""
    }`;

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

      {/* Panel body */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col w-full pt-6 pb-16 px-4 sm:px-6">
          {/* Saved badge */}
          <div className="flex justify-end mb-2" style={{ minHeight: 22 }}>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-raised text-surface-500 dark:text-surface-300 text-[10px] font-semibold border border-transparent" style={{ minWidth: 72 }}>
              ✓ Saved
            </span>
          </div>

          {/* Title */}
          <div className="text-xl font-semibold text-surface-900 dark:text-white leading-tight mb-2">{order.id}</div>

          {/* Path */}
          <div className="w-full rounded-md bg-surface-well px-3 py-1.5 mb-6">
            <code className="text-[11px] text-surface-500">orders/{order.id}</code>
          </div>

          {/* Form fields */}
          <div className="flex flex-col gap-3">
            {/* Customer */}
            <div className={fieldClass("customer")}>
              <span className="field-label text-primary">Customer <span className="text-red-500">*</span></span>
              <div className="px-3 pt-6 pb-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-surface-900 dark:text-white">{order.customer}</span>
                <span className="text-xs text-surface-500 dark:text-surface-400">({order.email})</span>
              </div>
            </div>

            {/* Status */}
            <div className={fieldClass("status")}>
              <span className="field-label">Status</span>
              <div className="px-3 pt-6 pb-2 flex items-center justify-between">
                <span className="chip"
                  style={{ backgroundColor: statusColor.bg, color: statusColor.text }}>
                  {order.status}
                </span>
                <ChevronDown size={16} className="text-surface-400" />
              </div>
            </div>

            {/* Payment */}
            <div className={fieldClass("payment")}>
              <span className="field-label">Payment</span>
              <div className="px-3 pt-6 pb-2">
                <span className={`chip ${
                  order.paymentStatus === "paid" ? "chip-emerald" :
                  order.paymentStatus === "pending" ? "chip-yellow" :
                  "chip-red"
                }`}>
                  {order.paymentStatus}
                </span>
              </div>
            </div>

            {/* Total */}
            <div className={fieldClass("total")}>
              <span className="field-label">Total</span>
              <div className="px-3 pt-6 pb-2 text-sm font-semibold text-surface-900 dark:text-surface-200">{order.total}</div>
            </div>

            {/* Items */}
            <div className={fieldClass("items")}>
              <span className="field-label">Items</span>
              <div className="px-3 pt-6 pb-2 text-sm text-surface-900 dark:text-surface-200">{order.items} item{order.items > 1 ? "s" : ""}</div>
            </div>

            {/* Address */}
            <div className={fieldClass("address")}>
              <span className="field-label">Shipping Address</span>
              <div className="px-3 pt-6 pb-2 text-sm text-surface-900 dark:text-surface-200">{order.address}</div>
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
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [highlightedKPI, setHighlightedKPI] = useState<number | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [highlightedField, setHighlightedField] = useState<string | null>(null);

  const isMobile = useMediaQuery("(max-width: 639px)");
  const isMedium = useMediaQuery("(min-width: 640px) and (max-width: 767px)");

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
        // ── Full list view (~2s): flash KPIs + browse rows ──
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

          {/* Content area — list + panel split */}
          <div className="h-full w-full flex bg-surface-card overflow-hidden relative">
            {/* Left: list content (shrinks when panel opens; hidden on mobile when panel is open) */}
            <div
              className="flex flex-col overflow-auto transition-all duration-150 ease-out"
              style={{
                width: panelOpen
                  ? isMobile ? "0%" : isMedium ? "35%" : "45%"
                  : "100%",
                opacity: panelOpen && isMobile ? 0 : 1,
                ...(panelOpen && isMobile ? { overflow: "hidden" } : {}),
              }}
            >
              {/* Title + KPIs — hidden when split panel is open */}
              {!panelOpen && (
                <>
                  <div className="px-4 sm:px-6 pt-4 pb-3 max-w-3xl mx-auto w-full">
                    <div className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Orders</div>
                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                      {/* Counts are counts: "15.0" orders read as a formatting bug. */}
                      <KPICard title="Confirmed" subtitle="" value="15"
                        change={{ value: "+18.0%", positive: true }} icon={<Info size={14} />}
                        isHighlighted={highlightedKPI === 0} />
                      <KPICard title="Shipped" subtitle="" value="12"
                        change={{ value: "+7.4%", positive: true }} icon={<Package size={14} />}
                        isHighlighted={highlightedKPI === 1} />
                      <KPICard title="Revenue" subtitle="" value="$36.6K" icon={<span />}
                        isHighlighted={highlightedKPI === 2} />
                    </div>
                  </div>
                  <div className="h-px bg-surface-raised mx-4" />
                </>
              )}

              {/* Orders list */}
              <div className={`flex-1 ${!panelOpen ? "max-w-3xl mx-auto w-full" : ""}`}>
                {MOCK_ORDERS.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    isHovered={hoveredRow === order.id}
                    isSelected={selectedOrderId === order.id}
                    onHover={() => setHoveredRow(order.id)}
                    onLeave={() => setHoveredRow(null)}
                  />
                ))}
              </div>
            </div>

            {/* Right: detail panel (split view; full-width overlay on mobile) */}
            <div
              className="border-l border-hairline bg-surface-card shadow-[-4px_0_20px_rgba(0,0,0,0.08)] flex flex-col transition-all duration-150 ease-out overflow-hidden"
              style={{
                width: panelOpen
                  ? isMobile ? "100%" : isMedium ? "65%" : "55%"
                  : "0%",
                opacity: panelOpen ? 1 : 0,
                ...(panelOpen && isMobile ? { borderLeft: "none" } : {}),
              }}
            >
              {selectedOrder && (
                <OrderDetailPanel order={selectedOrder} onClose={closeOrder} highlightedField={highlightedField} />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
