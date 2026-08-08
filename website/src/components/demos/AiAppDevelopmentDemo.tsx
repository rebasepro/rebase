import React, { useState } from "react";
import { Terminal, Code, Settings, Database, Brain, ArrowRight, Zap, Play, Check } from "lucide-react";

export default function AiAppDevelopmentDemo() {
  const [activeMode, setActiveMode] = useState<"recipes" | "pipelines">("recipes");
  const [recipeTab, setRecipeTab] = useState<"schema" | "sql">("schema");

  return (
    <div className="w-full max-w-6xl mx-auto rounded-3xl border border-surface-800 bg-[#070709] p-6 md:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative overflow-hidden">
      {/* Background glow effects - strictly using site primary blue (#0070f4) */}
      <div className="absolute -left-48 -top-48 w-[400px] h-[400px] rounded-full bg-primary/5 blur-[120px] pointer-events-none"></div>
      <div className="absolute -right-48 -bottom-48 w-[400px] h-[400px] rounded-full bg-primary/5 blur-[120px] pointer-events-none"></div>

      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:30px_30px] pointer-events-none"></div>

      {/* Header and Toggle */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8 pb-6 border-b border-surface-800/60 relative z-10">
        <div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold ring-1 ring-primary/20 mb-2">
            <Zap className="w-3.5 h-3.5" /> Decoupled Architectures
          </span>
          <h3 className="text-2xl font-semibold text-white tracking-tight">Decoupled AI Engine</h3>
          <p className="text-surface-400 text-sm mt-1">Implement intelligent features seamlessly without cluttering your core codebase.</p>
        </div>

        {/* Mode Selector */}
        <div className="flex bg-surface-900 p-1.5 rounded-xl border border-surface-800 self-start">
          <button
            onClick={() => setActiveMode("recipes")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
              activeMode === "recipes"
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "text-surface-400 hover:text-white"
            }`}
          >
            <Terminal className="w-4 h-4" /> CLI Recipes
          </button>
          <button
            onClick={() => setActiveMode("pipelines")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
              activeMode === "pipelines"
                ? "bg-primary text-white shadow-lg shadow-primary/20"
                : "text-surface-400 hover:text-white"
            }`}
          >
            <Settings className="w-4 h-4" /> Event Pipelines
          </button>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch relative z-10">
        
        {/* Left Column: Subtle descriptive cards that act as triggers */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          
          {/* Card 1: CLI Recipes */}
          <div
            onClick={() => setActiveMode("recipes")}
            className={`group p-5 rounded-2xl border text-left transition-all duration-300 cursor-pointer ${
              activeMode === "recipes"
                ? "bg-surface-900 border-primary/40 shadow-[0_4px_20px_rgba(0,112,244,0.1)]"
                : "bg-surface-950/40 border-surface-800/60 hover:border-surface-700"
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg border ${
                activeMode === "recipes" ? "bg-primary/10 border-primary/20 text-primary" : "bg-surface-900 border-surface-800 text-surface-500"
              }`}>
                <Terminal className="w-4 h-4" />
              </div>
              <h4 className="font-semibold text-white text-sm">CLI Recipes</h4>
              <span className="ml-auto text-[10px] text-surface-500 font-mono">Option 1</span>
            </div>
            <p className="text-surface-400 text-xs leading-relaxed">
              Inject custom collections and backend listeners directly into your codebase. 
              The AI callbacks execute on database events within your local project files.
            </p>
          </div>

          {/* Card 2: Event Pipelines */}
          <div
            onClick={() => setActiveMode("pipelines")}
            className={`group p-5 rounded-2xl border text-left transition-all duration-300 cursor-pointer ${
              activeMode === "pipelines"
                ? "bg-surface-900 border-primary/40 shadow-[0_4px_20px_rgba(0,112,244,0.1)]"
                : "bg-surface-950/40 border-surface-800/60 hover:border-surface-700"
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg border ${
                activeMode === "pipelines" ? "bg-primary/10 border-primary/20 text-primary" : "bg-surface-900 border-surface-800 text-surface-500"
              }`}>
                <Settings className="w-4 h-4" />
              </div>
              <h4 className="font-semibold text-white text-sm">Event Pipelines</h4>
              <span className="ml-auto text-[10px] text-surface-500 font-mono">Option 2</span>
            </div>
            <p className="text-surface-400 text-xs leading-relaxed">
              Configure database webhooks in the Rebase Studio UI. 
              Route write triggers directly to decoupled Hono custom functions to invoke LLM logic asynchronously.
            </p>
          </div>

          <div className="mt-auto p-4 rounded-xl bg-surface-900/40 border border-surface-800/60 hidden lg:block">
            <span className="text-[11px] font-semibold text-white block mb-1">Architectural Rule</span>
            <p className="text-[10px] text-surface-400 leading-normal">
              Never build third-party API dependencies into the core engine. Always inject features locally or route via event streams.
            </p>
          </div>
        </div>

        {/* Right Column: Sleek visual display */}
        <div className="lg:col-span-8">
          
          {/* Main Visual Frame */}
          <div className="rounded-2xl border border-surface-800 bg-[#0d0d0f] shadow-2xl flex flex-col h-[510px] overflow-hidden relative">
            
            {/* Window Topbar */}
            <div className="px-4 py-3 bg-[#121215] border-b border-surface-900 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80"></span>
              </div>
              
              {activeMode === "recipes" ? (
                <div className="flex items-center gap-2 font-mono text-[10px] text-slate-500 bg-[#09090b] px-3 py-1 rounded border border-surface-800">
                  <span className="text-primary font-semibold">$</span> rebase skills install --agent claude
                </div>
              ) : (
                <span className="text-[10px] font-mono text-slate-500">Rebase Studio · Webhook Designer</span>
              )}
              
              <div className="w-12"></div>
            </div>

            {/* Mode 1 Layout: Mock Editor */}
            {activeMode === "recipes" && (
              <div className="flex-1 flex flex-col overflow-hidden bg-[#0d0d0f]">
                {/* Editor Tabs */}
                <div className="flex bg-[#121215] border-b border-surface-900 select-none">
                  <button
                    onClick={() => setRecipeTab("schema")}
                    className={`px-4 py-2 text-xs font-mono flex items-center gap-2 border-r border-surface-900 cursor-pointer ${
                      recipeTab === "schema" ? "bg-[#0d0d0f] text-white border-t border-t-primary" : "text-surface-500 hover:text-surface-300"
                    }`}
                  >
                    <Code className="w-3.5 h-3.5 text-sky-400" />
                    collections/feedbacks.ts
                  </button>
                  <button
                    onClick={() => setRecipeTab("sql")}
                    className={`px-4 py-2 text-xs font-mono flex items-center gap-2 border-r border-surface-900 cursor-pointer ${
                      recipeTab === "sql" ? "bg-[#0d0d0f] text-white border-t border-t-primary" : "text-surface-500 hover:text-surface-300"
                    }`}
                  >
                    <Database className="w-3.5 h-3.5 text-amber-400" />
                    migrations/0015_ai.sql
                  </button>
                </div>

                {/* Styled Editor Pane */}
                <div className="flex-1 p-5 font-mono text-[11px] sm:text-xs text-slate-300 overflow-hidden leading-relaxed select-text bg-[#0d0d0f]">
                  {recipeTab === "schema" ? (
                    <div className="space-y-1">
                      <div><span className="text-slate-500">{"// collections/feedbacks.ts"}</span></div>
                      <div>
                        <span className="text-sky-400">import type</span> {"{"} PostgresCollectionConfig {"}"} <span className="text-sky-400">from</span> <span className="text-emerald-400">"@rebasepro/types"</span>;
                      </div>
                      <div>
                        <span className="text-sky-400">import</span> OpenAI <span className="text-sky-400">from</span> <span className="text-emerald-400">"openai"</span>;
                      </div>
                      <div className="h-2"></div>
                      <div>
                        <span className="text-sky-400">const</span> openai = <span className="text-sky-400">new</span> <span className="text-teal-400">OpenAI</span>();
                      </div>
                      <div className="h-2"></div>
                      <div>
                        <span className="text-sky-400">export const</span> feedbacks: <span className="text-blue-400">PostgresCollectionConfig</span> = {"{"}
                      </div>
                      <div className="pl-4">
                        slug: <span className="text-emerald-400">"feedbacks"</span>, table: <span className="text-emerald-400">"feedbacks"</span>,
                      </div>
                      <div className="pl-4">
                        properties: {"{"} content, aiSentiment, aiTags {"},"}
                      </div>
                      <div className="pl-4">
                        callbacks: {"{"}
                      </div>
                      <div className="pl-8">
                        <span className="text-slate-500">{"// Runs on every write — enrich the row before it hits Postgres"}</span>
                      </div>
                      <div className="pl-8">
                        beforeSave: <span className="text-sky-400">async</span> ({"{"} values {"}"}) =&gt; {"{"}
                      </div>
                      <div className="pl-12">
                        <span className="text-sky-400">const</span> ai = <span className="text-sky-400">await</span> <span className="text-blue-400">analyzeFeedback</span>(openai, values.content);
                      </div>
                      <div className="pl-12">
                        <span className="text-sky-400">return</span> {"{"} ...values, aiSentiment: ai.sentiment, aiTags: ai.tags {"};"}
                      </div>
                      <div className="pl-8">
                        {"}"}
                      </div>
                      <div className="pl-4">
                        {"}"}
                      </div>
                      <div>{"};"}</div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div><span className="text-slate-500">-- migrations/0015_add_ai_fields.sql</span></div>
                      <div className="h-2"></div>
                      <div>
                        <span className="text-sky-400 font-semibold">ALTER TABLE</span> <span className="text-teal-300">"feedbacks"</span>
                      </div>
                      <div>
                        <span className="text-sky-400 font-semibold">ADD COLUMN</span> <span className="text-teal-300">"ai_sentiment"</span> text,
                      </div>
                      <div>
                        <span className="text-sky-400 font-semibold">ADD COLUMN</span> <span className="text-teal-300">"ai_tags"</span> text[];
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Mode 2 Layout: Visual Event Pipeline Diagram */}
            {activeMode === "pipelines" && (
              <div className="flex-1 flex flex-col justify-between p-6 bg-[#0d0d0f] select-none">

                {/* Active flow labels */}
                <div className="w-full flex justify-between px-6 text-[10px] font-mono text-slate-500">
                  <span>Source Event</span>
                  <span>Webhook Router</span>
                  <span>Local Worker</span>
                </div>

                {/* Pipeline Flow Visualization. The 1.25rem connector offset compensates for the
                    ~40px of caption under each 64px icon tile, so the line crosses the icon centers. */}
                <div className="flex-1 flex items-center justify-between px-6 md:px-12 relative">

                  {/* Connector track + animated flow, behind the node tiles */}
                  <div
                    className="absolute left-14 right-14 md:left-20 md:right-20 top-[calc(50%-1.25rem)] -translate-y-1/2 h-1 rounded-full bg-[#232332] overflow-hidden"
                    aria-hidden="true"
                  >
                    <div
                      className="absolute inset-y-0 -left-8 w-[calc(100%+2rem)] animate-[flow_1.4s_linear_infinite]"
                      style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(0,112,244,0.9) 0px, rgba(0,112,244,0.9) 10px, transparent 10px, transparent 32px)" }}
                    />
                  </div>

                  {/* Node 1: Postgres Row (feedbacks) */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center border border-primary/20 bg-[#0e1520] text-primary shadow-[0_0_15px_rgba(0,112,244,0.05)]">
                      <Database className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-semibold text-white mt-2.5">Postgres Row</span>
                    <span className="text-[9px] font-mono text-slate-500">feedbacks table</span>
                  </div>

                  {/* Node 2: Webhook Trigger */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center border border-primary/30 bg-[#101b2e] text-primary shadow-[0_0_20px_rgba(0,112,244,0.1)]">
                      <Settings className="w-6 h-6 animate-[spin_8s_linear_infinite]" />
                    </div>
                    <span className="text-xs font-semibold text-white mt-2.5">Webhook Trigger</span>
                    <span className="text-[9px] font-mono text-slate-500">on row insert · no code</span>
                  </div>

                  {/* Node 3: AI Logic */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center border border-primary/20 bg-[#0e1520] text-primary shadow-[0_0_15px_rgba(0,112,244,0.05)]">
                      <Brain className="w-6 h-6 animate-pulse" />
                    </div>
                    <span className="text-xs font-semibold text-white mt-2.5">AI Worker</span>
                    <span className="text-[9px] font-mono text-slate-500">ai-extractor.ts</span>
                  </div>

                </div>

                {/* Subtext description panel */}
                <div className="bg-surface-900/50 border border-surface-800/60 rounded-xl p-3 text-[11px] font-mono text-slate-400 flex items-center gap-3 z-10 leading-relaxed">
                  <div className="h-2 w-2 rounded-full bg-primary animate-pulse shrink-0"></div>
                  <span>
                    When a row enters <code className="text-white">feedbacks</code>, Rebase forwards the payload to your local function to trigger the AI analysis asynchronously.
                  </span>
                </div>

              </div>
            )}
            
          </div>

        </div>

      </div>

      {/* Connector flow animation: one 32px pattern period per loop, so it tiles seamlessly */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes flow {
          to {
            transform: translateX(32px);
          }
        }
      `}} />

    </div>
  );
}
