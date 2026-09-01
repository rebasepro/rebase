import React, { useState } from "react";
import { SchemaBuilderMiniDemo } from "./SchemaBuilderMiniDemo";
import { SdkMiniDemo } from "./SdkMiniDemo";
import { ApiMiniDemo } from "./ApiMiniDemo";
import { CustomFieldsDemo } from "./CustomFieldsDemo";
import { RLSEditorDemo } from "./RLSEditorDemo";

type TabId = "schema" | "sdk" | "fields" | "security";

interface TabConfig {
    id: TabId;
    title: string;
    description: string;
    badge: string;
    icon: React.ReactNode;
}

export function DeveloperPlayground() {
    const [activeTab, setActiveTab] = useState<TabId>("schema");
    const [schemaSyncing, setSchemaSyncing] = useState(false);
    const [schemaStatus, setSchemaStatus] = useState<"diverged" | "syncing" | "synced">("diverged");

    const tabs: TabConfig[] = [
        {
            id: "schema",
            title: "Schema-as-Code",
            description: "Define database models in pure TypeScript. Run visual schema updates with automated AST mutations written straight back to your codebase.",
            badge: "AST Mutation",
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
            )
        },
        {
            id: "sdk",
            title: "Type-Safe SDK",
            description: "Interact with your database using an isomorphic client. Benefit from deep relational queries, zero N+1 issues, and perfect autocomplete.",
            badge: "Universal Client",
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
            )
        },
        {
            id: "fields",
            title: "Custom Fields",
            description: "Build custom form inputs or complex widgets using standard React. Plug them directly into document fields without proprietary languages.",
            badge: "React Extensible",
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
            )
        },
        {
            id: "security",
            title: "Visual Security",
            description: "Write row-level security (RLS) policies visually in Rebase Studio. Presets generate clean, indexable SQL conditions.",
            badge: "Postgres RLS",
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
            )
        }
    ];

    const runSchemaSync = () => {
        setSchemaSyncing(true);
        setSchemaStatus("syncing");
        setTimeout(() => {
            setSchemaSyncing(false);
            setSchemaStatus("synced");
        }, 1200);
    };

    return (
        <div className="w-full flex flex-col gap-6 select-none">
            {/* ── Tabs Navigation Grid ── */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveTab(tab.id);
                                if (tab.id === "schema" && schemaStatus === "synced") {
                                    setSchemaStatus("diverged");
                                }
                            }}
                            className={`flex flex-col items-start text-left p-4 rounded-xl border transition-all duration-300 relative cursor-pointer ${
                                isActive
                                    ? "bg-surface-900 border-primary/40 ring-1 ring-primary/20 shadow-lg shadow-primary/5"
                                    : "bg-surface-950/60 border-surface-800/40 hover:bg-surface-900/50 hover:border-surface-800"
                            }`}
                        >
                            {/* Accent Glow for active tab */}
                            {isActive && (
                                <div className="absolute top-0 left-4 right-4 h-[2px] bg-gradient-to-r from-primary-light via-primary to-primary-dark rounded-full shadow-[0_0_10px_rgba(139,92,246,0.5)]" />
                            )}
                            <div className="flex items-center gap-2 mb-2">
                                <span className={`p-1.5 rounded-lg border transition-colors ${
                                    isActive 
                                        ? "bg-primary/10 text-primary-light border-primary/20" 
                                        : "bg-surface-900 text-surface-500 border-surface-800"
                                }`}>
                                    {tab.icon}
                                </span>
                                <span className={`text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-md ${
                                    isActive
                                        ? "bg-primary/20 text-primary-light border border-primary/30"
                                        : "bg-surface-900 text-surface-500 border border-surface-800/60"
                                }`}>
                                    {tab.badge}
                                </span>
                            </div>
                            <h3 className={`text-sm font-semibold mb-1 transition-colors ${isActive ? "text-white" : "text-surface-300"}`}>
                                {tab.title}
                            </h3>
                            <p className="text-[11px] text-surface-400 leading-relaxed font-sans line-clamp-2">
                                {tab.description}
                            </p>
                        </button>
                    );
                })}
            </div>

            {/* ── Active Tab Dashboard Workspace ── */}
            <div className="w-full rounded-2xl border border-surface-800/80 bg-surface-950/80 shadow-[0_15px_40px_rgba(0,0,0,0.55)] overflow-hidden">
                {/* Mock Window Controls Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-surface-800/60 bg-surface-900/30">
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-surface-500 ml-3 tracking-wide">
                            rebase-workspace / {activeTab === "schema" ? "schema_definition.ts" : activeTab === "sdk" ? "client_query.ts" : activeTab === "fields" ? "custom_rating_widget.tsx" : "row_level_security.sql"}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                        <span className="text-[10px] font-mono text-surface-500">Workspace Live</span>
                    </div>
                </div>

                {/* Split workspace details */}
                <div className="min-h-[480px] lg:grid lg:grid-cols-12">
                    
                    {/* ── TAB 1: SCHEMA AS CODE ── */}
                    {activeTab === "schema" && (
                        <>
                            {/* Code side */}
                            <div className="lg:col-span-6 border-b lg:border-b-0 lg:border-r border-surface-800/50 bg-[#0f0f11] p-5 font-mono text-[11px] leading-relaxed flex flex-col justify-between">
                                <div className="space-y-4">
                                    <div className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider mb-2">TypeScript Model definition</div>
                                    <pre className="text-surface-300">
                                        <span className="text-purple-400">import type</span> &#123; <span className="text-blue-300">PostgresCollectionConfig</span> &#125; <span className="text-purple-400">from</span> <span className="text-green-400">"@rebasepro/types"</span>;{"\n\n"}
                                        <span className="text-purple-400">export const</span> postsCollection: <span className="text-blue-300">PostgresCollectionConfig</span> = &#123;{"\n"}
                                        {"  "}name: <span className="text-green-400">"Posts"</span>,{"\n"}
                                        {"  "}slug: <span className="text-green-400">"posts"</span>,{"\n"}
                                        {"  "}table: <span className="text-green-400">"posts"</span>,{"\n"}
                                        {"  "}properties: &#123;{"\n"}
                                        {"    "}id: &#123; name: <span className="text-green-400">"ID"</span>, type: <span className="text-green-400">"string"</span>, validation: &#123; required: <span className="text-amber-400">true</span> &#125; &#125;,{"\n"}
                                        {"    "}title: &#123; name: <span className="text-green-400">"Title"</span>, type: <span className="text-green-400">"string"</span> &#125;,{"\n"}
                                        <span className={schemaStatus === "synced" ? "text-green-300 bg-green-500/10 border-l border-green-500 pl-1 animate-pulse" : "text-surface-400 opacity-60"}>
                                            {"    "}status: &#123; name: <span className="text-green-400">"Status"</span>, type: <span className="text-green-400">"string"</span>, validation: &#123; required: <span className="text-amber-400">true</span> &#125; &#125;
                                        </span>{"\n"}
                                        {"  "}&#125;{"\n"}
                                        &#125;;
                                    </pre>
                                </div>
                                <div className="mt-6 pt-4 border-t border-surface-800/40 flex items-center justify-between">
                                    <div className="text-[10px] text-surface-500">AST Mutator will append new fields to this file automatically when edited in UI.</div>
                                    <button
                                        onClick={runSchemaSync}
                                        disabled={schemaSyncing || schemaStatus === "synced"}
                                        className={`px-3 py-1.5 rounded-md font-semibold text-[10px] transition-all cursor-pointer ${
                                            schemaStatus === "synced"
                                                ? "bg-emerald-950/30 text-emerald-400 border border-emerald-900/40"
                                                : "bg-primary text-white hover:bg-primary-dark shadow-md shadow-primary/10"
                                        }`}
                                    >
                                        {schemaSyncing ? "Syncing..." : schemaStatus === "synced" ? "Database Synced" : "Sync schema to DB"}
                                    </button>
                                </div>
                            </div>
                            {/* Vis sync side */}
                            <div className="lg:col-span-6 bg-[#09090b] p-5 flex flex-col justify-between">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between border-b border-surface-800/50 pb-2.5">
                                        <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">Visual Studio Schema Editor</span>
                                        <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded border ${
                                            schemaStatus === "synced"
                                                ? "bg-emerald-950/30 text-emerald-400 border-emerald-900/40"
                                                : "bg-amber-950/30 text-amber-400 border-amber-900/40 animate-pulse"
                                        }`}>
                                            {schemaStatus === "synced" ? "SCHEMA SYNCED" : "UNAPPLIED AST CODE CHANGES"}
                                        </span>
                                    </div>
                                    <p className="text-xs text-surface-400 leading-relaxed font-sans">
                                        Rebase lets non-technical editors build database schemas visually. Any change updates the database instantly and generates type-safe AST code modifications.
                                    </p>
                                    <SchemaBuilderMiniDemo />
                                </div>
                                <div className="text-[10px] text-surface-500 font-mono bg-surface-900/40 px-3 py-2 rounded border border-surface-800/40">
                                    <span>Active Engine: </span>
                                    <code className="text-amber-400 font-semibold">drizzle-kit push:postgres</code>
                                </div>
                            </div>
                        </>
                    )}

                    {/* ── TAB 2: UNIVERSAL SDK ── */}
                    {activeTab === "sdk" && (
                        <>
                            {/* Code side */}
                            <div className="lg:col-span-7 border-b lg:border-b-0 lg:border-r border-surface-800/50 bg-[#0f0f11] flex flex-col">
                                <div className="p-4 border-b border-surface-800/40 flex items-center justify-between">
                                    <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">Universal SDK Console</span>
                                    <span className="text-[8px] text-blue-400 font-semibold bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">Isomorphic Drizzle client</span>
                                </div>
                                <div className="flex-1 min-h-[320px]">
                                    <SdkMiniDemo />
                                </div>
                            </div>
                            {/* API inspector side */}
                            <div className="lg:col-span-5 bg-[#09090b] flex flex-col">
                                <div className="p-4 border-b border-surface-800/40 flex items-center justify-between">
                                    <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">Generated REST Endpoint</span>
                                    <span className="text-[8px] text-green-400 font-semibold bg-green-500/10 px-1.5 py-0.5 rounded border border-green-500/20">Instant API</span>
                                </div>
                                <div className="flex-1 min-h-[320px]">
                                    <ApiMiniDemo />
                                </div>
                            </div>
                        </>
                    )}

                    {/* ── TAB 3: CUSTOM FIELDS ── */}
                    {activeTab === "fields" && (
                        <>
                            {/* Registration code side */}
                            <div className="lg:col-span-6 border-b lg:border-b-0 lg:border-r border-surface-800/50 bg-[#0f0f11] p-5 font-mono text-[11px] leading-relaxed flex flex-col justify-between">
                                <div className="space-y-4">
                                    <div className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">Custom widget registration</div>
                                    <pre className="text-surface-300">
                                        <span className="text-purple-400">import type</span> &#123; <span className="text-blue-300">NumberProperty</span> &#125; <span className="text-purple-400">from</span> <span className="text-green-400">"@rebasepro/types"</span>;{"\n"}
                                        <span className="text-purple-400">import</span> &#123; <span className="text-blue-300">RatingField</span> &#125; <span className="text-purple-400">from</span> <span className="text-green-400">"./widgets"</span>;{"\n\n"}
                                        <span className="text-purple-400">export const</span> ratingProperty: <span className="text-blue-300">NumberProperty</span> = &#123;{"\n"}
                                        {"  "}name: <span className="text-green-400">"Rating"</span>,{"\n"}
                                        {"  "}type: <span className="text-green-400">"number"</span>,{"\n"}
                                        {"  "}admin: &#123; Field: <span className="text-blue-300">RatingField</span> &#125;,{"\n"}
                                        {"  "}validation: &#123;{"\n"}
                                        {"    "}min: <span className="text-amber-400">0</span>,{"\n"}
                                        {"    "}max: <span className="text-amber-400">5</span>{"\n"}
                                        {"  "}&#125;{"\n"}
                                        &#125;;
                                    </pre>
                                </div>
                                <div className="text-[10px] text-surface-500 leading-normal border-t border-surface-800/40 pt-4">
                                    Register any standard React component as a widget. Rebase automatically handles the form lifecycle state, validation constraints, and serialization.
                                </div>
                            </div>
                            {/* Live custom widgets render side */}
                            <div className="lg:col-span-6 bg-[#09090b] flex flex-col justify-between">
                                <div className="flex-1">
                                    <CustomFieldsDemo />
                                </div>
                            </div>
                        </>
                    )}

                    {/* ── TAB 4: VISUAL SECURITY (RLS) ── */}
                    {activeTab === "security" && (
                        <div className="lg:col-span-12 bg-[#09090b] flex flex-col">
                            <div className="p-4 border-b border-surface-800/40 flex items-center justify-between">
                                <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-wider">Visual row-level security policy builder</span>
                                <span className="text-[8px] text-emerald-400 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">DB Level Security</span>
                            </div>
                            <div className="p-4">
                                <RLSEditorDemo />
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
