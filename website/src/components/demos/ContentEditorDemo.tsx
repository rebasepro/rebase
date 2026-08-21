import React, { useState, useEffect, useCallback } from "react";
import {
    Filter, Pencil, MoreVertical, Image as ImageIcon, User, ChevronDown,
    Tag, Home, Moon, ChevronsRight, List, Folder,
    Search, Settings, Trash2, Plus, X, Maximize2, Code, Check, Copy,
    LayoutList, FileText, Languages
} from "lucide-react";

/* ─── Icon helper (same pattern as EntityViewDemo) ─── */
function MI({ children, size = 20, className = "" }: { children: string; size?: number; className?: string }) {
    const map: Record<string, React.ComponentType<{ size?: number }>> = {
        filter_list: Filter, edit: Pencil, more_vert: MoreVertical, image: ImageIcon,
        person: User, keyboard_arrow_down: ChevronDown, tag: Tag, home: Home,
        dark_mode: Moon, expand_more: ChevronDown, keyboard_double_arrow_right: ChevronsRight,
        format_list_bulleted: LayoutList, list: List, folder: Folder, sell: Tag,
        search: Search, settings: Settings, delete: Trash2, add: Plus, close: X,
        open_in_full: Maximize2, code: Code, check: Check, content_copy: Copy,
        file_text: FileText, translate: Languages,
    };
    const Comp = map[children] || Folder;
    return <span className={`inline-flex items-center justify-center select-none ${className}`}><Comp size={size} /></span>;
}

/* ─── Data ─── */
interface BlogPost {
    id: number; title: string; status: "Published" | "Draft" | "In Review";
    author: string; updated: string; wordCount: number;
}

const POSTS: BlogPost[] = [
    { id: 127, title: "Building a Modern CMS with Rebase", status: "Draft", author: "Francesco", updated: "2 min ago", wordCount: 847 },
    { id: 126, title: "Why PostgreSQL Beats Every NoSQL for Content", status: "Published", author: "Emily Watson", updated: "3 hours ago", wordCount: 1240 },
    { id: 125, title: "Schema-as-Code: The Future of Admin Panels", status: "Published", author: "Steve Rogers", updated: "Yesterday", wordCount: 920 },
    { id: 124, title: "Row-Level Security Made Simple", status: "In Review", author: "Alice Johnson", updated: "2 days ago", wordCount: 1580 },
    { id: 123, title: "Custom React Fields in 5 Minutes", status: "Published", author: "George C.", updated: "3 days ago", wordCount: 650 },
    { id: 122, title: "Migrating from Firebase to Postgres", status: "Draft", author: "Rachel Green", updated: "4 days ago", wordCount: 2100 },
    { id: 121, title: "The Art of Database Seeding", status: "Published", author: "Pam Beesly", updated: "5 days ago", wordCount: 780 },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    // CHIP_COLORS[hue + "Light"] in DARK mode — packages/ui/src/util/chip_colors.ts.
    // These held the light-mode stops, painted onto a black panel.
    Published: { bg: "#20c933", text: "#0b1d05" },
    "In Review": { bg: "#ff6f2c", text: "#581f10" },
    Draft: { bg: "#666666", text: "#eeeeee" },
};

