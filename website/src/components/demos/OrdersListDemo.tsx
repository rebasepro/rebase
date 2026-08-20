import React, { useState, useEffect, useCallback } from "react";
import {
  Search, Settings, Trash2, Plus, Filter, ChevronDown,
  ChevronsRight, User,
  Folder, ShoppingCart,
  LayoutList, Upload, Download, ArrowUpRight, ArrowDownRight,
  Info, Package, X, Maximize2, Code
} from "lucide-react";

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
  Confirmed: { bg: "rgb(59, 130, 246)", text: "rgb(255, 255, 255)" },
  Delivered: { bg: "rgb(34, 197, 94)", text: "rgb(255, 255, 255)" },
  Shipped: { bg: "rgb(99, 102, 241)", text: "rgb(255, 255, 255)" },
  Cancelled: { bg: "rgb(239, 68, 68)", text: "rgb(255, 255, 255)" },
  Processing: { bg: "rgb(245, 158, 11)", text: "rgb(255, 255, 255)" },
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
        : "border-surface-200/30 dark:border-surface-700/40 bg-white dark:bg-surface-900/50"
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
      className={`flex items-center min-w-full border-b border-surface-200/20 dark:border-surface-700/30 cursor-pointer transition-colors px-4 ${
        isSelected ? "bg-primary/5" : isHovered ? "bg-surface-100/50 dark:bg-surface-800/20" : ""
      }`}
      style={{ height: 58 }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <div className="flex-shrink-0 w-10 flex items-center justify-center">
        <div className={`border-2 w-4 h-4 rounded flex items-center justify-center transition-colors ${
          isSelected ? "bg-primary border-primary" : "bg-white dark:bg-surface-900 border-surface-400 dark:border-surface-500"
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
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wider ${
            order.paymentStatus === "paid" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20" :
            order.paymentStatus === "pending" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20" :
            "bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/20"
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
    `relative rounded-md bg-surface-100 dark:bg-surface-800/60 min-h-[48px] flex flex-col justify-center transition-all duration-300 ${
      highlightedField === name ? "ring-2 ring-green-500" : ""
    }`;

  return (
    <div className="flex flex-col h-full">
      {/* Panel top bar */}
      <div className="h-14 flex items-center px-3 border-b border-surface-200/20 dark:border-surface-700/30 shrink-0 gap-1">
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
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-300 text-[10px] font-semibold border border-transparent" style={{ minWidth: 72 }}>
              ✓ Saved
            </span>
          </div>

          {/* Title */}
          <div className="text-xl font-semibold text-surface-900 dark:text-white leading-tight mb-2">{order.id}</div>

          {/* Path */}
          <div className="w-full rounded-md bg-surface-100 dark:bg-surface-800/40 px-3 py-1.5 mb-6">
            <code className="text-[11px] text-surface-500">orders/{order.id}</code>
          </div>

          {/* Form fields */}
          <div className="flex flex-col gap-3">
            {/* Customer */}
            <div className={fieldClass("customer")}>
              <span className="absolute top-1.5 left-3 text-[10px] font-medium text-primary">Customer <span className="text-red-400">*</span></span>
              <div className="px-3 pt-6 pb-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-surface-900 dark:text-white">{order.customer}</span>
                <span className="text-xs text-surface-500 dark:text-surface-400">({order.email})</span>
              </div>
            </div>

            {/* Status */}
            <div className={fieldClass("status")}>
              <span className="absolute top-1.5 left-3 text-[10px] font-medium text-surface-400">Status</span>
              <div className="px-3 pt-6 pb-2 flex items-center justify-between">
                <span className="rounded-lg inline-flex items-center px-2.5 py-0.5 text-xs font-normal"
                  style={{ backgroundColor: statusColor.bg, color: statusColor.text }}>
                  {order.status}
                </span>
                <ChevronDown size={16} className="text-surface-400" />
              </div>
            </div>

            {/* Payment */}
            <div className={fieldClass("payment")}>
              <span className="absolute top-1.5 left-3 text-[10px] font-medium text-surface-400">Payment</span>
              <div className="px-3 pt-6 pb-2">
                <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider inline-block ${
                  order.paymentStatus === "paid" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20" :
                  order.paymentStatus === "pending" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20" :
                  "bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/20"
                }`}>
                  {order.paymentStatus}
                </span>
              </div>
            </div>

            {/* Total */}
            <div className={fieldClass("total")}>
              <span className="absolute top-1.5 left-3 text-[10px] font-medium text-surface-400">Total</span>
              <div className="px-3 pt-6 pb-2 text-sm font-semibold text-surface-900 dark:text-surface-200">{order.total}</div>
            </div>

            {/* Items */}
            <div className={fieldClass("items")}>
              <span className="absolute top-1.5 left-3 text-[10px] font-medium text-surface-400">Items</span>
              <div className="px-3 pt-6 pb-2 text-sm text-surface-900 dark:text-surface-200">{order.items} item{order.items > 1 ? "s" : ""}</div>
            </div>

            {/* Address */}
            <div className={fieldClass("address")}>
              <span className="absolute top-1.5 left-3 text-[10px] font-medium text-surface-400">Shipping Address</span>
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
    { icon: Folder, label: "PRODUCTS", active: false },
    { icon: User, label: "USERS", active: false },
    { icon: ShoppingCart, label: "ORDERS", active: true },
  ];

  return (
    <div
      className="flex overflow-hidden bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-white pointer-events-none select-none relative"
      style={{ height, width: "100%" }}
    >
      {/* Drawer */}
      <div className="z-20 relative hidden sm:block" style={{ width: 72 }}>
        <div className="h-full no-scrollbar overflow-y-auto overflow-x-hidden relative bg-surface-50 dark:bg-surface-900" style={{ width: 72 }}>
          <div className="flex flex-col h-full">
            <div className="flex flex-row items-center shrink-0 pt-4 pb-0 px-2">
              <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px]">
                <img src="/img/rebase_logo.svg" width="306" height="306" alt="Rebase" className="w-[28px] h-[28px] object-contain" />
              </div>
            </div>
            <div className="mt-1 flex-grow overflow-scroll no-scrollbar">
              <div className="my-2 mx-2 flex flex-col">
                <div className="overflow-hidden bg-surface-50 dark:bg-surface-800/30 rounded-lg">
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label}>
                        <div className={`rounded-lg truncate flex flex-row items-center h-10 font-semibold text-xs ${
                          item.active ? "bg-surface-accent-200/60 dark:bg-surface-800 dark:bg-opacity-50" : "hover:bg-surface-accent-300/75 dark:hover:bg-surface-accent-800/75"
                        } text-text-primary dark:text-surface-200`}>
                          <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px] text-text-secondary dark:text-text-secondary-dark">
                            <Icon size={18} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="shrink-0 mt-auto px-2 py-2">
              <div className="flex flex-row items-center rounded-lg py-2">
                <div className="shrink-0 flex items-center justify-center w-[56px] h-[24px] text-surface-500 dark:text-surface-400">
                  <ChevronsRight size={18} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <main className="flex flex-col grow overflow-auto">
        <div className="border-surface-200/20 dark:border-surface-700/30 bg-surface-50 dark:bg-surface-900 grow overflow-auto m-0 mt-1 lg:m-0 lg:mx-2 lg:mb-2 lg:rounded-lg lg:border flex flex-col">
          {/* Toolbar */}
          <div className="min-h-[48px] overflow-x-auto px-2 md:px-4 bg-surface-50 dark:bg-surface-900 border-b border-surface-200/40 dark:border-surface-700/40 flex flex-row justify-between items-center w-full shrink-0">
            <div className="flex items-center gap-1 mr-4">
              <div className="flex items-center bg-surface-100 dark:bg-surface-800 rounded-md p-0.5 gap-0.5">
                <button className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-white dark:bg-surface-900 shadow-sm text-primary">
                  <LayoutList size={14} /><span className="text-xs">List</span>
                </button>
              </div>
              <button className="p-1.5 rounded-full text-surface-500 flex items-center gap-1 text-xs">
                <Filter size={14} /><span>Filters</span>
              </button>
            </div>
            <div className="flex items-center gap-1">
              <div className="flex items-center rounded-md bg-surface-100 dark:bg-surface-800 px-2.5 py-1 gap-1.5 min-w-[160px]">
                <Search size={16} className="text-surface-400" />
                <span className="text-xs text-surface-400 whitespace-nowrap">Search</span>
              </div>
              <button aria-label="Upload" className="p-1.5 rounded-full text-surface-500"><Upload size={16} /></button>
              <button aria-label="Download" className="p-1.5 rounded-full text-surface-500"><Download size={16} /></button>
              <button aria-label="Settings" className="p-1.5 rounded-full text-surface-500"><Settings size={16} /></button>
              <button aria-label="Delete" className="p-1.5 rounded-full text-surface-500 opacity-50"><Trash2 size={16} /></button>
              <span className="text-xs text-surface-400 mx-1">(0)</span>
              <button className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-white text-sm">
                <Plus size={16} /><span className="text-xs font-medium">Add Order</span>
              </button>
            </div>
          </div>

          {/* Content area — list + panel split */}
          <div className="h-full w-full flex bg-white dark:bg-surface-950 overflow-hidden relative">
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
                      <KPICard title="Confirmed" subtitle="" value="15.0"
                        change={{ value: "+18.0%", positive: true }} icon={<Info size={14} />}
                        isHighlighted={highlightedKPI === 0} />
                      <KPICard title="Shipped" subtitle="" value="15.0"
                        change={{ value: "+7.4%", positive: true }} icon={<Package size={14} />}
                        isHighlighted={highlightedKPI === 1} />
                      <KPICard title="Revenue" subtitle="" value="$36.6K" icon={<span />}
                        isHighlighted={highlightedKPI === 2} />
                    </div>
                  </div>
                  <div className="h-px bg-surface-200/30 dark:bg-surface-700/40 mx-4" />
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
              className="border-l border-surface-200/20 dark:border-surface-700/30 bg-white dark:bg-surface-900 shadow-[-4px_0_20px_rgba(0,0,0,0.08)] flex flex-col transition-all duration-150 ease-out overflow-hidden"
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
