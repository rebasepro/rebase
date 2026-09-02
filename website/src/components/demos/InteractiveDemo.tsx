import React, { useState, useCallback } from "react";
import { Search, ShoppingCart, X, ChevronDown, Check, Code, Globe, Play } from "lucide-react";

/* ─── Types ─── */
interface Order {
    id: string;
    paymentStatus: "paid" | "pending" | "refunded";
    customer: string;
    status: "Confirmed" | "Delivered" | "Shipped" | "Cancelled" | "Processing";
    date: string;
    items: number;
    total: string;
    email: string;
    address: string;
}

const STATUS_OPTIONS: Order["status"][] = ["Confirmed", "Delivered", "Shipped", "Cancelled", "Processing"];

const MOCK_ORDERS: Order[] = [
    { id: "ORD-2026-0006", paymentStatus: "paid", customer: "Elizabeth", status: "Confirmed", date: "8 May", items: 3, total: "$284.00", email: "elizabeth@mail.com", address: "123 Main St, London" },
    { id: "ORD-2026-0036", paymentStatus: "paid", customer: "James", status: "Delivered", date: "1d ago", items: 1, total: "$59.99", email: "james@mail.com", address: "45 Park Ave, NYC" },
    { id: "ORD-2026-0061", paymentStatus: "paid", customer: "Alexander", status: "Shipped", date: "3d ago", items: 2, total: "$149.50", email: "alex@mail.com", address: "88 Kings Rd, London" },
    { id: "ORD-2026-0056", paymentStatus: "paid", customer: "Jennifer", status: "Cancelled", date: "8 May", items: 5, total: "$412.00", email: "jennifer@mail.com", address: "78 Oak Rd, Berlin" },
    { id: "ORD-2026-0026", paymentStatus: "paid", customer: "Susan", status: "Cancelled", date: "1d ago", items: 1, total: "$34.99", email: "susan@mail.com", address: "9 Elm St, Paris" },
    { id: "ORD-2026-0019", paymentStatus: "paid", customer: "Michael", status: "Confirmed", date: "5d ago", items: 4, total: "$199.00", email: "michael@mail.com", address: "22 Maple Dr, Tokyo" }
];

const STATUS_COLORS: Record<string, string> = {
    // The product's chip palette (CHIP_COLORS, dark) — see the `chip-*`
    // utilities in styles/global.css. Tailwind's own `-950/-300` pair is a
    // different hue family several stops darker.
    Confirmed: "chip-blue",
    Delivered: "chip-green",
    Shipped: "chip-indigo",
    Cancelled: "chip-red",
    Processing: "chip-yellow"
};