/* ─── Editor Content (the Notion-style block content shown inside the form panel) ─── */
function EditorContent({ step }: { step: number }) {
    return (
        <div className="space-y-4 font-sans">
            <div className="text-2xl font-semibold text-surface-900 dark:text-white leading-tight">Building a Modern CMS with Rebase</div>
            <p className="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">
                Rebase gives your team a Notion-style editor that writes directly to Postgres. No more disconnected content tools — every block is stored as structured JSON.
            </p>

            {step >= 1 && (
                <div className="rounded-lg overflow-hidden border border-surface-200 dark:border-surface-700/50">
                    <img src="https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&h=300&fit=crop" alt="" className="w-full h-36 object-cover" loading="lazy" />
                    <div className="text-center text-[11px] text-surface-500 py-1.5 italic bg-surface-50 dark:bg-surface-900">Code-first schema definition</div>
                </div>
            )}

            {step >= 2 && (
                <>
                    <div className="text-lg font-semibold text-surface-900 dark:text-white">Key Features</div>
                    <div className="space-y-2">
                        {["Rich text with markdown shortcuts", "Slash commands for block insertion", "Drag-and-drop reordering", "Inline image uploads"].map((item, i) => (
                            <div key={i} className="flex items-center gap-2.5">
                                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${i < 3 || step >= 4 ? "bg-primary border-primary" : "border-surface-400 dark:border-surface-600"}`}>
                                    {(i < 3 || step >= 4) && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                </div>
                                <span className={`text-sm ${i < 3 || step >= 4 ? "text-surface-500 dark:text-surface-500 line-through" : "text-surface-700 dark:text-surface-300"}`}>{item}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {step >= 3 && (
                <blockquote className="border-l-3 border-primary/40 pl-4 py-1 text-sm text-surface-500 dark:text-surface-400 italic">
                    The best admin panel is the one your team actually wants to use.
                </blockquote>
            )}

            {step >= 5 && (
                <div className="bg-surface-100 dark:bg-surface-900 border border-surface-200 dark:border-surface-700/50 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-200 dark:border-surface-700/50">
                        <span className="text-[10px] font-mono text-surface-500">typescript</span>
                    </div>
                    <pre className="p-3 text-xs font-mono text-surface-600 dark:text-surface-300 overflow-x-auto leading-relaxed whitespace-pre">{`const blog = defineCollection({
  name: "blog_posts",
  properties: {
    title: { type: "string" },
    content: { type: "richtext" },
    status: { type: "enum",
      values: ["draft", "published"] }
  }
});`}</pre>
                </div>
            )}

            {step < 6 && (
                <div className="flex items-center h-5">
                    <span className="inline-block w-[2px] h-5 bg-primary animate-pulse" />
                </div>
            )}
        </div>
    );
}

/* ═══ MAIN COMPONENT ═══ */
export function ContentEditorDemo() {
    const [panelOpen, setPanelOpen] = useState(false);
    const [hoveredRow, setHoveredRow] = useState<number | null>(null);
    const [editorStep, setEditorStep] = useState(0);
    const [formDirty, setFormDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const NAV_ITEMS = [
        { icon: "folder", label: "POSTS", active: true },
        { icon: "person", label: "AUTHORS", active: false },
        { icon: "sell", label: "TAGS", active: false },
    ];

    useEffect(() => {
        let mounted = true;
        let timer: any;
        const wait = (ms: number) => new Promise<void>(r => { timer = setTimeout(r, ms); });
        const guard = () => mounted;

        const loop = async () => {
            while (mounted) {
                // Reset
                setPanelOpen(false); setHoveredRow(null); setEditorStep(0);
                setFormDirty(false); setIsSaving(false);
                await wait(600); if (!guard()) return;

                // Browse rows
                setHoveredRow(127); await wait(350); if (!guard()) return;
                setHoveredRow(126); await wait(300); if (!guard()) return;
                setHoveredRow(125); await wait(300); if (!guard()) return;
                setHoveredRow(127); await wait(400); if (!guard()) return;

                // Open post 127
                setPanelOpen(true); setHoveredRow(null);
                await wait(600); if (!guard()) return;

                // Editor content appears progressively
                setEditorStep(1); await wait(700); if (!guard()) return;
                setEditorStep(2); await wait(600); if (!guard()) return;
                setEditorStep(3); await wait(500); if (!guard()) return;
                setEditorStep(4); // check last task
                setFormDirty(true);
                await wait(500); if (!guard()) return;
                setEditorStep(5); await wait(700); if (!guard()) return;
                setEditorStep(6); await wait(500); if (!guard()) return;

                // Save
                setIsSaving(true); await wait(500); if (!guard()) return;
                setIsSaving(false); setFormDirty(false);
                await wait(800); if (!guard()) return;

                // Close
                setPanelOpen(false);
                await wait(500); if (!guard()) return;

                // Browse more
                setHoveredRow(124); await wait(300); if (!guard()) return;
                setHoveredRow(123); await wait(300); if (!guard()) return;
                setHoveredRow(122); await wait(300); if (!guard()) return;
                setHoveredRow(null);
                await wait(1000); if (!guard()) return;
            }
        };

        loop();
        return () => { mounted = false; clearTimeout(timer); };
    }, []);

    return (
        <div className="flex overflow-hidden bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-white pointer-events-none select-none relative" style={{ height: 520, width: "100%" }}>
            {/* ═══ Drawer ═══ */}
            <div className="z-20 relative hidden sm:block" style={{ width: 72 }}>
                <div className="h-full overflow-hidden relative bg-surface-900" style={{ width: 72 }}>
                    <div className="flex flex-col h-full">
                        <div className="flex items-center justify-center pt-4 pb-0 px-2">
                            <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px]">
                                <img src="/img/rebase_logo.svg" width="306" height="306" alt="Rebase" className="w-[28px] h-[28px] object-contain" />
                            </div>
                        </div>
                        <div className="mt-1 flex-grow overflow-hidden">
                            <div className="my-2 mx-2 flex flex-col">
                                <div className="overflow-hidden bg-surface-800/30 rounded-lg">
                                    {NAV_ITEMS.map(item => (
                                        <div key={item.label} className={`rounded-lg flex items-center h-10 ${item.active ? "bg-surface-800/50" : ""} text-surface-200`}>
                                            <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px] text-surface-400">
                                                <MI size={18}>{item.icon}</MI>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="shrink-0 mt-auto px-2 py-2">
                            <div className="flex items-center rounded-lg py-2">
                                <div className="shrink-0 flex items-center justify-center w-[56px] h-[24px] text-surface-400">
                                    <MI size={18}>keyboard_double_arrow_right</MI>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══ Main ═══ */}
            <main className="flex flex-col grow overflow-auto">
                <div className="border-surface-700/30 bg-surface-900 grow overflow-auto lg:mx-2 lg:mb-2 lg:rounded-lg lg:border flex flex-col">
                    {/* Toolbar */}
                    <div className="min-h-[44px] px-2 md:px-4 bg-surface-900 border-b border-surface-700/40 flex flex-row justify-between items-center shrink-0">
                        <div className="flex items-center gap-1">
                            <div className="flex items-center bg-surface-800 rounded-md p-0.5 gap-0.5">
                                <button className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-surface-500"><MI size={14}>format_list_bulleted</MI></button>
                                <button className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-surface-900 shadow-sm text-primary"><MI size={14}>list</MI><span>Table</span></button>
                            </div>
                            <button aria-label="Filter" className="p-1.5 rounded-full text-surface-500"><MI size={18}>filter_list</MI></button>
                        </div>
                        <div className="flex items-center gap-1">
                            <div className="flex items-center h-8 rounded-lg bg-surface-900 border border-surface-700/60 px-2.5 gap-1.5 min-w-[140px]">
                                <MI size={16} className="text-surface-400">search</MI>
                                <span className="text-xs text-surface-400">Search</span>
                            </div>
                            <button aria-label="Settings" className="p-1.5 text-surface-500"><MI size={18}>settings</MI></button>
                            <button className="flex items-center gap-1 min-h-[32px] px-2 rounded-lg border border-primary bg-primary text-white text-sm font-semibold tracking-wide"><MI size={18}>add</MI></button>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="h-full w-full flex flex-col bg-surface-950 overflow-auto">
                        {/* Header */}
                        <div className="sticky top-0 z-10 flex min-w-fit border-b border-surface-700/30 bg-surface-900" style={{ height: 40 }}>
                            <div className="flex-shrink-0 flex items-center justify-center px-3 text-xs uppercase font-semibold text-surface-400" style={{ width: 100 }}>ID</div>
                            <div className="flex-shrink-0 flex items-center px-3 text-xs uppercase font-semibold text-surface-400" style={{ width: 300 }}>
                                <MI size={14} className="opacity-60 mr-1">file_text</MI>Title
                            </div>
                            <div className="flex-shrink-0 flex items-center px-3 text-xs uppercase font-semibold text-surface-400" style={{ width: 120 }}>
                                <MI size={14} className="opacity-60 mr-1">list</MI>Status
                            </div>
                            <div className="flex-shrink-0 flex items-center px-3 text-xs uppercase font-semibold text-surface-400" style={{ width: 140 }}>
                                <MI size={14} className="opacity-60 mr-1">person</MI>Author
                            </div>
                            <div className="flex-shrink-0 flex items-center px-3 text-xs uppercase font-semibold text-surface-400" style={{ width: 100 }}>Updated</div>
                        </div>
                        {/* Rows */}
                        <div className="flex-1">
                            {POSTS.map(post => {
                                const isHovered = hoveredRow === post.id;
                                const sc = STATUS_COLORS[post.status];
                                return (
                                    <div key={post.id} className={`flex min-w-full text-sm border-b border-surface-700/30 cursor-pointer transition-colors ${isHovered ? "bg-surface-800/30" : ""}`} style={{ height: 48 }}>
                                        <div className="flex-shrink-0 flex items-center justify-center px-3 font-mono text-xs text-surface-500" style={{ width: 100 }}>
                                            <div className="flex items-center gap-1">
                                                <button className="p-0.5 rounded text-surface-500"><MI size={14}>edit</MI></button>
                                                <span>{post.id}</span>
                                            </div>
                                        </div>
                                        <div className="flex-shrink-0 flex items-center px-3 truncate text-white" style={{ width: 300 }}>{post.title}</div>
                                        <div className="flex-shrink-0 flex items-center px-3" style={{ width: 120 }}>
                                            <span className="chip font-normal" style={{ backgroundColor: sc.bg, color: sc.text }}>{post.status}</span>
                                        </div>
                                        <div className="flex-shrink-0 flex items-center px-3 text-surface-300 text-sm" style={{ width: 140 }}>{post.author}</div>
                                        <div className="flex-shrink-0 flex items-center px-3 text-surface-500 text-xs" style={{ width: 100 }}>{post.updated}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </main>

            {/* ═══ Overlay ═══ */}
            <div className="absolute inset-0 z-30 transition-opacity duration-200" style={{ backgroundColor: panelOpen ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0)", pointerEvents: "none" }} />

            {/* ═══ Side Panel ═══ */}
            <div
                className="absolute top-0 right-0 h-full w-[55%] max-w-[680px] min-w-[340px] z-40 bg-white dark:bg-surface-900 border-l border-surface-700/30 flex flex-col shadow-2xl transition-transform duration-300 ease-out"
                style={{ transform: panelOpen ? "translateX(0)" : "translateX(100%)" }}
            >
                {/* Panel top bar */}
                <div className="h-12 flex items-center px-3 border-b border-surface-700/30 shrink-0 gap-1">
                    <button className="p-1.5 rounded text-surface-400"><MI size={18}>close</MI></button>
                    <button className="p-1.5 rounded text-surface-400"><MI size={16}>open_in_full</MI></button>
                    <div className="flex-1" />
                    <button className="px-3 py-2 text-xs text-surface-500"><MI size={16}>code</MI></button>
                    <button className="px-3 py-2 text-xs text-white font-medium border-b-2 border-primary">Post</button>
                </div>

                {/* Panel body */}
                <div className="flex-1 overflow-y-auto">
                    <div className="flex flex-col w-full pt-4 pb-16 px-4 sm:px-6">
                        {/* Dirty badge */}
                        <div className="flex justify-end mb-2" style={{ minHeight: 22 }}>
                            {formDirty ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                                    <MI size={12}>edit</MI> Modified
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-800 text-surface-300 text-[10px] font-semibold">
                                    <MI size={12}>check</MI> Saved
                                </span>
                            )}
                        </div>

                        {/* Title field */}
                        <div className="field min-h-[48px] flex flex-col justify-center mb-3">
                            <span className="field-label text-primary">Title <span className="text-red-500">*</span></span>
                            <div className="px-3 pt-6 pb-2 text-sm text-surface-200">Building a Modern CMS with Rebase</div>
                        </div>

                        {/* Status field */}
                        <div className="field min-h-[48px] flex flex-col justify-center mb-3">
                            <span className="field-label">Status</span>
                            <div className="px-3 pt-6 pb-2 flex items-center justify-between">
                                <span className="chip" style={{ backgroundColor: STATUS_COLORS.Draft.bg, color: STATUS_COLORS.Draft.text }}>Draft</span>
                                <MI size={18} className="text-surface-400">expand_more</MI>
                            </div>
                        </div>

                        {/* Content (rich text) field — this is the star */}
                        <div className="field min-h-[200px] flex flex-col mb-3">
                            <span className="field-label">Content</span>
                            <div className="px-3 pt-6 pb-3">
                                <EditorContent step={editorStep} />
                            </div>
                        </div>

                        {/* Author field */}
                        <div className="field min-h-[48px] flex flex-col justify-center mb-3">
                            <span className="field-label">Author</span>
                            <div className="px-3 pt-6 pb-2 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <MI size={20} className="text-primary">person</MI>
                                    <div>
                                        <div className="text-sm font-medium text-white">Francesco</div>
                                        <div className="text-xs text-surface-500">francesco@rebase.pro</div>
                                    </div>
                                </div>
                                <MI size={18} className="text-surface-400">expand_more</MI>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Panel bottom bar */}
                <div className="flex items-center justify-between px-3 py-2.5 border-t border-surface-700/30 bg-surface-900 shrink-0">
                    <div className="flex items-center gap-1">
                        <button className="p-1.5 rounded text-surface-500"><MI size={16}>content_copy</MI></button>
                        <button className="p-1.5 rounded text-surface-500"><MI size={16}>delete</MI></button>
                    </div>
                    <div className="flex items-center gap-2">
                        <button className="min-h-[40px] px-3 rounded-lg border border-transparent text-primary text-sm font-semibold tracking-wide">Discard</button>
                        <button className={`min-h-[40px] px-3 rounded-lg border border-transparent text-sm font-semibold tracking-wide ${formDirty ? "text-primary" : "text-primary opacity-30"}`}>
                            {isSaving ? "Saving..." : "Save"}
                        </button>
                        <button className="min-h-[40px] px-3 rounded-lg border border-primary bg-primary text-white text-sm font-semibold tracking-wide">Save and close</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
