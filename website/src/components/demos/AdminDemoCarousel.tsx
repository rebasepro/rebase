import React, { useState, useEffect, useRef, useCallback } from "react";
import { Lock, LayoutList, Table2, Columns3 } from "lucide-react";
import { EntityViewDemo } from "./EntityViewDemo";
import { OrdersListDemo } from "./OrdersListDemo";

const TABS = [
  { id: "list", label: "List", icon: LayoutList },
  { id: "spreadsheet", label: "Spreadsheet", icon: Table2 },
  { id: "kanban", label: "Kanban", icon: Columns3 },
] as const;

const AUTO_ADVANCE_MS = 12_000;

export function AdminDemoCarousel() {
  const [activeTab, setActiveTab] = useState<number>(0);
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef(Date.now());
  const rafRef = useRef<number | null>(null);

  const switchTo = useCallback((index: number) => {
    setActiveTab(index);
    setProgress(0);
    startTimeRef.current = Date.now();
  }, []);

  // Auto-advance with smooth progress bar
  useEffect(() => {
    startTimeRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(elapsed / AUTO_ADVANCE_MS, 1);
      setProgress(pct);

      if (pct >= 1) {
        setActiveTab((prev) => (prev + 1) % TABS.length);
        startTimeRef.current = Date.now();
        setProgress(0);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [activeTab]);

  const handleTabClick = useCallback(
    (index: number) => {
      switchTo(index);
    },
    [switchTo]
  );

  return (
    <div className="flex flex-col items-center">
      {/* Browser frame */}
      <div className="w-full rounded-2xl overflow-hidden border border-surface-800/80 bg-surface-950 shadow-[0_0_0_1px_rgba(15,23,42,0.55),0_24px_120px_rgba(0,0,0,0.65)]">
        {/* Browser Chrome */}
        <div className="px-4 py-3 border-b border-surface-800/80 flex items-center gap-2 bg-surface-900/50 backdrop-blur-md">
          <div className="flex gap-1.5 w-16">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="bg-surface-950/80 border border-surface-800/80 rounded-md px-3 py-1 text-[11px] font-mono text-surface-500 flex items-center gap-1.5">
              <Lock size={12} />
              admin.yourdomain.com
            </div>
          </div>
          <div className="w-16" />
        </div>

        {/* Demo content area */}
        <div className="relative w-full" style={{ height: 600 }}>
          {TABS.map((tab, index) => (
            <div
              key={tab.id}
              className="absolute inset-0 transition-all duration-500 ease-in-out"
              style={{
                opacity: activeTab === index ? 1 : 0,
                transform:
                  activeTab === index
                    ? "translateX(0)"
                    : index < activeTab
                      ? "translateX(-2%)"
                      : "translateX(2%)",
                pointerEvents: activeTab === index ? "auto" : "none",
                zIndex: activeTab === index ? 1 : 0,
              }}
            >
              {index === 0 && <OrdersListDemo />}
              {index === 1 && <EntityViewDemo fixedViewMode="table" />}
              {index === 2 && <EntityViewDemo fixedViewMode="kanban" />}
            </div>
          ))}
        </div>
      </div>

      {/* Tab indicators — below the browser frame */}
      <div className="flex items-center gap-2 mt-5">
        {TABS.map((tab, index) => {
          const isActive = activeTab === index;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(index)}
              className={`relative overflow-hidden flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all duration-300 cursor-pointer select-none ${
                isActive
                  ? "bg-surface-800/80 text-white border border-surface-700/60"
                  : "bg-surface-900/40 text-surface-500 border border-surface-800/40 hover:text-surface-300 hover:border-surface-700/60"
              }`}
            >
              {/* Progress fill for active tab */}
              {isActive && (
                <div
                  className="absolute inset-0 rounded-full overflow-hidden pointer-events-none"
                  style={{ zIndex: 0 }}
                >
                  <div
                    className="h-full bg-primary/20"
                    style={{
                      width: `${progress * 100}%`,
                      transition: "none",
                    }}
                  />
                </div>
              )}
              <Icon size={13} className="relative z-10" />
              <span className="relative z-10">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
