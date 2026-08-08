import React, { useEffect, useState } from "react";
import {
    Check,
    ChevronDown,
    ChevronUp,
    Code2,
    Globe,
    GripVertical,
    Image as ImageIcon,
    Layers,
    MessageSquare,
    Plus,
    Search,
    Settings,
    Tag,
    User
} from "lucide-react";
import { Chip } from "@rebasepro/ui";

/* ─── Mock Product Data ─── */
interface ProductItem {
    id: string;
    category: string;
    name: string;
    price: string;
    description: string;
    imageUrl: string;
}

const MOCK_PRODUCTS: ProductItem[] = [
    {
        id: "01",
        category: "Apparel",
        name: "Cowboy Hat",
        price: "85",
        description: "Premium black felt cowboy hat with stitched band.",
        imageUrl: "/img/product_cowboy_hat.webp"
    },
    {
        id: "02",
        category: "Apparel",
        name: "Minimal Logo Tee",
        price: "39",
        description: "100% organic cotton tee with glowing front design.",
        imageUrl: "/img/product_logo_tee.webp"
    },
    {
        id: "03",
        category: "Apparel",
        name: "Black Outline Tee",
        price: "45",
        description: "Classic crewneck featuring visual schematics outline.",
        imageUrl: "/img/product_logo_tee.webp"
    },
    {
        id: "04",
        category: "Accessories",
        name: "Logo Cap",
        price: "25",
        description: "Adjustable 6-panel strapback with silver embroidery.",
        imageUrl: "/img/product_logo_cap.webp"
    }
];

/* ─── Multiplayer User Data ─── */
interface UserRow {
    username: string;
    firstName: string;
    lastName: string;
    role: "admin" | "editor" | "viewer";
}

const MOCK_USERS: UserRow[] = [
    {
        username: "jmikrut",
        firstName: "James",
        lastName: "Mikrut",
        role: "admin"
    },
    {
        username: "tdavis",
        firstName: "Tylen",
        lastName: "Davis",
        role: "editor"
    },
    {
        username: "ncaminata",
        firstName: "Nate",
        lastName: "Caminata",
        role: "viewer"
    },
    {
        username: "universalthruth",
        firstName: "Sean",
        lastName: "Zubrickas",
        role: "viewer"
    }
];

/* ─── Collaborative Comments ─── */
interface FeedbackTicket {
    id: string;
    title: string;
    notes: string;
    tags: string[];
}

const MOCK_FEEDBACK: FeedbackTicket[] = [
    {
        id: "01",
        title: "Try other imagery",
        notes: "Let's improve imagery here. I'd like to see more captivating photography.",
        tags: ["Design", "Photography"]
    },
    {
        id: "02",
        title: "Check grammar in second paragraph",
        notes: "Verify the comma usage after the first clause in the intro block.",
        tags: ["Copywriting"]
    },
    {
        id: "03",
        title: "Love the call to action!",
        notes: "The glowing hover animation on the CTA button looks incredibly premium.",
        tags: ["Feedback"]
    }
];

