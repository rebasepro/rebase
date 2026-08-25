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

interface AdminDemoCarouselProps {
  height?: number;
  showTabs?: boolean;
  defaultTab?: number;
  autoPlay?: boolean;
  scale?: number;
}

export function AdminDemoCarousel({
  height = 600,
  showTabs = true,
  defaultTab = 0,
  autoPlay = true,
  scale = 1,
}: AdminDemoCarouselProps) {
  const [activeTab, setActiveTab] = useState<number>(defaultTab);
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
    if (!autoPlay) return;

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
  }, [activeTab, autoPlay]);

  const handleTabClick = useCallback(
    (index: number) => {
      switchTo(index);
    },
    [switchTo]
  );

  // Chrome bar (~44px) + content area (height) + tabs row with margin (~56px if visible)
  const chromeBarHeight = 44;
  const tabsHeight = showTabs ? 56 : 0;
  const totalMinHeight = height + chromeBarHeight + tabsHeight;

  const rootStyle: React.CSSProperties = {
    minHeight: totalMinHeight,
    ...(scale !== 1 ? { zoom: scale } : {}),
  };

  return (
    // `items-start`, not `items-center`. The browser frame is `w-full` so it is
    // unaffected either way, but the tab row below it is not: centred, it was
    // the only thing in the section off the 72rem shell edge, floating under a
    // left-aligned heading and a left-aligned frame.
    <div className="not-content flex flex-col items-start" style={rootStyle}>
      {/* Browser frame */}
      <div className="w-full rounded-2xl overflow-hidden border border-surface-800/80 bg-surface-950 shadow-[0_0_0_1px_rgba(15,23,42,0.55),0_24px_120px_rgba(0,0,0,0.65)]">
        {/* Browser Chrome */}
        <div 
          className="px-4 py-3 border-b border-surface-800/80 bg-surface-900/50 backdrop-blur-md"
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <div style={{ display: "flex", flexDirection: "row", gap: "6px", width: "64px", flexShrink: 0 }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "9999px", backgroundColor: "rgba(244, 63, 94, 0.8)", flexShrink: 0 }} />
            <div style={{ width: "10px", height: "10px", borderRadius: "9999px", backgroundColor: "rgba(251, 191, 36, 0.8)", flexShrink: 0 }} />
            <div style={{ width: "10px", height: "10px", borderRadius: "9999px", backgroundColor: "rgba(52, 211, 153, 0.8)", flexShrink: 0 }} />
          </div>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <div className="bg-surface-950/80 border border-surface-800/80 rounded-md px-3 py-1 text-[11px] font-mono text-surface-500" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Lock size={12} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: "11px", fontFamily: "monospace" }}>admin.yourdomain.com</span>
            </div>
          </div>
          <div style={{ width: "64px", flexShrink: 0 }} />
        </div>

        {/* Demo content area */}
        <div className="relative w-full" style={{ height }} inert={true} aria-hidden="true">
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
              {index === 0 && <OrdersListDemo height={height} />}
              {index === 1 && <EntityViewDemo fixedViewMode="table" height={height} />}
              {index === 2 && <EntityViewDemo fixedViewMode="kanban" height={height} />}
            </div>
          ))}
        </div>
      </div>

      {/* Tab indicators — below the browser frame */}
      {showTabs && (
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
      )}
    </div>
  );
}