export default function InteractiveDemo() {
    const [orders, setOrders] = useState<Order[]>(MOCK_ORDERS);
    const [selectedOrderId, setSelectedOrderId] = useState<string>("ORD-2026-0036");
    const [activeInspectorTab, setActiveInspectorTab] = useState<"sdk" | "json">("sdk");
    const [showStatusDropdown, setShowStatusDropdown] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [showToast, setShowToast] = useState(false);

    const activeOrder = orders.find(o => o.id === selectedOrderId) || orders[0];

    const handleUpdateStatus = (status: Order["status"]) => {
        setOrders(prev => prev.map(o => o.id === activeOrder.id ? { ...o, status } : o));
        setShowStatusDropdown(false);
        triggerToast();
    };

    const handleUpdateCustomer = (customer: string) => {
        setOrders(prev => prev.map(o => o.id === activeOrder.id ? { ...o, customer, email: `${customer.toLowerCase().replace(/\s+/g, '')}@mail.com` } : o));
        triggerToast();
    };

    const triggerToast = () => {
        setShowToast(true);
        setTimeout(() => setShowToast(false), 2000);
    };

    const filteredOrders = orders.filter(o => 
        o.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.customer.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Code generators
    const sdkCode = `import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient<Database>({
  baseUrl: "http://localhost:3001"
});

// 1. Fetch record
const order = await client.data.orders.findById("${activeOrder.id}");

// 2. Perform type-safe update
await client.data.orders.update("${activeOrder.id}", {
  customer: "${activeOrder.customer}",
  status: "${activeOrder.status}"
});`;

    const jsonResponse = JSON.stringify({
        status: "success",
        data: {
            id: activeOrder.id,
            customer: activeOrder.customer,
            email: activeOrder.email,
            status: activeOrder.status,
            paymentStatus: activeOrder.paymentStatus,
            date: activeOrder.date,
            itemsCount: activeOrder.items,
            totalPrice: activeOrder.total,
            shippingAddress: activeOrder.address
        }
    }, null, 2);

    return (
        <div className="w-full h-full min-h-[580px] grid grid-cols-1 lg:grid-cols-12 border border-surface-800 bg-surface-950 rounded-xl overflow-hidden shadow-2xl relative not-content">
            
            {/* Success Toast */}
            <div className={`absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-emerald-950 border border-emerald-500/30 text-emerald-400 text-xs font-semibold px-4 py-2 rounded-full shadow-lg transition-all duration-300 flex items-center gap-2 ${showToast ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
                <Check size={14} />
                TypeScript SDK Mutation Synced with Postgres!
            </div>

            {/* LEFT SIDE: the interactive panel (8 cols on lg) */}
            <div className="lg:col-span-7 flex flex-col h-full border-b lg:border-b-0 lg:border-r border-surface-800">
                {/* Admin Header */}
                <div className="px-5 py-3 border-b border-surface-800/80 bg-surface-900/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ShoppingCart size={16} className="text-primary-light" />
                        <span className="text-xs font-semibold text-white font-sans tracking-wide">Orders Manager</span>
                    </div>
                    
                    {/* Search bar */}
                    <div className="relative h-8 rounded-lg bg-surface-900 border border-surface-700/60 px-2 flex items-center gap-1.5 w-48">
                        <Search size={12} className="text-surface-500" />
                        <input 
                            type="text" 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="bg-transparent border-0 outline-0 p-0 text-[11px] text-white w-full focus:ring-0 focus:outline-none placeholder-surface-500"
                            placeholder="Search orders..."
                        />
                    </div>
                </div>

                {/* List & Detail Splitted layout */}
                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0">
                    {/* Orders List (6 cols on md) */}
                    <div className="md:col-span-6 border-b md:border-b-0 md:border-r border-surface-800/60 overflow-y-auto max-h-[480px]">
                        <div className="divide-y divide-surface-900">
                            {filteredOrders.map(order => {
                                const isSelected = order.id === selectedOrderId;
                                return (
                                    <div 
                                        key={order.id}
                                        onClick={() => setSelectedOrderId(order.id)}
                                        className={`p-3.5 flex flex-col gap-1 cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 border-l-2 border-primary' : 'hover:bg-surface-900/40'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-mono font-semibold text-white">{order.id}</span>
                                            <span className="text-[10px] text-surface-500">{order.date}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-surface-400 font-sans">{order.customer}</span>
                                            <span className={`chip chip-xs ${STATUS_COLORS[order.status]}`}>
                                                {order.status}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                            {filteredOrders.length === 0 && (
                                <div className="p-8 text-center text-xs text-surface-500">No orders found.</div>
                            )}
                        </div>
                    </div>

                    {/* Order Details Pane (6 cols on md) */}
                    <div className="md:col-span-6 bg-surface-900/20 p-4 flex flex-col justify-between overflow-y-auto max-h-[480px]">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between border-b border-surface-800/40 pb-2">
                                <span className="text-xs font-semibold text-white">Order Details</span>
                                <span className="text-[9px] font-mono text-surface-500">path: orders/{activeOrder.id}</span>
                            </div>

                            {/* Editable Fields */}
                            <div className="space-y-3">
                                {/* Customer Name Field */}
                                <div className="field min-h-[48px] px-3 pt-6 pb-2 flex flex-col">
                                    <span className="field-label text-primary">Customer name <span className="text-red-500">*</span></span>
                                    <input 
                                        type="text" 
                                        value={activeOrder.customer}
                                        onChange={(e) => handleUpdateCustomer(e.target.value)}
                                        className="bg-transparent border-0 outline-0 p-0 text-sm text-white font-sans focus:ring-0 focus:outline-none"
                                    />
                                </div>

                                {/* Status Select Field */}
                                <div className="field min-h-[48px] px-3 pt-6 pb-2 flex flex-col">
                                    <span className="field-label">Status</span>
                                    <div 
                                        onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                                        className="flex items-center justify-between cursor-pointer"
                                    >
                                        <span className={`chip chip-xs ${STATUS_COLORS[activeOrder.status]}`}>
                                            {activeOrder.status}
                                        </span>
                                        <ChevronDown size={14} className="text-surface-400" />
                                    </div>

                                    {showStatusDropdown && (
                                        <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-surface-950 border border-surface-800 rounded-lg shadow-xl overflow-hidden divide-y divide-surface-900">
                                            {STATUS_OPTIONS.map(opt => (
                                                <div 
                                                    key={opt}
                                                    onClick={() => handleUpdateStatus(opt)}
                                                    className="p-2 text-[10px] text-surface-300 hover:bg-surface-900 cursor-pointer flex items-center justify-between"
                                                >
                                                    {opt}
                                                    {activeOrder.status === opt && <Check size={12} className="text-emerald-400" />}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Order summary stats */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="field min-h-[48px] px-3 pt-6 pb-2">
                                        <span className="field-label">Total price</span>
                                        <div className="text-sm text-white font-mono">{activeOrder.total}</div>
                                    </div>
                                    <div className="field min-h-[48px] px-3 pt-6 pb-2">
                                        <span className="field-label">Items count</span>
                                        <div className="text-sm text-white font-mono">{activeOrder.items} items</div>
                                    </div>
                                </div>

                                {/* Address */}
                                <div className="field min-h-[48px] px-3 pt-6 pb-2">
                                    <span className="field-label">Shipping address</span>
                                    <div className="text-sm text-white">{activeOrder.address}</div>
                                </div>
                            </div>
                        </div>

                        {/* Interactive Hint */}
                        <div className="mt-4 pt-3 border-t border-surface-850 text-[10px] text-surface-500 leading-normal flex items-start gap-1.5">
                            <Play size={10} className="text-primary-light shrink-0 mt-0.5" />
                            <span>Try changing the <strong className="font-semibold text-surface-300">customer name</strong> or <strong className="font-semibold text-surface-300">status</strong> — the SDK call and the REST response on the right update live.</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* RIGHT SIDE: Live SDK & API Inspector (5 cols on lg) */}
            <div className="lg:col-span-5 flex flex-col h-full bg-[#0c0c0e]">
                {/* Tabs */}
                <div className="px-4 py-2.5 border-b border-surface-800 bg-[#0f0f11] flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider font-mono">Live API inspector</span>
                    
                    <div className="flex items-center gap-1 bg-surface-950 border border-surface-800 p-0.5 rounded-md">
                        <button 
                            onClick={() => setActiveInspectorTab("sdk")}
                            className={`px-2 py-1 text-[9px] font-mono font-semibold rounded flex items-center gap-1 cursor-pointer ${activeInspectorTab === "sdk" ? 'bg-primary/20 text-primary-light border border-primary/30' : 'text-surface-500 hover:text-surface-300'}`}
                        >
                            <Code size={10} />
                            TypeScript SDK
                        </button>
                        <button 
                            onClick={() => setActiveInspectorTab("json")}
                            className={`px-2 py-1 text-[9px] font-mono font-semibold rounded flex items-center gap-1 cursor-pointer ${activeInspectorTab === "json" ? 'bg-primary/20 text-primary-light border border-primary/30' : 'text-surface-500 hover:text-surface-300'}`}
                        >
                            <Globe size={10} />
                            Hono API Response
                        </button>
                    </div>
                </div>

                {/* Code viewport */}
                <div className="flex-1 p-5 font-mono text-[11px] leading-relaxed text-surface-300 overflow-auto bg-[#0a0a0c]">
                    {activeInspectorTab === "sdk" ? (
                        <pre className="whitespace-pre-wrap">
                            <span className="text-purple-400">import</span> &#123; <span className="text-blue-300">createRebaseClient</span> &#125; <span className="text-purple-400">from</span> <span className="text-green-400">"@rebasepro/client"</span>;{"\n\n"}
                            <span className="text-purple-400">const</span> client = <span className="text-blue-400">createRebaseClient</span>&lt;Database&gt;(&#123;{"\n"}
                            {"  "}baseUrl: <span className="text-green-400">"http://localhost:3001"</span>{"\n"}
                            &#125;);{"\n\n"}
                            <span className="text-surface-500">// 1. Fetch record</span>{"\n"}
                            <span className="text-purple-400">const</span> order = <span className="text-purple-400">await</span> client.data.orders.<span className="text-blue-300">findById</span>(<span className="text-green-400">"{activeOrder.id}"</span>);{"\n\n"}
                            <span className="text-surface-500">// 2. Perform type-safe update</span>{"\n"}
                            <span className="text-purple-400">await</span> client.data.orders.<span className="text-blue-300">update</span>(<span className="text-green-400">"{activeOrder.id}"</span>, &#123;{"\n"}
                            {"  "}customer: <span className="text-green-300 bg-green-500/5 px-1 rounded animate-pulse">"{activeOrder.customer}"</span>,{"\n"}
                            {"  "}status: <span className="text-green-300 bg-green-500/5 px-1 rounded animate-pulse">"{activeOrder.status}"</span>{"\n"}
                            &#125;);
                        </pre>
                    ) : (
                        <pre className="whitespace-pre-wrap text-emerald-400/90">
                            {jsonResponse.split("\n").map((line, idx) => {
                                // Highlight values that have changed
                                const isHighlighted = line.includes(`"${activeOrder.customer}"`) || line.includes(`"${activeOrder.status}"`);
                                return (
                                    <span key={idx} className={isHighlighted ? "text-emerald-300 bg-emerald-500/10 px-1 rounded animate-pulse" : ""}>
                                        {line}{"\n"}
                                    </span>
                                );
                            })}
                        </pre>
                    )}
                </div>

                {/* Footer details */}
                <div className="px-4 py-2 border-t border-surface-800/40 bg-surface-950/20 text-[10px] text-surface-500 font-mono flex items-center justify-between">
                    <span>Driver: pgvector + postgres</span>
                    <span>HTTPS 200 OK</span>
                </div>
            </div>

        </div>
    );
}