/* ─── Cursor / Badge Helper Component ─── */
function FloatingCursor({
                            role,
                            colorClass,
                            left,
                            top,
                            pulse = false
                        }: {
    role: string;
    colorClass: string;
    left: string;
    top: string;
    pulse?: boolean;
}) {
    const colorMap: Record<string, { bg: string; text: string; border: string; fill: string }> = {
        purple: {
            bg: "bg-[#8b5cf6]",
            text: "text-white",
            border: "border-[#a78bfa]",
            fill: "#8b5cf6"
        },
        teal: {
            bg: "bg-[#0d9488]",
            text: "text-white",
            border: "border-[#2dd4bf]",
            fill: "#0d9488"
        },
        red: {
            bg: "bg-[#dc2626]",
            text: "text-white",
            border: "border-[#f87171]",
            fill: "#dc2626"
        },
        blue: {
            bg: "bg-[#2563eb]",
            text: "text-white",
            border: "border-[#60a5fa]",
            fill: "#2563eb"
        },
        orange: {
            bg: "bg-[#ea580c]",
            text: "text-white",
            border: "border-[#fb923c]",
            fill: "#ea580c"
        }
    };

    const currentColors = colorMap[colorClass] || colorMap.purple;

    return (
        <div
            className={"absolute transition-all duration-700 ease-in-out pointer-events-none z-30 flex flex-col gap-1 items-start"}
            style={{
                left,
                top
            }}
        >
            <div
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${currentColors.bg} ${currentColors.text} ${currentColors.border} shadow-lg whitespace-nowrap ${pulse ? "animate-pulse" : ""}`}>
                {role}
            </div>
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill={currentColors.fill}
                className="-mt-0.5 ml-1 drop-shadow-md"
            >
                <path d="M4 4l16 11-8 2-6 7V4z"/>
            </svg>
        </div>
    );
}

/* ─── MAIN MOSAIC DEMO ─── */
export default function RebaseMosaicDemo() {
    const [tick, setTick] = useState(0);

    // Auto animation loop running every 4 seconds
    useEffect(() => {
        const timer = setInterval(() => {
            setTick((prev) => (prev + 1) % 6);
        }, 4000);
        return () => clearInterval(timer);
    }, []);

    // Compute states based on timeline tick (0 to 5)
    // E-commerce card selection
    const activeProductIndex = tick === 2 || tick === 3 ? 3 : 1; // 1 is Minimal Logo Tee, 3 is Logo Cap

    // Notion Editor Animation States
    const isCheckboxChecked = tick >= 1 && tick <= 4;
    const showSlashMenu = tick === 2;
    const showCalloutBlock = tick === 3 || tick === 4;

    // Slash command text typing simulation
    const slashInputText =
        tick === 1 ? "/" :
            tick === 2 ? "/callout" :
                "";

    // Users table active editors
    const activeUserRowIndex = tick % 4; // Cycles multiplayer highlighting

    // DAM tab & image focus
    const activeDamTab = tick === 2 || tick === 3 ? "instagram" : "assets";

    // Live preview text updating
    const livePreviewTexts = [
        "Live Preview: render your front-end",
        "Live Preview: render your front-end directly in the Admin Panel",
        "Live Preview: render your front-end directly in the Admin Panel",
        "Live Preview: render your front-end",
        "Live Preview: render your front-end directly in the Admin Panel",
        "Live Preview: render your front-end directly in the Admin Panel"
    ];
    const currentLivePreviewText = livePreviewTexts[tick];

    // Feedback ticket expansion
    const expandedTicketId = tick === 2 || tick === 3 ? "02" : tick === 5 ? "03" : "01";

    // Floating cursor positions based on tick
    const cursorCoords = {
        marketer: {
            left: tick === 0 ? "14%" : tick === 1 ? "24%" : tick === 2 ? "28%" : tick === 3 ? "32%" : tick === 4 ? "48%" : "82%",
            top: tick === 0 ? "43%" : tick === 1 ? "52%" : tick === 2 ? "68%" : tick === 3 ? "78%" : tick === 4 ? "82%" : "35%"
        },
        productOwner: {
            left: activeUserRowIndex === 0 ? "42%" : activeUserRowIndex === 1 ? "45%" : activeUserRowIndex === 2 ? "38%" : "48%",
            top: activeUserRowIndex === 0 ? "45%" : activeUserRowIndex === 1 ? "60%" : activeUserRowIndex === 2 ? "74%" : "86%"
        },
        developer: {
            left: tick === 3 ? "45%" : "32%",
            top: tick === 3 ? "65%" : "52%"
        },
        client: {
            left: tick === 1 || tick === 4 ? "78%" : "68%",
            top: tick === 1 || tick === 4 ? "42%" : "55%"
        },
        designer: {
            left: expandedTicketId === "01" ? "32%" : expandedTicketId === "02" ? "28%" : "36%",
            top: expandedTicketId === "01" ? "42%" : expandedTicketId === "02" ? "58%" : "82%"
        }
    };

    return (
        <div className="w-full relative select-none">
            {/* Background Radial Glow */}
            <div className="absolute inset-0 pointer-events-none -z-10" aria-hidden="true"
                 style={{ background: "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(0, 112, 244, 0.08) 0%, rgba(0, 80, 200, 0.03) 50%, transparent 100%)" }}/>

            {/* Main Grid Layout - 3 Columns responsive */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full text-neutral-200">

                {/* ========================================================
            COLUMN 1: E-COMMERCE & RICH TEXT EDITOR
            ======================================================== */}
                <div className="flex flex-col gap-6">

                    {/* Card 1: E-commerce Product Form */}
                    <div
                        className="group relative overflow-hidden rounded-2xl border border-neutral-800/80 bg-neutral-950/80 shadow-[0_4px_30px_rgba(0,0,0,0.45)] backdrop-blur-md hover:border-primary/30 transition-colors duration-300">
                        {/* Window header */}
                        <div
                            className="flex items-center justify-between px-4 py-3 border-b border-neutral-800/80 bg-neutral-900/30">
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-neutral-700"></span>
                                <span className="w-2 h-2 rounded-full bg-neutral-700"></span>
                                <span className="w-2 h-2 rounded-full bg-neutral-700"></span>
                            </div>
                            <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">ecommerce / products</span>
                            <Settings size={12} className="text-neutral-600"/>
                        </div>

                        {/* Content area */}
                        <div className="p-4 space-y-3 h-[375px] overflow-hidden">
                            {MOCK_PRODUCTS.map((prod, index) => {
                                const isActive = index === activeProductIndex;
                                return (
                                    <div
                                        key={prod.id}
                                        className={`rounded-xl border transition-all duration-300 ${
                                            isActive
                                                ? "border-primary/40 bg-neutral-900/40"
                                                : "border-neutral-800/50 bg-neutral-950/40 hover:bg-neutral-900/20"
                                        }`}
                                    >
                                        {/* Collapsed Header */}
                                        <div
                                            className={`flex items-center justify-between px-3 py-2.5 cursor-pointer ${
                                                isActive ? "border-b border-neutral-800/50" : ""
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                        <span
                            className="text-[10px] font-mono bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 rounded text-neutral-400">
                          {prod.id}
                        </span>
                                                <span
                                                    className="text-xs font-medium text-neutral-500">{prod.category}</span>
                                                <span
                                                    className="text-xs font-semibold text-neutral-200">{prod.name}</span>
                                            </div>
                                            {isActive ? <ChevronUp size={14} className="text-neutral-500"/> :
                                                <ChevronDown size={14} className="text-neutral-500"/>}
                                        </div>

                                        {/* Expanded Detail Panel */}
                                        {isActive && (
                                            <div className="p-3 space-y-3 text-xs">
                                                {/* Name Input */}
                                                <div
                                                    className="relative rounded-lg bg-neutral-950/70 border border-neutral-800/60 p-2">
                                                    <span
                                                        className="absolute top-1 left-2 text-[9px] font-semibold text-primary uppercase tracking-wider">Product Name</span>
                                                    <div
                                                        className="pt-3 pb-0.5 font-medium text-neutral-200">{prod.name}</div>
                                                </div>

                                                {/* Price & Image Preview */}
                                                <div className="grid grid-cols-3 gap-2">
                                                    {/* Price input */}
                                                    <div
                                                        className="col-span-1 relative rounded-lg bg-neutral-950/70 border border-neutral-800/60 p-2">
                                                        <span
                                                            className="absolute top-1 left-2 text-[9px] font-semibold text-neutral-500 uppercase tracking-wider">Price ($)</span>
                                                        <div
                                                            className="pt-3 pb-0.5 font-medium text-neutral-200">{prod.price}</div>
                                                    </div>
                                                    {/* Image preview grid */}
                                                    <div
                                                        className="col-span-2 rounded-lg bg-neutral-950/70 border border-neutral-800/60 p-1 flex items-center justify-center relative overflow-hidden">
                                                        <img
                                                            src={prod.imageUrl}
                                                            alt={prod.name}
                                                            className="h-10 w-auto object-contain drop-shadow-md rounded"
                                                        />
                                                        <div
                                                            className="absolute right-1 bottom-1 text-[8px] bg-neutral-900 border border-neutral-800 px-1 rounded text-neutral-400">
                                                            Preview
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Variants selector dropdown */}
                                                <div
                                                    className="relative rounded-lg bg-neutral-950/70 border border-neutral-800/60 p-2 flex items-center justify-between">
                                                    <div>
                                                        <span
                                                            className="absolute top-1 left-2 text-[9px] font-semibold text-neutral-500 uppercase tracking-wider">Variants</span>
                                                        <div className="pt-3 pb-0.5 text-neutral-400">Select
                                                            options...
                                                        </div>
                                                    </div>
                                                    <ChevronDown size={14} className="text-neutral-500"/>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Card 2: Notion-style Rich Text Editor */}
                    <div
                        className="group relative overflow-hidden rounded-2xl border border-neutral-800/80 bg-neutral-950/80 shadow-[0_4px_30px_rgba(0,0,0,0.45)] backdrop-blur-md hover:border-primary/30 transition-colors duration-300">
                        {/* Window header */}
                        <div
                            className="flex items-center justify-between px-4 py-3 border-b border-neutral-800/80 bg-neutral-900/30">
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-neutral-700"></span>
                                <span className="w-2 h-2 rounded-full bg-neutral-700"></span>
                                <span className="w-2 h-2 rounded-full bg-neutral-700"></span>
                            </div>
                            <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">editor / notion_docs</span>
                            <Settings size={12} className="text-neutral-600"/>
                        </div>

                        {/* Editor content block (clean Notion style) */}
                        <div className="p-5 relative h-[250px] overflow-hidden">
                            {/* Floating Marketer Cursor */}
                            <FloatingCursor
                                role="Marketer"
                                colorClass="purple"
                                left={cursorCoords.marketer.left}
                                top={cursorCoords.marketer.top}
                            />

                            {/* Document Header */}
                            <div className="mb-4">
                                <div
                                    className="text-[9px] font-mono text-neutral-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <span>workspace</span>
                                    <span className="text-neutral-700">/</span>
                                    <span>docs</span>
                                    <span className="text-neutral-700">/</span>
                                    <span className="text-neutral-400">spec</span>
                                </div>
                                <div className="text-lg font-semibold text-white font-sans">Rebase Setup Spec</div>
                            </div>

                            {/* Block elements list */}
                            <div
                                className="text-xs leading-relaxed text-neutral-300 font-sans space-y-3.5 pl-6 relative">

                                {/* Paragraph Block */}
                                <div className="group/block relative">
                                    {/* Notion-style block controls on hover */}
                                    <div
                                        className="absolute -left-6 top-0.5 flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity duration-250">
                                        <Plus size={9}
                                              className="text-neutral-600 hover:text-neutral-400 cursor-pointer"/>
                                        <GripVertical size={9} className="text-neutral-600 cursor-grab"/>
                                    </div>
                                    <p className="text-neutral-400">
                                        Rebase connects directly to Postgres, autogenerating a Notion-style block editor
                                        and type-safe Client SDK methods.
                                    </p>
                                </div>

                                {/* To-do list Block */}
                                <div className="group/block relative flex items-start gap-2">
                                    <div
                                        className="absolute -left-6 top-0.5 flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity duration-250">
                                        <Plus size={9}
                                              className="text-neutral-600 hover:text-neutral-400 cursor-pointer"/>
                                        <GripVertical size={9} className="text-neutral-600 cursor-grab"/>
                                    </div>
                                    <div className="flex items-center h-4 mt-0.5">
                                        <div
                                            className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all duration-300 ${isCheckboxChecked ? "bg-primary border-primary" : "border-neutral-700 bg-neutral-950"}`}>
                                            {isCheckboxChecked &&
                                                <Check size={10} className="text-white stroke-[3px]"/>}
                                        </div>
                                    </div>
                                    <span
                                        className={`transition-all duration-300 ${isCheckboxChecked ? "line-through text-neutral-500 font-normal" : "text-neutral-300"}`}>
                    Connect existing Postgres tables
                  </span>
                                </div>

                                {/* Slash input block or Callout block */}
                                <div className="group/block relative min-h-[20px]">
                                    <div
                                        className="absolute -left-6 top-0.5 flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity duration-250">
                                        <Plus size={9}
                                              className="text-neutral-600 hover:text-neutral-400 cursor-pointer"/>
                                        <GripVertical size={9} className="text-neutral-600 cursor-grab"/>
                                    </div>

                                    {!showCalloutBlock ? (
                                        <div className="flex items-center h-5">
                                            {slashInputText ? (
                                                <div
                                                    className="flex items-center text-primary-light font-mono font-medium">
                                                    {slashInputText}
                                                    <span className="w-[1.5px] h-3.5 bg-primary animate-pulse ml-0.5"/>
                                                </div>
                                            ) : (
                                                <span
                                                    className="text-neutral-600 italic">Type '/' for block commands...</span>
                                            )}
                                        </div>
                                    ) : (
                                        /* Notion-style Callout Box */
                                        <div
                                            className="flex gap-2.5 rounded-xl border border-neutral-800/85 bg-neutral-900/30 p-3 text-xs text-neutral-300 animate-in zoom-in-95 duration-200">
                                            <span className="text-base select-none">💡</span>
                                            <div>
                                                <span
                                                    className="font-semibold text-neutral-200">Rebase Tip:</span> Every
                                                block in this editor is stored as structured JSON.
                                            </div>
                                        </div>
                                    )}

                                    {/* Notion-style slash dropdown menu */}
                                    {showSlashMenu && (
                                        <div
                                            className="absolute top-6 left-2 bg-neutral-900 border border-neutral-800 rounded-lg shadow-2xl p-1 w-44 z-20 animate-in fade-in slide-in-from-top-1 duration-200">
                                            <div
                                                className="px-2 py-1 text-[8px] font-semibold text-neutral-500 uppercase tracking-wider">Basic
                                                Blocks
                                            </div>

                                            <div
                                                className="bg-neutral-800/70 hover:bg-neutral-800 rounded flex items-center p-1 gap-2 border border-neutral-700/50">
                                                <div className="bg-primary/10 rounded p-1 border border-primary/20">
                                                    <Layers size={10} className="text-primary"/>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] font-medium text-white">Callout</span>
                                                    <span
                                                        className="text-[7px] text-neutral-400">Info box with emoji</span>
                                                </div>
                                            </div>

                                            <div className="rounded flex items-center p-1 gap-2 opacity-50">
                                                <div className="bg-neutral-950 rounded p-1 border border-neutral-850">
                                                    <Code2 size={10} className="text-neutral-500"/>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span
                                                        className="text-[9px] font-medium text-neutral-300">Code Block</span>
                                                    <span className="text-[7px] text-neutral-500">Syntax-highlighted code</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                            </div>
                        </div>
                    </div>

                </div>

                {/* ========================================================
            COLUMN 2: MULTIPLAYER USERS, CODE BLOCK, DAM ASSETS
            ======================================================== */}
                <div className="flex flex-col gap-6">

                    {/* Card 3: Users Table (Multiplayer Admin) */}
                    <div
                        className="group relative overflow-hidden rounded-2xl border border-neutral-800/80 bg-neutral-950/80 shadow-[0_4px_30px_rgba(0,0,0,0.45)] backdrop-blur-md hover:border-primary/30 transition-colors duration-300">
                        {/* Header */}
                        <div className="p-4 pb-2 flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-semibold text-neutral-100 flex items-center gap-1.5">
                                    <User size={14} className="text-primary"/> Users
                                </h3>
                            </div>
                            <button
                                className="flex items-center gap-1 px-2 py-1 rounded-md bg-neutral-900 border border-neutral-800 text-[10px] font-semibold text-neutral-300 hover:text-white transition-colors">
                                <Plus size={10}/> Create New
                            </button>
                        </div>

                        {/* Search Input bar */}
                        <div className="px-4 pb-3">
                            <div
                                className="flex items-center gap-2 rounded-lg bg-neutral-900/50 border border-neutral-800 px-2.5 py-1 text-[11px] text-neutral-500">
                                <Search size={12}/>
                                <span>Search by username...</span>
                            </div>
                        </div>

                        {/* Users grid table */}
                        <div className="overflow-x-auto relative min-h-[175px]">
                            {/* Floating Product Owner Cursor */}
                            <FloatingCursor
                                role="Product Owner"
                                colorClass="teal"
                                left={cursorCoords.productOwner.left}
                                top={cursorCoords.productOwner.top}
                                pulse={true}
                            />

                            <table className="w-full text-left border-collapse text-[11px]">
                                <thead>
                                <tr className="border-b border-neutral-800 text-neutral-500">
                                    <th className="px-4 py-2 font-semibold">Username</th>
                                    <th className="px-3 py-2 font-semibold">First Name</th>
                                    <th className="px-3 py-2 font-semibold">Last Name</th>
                                    <th className="px-4 py-2 font-semibold">Role</th>
                                </tr>
                                </thead>
                                <tbody>
                                {MOCK_USERS.map((user, idx) => {
                                    const isPoEditingRow = idx === activeUserRowIndex;
                                    return (
                                        <tr
                                            key={user.username}
                                            className={`border-b border-neutral-900/50 transition-colors duration-300 ${
                                                isPoEditingRow ? "bg-teal-950/20 text-teal-200" : ""
                                            }`}
                                        >
                                            <td className="px-4 py-2.5 font-mono text-neutral-400">
                                                <div className="flex items-center gap-1.5">
                                                    <span
                                                        className={`w-1.5 h-1.5 rounded-full ${isPoEditingRow ? "bg-teal-400 animate-pulse" : "bg-neutral-800"}`}/>
                                                    {user.username}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2.5">{user.firstName}</td>
                                            <td className="px-3 py-2.5">{user.lastName}</td>
                                            <td className="px-4 py-2.5">
                                                <Chip
                                                    colorScheme={user.role === "admin" ? "red" : user.role === "editor" ? "yellow" : "gray"}
                                                    outlined
                                                    size="smallest"
                                                    className="uppercase font-medium tracking-wider text-[9px]"
                                                >
                                                    {user.role}
                                                </Chip>
                                            </td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Card 4: TypeScript Code Block */}
                    <div
                        className="group relative overflow-hidden rounded-2xl border border-neutral-800/80 bg-[#0b0c10] shadow-[0_4px_30px_rgba(0,0,0,0.5)] font-mono text-[11px] leading-relaxed p-4 hover:border-primary/30 transition-colors duration-300">
                        {/* Floating Developer Cursor */}
                        <FloatingCursor
                            role="Developer"
                            colorClass="red"
                            left={cursorCoords.developer.left}
                            top={cursorCoords.developer.top}
                        />

                        {/* Code syntax */}
                        <pre className="text-neutral-400">
              <span className="text-purple-400">import</span> &#123; createRebaseClient &#125; <span
                            className="text-purple-400">from</span> <span
                            className="text-green-400">"@rebasepro/client"</span>;{"\n"}
                            {"\n"}
                            <span className="text-purple-400">const</span> client = <span
                            className="text-blue-400">createRebaseClient</span>(&#123;{"\n"}
                            {"  "}baseUrl: <span className="text-green-400">"http://localhost:3001"</span>{"\n"}
                            &#125;);{"\n"}
                            {"\n"}
                            <span className="text-neutral-500">// Query active posts in real-time</span>{"\n"}
                            <span className="text-purple-400">const</span> posts = <span
                            className="text-purple-400">await</span> client.<span className="text-teal-400">data</span>.<span
                            className="text-blue-400">posts</span>{"\n"}
                            {"  "}.<span className="text-teal-400">where</span>(<span
                            className="text-green-400">"status"</span>, <span
                            className="text-green-400">"=="</span>, <span
                            className="text-green-400">"active"</span>){"\n"}
                            <span
                                className={`transition-all duration-300 ${tick === 3 ? "text-green-300 bg-green-500/10 border-l border-green-500 pl-1 animate-pulse" : "opacity-0 select-none pointer-events-none"}`}>
                {"  "}.<span className="text-teal-400">orderBy</span>(<span
                                className="text-green-400">"createdAt"</span>, <span
                                className="text-green-400">"desc"</span>){"\n"}
              </span>
                            {"  "}.<span className="text-teal-400">limit</span>(<span
                            className="text-amber-400">10</span>){"\n"}
                            {"  "}.<span className="text-teal-400">find</span>();{"\n"}
            </pre>
                    </div>

                    {/* Card 5: Digital Asset Manager */}
                    <div
                        className="group relative overflow-hidden rounded-2xl border border-neutral-800/80 bg-neutral-950/80 shadow-[0_4px_30px_rgba(0,0,0,0.45)] backdrop-blur-md hover:border-primary/30 transition-colors duration-300">
                        {/* Header tabs */}
                        <div
                            className="flex border-b border-neutral-800 text-[10px] font-semibold text-neutral-500 uppercase tracking-wider bg-neutral-900/30">
                            <button
                                className={`flex-1 py-2 text-center border-r border-neutral-800 hover:text-neutral-300 transition-colors ${activeDamTab === "instagram" ? "bg-neutral-900 text-primary-light" : ""}`}>
                                Instagram Posts
                            </button>
                            <button
                                className="flex-1 py-2 text-center border-r border-neutral-800 hover:text-neutral-300 transition-colors">
                                Twitter Posts
                            </button>
                            <button
                                className={`flex-1 py-2 text-center hover:text-neutral-300 transition-colors ${activeDamTab === "assets" ? "bg-neutral-900 text-primary-light" : ""}`}>
                                Brand Assets
                            </button>
                        </div>

                        {/* Folder contents */}
                        <div className="p-4">
                            <div className="grid grid-cols-3 gap-3">
                                {/* File 1: Wavy blue abstract */}
                                <div
                                    className="rounded-xl border border-neutral-800/60 bg-neutral-950/40 p-1 hover:border-primary/20 transition-all duration-300">
                                    <div className="aspect-[4/3] rounded-lg overflow-hidden bg-neutral-900 relative">
                                        <img
                                            src="/img/dam_asset_blue.webp"
                                            alt="DAM Blue Fluid"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                    <div className="p-1.5 text-[9px] font-medium text-neutral-400 truncate">bg-1.jpg
                                    </div>
                                </div>

                                {/* File 2: Wavy gold abstract */}
                                <div
                                    className="rounded-xl border border-neutral-800/60 bg-neutral-950/40 p-1 hover:border-primary/20 transition-all duration-300">
                                    <div className="aspect-[4/3] rounded-lg overflow-hidden bg-neutral-900 relative">
                                        <img
                                            src="/img/dam_asset_gold.webp"
                                            alt="DAM Gold Fluid"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                    <div className="p-1.5 text-[9px] font-medium text-neutral-400 truncate">bg-2.jpg
                                    </div>
                                </div>

                                {/* File 3: Wavy green abstract */}
                                <div
                                    className="rounded-xl border border-neutral-800/60 bg-neutral-950/40 p-1 hover:border-primary/20 transition-all duration-300">
                                    <div className="aspect-[4/3] rounded-lg overflow-hidden bg-neutral-900 relative">
                                        <img
                                            src="/img/dam_asset_green.webp"
                                            alt="DAM Green Fluid"
                                            className="w-full h-full object-cover"
                                        />
                                    </div>
                                    <div className="p-1.5 text-[9px] font-medium text-neutral-400 truncate">bg-3.jpg
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>

                {/* ========================================================
            COLUMN 3: LIVE PREVIEW & FEEDBACK/COMMENTS
            ======================================================== */}
                <div className="flex flex-col gap-6">

                    {/* Card 6: Live Preview Visual Editor */}
                    <div
                        className="group relative overflow-hidden rounded-2xl border border-neutral-800/80 bg-neutral-950/80 shadow-[0_4px_30px_rgba(0,0,0,0.45)] backdrop-blur-md hover:border-primary/30 transition-colors duration-300">
                        {/* Header */}
                        <div
                            className="flex items-center justify-between px-4 py-3 border-b border-neutral-800/80 bg-neutral-900/30">
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-neutral-700"></span>
                                <span className="w-2 h-2 rounded-full bg-neutral-700"></span>
                                <span className="w-2 h-2 rounded-full bg-neutral-700"></span>
                            </div>
                            <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">visual / live preview</span>
                            <Globe size={12} className="text-neutral-600 animate-pulse"/>
                        </div>

                        {/* Split Screen Container */}
                        <div className="grid grid-cols-2 h-[220px] overflow-hidden relative">
                            {/* Floating Client Cursor */}
                            <FloatingCursor
                                role="Client"
                                colorClass="blue"
                                left={cursorCoords.client.left}
                                top={cursorCoords.client.top}
                            />

                            {/* Left Column: Form Fields Panel */}
                            <div className="border-r border-neutral-800 p-3 space-y-3 bg-neutral-950/30 text-[10px]">
                                {/* Title field */}
                                <div className="relative rounded bg-neutral-900/50 border border-neutral-800 p-1.5">
                                    <span className="text-[8px] font-semibold text-neutral-500 uppercase">Page Title</span>
                                    <div
                                        className="pt-1 font-medium text-neutral-300 leading-normal truncate">{currentLivePreviewText}</div>
                                </div>

                                {/* Status field */}
                                <div
                                    className="relative rounded bg-neutral-900/50 border border-neutral-800 p-1.5 flex items-center justify-between">
                                    <div>
                                        <span className="text-[8px] font-semibold text-neutral-500 uppercase">Status</span>
                                        <div className="pt-0.5 font-medium text-emerald-400">Published</div>
                                    </div>
                                    <Check size={10} className="text-emerald-500"/>
                                </div>

                                {/* Banner image selector */}
                                <div
                                    className="relative rounded bg-neutral-900/50 border border-neutral-800 p-1.5 flex items-center gap-2">
                                    <ImageIcon size={14} className="text-neutral-600"/>
                                    <div className="truncate">
                                        <span
                                            className="text-[8px] font-semibold text-neutral-500 uppercase block leading-none">Banner Image</span>
                                        <span className="text-neutral-400">banner.webp</span>
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Rendered Webpage Preview */}
                            <div
                                className="p-3 bg-gradient-to-br from-neutral-950 to-neutral-900 flex flex-col justify-center items-center relative group-hover:shadow-[inset_0_0_20px_rgba(0,112,244,0.05)]">
                                {/* Overlay bounding box indicating selected block */}
                                <div
                                    className="absolute inset-2 border border-dashed border-primary/40 rounded-lg pointer-events-none animate-pulse"/>

                                <div className="text-center space-y-1.5 max-w-[130px]">
                                    <h4 className="text-[10px] font-semibold tracking-tight text-white leading-tight">
                                        {currentLivePreviewText}
                                    </h4>
                                    <div className="h-0.5 w-6 bg-primary mx-auto rounded"/>
                                    <p className="text-[8px] text-neutral-500 leading-normal">
                                        Real-time frontend visual synchronization.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Card 7: Collaborative Comments / Feedback Accordion */}
                    <div
                        className="group relative overflow-hidden rounded-2xl border border-neutral-800/80 bg-neutral-950/80 shadow-[0_4px_30px_rgba(0,0,0,0.45)] backdrop-blur-md hover:border-primary/30 transition-colors duration-300">
                        {/* Floating Designer Cursor */}
                        <FloatingCursor
                            role="Designer"
                            colorClass="orange"
                            left={cursorCoords.designer.left}
                            top={cursorCoords.designer.top}
                        />

                        {/* Header */}
                        <div className="p-4 pb-2 border-b border-neutral-800/60 bg-neutral-900/10">
                            <h3 className="text-sm font-semibold text-neutral-100 flex items-center gap-1.5">
                                <MessageSquare size={14} className="text-primary"/> Feedback
                            </h3>
                        </div>

                        {/* Accordion Tickets */}
                        <div className="p-4 space-y-3 h-[230px] overflow-hidden">
                            {MOCK_FEEDBACK.map((ticket) => {
                                const isExpanded = ticket.id === expandedTicketId;
                                return (
                                    <div
                                        key={ticket.id}
                                        className={`rounded-xl border transition-all duration-300 ${
                                            isExpanded
                                                ? "border-orange-500/30 bg-neutral-900/40"
                                                : "border-neutral-800/50 bg-neutral-950/40 hover:bg-neutral-900/20"
                                        }`}
                                    >
                                        {/* Collapsed view header */}
                                        <div className="flex items-center justify-between px-3 py-2 cursor-pointer">
                                            <div className="flex items-center gap-3">
                        <span
                            className="text-[9px] font-mono bg-neutral-900 border border-neutral-800 px-1 py-0.5 rounded text-neutral-400">
                          {ticket.id}
                        </span>
                                                <span
                                                    className="text-[11px] font-semibold text-neutral-200 truncate max-w-[170px]">
                          {ticket.title}
                        </span>
                                            </div>
                                            {isExpanded ? <ChevronUp size={12} className="text-neutral-500"/> :
                                                <ChevronDown size={12} className="text-neutral-500"/>}
                                        </div>

                                        {/* Expanded Detail Note */}
                                        {isExpanded && (
                                            <div
                                                className="px-3 pb-3 pt-0 text-[10px] space-y-2 border-t border-neutral-800/50 pt-2 bg-neutral-950/20">
                                                <p className="text-neutral-400 leading-normal">{ticket.notes}</p>

                                                {/* Tags */}
                                                <div className="flex flex-wrap gap-1.5 pt-1">
                                                    {ticket.tags.map((tag) => (
                                                        <span key={tag}
                                                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 text-[9px] border border-neutral-700/50">
                              <Tag size={8}/> {tag}
                            </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Add Feedback button */}
                            <button
                                className="w-full flex items-center justify-center gap-1 py-2 border border-dashed border-neutral-800 hover:border-neutral-700 rounded-xl text-[10px] text-neutral-500 hover:text-neutral-400 transition-colors">
                                <Plus size={10}/> Add Feedback Ticket
                            </button>
                        </div>
                    </div>

                </div>

            </div>
        </div>
    );
}
